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

# 상태 파일이 없으면 즉시 종료
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── YAML frontmatter 파싱 ───────────────────────────────────

CURRENT_PHASE="$(read_frontmatter_field "$STATE_FILE" "current_phase")"
WORK_DIR="$(read_frontmatter_field "$STATE_FILE" "work_dir")"
ACTIVE_SLICE="$(read_frontmatter_field "$STATE_FILE" "active_slice")"

# implement 단계가 아니면 즉시 종료
if [[ "$CURRENT_PHASE" != "implement" ]]; then
  exit 0
fi

# work_dir이 비어있으면 종료
if [[ -z "$WORK_DIR" ]]; then
  exit 0
fi

# ─── 도구 입력 파싱 ──────────────────────────────────────────

TOOL_INPUT="$(cat)"
TOOL_NAME="${CLAUDE_TOOL_USE_TOOL_NAME:-${CLAUDE_TOOL_NAME:-}}"

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

# ─── 파일 변경 로그에 기록 ───────────────────────────────────

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

  # receipt 파일이 없으면 초기 생성
  if [[ ! -f "$RECEIPT_FILE" ]]; then
    node -e "
      const fs = require('fs');
      const args = process.argv.filter(a => a !== '[eval]');
      const sliceId = args[1], ts = args[2], receiptPath = args[3];
      const data = {
        slice_id: sliceId, status: 'in_progress', tdd_state: 'PENDING',
        tdd: {}, changes: { files_modified: [], lines_added: 0, lines_removed: 0 },
        verification: {}, spec_compliance: {}, code_review: {}, debug: null,
        timestamp: ts
      };
      fs.writeFileSync(receiptPath, JSON.stringify(data, null, 2));
    " "$ACTIVE_SLICE" "$TIMESTAMP" "$RECEIPT_FILE" 2>/dev/null || true
  fi

  # 파일 변경을 receipt의 changes.files_modified에 추가 (best-effort)
  # Node.js로 정확한 JSON 조작 — process.argv로 전달하여 injection 방지
  if command -v node &>/dev/null; then
    node -e "
      const fs = require('fs');
      const args = process.argv.filter(a => a !== '[eval]');
      const [, receiptFile, filePath, ts] = args;
      try {
        const r = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
        if (!r.changes) r.changes = { files_modified: [] };
        if (!r.changes.files_modified) r.changes.files_modified = [];
        if (!r.changes.files_modified.includes(filePath)) r.changes.files_modified.push(filePath);
        r.timestamp = ts;
        const tmp = receiptFile + '.tmp.' + process.pid;
        fs.writeFileSync(tmp, JSON.stringify(r, null, 2));
        fs.renameSync(tmp, receiptFile);
      } catch(e) {
        process.stderr.write('file-tracker receipt update error: ' + e.message + '\\n');
        try { fs.unlinkSync(receiptFile + '.tmp.' + process.pid); } catch(_) {}
      }
    " "$RECEIPT_FILE" "$FILE_PATH" "$TIMESTAMP" 2>/dev/null || true
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
  fi
fi

exit 0
