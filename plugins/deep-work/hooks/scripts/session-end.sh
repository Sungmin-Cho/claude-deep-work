#!/usr/bin/env bash
# session-end.sh — Stop hook: CLI 세션 종료 시 활성 deep-work 세션 확인 및 알림
# Exit codes:
#   0 = always (Stop hooks must never block session close)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─── 유틸리티 ──────────────────────────────────────────────

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

# ─── 프로젝트 루트 & 상태 파일 ─────────────────────────────

PROJECT_ROOT="$(find_project_root 2>/dev/null || echo "$PWD")"
STATE_FILE="$PROJECT_ROOT/.claude/deep-work.local.md"

# 상태 파일이 없으면 워크플로우 비활성 → 즉시 종료
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── YAML frontmatter에서 current_phase, task_description 추출 ──

CURRENT_PHASE=""
TASK_DESC=""
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
    if [[ "$line" =~ ^task_description:[[:space:]]*(.+)$ ]]; then
      TASK_DESC="${BASH_REMATCH[1]}"
      TASK_DESC="${TASK_DESC%\"}"
      TASK_DESC="${TASK_DESC#\"}"
      TASK_DESC="${TASK_DESC%\'}"
      TASK_DESC="${TASK_DESC#\'}"
    fi
  fi
done < "$STATE_FILE"

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

cat <<JSON
{"message":"Deep Work 세션이 활성 상태입니다.\n\n  Phase: ${PHASE_KO}\n  Task: ${TASK_DESC}\n\n다음 세션에서 /deep-status로 진행 상황을 확인하거나,\n작업이 완료되었다면 /deep-report로 리포트를 생성하세요."}
JSON

# ─── 알림 전송 (fire-and-forget) ───────────────────────────

bash "$SCRIPT_DIR/notify.sh" "$STATE_FILE" "$CURRENT_PHASE" "session_end" \
  "CLI 세션 종료 — Deep Work 세션 활성 중 (Phase: $PHASE_KO)" 2>/dev/null || true

exit 0
