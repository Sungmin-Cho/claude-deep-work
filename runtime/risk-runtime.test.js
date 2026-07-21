'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decideRiskProfile, scoreRiskDimensions, detectHardTriggers, classFromScore,
  canonicalDigest, CLASS_ORDER, DIMENSIONS } = require('./risk-runtime.js');

test('어휘 고정', () => {
  assert.deepStrictEqual(CLASS_ORDER, ['low', 'medium', 'high', 'critical']);
  assert.deepStrictEqual(DIMENSIONS, ['ambiguity', 'blast_radius', 'irreversibility',
    'data_security_integrity', 'concurrency_statefulness', 'external_side_effects',
    'verification_difficulty']);
});

test('classFromScore 경계값', () => {
  assert.strictEqual(classFromScore(0, []), 'low');
  assert.strictEqual(classFromScore(3, []), 'low');
  assert.strictEqual(classFromScore(4, []), 'medium');
  assert.strictEqual(classFromScore(7, []), 'medium');
  assert.strictEqual(classFromScore(8, []), 'high');
  assert.strictEqual(classFromScore(10, []), 'high');
  assert.strictEqual(classFromScore(11, []), 'critical');
  assert.strictEqual(classFromScore(14, []), 'critical');
});

test('hard trigger 최소 class 강제 — 저점수 + auth trigger → high', () => {
  const triggers = [{ id: 'auth-boundary', min_class: 'high', matched: 'auth' }];
  assert.strictEqual(classFromScore(1, triggers), 'high');
  // 점수가 이미 더 높으면 점수 class 유지
  assert.strictEqual(classFromScore(12, triggers), 'critical');
});

test('detectHardTriggers — 한/영 렉시콘', () => {
  const en = detectHardTriggers({ taskText: 'fix permission check in auth middleware', evidence: {} });
  assert.ok(en.some((t) => t.id === 'auth-boundary'));
  const ko = detectHardTriggers({ taskText: '인증 권한 조건 한 줄 수정', evidence: {} });
  assert.ok(ko.some((t) => t.id === 'auth-boundary'));
  const none = detectHardTriggers({ taskText: 'README 오타 수정', evidence: {} });
  assert.deepStrictEqual(none, []);
});

// 스펙 §4.3 계약 — hard trigger 발화 시 rationale에 trigger ID와 매칭 근거가 기록되어야 한다.
test('decideRiskProfile — hard trigger 발화 시 rationale에 trigger 항목 기록 (스펙 §4.3)', () => {
  const r = decideRiskProfile({ stage: 'provisional',
    taskText: 'fix permission check in auth middleware', signals: {}, evidence: {} });
  assert.ok(r.rationale.some((l) => l.startsWith('trigger:auth-boundary')));
});

test('scoreRiskDimensions — 키워드 매칭과 rationale 형식', () => {
  const r = scoreRiskDimensions({ taskText: 'lease renewal retry 로직', signals: {}, evidence: {} });
  assert.strictEqual(r.dimensions.concurrency_statefulness, 2); // lease + retry = 2건
  assert.ok(r.rationale.some((line) => /keyword:.*concurrency_statefulness\+1/.test(line)));
});

test('scoreRiskDimensions — has_tests=false는 verification_difficulty 가점', () => {
  const withTests = scoreRiskDimensions({ taskText: 'x', signals: { has_tests: true }, evidence: {} });
  const noTests = scoreRiskDimensions({ taskText: 'x', signals: { has_tests: false }, evidence: {} });
  assert.ok(noTests.dimensions.verification_difficulty >= withTests.dimensions.verification_difficulty + 1);
});

test('scoreRiskDimensions — 경로 패턴 (hooks/ → blast_radius)', () => {
  const r = scoreRiskDimensions({ taskText: 'x', signals: {},
    evidence: { changed_paths: ['hooks/scripts/phase-guard.sh'] } });
  assert.ok(r.dimensions.blast_radius >= 1);
});

test('decideRiskProfile — 결정론 (digest는 모듈이 반환하지 않음 — CLI가 1곳에서 계산)', () => {
  const input = { stage: 'provisional', taskText: '결제 idempotency 조건 변경', signals: {}, evidence: {} };
  const a = decideRiskProfile(input);
  const b = decideRiskProfile(input);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.decided_at, undefined); // CLI가 부착 — 모듈은 시각 미포함
  assert.strictEqual(a.input_digest, undefined); // CLI가 canonicalDigest(effective)로 1회 계산해 부착 (P1 fix)
});

test('decideRiskProfile — priorProfile은 class/score 불개입, transition만 생성', () => {
  const base = { stage: 'authoritative', taskText: 'lease 상태 머신 구현', signals: {}, evidence: {} };
  const without = decideRiskProfile(base);
  const withPrior = decideRiskProfile({ ...base, priorProfile: { class: 'medium' } });
  assert.strictEqual(without.class, withPrior.class);
  assert.strictEqual(without.score, withPrior.score);
  assert.strictEqual(without.transition, null);
  if (withPrior.class !== 'medium') {
    assert.deepStrictEqual(Object.keys(withPrior.transition).sort(), ['from', 'reason', 'to']);
    assert.strictEqual(withPrior.transition.from, 'medium');
    assert.strictEqual(withPrior.transition.to, withPrior.class);
  }
});

test('신호 전무 → 전 차원 0, low, confidence 최저', () => {
  const r = decideRiskProfile({ stage: 'provisional', taskText: 'do the thing', signals: {}, evidence: {} });
  assert.strictEqual(r.class, 'low');
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.confidence, 0.4);
});

// ─ Property tests (스펙 §8.2 1~3) ─
test('property: 차원 점수 증가는 class를 낮추지 않는다 (단조성)', () => {
  const classIdx = (c) => CLASS_ORDER.indexOf(c);
  for (let base = 0; base <= 12; base += 1) {
    assert.ok(classIdx(classFromScore(base + 1, [])) >= classIdx(classFromScore(base, [])));
  }
});

test('property: canonicalDigest는 키 순서와 무관', () => {
  assert.match(canonicalDigest({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(canonicalDigest({ a: 1, b: [2, { c: 3 }] }),
    canonicalDigest({ b: [2, { c: 3 }], a: 1 }));
});
