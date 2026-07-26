'use strict';
const crypto=require('node:crypto');
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
const AUTHORITY_TIERS=Object.freeze(['brainstorm','research','spec','plan','implement','test']);
function canonical(value){if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return`{${Object.keys(value).sort().map((key)=>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;return JSON.stringify(value);}
function digest(value){return crypto.createHash('sha256').update(canonical(value)).digest('hex');}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');}
function maxTier(a,b){return TIERS.indexOf(a)>=TIERS.indexOf(b)?a:b;}

function compileMethodologyAuthority({riskProfile,difficulty=null,mode='adaptive',
  floorBaseline={}}={}){
  const cls=riskProfile&&CLASS_ORDER.includes(riskProfile.class)?riskProfile.class:'medium';
  const profile=PROFILE_BY_CLASS[cls],recommended=TIER_CATALOG[profile];
  const floors={};
  if(mode==='adaptive')for(const phase of DIFF_PHASES){
    const prior=TIERS.includes(floorBaseline?.[phase])?floorBaseline[phase]:recommended[phase];
    floors[phase]=maxTier(recommended[phase],prior);
  }
  const authority={schema_version:1,authority:'methodology-policy-v1',
    mode:mode==='shadow'?'shadow':'adaptive',risk_class:cls,profile,
    difficulty:difficulty??null,role_routing:{
      tiers:{brainstorm:MAIN,research:recommended.research,spec:MAIN,plan:MAIN,
        implement:recommended.implement,test:recommended.test},
      efforts:{...EFFORT_CATALOG[profile]}},
    review_policy:REVIEW_POLICY[profile],
    verification_policy:VERIFICATION_POLICY[profile],floors_effective:floors};
  authority.policy_sha256=digest(authority);return authority;
}

function validateMethodologyAuthority(value){
  const keys=['schema_version','authority','mode','risk_class','profile','difficulty',
    'role_routing','review_policy','verification_policy','floors_effective','policy_sha256'];
  const valid=exactKeys(value,keys)&&value.schema_version===1&&
    value.authority==='methodology-policy-v1'&&['adaptive','shadow'].includes(value.mode)&&
    CLASS_ORDER.includes(value.risk_class)&&value.profile===PROFILE_BY_CLASS[value.risk_class]&&
    exactKeys(value.role_routing,['tiers','efforts'])&&
    exactKeys(value.role_routing.tiers,AUTHORITY_TIERS)&&
    AUTHORITY_TIERS.every((phase)=>phase==='research'||phase==='implement'||phase==='test'
      ?TIERS.includes(value.role_routing.tiers[phase])
      :value.role_routing.tiers[phase]===MAIN)&&
    canonical(value.role_routing.efforts)===canonical(EFFORT_CATALOG[value.profile])&&
    value.review_policy===REVIEW_POLICY[value.profile]&&
    value.verification_policy===VERIFICATION_POLICY[value.profile]&&
    exactKeys(value.floors_effective,value.mode==='adaptive'?DIFF_PHASES:[])&&
    Object.values(value.floors_effective).every((tier)=>TIERS.includes(tier))&&
    /^[0-9a-f]{64}$/.test(value.policy_sha256||'');
  if(!valid)throw Object.assign(new Error('[methodology-policy] invalid authority'),
    {code:'methodology-policy'});
  const preimage=structuredClone(value);delete preimage.policy_sha256;
  if(digest(preimage)!==value.policy_sha256)
    throw Object.assign(new Error('[methodology-policy] digest mismatch'),
      {code:'methodology-policy'});
  return structuredClone(value);
}

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
  VERIFICATION_POLICY, DIFF_PHASES, compilePolicySnapshot,
  compileMethodologyAuthority,validateMethodologyAuthority };
