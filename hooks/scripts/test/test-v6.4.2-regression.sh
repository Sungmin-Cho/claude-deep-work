#!/bin/bash
# hooks/scripts/test/test-v6.4.2-regression.sh
# v6.4.2 회귀 테스트 — phase-guard / migrate-model-routing / 동음이의어 보존 / notify.sh 잔여 0 / --exec 보존
# NOTE: set -e 와 grep -c zero-match exit 1 interaction 회피 — set -e 제거 + 명시적 exit code 처리 (W18)
set -uo pipefail

SELF_NAME="$(basename "$0")" # self-include 제외 (W19)

fail() { echo "FAIL — $1"; exit 1; }
pass() { echo "PASS — $1"; }

# Resolve repo root relative to this script's location
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

# 1. Phase-guard가 recommendations 필드를 검사하지 않음 확인
hits=$(grep -c "recommendations" "$REPO_ROOT/hooks/scripts/phase-guard-core.js" 2>/dev/null; true)
hits="${hits:-0}"
[[ "$hits" -eq 0 ]] || fail "phase-guard에 recommendations 참조 발견 (${hits}건)"
pass "phase-guard 비간섭"

# 2. v6.4.0 migrate-model-routing.js와 v3 마이그레이션이 model_routing.plan='main'을 동일하게 보존
tmp=$(mktemp -d)
cat > "$tmp/p.yaml" <<EOF
version: 2
default_preset: solo
presets:
  solo:
    team_mode: solo
    model_routing:
      brainstorm: main
      research: main
      plan: main
      implement: sonnet
      test: haiku
EOF

result=$(node "$REPO_ROOT/scripts/migrate-profile-v2-to-v3.js" "$tmp/p.yaml" 2>&1; true)
echo "$result" | grep -q '"migrated":\s*true' || fail "v3 마이그레이션 실행 안 됨: $result"
grep -q "plan: main" "$tmp/p.yaml" || fail "v3 마이그레이션 후 plan: main 사라짐"
# chmod 600 검증 (macOS / Linux 양쪽)
mode=$(stat -f '%A' "$tmp/p.yaml" 2>/dev/null || stat -c '%a' "$tmp/p.yaml" 2>/dev/null || echo "unknown")
[[ "$mode" == "600" ]] || fail "v3 파일 권한이 0o600이 아님: $mode"
pass "v3 마이그레이션 model_routing.plan 보존 + chmod 600"

# 3. assumption-engine.{js,test.js}의 notification 변수가 외부 알림과 무관함 (변경 없음 확인)
[[ -f "$REPO_ROOT/hooks/scripts/assumption-engine.js" ]] || fail "assumption-engine.js 누락"
hits=$(grep -c "notification" "$REPO_ROOT/hooks/scripts/assumption-engine.js" 2>/dev/null; true)
hits="${hits:-0}"
[[ "$hits" -eq 5 ]] || fail "assumption-engine.js의 notification 변수 변동 (예상 정확히 5건 — line 1151/1162/1242/1247/1250, 현재 ${hits}건)"
pass "assumption-engine notification 변수 (동음이의어) 보존"

# 4. notify.sh 잔여 참조 0 — self 제외 + 테스트 디렉터리 제외 (W19)
# hooks/scripts/test/ 의 다른 테스트 파일도 "notify.sh"를 언급할 수 있으므로 test/ 디렉터리 전체 제외
prod_hits=$(grep -rln "notify\.sh" --include="*.sh" --include="*.js" --include="*.md" \
  "$REPO_ROOT/hooks/" "$REPO_ROOT/skills/" "$REPO_ROOT/commands/" "$REPO_ROOT/scripts/" 2>/dev/null \
  | grep -v "/${SELF_NAME}$" \
  | grep -v "/hooks/scripts/test/" \
  | wc -l | tr -d ' ')
[[ "$prod_hits" == "0" ]] || fail "notify.sh 잔여 참조 ${prod_hits}건 (self + test dir 제외 후)"
pass "notify.sh 잔여 참조 0"

# 5. Phase 기본 흐름 (brainstorm → research → plan → implement → test → integrate) 변경 없음
for skill in deep-brainstorm deep-research deep-plan deep-implement deep-test deep-integrate; do
  [[ -f "$REPO_ROOT/skills/$skill/SKILL.md" ]] || fail "skills/$skill/SKILL.md 누락"
done
pass "phase skill 6개 모두 존재"

# 6. .github/workflows에 webhook 잔여 정보 (정확한 path 패턴, W19) — info only, 실패 안 함
if [[ -d "$REPO_ROOT/.github/workflows" ]]; then
  webhook_hits=$(grep -rln -i "slack\|discord\|telegram\|webhook" "$REPO_ROOT/.github/workflows/" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$webhook_hits" != "0" ]]; then
    echo "INFO — .github/workflows에 webhook 관련 라인 ${webhook_hits}건 (manual review 필요)"
  fi
fi

# 7. --exec 플래그가 v6.4.0 코드 path에 보존됨 (C5/C-F)
# active_cluster_takeover까지 포함해 v6.4.0 핵심 state 필드 모두 검증 (R3-W6 fix: >= 4)
exec_refs=$(grep -rln "exec=inline\|exec=delegate\|execution_override\|active_cluster_takeover" \
  "$REPO_ROOT/commands/" "$REPO_ROOT/skills/" 2>/dev/null \
  | grep -v "/${SELF_NAME}$" | wc -l | tr -d ' ')
[[ "$exec_refs" -ge 4 ]] || fail "--exec/execution_override/active_cluster_takeover 참조 누락 (예상 ≥4, 현재 ${exec_refs})"
pass "--exec=inline/delegate + execution_override + active_cluster_takeover v6.4.0 보존"

echo "All regression tests PASSED"
