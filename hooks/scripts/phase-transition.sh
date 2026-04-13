#!/usr/bin/env bash
# phase-transition.sh — PostToolUse hook: phase 전환 감지 → 조건 checklist injection
#
# state 파일의 current_phase가 변경되면 worktree_path, team_mode 등
# 핵심 조건을 stdout으로 출력하여 LLM context에 주입한다.
#
# Exit codes:
#   0 = always (PostToolUse hooks are informational, never block)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

init_deep_work_state

# ─── Read tool input from environment variable (F-04) ───────
# PostToolUse hooks 배열에서 앞선 hook(file-tracker.sh)이 stdin을 소비할 수 있으므로,
# stdin 대신 환경변수 $CLAUDE_TOOL_INPUT을 통해 tool input을 받는다.
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
[[ -z "$TOOL_INPUT" ]] && exit 0

# ─── 1. State 파일 대상인지 확인 ────────────────────────────
FILE_PATH=""
if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
  FILE_PATH="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
fi

[[ -z "$FILE_PATH" ]] && exit 0
[[ "$FILE_PATH" != *".claude/deep-work."*".md" ]] && exit 0

# ─── 2. Session ID 추출 ────────────────────────────────────
SESSION_ID="$(echo "$FILE_PATH" | grep -o 'deep-work\.[^.]*' | sed 's/deep-work\.//')"
[[ -z "$SESSION_ID" ]] && exit 0

# ─── 3. 현재 phase 읽기 ────────────────────────────────────
[[ ! -f "$FILE_PATH" ]] && exit 0
NEW_PHASE="$(read_frontmatter_field "$FILE_PATH" "current_phase")"
[[ -z "$NEW_PHASE" ]] && exit 0

# ─── 4. Cache 비교 ─────────────────────────────────────────
CACHE_DIR="$PROJECT_ROOT/.claude"
CACHE_FILE="$CACHE_DIR/.phase-cache-${SESSION_ID}"
OLD_PHASE=""
[[ -f "$CACHE_FILE" ]] && OLD_PHASE="$(cat "$CACHE_FILE")"
[[ "$NEW_PHASE" == "$OLD_PHASE" ]] && exit 0

# ─── 5. Cache 업데이트 ─────────────────────────────────────
echo "$NEW_PHASE" > "$CACHE_FILE"

# ─── 6. State에서 조건 읽기 ────────────────────────────────
WORKTREE_ENABLED="$(read_frontmatter_field "$FILE_PATH" "worktree_enabled")"
WORKTREE_PATH="$(read_frontmatter_field "$FILE_PATH" "worktree_path")"
TEAM_MODE="$(read_frontmatter_field "$FILE_PATH" "team_mode")"
# cross_model_enabled: nested mapping (codex: true/false, gemini: true/false) 또는 scalar (true/false)
# read_frontmatter_field는 same-line scalar만 추출하므로, nested mapping 대비 grep으로 보완
CROSS_MODEL_ENABLED="$(read_frontmatter_field "$FILE_PATH" "cross_model_enabled")"
if [[ -z "$CROSS_MODEL_ENABLED" ]]; then
  # Nested mapping인 경우: cross_model_enabled: 아래 줄에 codex: true 또는 gemini: true가 있는지 확인
  if grep -A3 '^cross_model_enabled:' "$FILE_PATH" 2>/dev/null | grep -q 'true'; then
    CROSS_MODEL_ENABLED="true"
  fi
fi
TDD_MODE="$(read_frontmatter_field "$FILE_PATH" "tdd_mode")"

# ─── 7. Checklist injection (stdout → LLM context) ────────
HAS_CONDITIONS=false

OUTPUT=""
OUTPUT+=$'\n'"━━━ Phase Transition: ${OLD_PHASE:-init} → ${NEW_PHASE} ━━━"$'\n\n'

if [[ "$WORKTREE_ENABLED" == "true" && -n "$WORKTREE_PATH" ]]; then
  OUTPUT+="📂 worktree_path: $WORKTREE_PATH"$'\n'
  OUTPUT+="   → 모든 파일 작업은 이 경로 내에서 수행"$'\n'
  HAS_CONDITIONS=true
fi

if [[ "$TEAM_MODE" == "team" ]]; then
  OUTPUT+="👥 team_mode: team"$'\n'
  OUTPUT+="   → TeamCreate 사용하여 병렬 에이전트 실행"$'\n'
  HAS_CONDITIONS=true
fi

if [[ "$CROSS_MODEL_ENABLED" == "true" ]]; then
  OUTPUT+="🔄 cross_model_enabled: true"$'\n'
  OUTPUT+="   → 교차 검증 실행 필요"$'\n'
  HAS_CONDITIONS=true
fi

if [[ "$NEW_PHASE" == "implement" ]]; then
  OUTPUT+="🧪 tdd_mode: ${TDD_MODE:-strict}"$'\n'
  OUTPUT+="   → TDD 프로토콜 준수 (테스트 먼저)"$'\n'
  HAS_CONDITIONS=true
fi

OUTPUT+=$'\n'"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 조건이 있을 때만 출력
if [[ "$HAS_CONDITIONS" == "true" ]]; then
  printf '%s' "$OUTPUT"
fi

exit 0
