#!/usr/bin/env bash
# phase-guard.sh - Blocks code file edits during research, plan, and test phases
# Exit codes:
#   0 = allow the tool use
#   2 = block the tool use (with JSON reason on stdout)

set -euo pipefail

# Normalize path separators for cross-platform checks
# - Converts backslashes to slashes (Windows -> POSIX style)
# - Keeps drive letters (e.g. C:/...)
normalize_path() {
  local p="$1"
  p="${p//\\//}"
  # collapse duplicate slashes (except URL-like, which we don't expect here)
  while [[ "$p" == *"//"* ]]; do
    p="${p//\/\//\/}"
  done
  printf '%s' "$p"
}

# Find the project root by looking for .claude/ directory
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
PROJECT_ROOT_NORM="$(normalize_path "$PROJECT_ROOT")"
STATE_FILE_NORM="$(normalize_path "$STATE_FILE")"

# If no state file exists, deep-work workflow is not active → allow everything
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# Read current_phase and work_dir from YAML frontmatter
CURRENT_PHASE=""
WORK_DIR=""
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
      CURRENT_PHASE="${CURRENT_PHASE%\"}"
      CURRENT_PHASE="${CURRENT_PHASE#\"}"
      CURRENT_PHASE="${CURRENT_PHASE%\'}"
      CURRENT_PHASE="${CURRENT_PHASE#\'}"
    fi
    if [[ "$line" =~ ^work_dir:[[:space:]]*(.+)$ ]]; then
      WORK_DIR="${BASH_REMATCH[1]}"
      WORK_DIR="${WORK_DIR%\"}"
      WORK_DIR="${WORK_DIR#\"}"
      WORK_DIR="${WORK_DIR%\'}"
      WORK_DIR="${WORK_DIR#\'}"
    fi
  fi
done < "$STATE_FILE"

# If phase is implement, idle, or empty → allow
if [[ -z "$CURRENT_PHASE" || "$CURRENT_PHASE" == "implement" || "$CURRENT_PHASE" == "idle" ]]; then
  exit 0
fi

# For research, plan, and test phases, check what file is being edited
# Read tool input from stdin
TOOL_INPUT="$(cat)"

# Extract file_path from JSON input
FILE_PATH=""
if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
  FILE_PATH="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
fi

# If no file_path found, allow (might be a different tool format)
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Normalize the incoming file path for comparison
FILE_PATH_NORM="$(normalize_path "$FILE_PATH")"

# Resolve absolute/relative paths (supports POSIX + Windows drive-letter absolute paths)
RESOLVED_PATH_NORM="$FILE_PATH_NORM"
if [[ "$FILE_PATH_NORM" =~ ^[A-Za-z]:/ ]] || [[ "$FILE_PATH_NORM" == /* ]]; then
  RESOLVED_PATH_NORM="$FILE_PATH_NORM"
else
  RESOLVED_PATH_NORM="$(normalize_path "$PROJECT_ROOT_NORM/$FILE_PATH_NORM")"
fi

# Allow edits to deep-work/ directory (documentation files)
if [[ "$RESOLVED_PATH_NORM" == *"/deep-work/"* ]]; then
  exit 0
fi

# Allow edits to the state file itself
if [[ "$RESOLVED_PATH_NORM" == "$STATE_FILE_NORM" ]] || [[ "$RESOLVED_PATH_NORM" == *"/.claude/deep-work.local.md" ]]; then
  exit 0
fi

# Build phase-specific block message with next-step guidance
PHASE_LABEL=""
NEXT_STEP=""

case "$CURRENT_PHASE" in
  research)
    PHASE_LABEL="리서치(Research)"
    NEXT_STEP="👉 다음 단계: 리서치가 완료되면 /deep-plan을 실행하세요.\n   리서치가 아직 진행 중이라면 /deep-research를 실행하세요."
    ;;
  plan)
    PHASE_LABEL="기획(Plan)"
    NEXT_STEP="👉 다음 단계: 계획을 승인하면 자동으로 구현이 시작됩니다.\n   계획을 수정하려면 /deep-plan을 다시 실행하세요."
    ;;
  test)
    PHASE_LABEL="테스트(Test)"
    NEXT_STEP="👉 다음 단계:\n   - 테스트가 통과하면 세션이 자동 완료됩니다.\n   - 테스트 실패 시 implement 단계로 자동 복귀하여 수정할 수 있습니다.\n   - 현재 테스트 결과를 확인하려면 ${WORK_DIR}/test-results.md를 읽으세요."
    ;;
  *)
    PHASE_LABEL="$CURRENT_PHASE"
    NEXT_STEP="👉 /deep-status로 현재 상태를 확인하세요."
    ;;
esac

cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 현재 ${PHASE_LABEL} 단계입니다. 코드 파일 수정이 차단되었습니다.\n\n수정 시도된 파일: ${FILE_PATH}\n\n${PHASE_LABEL} 단계에서는 deep-work/ 디렉토리 내 문서만 수정할 수 있습니다.\n\n${NEXT_STEP}"}
JSON
exit 2
