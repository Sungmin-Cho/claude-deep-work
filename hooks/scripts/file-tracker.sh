#!/usr/bin/env bash
# file-tracker.sh — PostToolUse hook: implement 단계 파일 변경 자동 추적 + receipt 수집
# v4.0: Bash 도구 지원, active slice에 변경 매핑, receipt JSON 업데이트
# Exit codes:
#   0 = always (PostToolUse hooks are informational only, never block)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# ─── 프로젝트 루트 & 상태 파일 ──────────────────────────────

init_deep_work_state
STATE_FILE_NORM="$(normalize_path "$STATE_FILE")"

# ─── Read stdin & cache FIRST (before any phase-based early exit) ──────
# phase-transition.sh depends on this cache regardless of phase. v6.2.4's
# initial cache placement was below the `!= implement` early-exit, so
# non-implement transitions (research→plan, plan→implement, test→idle)
# never got a fresh cache entry — breaking the injector on most phase
# changes. Move stdin read to the top and cache atomically.
TOOL_INPUT="$(cat)"
TOOL_NAME="${CLAUDE_TOOL_USE_TOOL_NAME:-${CLAUDE_TOOL_NAME:-}}"

_HOOK_INPUT_CACHE="$PROJECT_ROOT/.claude/.hook-tool-input.${PPID}"
mkdir -p "$(dirname "$_HOOK_INPUT_CACHE")" 2>/dev/null
_HOOK_INPUT_TMP="${_HOOK_INPUT_CACHE}.tmp.$$"
# Atomic write: truncate+write is non-atomic and a concurrent reader could
# see a partial JSON. Write to tmp and rename.
if printf '%s' "$TOOL_INPUT" > "$_HOOK_INPUT_TMP" 2>/dev/null; then
  mv "$_HOOK_INPUT_TMP" "$_HOOK_INPUT_CACHE" 2>/dev/null || rm -f "$_HOOK_INPUT_TMP" 2>/dev/null
fi

# 상태 파일이 없으면 즉시 종료
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── YAML frontmatter 파싱 ───────────────────────────────────

CURRENT_PHASE="$(read_frontmatter_field "$STATE_FILE" "current_phase")"
WORK_DIR="$(read_frontmatter_field "$STATE_FILE" "work_dir")"
ACTIVE_SLICE="$(read_frontmatter_field "$STATE_FILE" "active_slice")"

# ─── Marker file cache flip runs for any non-idle phase ─────
# We still need the sensor_cache_valid flip when a marker file (package.json,
# tsconfig.json, etc.) is modified in ANY phase — otherwise the sensor
# ecosystem cache goes stale across phase transitions. So defer the
# non-implement early-exit until AFTER the marker-file check at the bottom.

# implement 단계가 아닌 경우: receipt 업데이트는 skip, marker flip만 수행
_SKIP_RECEIPT=false
if [[ "$CURRENT_PHASE" != "implement" ]]; then
  _SKIP_RECEIPT=true
fi

# work_dir이 비어있으면 receipt skip (marker flip은 계속)
if [[ -z "$WORK_DIR" ]]; then
  _SKIP_RECEIPT=true
fi

FILE_PATH=""

if [[ "$TOOL_NAME" == "Bash" ]]; then
  # Bash 도구: command 필드에서 대상 파일 추출 시도 (best-effort)
  # file-changes.log에 명령 자체를 기록
  COMMAND=""
  if echo "$TOOL_INPUT" | grep -q '"command"'; then
    COMMAND="$(echo "$TOOL_INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  fi
  if [[ -n "$COMMAND" ]]; then
    FILE_PATH="[bash] $COMMAND"
  fi
else
  # Write/Edit/MultiEdit: file_path 추출 (JSON 파서로 escape된 따옴표 처리)
  FILE_PATH="$(extract_file_path_from_json "$TOOL_INPUT")"
fi

# file_path를 못 찾으면 종료
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# ─── 제외 대상 필터링 (Write/Edit만) ────────────────────────

if [[ "$TOOL_NAME" != "Bash" ]]; then
  PROJECT_ROOT_NORM="$(normalize_path "$PROJECT_ROOT")"
  FILE_PATH_NORM="$(normalize_path "$FILE_PATH")"

  RESOLVED_PATH_NORM="$FILE_PATH_NORM"
  if [[ "$FILE_PATH_NORM" =~ ^[A-Za-z]:/ ]] || [[ "$FILE_PATH_NORM" == /* ]]; then
    RESOLVED_PATH_NORM="$FILE_PATH_NORM"
  else
    RESOLVED_PATH_NORM="$(normalize_path "$PROJECT_ROOT_NORM/$FILE_PATH_NORM")"
  fi

  # .deep-work/ 디렉토리 내 문서 파일 제외
  if [[ "$RESOLVED_PATH_NORM" == *"/.deep-work/"* ]]; then
    exit 0
  fi
  # 상태 파일 자체 제외
  if [[ "$RESOLVED_PATH_NORM" == "$STATE_FILE_NORM" ]] || [[ "$RESOLVED_PATH_NORM" == *"/.claude/deep-work."*".md" ]]; then
    exit 0
  fi
fi

# ─── 파일 변경 로그 + receipt + ownership (implement phase only) ───────
# Marker file cache flip at the bottom still runs even for non-implement
# phases so the sensor ecosystem cache doesn't go stale across transitions.

if ! $_SKIP_RECEIPT; then

LOG_DIR="$PROJECT_ROOT/$WORK_DIR"
LOG_FILE="$LOG_DIR/file-changes.log"

mkdir -p "$LOG_DIR" 2>/dev/null || true

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# v4.0: active slice 정보 포함
if [[ -n "$ACTIVE_SLICE" ]]; then
  echo "$TIMESTAMP [$ACTIVE_SLICE] $FILE_PATH" >> "$LOG_FILE" 2>/dev/null || true
else
  echo "$TIMESTAMP $FILE_PATH" >> "$LOG_FILE" 2>/dev/null || true
fi

# ─── v4.0: Receipt 디렉토리에 변경 기록 ─────────────────────

if [[ -n "$ACTIVE_SLICE" ]]; then
  RECEIPT_DIR="$LOG_DIR/receipts"
  RECEIPT_FILE="$RECEIPT_DIR/${ACTIVE_SLICE}.json"
  mkdir -p "$RECEIPT_DIR" 2>/dev/null || true

  # 파일 변경을 receipt의 changes.files_modified에 추가 (best-effort).
  # Serialized by _acquire_lock; on lock timeout, queue to pending file that
  # a subsequent invocation will drain before its own update. Prevents lost
  # entries under concurrent PostToolUse invocations (v6.2.3 race).
  if command -v node &>/dev/null; then
    _RECEIPT_LOCK="${RECEIPT_FILE}.lock"
    _RECEIPT_PENDING="${RECEIPT_FILE}.pending-changes.jsonl"

    # Extended retries (2s total) make normal-contention timeouts rare; the
    # pending sidecar is now truly a last-resort safety net rather than a
    # routine path.
    if _acquire_lock "$_RECEIPT_LOCK" 40 0.05; then
      node -e '
        const fs = require("fs");
        const [, receiptFile, pendingFile, filePath, ts, sliceId] = process.argv;
        const drainingFile = pendingFile + ".draining." + process.pid;
        try {
          const r = fs.existsSync(receiptFile)
            ? JSON.parse(fs.readFileSync(receiptFile, "utf8"))
            : {
                slice_id: sliceId, status: "in_progress", tdd_state: "PENDING",
                tdd: {}, changes: { files_modified: [], lines_added: 0, lines_removed: 0 },
                verification: {}, spec_compliance: {}, code_review: {}, debug: null,
                timestamp: ts
              };
          if (!r.changes) r.changes = { files_modified: [] };
          if (!r.changes.files_modified) r.changes.files_modified = [];

          // Crash-safe drain: rename pending to .draining.<pid> BEFORE reading.
          // If we crash between rename and receipt write, the .draining file
          // survives and the next invocation can recover. If we unlinked
          // before writing (the v6.2.4 original bug), entries would be lost.
          let drainLines = [];
          if (fs.existsSync(pendingFile)) {
            try {
              fs.renameSync(pendingFile, drainingFile);
              drainLines = fs.readFileSync(drainingFile, "utf8").split("\n").filter(Boolean);
            } catch(_) { /* another drainer beat us — that is fine */ }
          }
          // Also pick up any .draining files from previous crashed drains.
          try {
            const dir = receiptFile.substring(0, receiptFile.lastIndexOf("/"));
            for (const name of fs.readdirSync(dir)) {
              if (name.startsWith(pendingFile.substring(pendingFile.lastIndexOf("/") + 1) + ".draining.") && (dir + "/" + name) !== drainingFile) {
                try {
                  drainLines = drainLines.concat(
                    fs.readFileSync(dir + "/" + name, "utf8").split("\n").filter(Boolean)
                  );
                  fs.unlinkSync(dir + "/" + name);
                } catch(_) {}
              }
            }
          } catch(_) {}

          for (const line of drainLines) {
            try {
              const entry = JSON.parse(line);
              if (typeof entry.file_path === "string" && !r.changes.files_modified.includes(entry.file_path)) {
                r.changes.files_modified.push(entry.file_path);
              }
            } catch(_) { /* skip malformed pending line */ }
          }

          // Add current change.
          if (!r.changes.files_modified.includes(filePath)) r.changes.files_modified.push(filePath);
          r.timestamp = ts;

          // Atomic canonical write.
          const tmp = receiptFile + ".tmp." + process.pid;
          fs.writeFileSync(tmp, JSON.stringify(r, null, 2));
          fs.renameSync(tmp, receiptFile);

          // Canonical committed — now safe to unlink the .draining file.
          try { if (fs.existsSync(drainingFile)) fs.unlinkSync(drainingFile); } catch(_) {}
        } catch(e) {
          process.stderr.write("file-tracker receipt update error: " + e.message + "\n");
          try { fs.unlinkSync(receiptFile + ".tmp." + process.pid); } catch(_) {}
          // NOTE: do not delete .draining on error — it is recoverable.
        }
      ' "$RECEIPT_FILE" "$_RECEIPT_PENDING" "$FILE_PATH" "$TIMESTAMP" "$ACTIVE_SLICE" 2>>"$PROJECT_ROOT/.claude/deep-work-guard-errors.log" || true
      _release_lock "$_RECEIPT_LOCK"
    else
      # Lock timeout (very rare after retry bump) — queue for the next
      # invocation's drain. /deep-finish and session-end also sweep pending
      # files as a safety net.
      node -e '
        const fs = require("fs");
        const [, pendingFile, filePath, ts] = process.argv;
        fs.appendFileSync(pendingFile, JSON.stringify({ file_path: filePath, ts }) + "\n");
      ' "$_RECEIPT_PENDING" "$FILE_PATH" "$TIMESTAMP" 2>/dev/null || true
    fi
  fi
fi

# ─── v5.4: File ownership registration ─────────────────────
# Register edited files in the session registry for cross-session protection.
# Errors are silenced — PostToolUse hooks must never block.

if [[ -n "${DEEP_WORK_SESSION_ID:-}" ]]; then
  OWNERSHIP_PATH=""

  if [[ "$TOOL_NAME" == "Bash" ]]; then
    # Extract target file from bash command using phase-guard-core.js helpers
    BASH_CMD="${FILE_PATH#\[bash\] }"
    OWNERSHIP_PATH="$(echo "$BASH_CMD" | node -e "
      const {detectBashFileWrite, extractBashTargetFile} = require('./phase-guard-core.js');
      let d=''; process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{
        if(detectBashFileWrite(d)){
          const f=extractBashTargetFile(d);
          if(f) console.log(f);
        }
      });
    " 2>/dev/null || echo "")"
  else
    # Write/Edit/MultiEdit: use the already-resolved normalized path
    OWNERSHIP_PATH="$RESOLVED_PATH_NORM"
  fi

  if [[ -n "$OWNERSHIP_PATH" ]]; then
    (register_file_ownership "$DEEP_WORK_SESSION_ID" "$OWNERSHIP_PATH") 2>/dev/null || true
  fi

  (update_last_activity "$DEEP_WORK_SESSION_ID") 2>/dev/null || true
fi

fi  # end of: if ! $_SKIP_RECEIPT

# ─── v5.7: Marker file cache invalidation ─────────────────────
# If a marker file was created/modified, invalidate the sensor ecosystem cache.
# Marker files: package.json, tsconfig.json, pyproject.toml, setup.py,
#   requirements.txt, CMakeLists.txt, *.csproj, *.sln

if [[ "$TOOL_NAME" != "Bash" && -n "${FILE_PATH:-}" ]]; then
  MARKER_BASENAME="$(basename "${FILE_PATH}")"
  IS_MARKER=false

  case "$MARKER_BASENAME" in
    package.json|tsconfig.json|pyproject.toml|setup.py|requirements.txt|CMakeLists.txt)
      IS_MARKER=true ;;
    *.csproj|*.sln)
      IS_MARKER=true ;;
  esac

  if $IS_MARKER && [[ -f "$STATE_FILE" ]]; then
    # Portable frontmatter flip via Node.js (was BSD-only `sed -i ''` — failed
    # on Linux and also mis-handled the insert case even on macOS).
    #
    # v6.2.4 post-review: acquire ${STATE_FILE}.lock — sensor-trigger.js
    # already takes this same lock before its state-YAML read-modify-write,
    # so concurrent runs (marker file edited while session is in
    # implement+GREEN) no longer lose sensor_pending or sensor_cache_valid.
    _STATE_LOCK="${STATE_FILE}.lock"
    if _acquire_lock "$_STATE_LOCK" 20 0.05; then
      node -e '
        const fs = require("fs");
        const f = process.argv[1];
        try {
          let t = fs.readFileSync(f, "utf8");
          if (/^sensor_cache_valid:/m.test(t)) {
            t = t.replace(/^sensor_cache_valid:.*$/m, "sensor_cache_valid: false");
          } else {
            // Insert right after the opening --- delimiter
            t = t.replace(/^---\n/, "---\nsensor_cache_valid: false\n");
          }
          fs.writeFileSync(f, t);
        } catch(_) { /* best-effort: never block PostToolUse */ }
      ' "$STATE_FILE" 2>>"$PROJECT_ROOT/.claude/deep-work-guard-errors.log" || true
      _release_lock "$_STATE_LOCK"
    fi
    # On lock timeout, skip the flip for this invocation; the next marker
    # write will try again. Staleness window is one tool call.
  fi
fi

exit 0
