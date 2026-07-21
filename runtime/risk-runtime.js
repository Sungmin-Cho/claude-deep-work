'use strict';
const crypto = require('node:crypto');

const CLASS_ORDER = Object.freeze(['low', 'medium', 'high', 'critical']);
const DIMENSIONS = Object.freeze(['ambiguity', 'blast_radius', 'irreversibility',
  'data_security_integrity', 'concurrency_statefulness', 'external_side_effects',
  'verification_difficulty']);

// ── 렉시콘 (스펙 §4.2(1), 한/영 병기) — fixture(tests/risk-fixture-matrix.test.js)가 계약.
// 각 항목은 [label, RegExp]. 차원 점수 = min(2, 매칭된 서로 다른 항목 수).
const KEYWORD_LEXICON = Object.freeze({
  ambiguity: [
    ['unclear', /unclear|ambiguous|불명확|애매|모호/iu],
    ['explore', /\bexplore\b|\binvestigate\b|탐색|조사|검토만/iu],
    ['tbd', /\bTBD\b|\bmaybe\b|아마|미정/iu],
  ],
  blast_radius: [
    ['global', /전체|전역|모든 모듈|all modules|cross-cutting|공통/iu],
    ['refactor', /refactor|리팩터|리팩토링|대규모 변경|rename across/iu],
    ['public-api', /public api|공개 api|외부 계약|interface 변경/iu],
  ],
  irreversibility: [
    ['migration', /migration|마이그레이션/iu],
    ['destructive', /destructive|비가역|irreversible|drop\b|파괴적/iu],
    ['no-rollback', /rollback 불가|복구 불가|no rollback|unrecoverable/iu],
    ['schema-change', /schema (change|변경)|스키마 변경/iu],
  ],
  data_security_integrity: [
    ['auth', /\bauth(?:n|z|entication|orization)?\b|인증|인가|권한|\bpermission\b|\bacl\b|로그인/iu],
    ['payment', /\bpayment\b|\bbilling\b|결제|과금|금액|재무|\binvoice\b/iu],
    ['secret', /\bsecrets?\b|\btokens?\b|\bcredentials?\b|비밀|암호|\bpassword\b/iu],
    ['integrity', /무결성|integrity|규제 데이터|개인정보|\bpii\b/iu],
  ],
  concurrency_statefulness: [
    ['lock-lease', /\block\b|\blease\b|\bfencing\b|\bmutex\b/iu],
    ['retry', /\bretry\b|재시도|idempoten|중복 (요청|실행)/iu],
    ['race', /\brace\b|동시성|concurren|병렬 상태/iu],
    ['state-machine', /state machine|상태 머신|상태 전이|\bfsm\b/iu],
  ],
  external_side_effects: [
    ['publish-deploy', /\bpublish\b|\bdeploy\b|배포|출시/iu],
    ['merge-push', /\bmerge\b|force[- ]?push|원격 (변경|쓰기)/iu],
    ['delete-remote', /(원격|remote|prod(uction)?).{0,12}(삭제|delete|destroy)|삭제.{0,8}(원격|remote)/iu],
    ['billing-effect', /과금 발생|charge|청구/iu],
  ],
  verification_difficulty: [
    ['host', /actual host|host adapter|호스트 의존|windows|macos|linux|git bash|플랫폼별/iu],
    ['fault', /fault injection|장애 주입|\bchaos\b|부분 실패/iu],
    ['recovery', /restart|재시작|recovery|복구 (경로|검증)|\bsmoke\b/iu],
    ['env-only', /운영 환경에서만|실환경|e2e만|프로덕션에서만/iu],
  ],
});

// ── 경로 패턴 (스펙 §4.2(2)) — evidence.changed_paths에 적용, 차원별 가점 1항목.
const PATH_PATTERNS = Object.freeze([
  ['path:hooks-enforcement', /(^|\/)hooks\//u, 'blast_radius'],
  ['path:auth', /(^|\/)(auth|iam|acl)[^/]*($|\/)|auth/u, 'data_security_integrity'],
  ['path:payment', /payment|billing/u, 'data_security_integrity'],
  ['path:migration-schema', /migration|schema/u, 'irreversibility'],
  ['path:ci-release', /(^|\/)\.github\/workflows\/|release|publish/u, 'external_side_effects'],
]);

// ── Hard trigger (스펙 §4.3 — 9종 고정)
const HARD_TRIGGERS = Object.freeze([
  ['auth-boundary', 'high', /\bauth(?:n|z|entication|orization)?\b|인증|인가|권한|\bpermission\b|\bacl\b/iu],
  ['payment-financial', 'high', /\bpayment\b|\bbilling\b|결제|과금|금액 계산|재무 계산/iu],
  ['secret-handling', 'high', /\bsecrets?\b|\bcredentials?\b|token (rotation|처리)|api ?token|비밀 ?값|\bpassword\b/iu],
  ['state-machine-concurrency', 'high', /\block\b|\blease\b|\bfencing\b|idempoten|state machine|상태 머신|동시성|\brace\b/iu],
  ['public-contract-break', 'high', /breaking change|backward compat|하위 호환|public (api|schema|contract).{0,10}(변경|change|break)/iu],
  ['host-dependent', 'high', /host adapter|actual host|호스트 의존|windows.{0,20}(hook|payload|지원)|git bash/iu],
  ['destructive-migration', 'critical', /(destructive|파괴적|drop|삭제).{0,20}(migration|마이그레이션|schema|스키마)|(migration|마이그레이션|schema|스키마).{0,20}(destructive|파괴적|drop|삭제)/iu],
  ['external-destructive-action', 'critical', /npm publish|force[- ]?push|(원격|remote|prod(uction)?).{0,12}(삭제|delete|destroy)|(publish|deploy|배포).{0,12}(자동화|automation)|auto[- ]?deploy/iu],
  ['unproven-recovery', 'critical', /복구 불가|rollback 불가|no rollback|unrecoverable|복구 절차 없/iu],
]);

function textCorpus({ taskText, evidence }) {
  const ev = evidence && typeof evidence === 'object' ? evidence : {};
  const parts = [typeof taskText === 'string' ? taskText : ''];
  for (const key of ['keywords', 'side_effects']) {
    if (Array.isArray(ev[key])) parts.push(...ev[key].filter((v) => typeof v === 'string'));
  }
  // 공백 결합(개행 아님): 복합 hard trigger 정규식(.{0,N})이 taskText와
  // evidence 필드 경계를 넘어 분산 evidence를 매칭할 수 있어야 한다
  // (예: taskText "drop the legacy table" + keywords ["migration"]).
  // 개행 결합이면 `.`이 줄바꿈을 건너지 못해 오분류가 발생했다. 거리 캡
  // .{0,N}이 스퍼리어스 확산은 이미 제한하므로 공백 결합이 안전하다.
  // FR2-1: part 자체(taskText/evidence 원문)에 개행이 내장된 경우 결합자를
  // 공백으로 바꿔도 그 개행은 남아 .{0,N}을 여전히 막는다 (예: taskText
  // "drop the legacy table\n" + keywords ["migration"]). join(" ") 전에
  // 각 part의 공백류(개행 포함)를 단일 스페이스로 정규화해 이를 해소한다.
  return parts.map((part) => part.replace(/\s+/gu, ' ')).join(' ');
}

function scoreRiskDimensions({ taskText, signals, evidence } = {}) {
  const corpus = textCorpus({ taskText, evidence });
  const ev = evidence && typeof evidence === 'object' ? evidence : {};
  const sig = signals && typeof signals === 'object' ? signals : {};
  const dimensions = {};
  const rationale = [];
  let matchCount = 0;
  for (const dim of DIMENSIONS) {
    let hits = 0;
    for (const [label, pattern] of KEYWORD_LEXICON[dim]) {
      if (pattern.test(corpus)) {
        hits += 1; matchCount += 1;
        rationale.push(`keyword:${label} → ${dim}+1`);
      }
    }
    dimensions[dim] = Math.min(2, hits);
  }
  const paths = Array.isArray(ev.changed_paths) ? ev.changed_paths.filter((p) => typeof p === 'string') : [];
  for (const [label, pattern, dim] of PATH_PATTERNS) {
    if (paths.some((p) => pattern.test(p))) {
      matchCount += 1;
      rationale.push(`${label} → ${dim}+1`);
      dimensions[dim] = Math.min(2, dimensions[dim] + 1);
    }
  }
  if (paths.length >= 5) {
    rationale.push(`paths:${paths.length}개 → blast_radius+1`);
    dimensions.blast_radius = Math.min(2, dimensions.blast_radius + 1);
    matchCount += 1;
  }
  // 저장소 신호(스펙 §4.2(3)): repo 규모 불산입, has_tests만 verification_difficulty 보조.
  if (sig.has_tests === false) {
    rationale.push('signal:has_tests=false → verification_difficulty+1');
    dimensions.verification_difficulty = Math.min(2, dimensions.verification_difficulty + 1);
    matchCount += 1;
  }
  if (matchCount === 0) rationale.push('신호 없음 — 전 차원 0점 (스펙 §7)');
  return { dimensions, rationale, matchCount };
}

function detectHardTriggers({ taskText, evidence } = {}) {
  const corpus = textCorpus({ taskText, evidence });
  const ev = evidence && typeof evidence === 'object' ? evidence : {};
  const paths = Array.isArray(ev.changed_paths) ? ev.changed_paths.filter((p) => typeof p === 'string') : [];
  // textCorpus와 동일하게 공백 결합 — 결합자 불일치는 changed_paths 기반
  // 분산 evidence 매칭도 동일하게 끊어버리므로 여기도 통일한다.
  // FR2-1: corpus는 textCorpus에서 이미 정규화됐지만 paths도 동일 규칙(공백류
  // → 단일 스페이스)으로 정규화해 결합 후 결과가 일관되게 유지되도록 한다.
  const corpusWithPaths = `${corpus} ${paths.map((p) => p.replace(/\s+/gu, ' ')).join(' ')}`;
  const out = [];
  for (const [id, minClass, pattern] of HARD_TRIGGERS) {
    const m = corpusWithPaths.match(pattern);
    if (m) out.push({ id, min_class: minClass, matched: m[0] });
  }
  return out;
}

function classFromScore(score, hardTriggers = []) {
  let cls;
  if (score <= 3) cls = 'low';
  else if (score <= 7) cls = 'medium';
  else if (score <= 10) cls = 'high';
  else cls = 'critical';
  for (const t of hardTriggers) {
    if (CLASS_ORDER.indexOf(t.min_class) > CLASS_ORDER.indexOf(cls)) cls = t.min_class;
  }
  return cls;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// 스펙 §4.4 — 결정론 confidence. slice는 task-text 단독 판단이므로 provisional 산식을 쓴다.
function computeConfidence({ stage, matchCount, evidence }) {
  if (stage === 'authoritative') {
    const ev = evidence && typeof evidence === 'object' ? evidence : {};
    const items = ['changed_paths', 'keywords', 'side_effects', 'evidence_refs']
      .reduce((n, k) => n + (Array.isArray(ev[k]) ? ev[k].length : 0), 0);
    return Number(clamp(0.6 + 0.03 * Math.min(20, items) + 0.02 * matchCount, 0.6, 0.95).toFixed(2));
  }
  return Number(clamp(0.4 + 0.05 * matchCount, 0.4, 0.7).toFixed(2));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalDigest(value) {
  const json = JSON.stringify(canonicalize(value));
  return `sha256:${crypto.createHash('sha256').update(json, 'utf8').digest('hex')}`;
}

const STAGES = Object.freeze(['provisional', 'authoritative', 'slice']);

function decideRiskProfile({ stage, taskText, signals, evidence, priorProfile } = {}) {
  const effectiveStage = STAGES.includes(stage) ? stage : 'provisional';
  const scored = scoreRiskDimensions({ taskText, signals, evidence });
  const hardTriggers = detectHardTriggers({ taskText, evidence });
  const score = DIMENSIONS.reduce((sum, d) => sum + scored.dimensions[d], 0);
  const cls = classFromScore(score, hardTriggers);
  const confidence = computeConfidence({ stage: effectiveStage, matchCount: scored.matchCount, evidence });
  // 스펙 §4.1 transition — priorProfile은 여기에만 개입한다 (class/score 산출 불개입).
  let transition = null;
  const priorClass = priorProfile && typeof priorProfile === 'object' ? priorProfile.class : undefined;
  if (CLASS_ORDER.includes(priorClass) && priorClass !== cls) {
    transition = { from: priorClass, to: cls,
      reason: hardTriggers.length > 0 ? `hard triggers: ${hardTriggers.map((t) => t.id).join(', ')}`
        : `score ${score} → class ${cls}` };
  }
  // input_digest는 이 모듈이 반환하지 않는다 — CLI가 canonicalDigest(effective)로 1회 계산해
  // input_ref.digest와 함께 부착한다 (재현 계약 §4.6, P1 fix). canonicalDigest export는 유지.
  // 스펙 §4.3 — hard trigger가 발화하면 trigger ID와 매칭 근거 문자열을 rationale에도
  // 기록한다 (hard_triggers 필드는 구조화 데이터, rationale은 사람이 읽는 근거 로그 —
  // 둘 다 계약 대상). 순수성/결정론 유지: Date/random 미사용, 입력에서만 파생.
  const rationale = [...scored.rationale,
    ...hardTriggers.map((t) => `trigger:${t.id} → min ${t.min_class} (matched: "${t.matched}")`)];
  return { stage: effectiveStage, class: cls, score, confidence,
    dimensions: scored.dimensions, hard_triggers: hardTriggers,
    rationale, transition };
}

module.exports = { CLASS_ORDER, DIMENSIONS, STAGES, KEYWORD_LEXICON, PATH_PATTERNS,
  HARD_TRIGGERS, scoreRiskDimensions, detectHardTriggers, classFromScore,
  computeConfidence, canonicalDigest, decideRiskProfile };
