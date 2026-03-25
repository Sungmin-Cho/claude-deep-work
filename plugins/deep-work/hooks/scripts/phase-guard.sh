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

# ─── Utility: normalize path separators ──────────────────────

normalize_path() {
  local p="$1"
  p="${p//\\//}"
  while [[ "$p" == *"//"* ]]; do
    p="${p//\/\//\/}"
  done
  printf '%s' "$p"
}

# ─── Find project root ───────────────────────────────────────

find_project_root() {
  local dir="$PWD"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.claude" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  echo "$PWD"
  return 1
}

PROJECT_ROOT="$(find_project_root 2>/dev/null || echo "$PWD")"
STATE_FILE="$PROJECT_ROOT/.claude/deep-work.local.md"

# ─── FAST PATH: No state file → allow everything ─────────────

if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── FAST PATH: Read phase from YAML frontmatter ─────────────

CURRENT_PHASE=""
WORK_DIR=""
TDD_MODE=""
ACTIVE_SLICE=""
TDD_STATE=""
IN_FRONTMATTER=false
while IFS= read -r line; do
  if [[ "$line" == "---" ]]; then
    if $IN_FRONTMATTER; then
      break
    else
      IN_FRONTMATTER=true
      continue
    fi
  fi
  if $IN_FRONTMATTER; then
    if [[ "$line" =~ ^current_phase:[[:space:]]*(.+)$ ]]; then
      CURRENT_PHASE="${BASH_REMATCH[1]}"
      CURRENT_PHASE="${CURRENT_PHASE%\"}" ; CURRENT_PHASE="${CURRENT_PHASE#\"}"
      CURRENT_PHASE="${CURRENT_PHASE%\'}" ; CURRENT_PHASE="${CURRENT_PHASE#\'}"
    fi
    if [[ "$line" =~ ^work_dir:[[:space:]]*(.+)$ ]]; then
      WORK_DIR="${BASH_REMATCH[1]}"
      WORK_DIR="${WORK_DIR%\"}" ; WORK_DIR="${WORK_DIR#\"}"
      WORK_DIR="${WORK_DIR%\'}" ; WORK_DIR="${WORK_DIR#\'}"
    fi
    if [[ "$line" =~ ^tdd_mode:[[:space:]]*(.+)$ ]]; then
      TDD_MODE="${BASH_REMATCH[1]}"
      TDD_MODE="${TDD_MODE%\"}" ; TDD_MODE="${TDD_MODE#\"}"
      TDD_MODE="${TDD_MODE%\'}" ; TDD_MODE="${TDD_MODE#\'}"
    fi
    if [[ "$line" =~ ^active_slice:[[:space:]]*(.+)$ ]]; then
      ACTIVE_SLICE="${BASH_REMATCH[1]}"
      ACTIVE_SLICE="${ACTIVE_SLICE%\"}" ; ACTIVE_SLICE="${ACTIVE_SLICE#\"}"
      ACTIVE_SLICE="${ACTIVE_SLICE%\'}" ; ACTIVE_SLICE="${ACTIVE_SLICE#\'}"
    fi
    if [[ "$line" =~ ^tdd_state:[[:space:]]*(.+)$ ]]; then
      TDD_STATE="${BASH_REMATCH[1]}"
      TDD_STATE="${TDD_STATE%\"}" ; TDD_STATE="${TDD_STATE#\"}"
      TDD_STATE="${TDD_STATE%\'}" ; TDD_STATE="${TDD_STATE#\'}"
    fi
  fi
done < "$STATE_FILE"

# ─── FAST PATH: idle or empty phase → allow ──────────────────

if [[ -z "$CURRENT_PHASE" || "$CURRENT_PHASE" == "idle" ]]; then
  exit 0
fi

# ─── Read tool input from stdin ───────────────────────────────

TOOL_INPUT="$(cat)"

# Detect tool name from environment (set by hooks system)
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"

# ─── FAST PATH: implement phase, Write/Edit, relaxed mode ────

if [[ "$CURRENT_PHASE" == "implement" && "$TDD_MODE" == "relaxed" && "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# ─── FAST PATH: implement phase, spike mode → allow ──────────

if [[ "$CURRENT_PHASE" == "implement" && "$TDD_MODE" == "spike" ]]; then
  exit 0
fi

# ─── FAST PATH: non-implement phase, Write/Edit → block ──────
# (research, plan, test, brainstorm) — same logic as v3.3.3

if [[ "$CURRENT_PHASE" != "implement" && "$TOOL_NAME" != "Bash" ]]; then
  # Extract file_path for block message
  FILE_PATH=""
  if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
    FILE_PATH="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  fi

  # If no file_path, allow (safety)
  if [[ -z "$FILE_PATH" ]]; then
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
  if [[ "$RESOLVED_PATH_NORM" == *"/.claude/deep-work.local.md" ]]; then
    exit 0
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

NODE_INPUT=$(cat <<NODEJSON
{
  "action": "pre",
  "toolName": "${TOOL_NAME}",
  "toolInput": ${TOOL_INPUT},
  "state": {
    "current_phase": "${CURRENT_PHASE}",
    "tdd_mode": "${TDD_MODE:-strict}",
    "active_slice": "${ACTIVE_SLICE}",
    "tdd_state": "${TDD_STATE:-PENDING}"
  }
}
NODEJSON
)

# Call Node.js with timeout protection
NODE_RESULT=""
if NODE_RESULT=$(echo "$NODE_INPUT" | timeout 4 node "$SCRIPT_DIR/phase-guard-core.js" 2>/dev/null); then
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
