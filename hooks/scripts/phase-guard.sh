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
  local fp_esc owner_sid_esc owner_task_esc
  fp_esc="$(json_escape "$fp")"
  owner_sid_esc="$(json_escape "$owner_sid")"
  owner_task_esc="$(json_escape "$owner_task")"
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 이 파일은 다른 세션의 작업 영역입니다.\n\n세션: ${owner_sid_esc} (${owner_task_esc})\n파일: ${fp_esc}\n\n해당 세션에서 작업하거나, /deep-status --all로 세션 목록을 확인하세요."}
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
WORKTREE_ENABLED="$(read_frontmatter_field "$STATE_FILE" "worktree_enabled")"
WORKTREE_PATH="$(read_frontmatter_field "$STATE_FILE" "worktree_path")"
# Slice scope enforcement inputs (v6.2.4 — previously missing; scope check was no-op).
SLICE_FILES_JSON="$(read_frontmatter_list "$STATE_FILE" "slice_files")"
STRICT_SCOPE="$(read_frontmatter_field "$STATE_FILE" "strict_scope")"
EXEMPT_PATTERNS_JSON="$(read_frontmatter_list "$STATE_FILE" "exempt_patterns")"

# ─── FAST PATH: idle or empty phase → allow ──────────────────

if [[ -z "$CURRENT_PHASE" || "$CURRENT_PHASE" == "idle" ]]; then
  exit 0
fi

# ─── Read tool input from stdin ───────────────────────────────

TOOL_INPUT="$(cat)"

# Detect tool name from environment (set by hooks system)
TOOL_NAME="${CLAUDE_TOOL_USE_TOOL_NAME:-${CLAUDE_TOOL_NAME:-}}"

# ─── File path extraction (all phases, for worktree guard + ownership) ──
# NOTE: 파일 경로 추출은 CURRENT_SESSION_ID와 무관하게 실행해야 한다 (F-02).
# Session ID가 없어도 P0 worktree guard는 작동해야 하므로, 경로 추출을
# session ID 조건 밖으로 분리하고, ownership check만 session ID 안에 유지한다.
_OWN_FILE=""
if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "MultiEdit" ]]; then
  # Use JSON parser instead of regex — handles escaped quotes in file paths
  _OWN_FILE="$(extract_file_path_from_json "$TOOL_INPUT")"
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

_OWN_FILE_NORM=""
if [[ -n "$_OWN_FILE" ]]; then
  _OWN_FILE_NORM="$(normalize_path "$_OWN_FILE")"
  if [[ "$_OWN_FILE_NORM" =~ ^[A-Za-z]:/ ]] || [[ "$_OWN_FILE_NORM" == /* ]]; then
    : # already absolute
  else
    _OWN_FILE_NORM="$(normalize_path "$(normalize_path "$PROJECT_ROOT")/$_OWN_FILE_NORM")"
  fi
fi

# Ownership check: implement phase + session ID required
if [[ -n "$CURRENT_SESSION_ID" && -n "$_OWN_FILE_NORM" ]]; then
  if [[ "$CURRENT_PHASE" == "implement" ]]; then
    OWNERSHIP_RESULT=""
    if ! OWNERSHIP_RESULT="$(check_file_ownership "$CURRENT_SESSION_ID" "$_OWN_FILE_NORM" 2>/dev/null)"; then
      block_ownership "$_OWN_FILE" "$OWNERSHIP_RESULT"
    fi
  fi
fi

# ─── P0: WORKTREE PATH ENFORCEMENT ─────────────────────────
# Blocks Write/Edit/Bash to files outside the active worktree path.
# Meta directories (.claude/, .deep-work/, .deep-review/, .deep-wiki/) are exempt.

if [[ "$WORKTREE_ENABLED" == "true" && -n "$WORKTREE_PATH" && -n "$_OWN_FILE_NORM" ]]; then
  WORKTREE_PATH_NORM="$(normalize_path "$WORKTREE_PATH")"

  if [[ "$_OWN_FILE_NORM" != "$WORKTREE_PATH_NORM"/* && "$_OWN_FILE_NORM" != "$WORKTREE_PATH_NORM" ]]; then
    # Meta directory exceptions — anchored to PROJECT_ROOT (C-3: prevents bypass via external .claude/ paths)
    _IS_META=false
    _PROJECT_ROOT_NORM="$(normalize_path "$PROJECT_ROOT")"
    for _meta_pat in ".claude/" ".deep-work/" ".deep-review/" ".deep-wiki/"; do
      if [[ "$_OWN_FILE_NORM" == "$_PROJECT_ROOT_NORM/$_meta_pat"* ]]; then
        _IS_META=true
        break
      fi
    done

    if [[ "$_IS_META" == "false" ]]; then
      _OWN_FILE_ESC="$(json_escape "$_OWN_FILE")"
      _WORKTREE_PATH_ESC="$(json_escape "$WORKTREE_PATH")"
      cat <<JSON
{"decision":"block","reason":"⛔ Worktree Guard: worktree 외부 파일 수정 차단\n\n대상: ${_OWN_FILE_ESC}\n허용 경로: ${_WORKTREE_PATH_ESC}/\n\nworktree 내에서 작업해주세요."}
JSON
      exit 2
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

  # F-17: Use _OWN_FILE/_OWN_FILE_NORM from unified extraction above (no duplicate grep)
  # If no file_path: block for Write/Edit/MultiEdit (fail-closed), allow others
  if [[ -z "$_OWN_FILE" ]]; then
    if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "MultiEdit" ]]; then
      cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 현재 ${CURRENT_PHASE} 단계입니다. 파일 경로를 확인할 수 없어 차단되었습니다.\n\n다시 시도해주세요."}
JSON
      exit 2
    fi
    exit 0
  fi

  # Allow .deep-work/ directory and state file
  if [[ "$_OWN_FILE_NORM" == *"/.deep-work/"* ]]; then
    exit 0
  fi
  if [[ "$_OWN_FILE_NORM" == *"/.claude/deep-work."*".md" ]]; then
    exit 0
  fi

  # File ownership check (multi-session protection)
  if [[ -n "$CURRENT_SESSION_ID" ]]; then
    OWNERSHIP_RESULT=""
    if ! OWNERSHIP_RESULT="$(check_file_ownership "$CURRENT_SESSION_ID" "$_OWN_FILE_NORM" 2>/dev/null)"; then
      block_ownership "$_OWN_FILE" "$OWNERSHIP_RESULT"
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

  _OWN_FILE_ESC="$(json_escape "$_OWN_FILE")"
  _PHASE_LABEL_ESC="$(json_escape "$PHASE_LABEL")"
  _NEXT_STEP_ESC="$(json_escape "$NEXT_STEP")"
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 현재 ${_PHASE_LABEL_ESC} 단계입니다. 코드 파일 수정이 차단되었습니다.\n\n수정 시도된 파일: ${_OWN_FILE_ESC}\n\n${_NEXT_STEP_ESC}"}
JSON
  exit 2
fi

# ─── COMPLEX PATH: delegate to Node.js ───────────────────────
# Reached when:
# - Bash tool in any non-idle phase (file write detection)
# - implement phase with strict/coaching TDD mode (TDD state machine)

# Build JSON input for Node.js using stdin pipe (safe: avoids set -e failure on argv approach).
# Pass slice_files/strict_scope/exempt_patterns too — previously omitted, leaving
# checkSliceScope a no-op (slice scope contract was silently unenforced).
NODE_INPUT=$(printf '%s' "$TOOL_INPUT" | node -e "
  process.stdin.setEncoding('utf8');
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    const a = process.argv;
    const buildState = () => {
      const tdd_override = a[6] === a[3] && a[6] !== '';
      let slice_files = []; try { slice_files = JSON.parse(a[7] || '[]'); } catch(_) {}
      let exempt_patterns = []; try { exempt_patterns = JSON.parse(a[9] || '[]'); } catch(_) {}
      return {
        current_phase: a[1],
        tdd_mode: a[2] || 'strict',
        active_slice: a[3] || '',
        tdd_state: a[4] || 'PENDING',
        tdd_override,
        slice_files,
        strict_scope: a[8] === 'true',
        exempt_patterns,
      };
    };
    try {
      const input = JSON.parse(d);
      console.log(JSON.stringify({ action: 'pre', toolName: a[5], toolInput: input, state: buildState() }));
    } catch(e) {
      console.log(JSON.stringify({ action: 'pre', toolName: a[5] || 'unknown', toolInput: {}, state: buildState() }));
    }
  });
" "$CURRENT_PHASE" "${TDD_MODE:-strict}" "$ACTIVE_SLICE" "${TDD_STATE:-PENDING}" "$TOOL_NAME" "${TDD_OVERRIDE:-}" "${SLICE_FILES_JSON:-[]}" "${STRICT_SCOPE:-false}" "${EXEMPT_PATTERNS_JSON:-[]}" 2>/dev/null || true)

# Call Node.js with error-code discipline (v6.2.4):
#   exit 0   → success; inspect decision on stdout (allow / warn / block)
#   exit 3   → internal Node error; stdout has a 내부 검증 오류 block message
#   other    → subprocess crash / OOM / timeout; emit generic block
NODE_ERR_LOG="$PROJECT_ROOT/.claude/deep-work-guard-errors.log"
set +e
NODE_RESULT=$(echo "$NODE_INPUT" | node "$SCRIPT_DIR/phase-guard-core.js" 2>>"$NODE_ERR_LOG")
NODE_RC=$?
set -e

if [[ $NODE_RC -eq 3 ]]; then
  # Internal error — Node already emitted the block JSON with the debug hint.
  printf '%s' "$NODE_RESULT"
  exit 2
fi

if [[ $NODE_RC -ne 0 ]]; then
  # Subprocess crash / unexpected exit — generic block.
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: hook 검증 중 오류가 발생했습니다.\n\n다시 시도해주세요. 문제가 지속되면 /deep-status로 상태를 확인하세요."}
JSON
  exit 2
fi

# Parse decision from Node.js output.
DECISION=$(echo "$NODE_RESULT" | grep -o '"decision"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"decision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [[ -z "$DECISION" ]]; then
  # Fail-closed: malformed stdout or missing decision field.
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 가드가 결정을 생성하지 못했습니다. 다시 시도해주세요."}
JSON
  exit 2
fi

if [[ "$DECISION" == "block" ]]; then
  # Extract reason (already JSON-escaped by Node).
  REASON=$(echo "$NODE_RESULT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const s=JSON.stringify(JSON.parse(d).reason||'');process.stdout.write(s.slice(1,-1))}catch(e){process.stdout.write('TDD enforcement가 이 수정을 차단했습니다.')}})" 2>/dev/null || echo "TDD enforcement가 이 수정을 차단했습니다.")
  cat <<JSON
{"decision":"block","reason":"${REASON}"}
JSON
  exit 2
fi

# allow or warn → exit 0
exit 0
