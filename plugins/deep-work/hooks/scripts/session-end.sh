#!/usr/bin/env bash
# session-end.sh — Stop hook: CLI 세션 종료 시 활성 deep-work 세션 확인 및 알림
# Exit codes:
#   0 = always (Stop hooks must never block session close)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# ─── 프로젝트 루트 & 상태 파일 ─────────────────────────────

init_deep_work_state

# 상태 파일이 없으면 워크플로우 비활성 → 즉시 종료
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── YAML frontmatter에서 current_phase, task_description 추출 ──

CURRENT_PHASE="$(read_frontmatter_field "$STATE_FILE" "current_phase")"
TASK_DESC="$(read_frontmatter_field "$STATE_FILE" "task_description")"

# idle이거나 비어있으면 활성 세션 없음 → 종료
if [[ -z "$CURRENT_PHASE" || "$CURRENT_PHASE" == "idle" ]]; then
  exit 0
fi

# ─── 활성 세션 알림 메시지 출력 ─────────────────────────────

PHASE_KO=""
case "$CURRENT_PHASE" in
  research)  PHASE_KO="리서치(Research)" ;;
  plan)      PHASE_KO="기획(Plan)" ;;
  implement) PHASE_KO="구현(Implement)" ;;
  test)      PHASE_KO="테스트(Test)" ;;
  *)         PHASE_KO="$CURRENT_PHASE" ;;
esac

# ─── Worktree 정보 확인 ─────────────────────────────────────

WORKTREE_ENABLED="$(read_frontmatter_field "$STATE_FILE" "worktree_enabled")"
WORKTREE_BRANCH="$(read_frontmatter_field "$STATE_FILE" "worktree_branch")"
WORKTREE_MSG=""
if [[ "$WORKTREE_ENABLED" == "true" && -n "$WORKTREE_BRANCH" ]]; then
  WORKTREE_MSG="\n\n  🌿 Worktree: ${WORKTREE_BRANCH}\n     다음 세션에서 /deep-finish로 브랜치를 정리하세요."
fi

cat <<JSON
{"message":"Deep Work 세션이 활성 상태입니다.\n\n  Phase: ${PHASE_KO}\n  Task: ${TASK_DESC}${WORKTREE_MSG}\n\n다음 세션에서 /deep-status로 진행 상황을 확인하거나,\n작업이 완료되었다면 /deep-report로 리포트를 생성하세요."}
JSON

# ─── 알림 전송 (fire-and-forget) ───────────────────────────

bash "$SCRIPT_DIR/notify.sh" "$STATE_FILE" "$CURRENT_PHASE" "session_end" \
  "CLI 세션 종료 — Deep Work 세션 활성 중 (Phase: $PHASE_KO)" 2>/dev/null || true

exit 0
