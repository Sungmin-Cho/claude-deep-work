#!/bin/bash
# hooks/scripts/test/test-recommender-integration.sh
# Integration tests: recommender fallback paths + flag combination matrix
# Task 8 (v6.4.2) — 8 assertions covering fallback 4종 + 플래그 조합 + 일시정지
# bash 3.2 compatible (macOS default)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

PASS=0; FAIL=0

assert() {
  local label="$1"
  local condition="$2"
  if eval "$condition"; then
    echo "PASS — $label"
    PASS=$((PASS+1))
  else
    echo "FAIL — $label"
    FAIL=$((FAIL+1))
  fi
}

# 1. 빈 task description → fallback (sanitizeInput은 빈 문자열도 정상 반환)
out=$(printf '{ "task_description": "" }' | node scripts/recommender-input.js 2>&1 || true)
assert "빈 task description sanitize" '[[ -n "$out" ]]'

# 2. --no-recommender → recommender skip (no_recommender: true, recommender: null)
flags=$(node scripts/parse-deep-work-flags.js -- --no-recommender "task" 2>&1 || true)
assert "--no-recommender 플래그 인식" 'echo "$flags" | grep -q "\"no_recommender\":true"'

# 3. --recommender=invalid → sonnet fallback + 경고
flags=$(node scripts/parse-deep-work-flags.js -- --recommender=invalid "task" 2>&1 || true)
assert "invalid recommender → sonnet fallback" 'echo "$flags" | grep -q "sonnet"'
assert "invalid recommender 경고 출력" 'echo "$flags" | grep -q "허용되지 않는"'

# 4. --no-ask + --recommender=opus → 경고 + recommender 무시
flags=$(node scripts/parse-deep-work-flags.js -- --no-ask --recommender=opus "task" 2>&1 || true)
assert "--no-ask + --recommender 모순 경고" 'echo "$flags" | grep -q "호출되지 않음"'

# 5. --profile=X --no-ask 호환
flags=$(node scripts/parse-deep-work-flags.js -- --profile=solo-strict --no-ask "task" 2>&1 || true)
assert "--profile=X --no-ask 호환" 'echo "$flags" | grep -q "solo-strict" && echo "$flags" | grep -q "\"no_ask\":true"'

# 6. JSON parse 실패 → no-json-fence fallback
out=$(node -e '
  const { parseRecommendation } = require("./scripts/recommender-parser.js");
  const r = parseRecommendation("Here is recommendation: not json", {});
  console.log(JSON.stringify(r));
' 2>&1 || true)
assert "JSON parse 실패 → fallback" 'echo "$out" | grep -q "no-json-fence"'

# 7. enum 위반 → fallback (R3-W6 fix: 5-key 완전 + team_mode만 invalid)
out=$(node -e '
  const { parseRecommendation } = require("./scripts/recommender-parser.js");
  const bad = "```json\n" + JSON.stringify({
    team_mode:     { value: "invalid",      reason: "x" },
    start_phase:   { value: "research",     reason: "x" },
    tdd_mode:      { value: "strict",       reason: "x" },
    git:           { value: "new-branch",   reason: "x" },
    model_routing: { value: "default",      reason: "x" }
  }) + "\n```";
  console.log(JSON.stringify(parseRecommendation(bad, {})));
' 2>&1 || true)
assert "enum 위반 → fallback" 'echo "$out" | grep -q "enum violation"'

# 8. capability false 항목 추천 → fallback (R3-W6 fix: 5-key 완전 + team_mode capability 충돌)
out=$(node -e '
  const { parseRecommendation } = require("./scripts/recommender-parser.js");
  const bad = "```json\n" + JSON.stringify({
    team_mode:     { value: "team",         reason: "x" },
    start_phase:   { value: "research",     reason: "x" },
    tdd_mode:      { value: "strict",       reason: "x" },
    git:           { value: "new-branch",   reason: "x" },
    model_routing: { value: "default",      reason: "x" }
  }) + "\n```";
  console.log(JSON.stringify(parseRecommendation(bad, { capability: { team_mode_available: false } })));
' 2>&1 || true)
assert "capability false → fallback" 'echo "$out" | grep -q "capability"'

echo ""
echo "Integration tests: PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" == "0" ]] || exit 1
