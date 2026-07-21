'use strict';
const { TIERS, MAIN } = require('./model-catalog.js');
const { CLASS_ORDER } = require('./risk-runtime.js');

// ── 부록 A (스펙 정본) — 표시·기록 전용, v6.11에서 라우팅에 강제되지 않는다.
const PROFILE_BY_CLASS = Object.freeze({ low: 'lean', medium: 'standard', high: 'strict', critical: 'critical' });

const EFFORT_CATALOG = Object.freeze({ // A.2
  lean: Object.freeze({ author: 'medium', implementer: 'medium', reviewer: 'high' }),
  standard: Object.freeze({ author: 'high', implementer: 'medium', reviewer: 'high' }),
  strict: Object.freeze({ author: 'high', implementer: 'high', semantic_reviewer: 'xhigh', executability_reviewer: 'high' }),
  critical: Object.freeze({ author: 'xhigh', implementer: 'high', semantic_reviewer: 'xhigh', executability_reviewer: 'xhigh', escalation: 'max' }),
});

const TIER_CATALOG = Object.freeze({ // A.2b — standard 행은 v6.10 baseline(medium scale)과 일치
  lean: Object.freeze({ research: 'light', implement: 'light', test: 'light' }),
  standard: Object.freeze({ research: 'standard', implement: 'standard', test: 'light' }),
  strict: Object.freeze({ research: 'deep', implement: 'deep', test: 'standard' }),
  critical: Object.freeze({ research: 'deep', implement: 'deep', test: 'deep' }),
});

const REVIEW_POLICY = Object.freeze({ // A.3
  lean: '단일 리뷰', standard: '단일 강한 리뷰 + 필요 시 dual',
  strict: '독립 dual 리뷰', critical: 'dual + adjudication + human gate',
});

const VERIFICATION_POLICY = Object.freeze({ // A.3
  lean: '최소 검증 (기록 전용)', standard: '표준 검증',
  strict: '강화 검증', critical: '전수 검증 + human gate',
});

const DIFF_PHASES = Object.freeze(['research', 'implement', 'test']); // 스펙 §4.5 — brainstorm/plan은 main 고정이라 제외

// routing_diff 행의 recommended_effort에 쓸 role 매핑 — 스펙 §5.1 예시(implement 행의
// effort가 A.2 implementer 값과 일치)에서 도출. research는 author, implement/test는 implementer.
const PHASE_EFFORT_ROLE = Object.freeze({ research: 'author', implement: 'implementer', test: 'implementer' });

function buildRoutingDiff({ profile, actualTiers, actualPinned }) {
  const tiers = actualTiers && typeof actualTiers === 'object' ? actualTiers : {};
  const pinned = actualPinned && typeof actualPinned === 'object' ? actualPinned : {};
  const diff = [];
  for (const phase of DIFF_PHASES) {
    const pin = pinned[phase];
    if (pin !== undefined && !TIERS.includes(pin) && pin !== MAIN) {
      // concrete pin: actualTiers[phase]는 baseline 잔존 → tier 비교 무의미 (스펙 §4.5)
      diff.push({ phase, excluded_reason: 'concrete-pin' });
      continue;
    }
    const actual = tiers[phase];
    if (!TIERS.includes(actual)) {
      diff.push({ phase, excluded_reason: `non-tier value (${actual === undefined ? 'missing' : String(actual)})` });
      continue;
    }
    diff.push({ phase, actual_tier: actual, recommended_tier: TIER_CATALOG[profile][phase],
      recommended_effort: EFFORT_CATALOG[profile][PHASE_EFFORT_ROLE[phase]], actual_effort_axis: 'absent' });
  }
  return diff;
}

function compilePolicySnapshot({ riskProfile, difficulty, runtime, actualRouting, actualTiers, actualPinned } = {}) {
  const cls = riskProfile && CLASS_ORDER.includes(riskProfile.class) ? riskProfile.class : 'medium';
  const profile = PROFILE_BY_CLASS[cls];
  return {
    profile,
    risk_class: cls,
    role_routing: {
      recommended_tiers: TIER_CATALOG[profile],
      recommended_efforts: EFFORT_CATALOG[profile],
      difficulty: difficulty ?? null,
      runtime: runtime ?? 'unknown',
      actual_routing: actualRouting && typeof actualRouting === 'object' ? actualRouting : {}, // 기록·감사용 (비교 미사용)
    },
    review_policy: { recommended: REVIEW_POLICY[profile] },
    verification_policy: { recommended: VERIFICATION_POLICY[profile] },
    routing_diff: buildRoutingDiff({ profile, actualTiers, actualPinned }),
  };
}

module.exports = { PROFILE_BY_CLASS, EFFORT_CATALOG, TIER_CATALOG, REVIEW_POLICY,
  VERIFICATION_POLICY, DIFF_PHASES, compilePolicySnapshot };
