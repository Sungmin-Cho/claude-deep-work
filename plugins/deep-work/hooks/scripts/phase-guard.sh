#!/usr/bin/env bash
# phase-guard.sh — PreToolUse hook for deep-work v4.0 Evidence-Driven Protocol
#
# Bash fast path handles simple checks (~50ms).
# Complex logic (TDD state machine, Bash command analysis) delegates to Node.js (~200ms).
#
# Exit codes:
#   0 = allow the tool use
#   2 = block the tool use (with JSON reason on stdout)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

init_deep_work_state

# ─── Session ID for multi-session ownership checks ──────────
CURRENT_SESSION_ID="${DEEP_WORK_SESSION_ID:-}"
if [[ -z "$CURRENT_SESSION_ID" ]]; then
  _PTR="$PROJECT_ROOT/.claude/deep-work-current-session"
  [[ -f "$_PTR" ]] && CURRENT_SESSION_ID="$(tr -d '\n\r' < "$_PTR")"
fi

# Helper: block with file ownership message and exit
block_ownership() {
  local fp="$1" result="$2"
  local parsed
  parsed="$(echo "$result" | node -e "
    process.stdin.setEncoding('utf8');let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{try{const o=JSON.parse(d);process.stdout.write((o.owner_session||'')+'|'+(o.task||''))}catch(e){process.stdout.write('|')}});
  " 2>/dev/null || echo "|")"
  local owner_sid="${parsed%%|*}"
  local owner_task="${parsed#*|}"
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 이 파일은 다른 세션의 작업 영역입니다.\n\n세션: ${owner_sid} (${owner_task})\n파일: ${fp}\n\n해당 세션에서 작업하거나, /deep-status --all로 세션 목록을 확인하세요."}
JSON
  exit 2
}

# ─── FAST PATH: No state file → allow everything ─────────────

if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── FAST PATH: Read phase from YAML frontmatter ─────────────

CURRENT_PHASE="$(read_frontmatter_field "$STATE_FILE" "current_phase")"
WORK_DIR="$(read_frontmatter_field "$STATE_FILE" "work_dir")"
TDD_MODE="$(read_frontmatter_field "$STATE_FILE" "tdd_mode")"
ACTIVE_SLICE="$(read_frontmatter_field "$STATE_FILE" "active_slice")"
TDD_STATE="$(read_frontmatter_field "$STATE_FILE" "tdd_state")"
TDD_OVERRIDE="$(read_frontmatter_field "$STATE_FILE" "tdd_override")"
SKIPPED_PHASES="$(read_frontmatter_field "$STATE_FILE" "skipped_phases")"

# ─── FAST PATH: idle or empty phase → allow ──────────────────

if [[ -z "$CURRENT_PHASE" || "$CURRENT_PHASE" == "idle" ]]; then
  exit 0
fi

# ─── Read tool input from stdin ───────────────────────────────

TOOL_INPUT="$(cat)"

# Detect tool name from environment (set by hooks system)
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"

# ─── Ownership check: implement phase ────────────────────────
if [[ "$CURRENT_PHASE" == "implement" && -n "$CURRENT_SESSION_ID" ]]; then
  _OWN_FILE=""
  if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "MultiEdit" ]]; then
    if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
      _OWN_FILE="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
    fi
  elif [[ "$TOOL_NAME" == "Bash" ]]; then
    _BASH_CMD="$(echo "$TOOL_INPUT" | node -e "
      process.stdin.setEncoding('utf8');let d='';
      process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).command||'')}catch(e){}});
    " 2>/dev/null || echo "")"
    if [[ -n "$_BASH_CMD" ]]; then
      _OWN_FILE="$(printf '%s' "$_BASH_CMD" | node -e "
        const {detectBashFileWrite,extractBashTargetFile}=require(process.argv[1]);
        let d='';process.stdin.on('data',c=>d+=c);
        process.stdin.on('end',()=>{
          const r=detectBashFileWrite(d);
          if(r.isFileWrite){const f=extractBashTargetFile(d);if(f)process.stdout.write(f);}
        });
      " "$SCRIPT_DIR/phase-guard-core.js" 2>/dev/null || echo "")"
    fi
  fi

  if [[ -n "$_OWN_FILE" ]]; then
    _OWN_FILE_NORM="$(normalize_path "$_OWN_FILE")"
    if [[ "$_OWN_FILE_NORM" =~ ^[A-Za-z]:/ ]] || [[ "$_OWN_FILE_NORM" == /* ]]; then
      : # already absolute
    else
      _OWN_FILE_NORM="$(normalize_path "$(normalize_path "$PROJECT_ROOT")/$_OWN_FILE_NORM")"
    fi
    OWNERSHIP_RESULT=""
    if ! OWNERSHIP_RESULT="$(check_file_ownership "$CURRENT_SESSION_ID" "$_OWN_FILE_NORM" 2>/dev/null)"; then
      block_ownership "$_OWN_FILE" "$OWNERSHIP_RESULT"
    fi
  fi
fi

# ─── FAST PATH: implement phase, Write/Edit, relaxed mode ────

if [[ "$CURRENT_PHASE" == "implement" && "$TDD_MODE" == "relaxed" && "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# ─── FAST PATH: implement phase, spike mode → allow ──────────

if [[ "$CURRENT_PHASE" == "implement" && "$TDD_MODE" == "spike" ]]; then
  exit 0
fi

# ─── FAST PATH: implement phase, TDD override active → allow ─

if [[ "$CURRENT_PHASE" == "implement" && -n "$TDD_OVERRIDE" && "$TDD_OVERRIDE" == "$ACTIVE_SLICE" && "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# ─── FAST PATH: non-implement phase, Write/Edit → block ──────
# (research, plan, test, brainstorm) — same logic as v3.3.3

if [[ "$CURRENT_PHASE" != "implement" && "$TOOL_NAME" != "Bash" ]]; then
  # If current phase was skipped (v5.1 skip-to-implement), allow
  if [[ -n "$SKIPPED_PHASES" && ",${SKIPPED_PHASES}," == *",${CURRENT_PHASE},"* ]]; then
    exit 0
  fi

  # Extract file_path for block message
  FILE_PATH=""
  if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
    FILE_PATH="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  fi

  # If no file_path: block for Write/Edit/MultiEdit (fail-closed), allow others
  if [[ -z "$FILE_PATH" ]]; then
    if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "MultiEdit" ]]; then
      cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 현재 ${CURRENT_PHASE} 단계입니다. 파일 경로를 확인할 수 없어 차단되었습니다.\n\n다시 시도해주세요."}
JSON
      exit 2
    fi
    exit 0
  fi

  FILE_PATH_NORM="$(normalize_path "$FILE_PATH")"
  RESOLVED_PATH_NORM="$FILE_PATH_NORM"
  PROJECT_ROOT_NORM="$(normalize_path "$PROJECT_ROOT")"
  if [[ "$FILE_PATH_NORM" =~ ^[A-Za-z]:/ ]] || [[ "$FILE_PATH_NORM" == /* ]]; then
    RESOLVED_PATH_NORM="$FILE_PATH_NORM"
  else
    RESOLVED_PATH_NORM="$(normalize_path "$PROJECT_ROOT_NORM/$FILE_PATH_NORM")"
  fi

  # Allow deep-work/ directory and state file
  if [[ "$RESOLVED_PATH_NORM" == *"/deep-work/"* ]]; then
    exit 0
  fi
  if [[ "$RESOLVED_PATH_NORM" == *"/.claude/deep-work."*".md" ]]; then
    exit 0
  fi

  # File ownership check (multi-session protection)
  if [[ -n "$CURRENT_SESSION_ID" ]]; then
    OWNERSHIP_RESULT=""
    if ! OWNERSHIP_RESULT="$(check_file_ownership "$CURRENT_SESSION_ID" "$RESOLVED_PATH_NORM" 2>/dev/null)"; then
      block_ownership "$FILE_PATH" "$OWNERSHIP_RESULT"
    fi
  fi

  # Block with phase-specific message
  PHASE_LABEL=""
  NEXT_STEP=""
  case "$CURRENT_PHASE" in
    research)
      PHASE_LABEL="리서치(Research)"
      NEXT_STEP="리서치가 완료되면 /deep-plan을 실행하세요."
      ;;
    plan)
      PHASE_LABEL="기획(Plan)"
      NEXT_STEP="계획을 승인하면 자동으로 구현이 시작됩니다."
      ;;
    test)
      PHASE_LABEL="테스트(Test)"
      NEXT_STEP="테스트가 통과하면 세션이 자동 완료됩니다."
      ;;
    brainstorm)
      PHASE_LABEL="브레인스톰(Brainstorm)"
      NEXT_STEP="brainstorm.md를 승인하면 다음 단계로 진행됩니다."
      ;;
    *)
      PHASE_LABEL="$CURRENT_PHASE"
      NEXT_STEP="/deep-status로 현재 상태를 확인하세요."
      ;;
  esac

  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 현재 ${PHASE_LABEL} 단계입니다. 코드 파일 수정이 차단되었습니다.\n\n수정 시도된 파일: ${FILE_PATH}\n\n${NEXT_STEP}"}
JSON
  exit 2
fi

# ─── COMPLEX PATH: delegate to Node.js ───────────────────────
# Reached when:
# - Bash tool in any non-idle phase (file write detection)
# - implement phase with strict/coaching TDD mode (TDD state machine)

# Build JSON input for Node.js using stdin pipe (safe: avoids set -e failure on argv approach)
NODE_INPUT=$(printf '%s' "$TOOL_INPUT" | node -e "
  process.stdin.setEncoding('utf8');
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(d);
      const a = process.argv;
      const tdd_override = a[6] === a[3] && a[6] !== '';
      const state = { current_phase: a[1], tdd_mode: a[2], active_slice: a[3], tdd_state: a[4], tdd_override: tdd_override };
      console.log(JSON.stringify({ action: 'pre', toolName: a[5], toolInput: input, state: state }));
    } catch(e) {
      const a = process.argv;
      console.log(JSON.stringify({ action: 'pre', toolName: a[5] || 'unknown', toolInput: {}, state: { current_phase: a[1], tdd_mode: a[2] || 'strict', active_slice: a[3] || '', tdd_state: a[4] || 'PENDING', tdd_override: false } }));
    }
  });
" "$CURRENT_PHASE" "${TDD_MODE:-strict}" "$ACTIVE_SLICE" "${TDD_STATE:-PENDING}" "$TOOL_NAME" "${TDD_OVERRIDE:-}" 2>/dev/null || true)

# Call Node.js with timeout protection
NODE_RESULT=""
# Note: macOS has no `timeout` command. Use node's own setTimeout or rely on hook timeout (5s).
if NODE_RESULT=$(echo "$NODE_INPUT" | node "$SCRIPT_DIR/phase-guard-core.js" 2>/dev/null); then
  # Parse decision from Node.js output
  DECISION=$(echo "$NODE_RESULT" | grep -o '"decision"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"decision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

  if [[ "$DECISION" == "block" ]]; then
    # Extract reason and output as hook block response
    REASON=$(echo "$NODE_RESULT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).reason||'')}catch(e){console.log('')}})" 2>/dev/null || echo "TDD enforcement가 이 수정을 차단했습니다.")
    cat <<JSON
{"decision":"block","reason":"${REASON}"}
JSON
    exit 2
  fi

  # allow or warn → exit 0
  exit 0
else
  # Node.js failed or timed out → block + retry guidance (per eng review decision)
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: hook 검증 중 오류가 발생했습니다.\n\n다시 시도해주세요. 문제가 지속되면 /deep-status로 상태를 확인하세요."}
JSON
  exit 2
fi
