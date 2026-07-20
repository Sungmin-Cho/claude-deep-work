'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { compilePolicySnapshot, PROFILE_BY_CLASS, TIER_CATALOG, EFFORT_CATALOG,
  DIFF_PHASES } = require('./policy-runtime.js');
const { CLASS_ORDER } = require('./risk-runtime.js');

test('A.1 매핑 고정', () => {
  assert.deepStrictEqual(PROFILE_BY_CLASS,
    { low: 'lean', medium: 'standard', high: 'strict', critical: 'critical' });
});

test('A.2b tier 카탈로그 고정 — standard 행은 v6.10 baseline과 일치', () => {
  assert.deepStrictEqual(TIER_CATALOG.standard, { research: 'standard', implement: 'standard', test: 'light' });
  assert.deepStrictEqual(TIER_CATALOG.strict, { research: 'deep', implement: 'deep', test: 'standard' });
  assert.deepStrictEqual(TIER_CATALOG.lean, { research: 'light', implement: 'light', test: 'light' });
  assert.deepStrictEqual(TIER_CATALOG.critical, { research: 'deep', implement: 'deep', test: 'deep' });
});

test('routing_diff — tier 일치 시 diff 없음(standard risk × baseline)', () => {
  const snap = compilePolicySnapshot({
    riskProfile: { class: 'medium' }, difficulty: null, runtime: 'claude',
    actualRouting: { research: 'sonnet', implement: 'sonnet', test: 'haiku' },
    actualTiers: { brainstorm: 'main', research: 'standard', plan: 'main', implement: 'standard', test: 'light' },
    actualPinned: {},
  });
  assert.strictEqual(snap.profile, 'standard');
  const mismatches = snap.routing_diff.filter((d) => !d.excluded_reason && d.actual_tier !== d.recommended_tier);
  assert.deepStrictEqual(mismatches, []);
  for (const d of snap.routing_diff.filter((x) => !x.excluded_reason)) {
    assert.strictEqual(d.actual_effort_axis, 'absent');
    assert.ok(DIFF_PHASES.includes(d.phase)); // brainstorm/plan 미포함
  }
});

test('routing_diff — high risk × baseline은 implement tier 불일치 검출', () => {
  const snap = compilePolicySnapshot({
    riskProfile: { class: 'high' }, difficulty: null, runtime: 'claude',
    actualRouting: { research: 'sonnet', implement: 'sonnet', test: 'haiku' },
    actualTiers: { research: 'standard', implement: 'standard', test: 'light' },
    actualPinned: {},
  });
  const imp = snap.routing_diff.find((d) => d.phase === 'implement');
  assert.strictEqual(imp.actual_tier, 'standard');
  assert.strictEqual(imp.recommended_tier, 'deep');
});

test('routing_diff — concrete pin phase는 excluded_reason: concrete-pin (스펙 §4.5)', () => {
  const snap = compilePolicySnapshot({
    riskProfile: { class: 'medium' }, difficulty: null, runtime: 'codex',
    actualRouting: { research: 'gpt-5.6-terra', implement: 'gpt-5.6-sol', test: 'gpt-5.6-luna' },
    actualTiers: { research: 'standard', implement: 'standard', test: 'light' }, // implement pin에도 baseline 잔존
    actualPinned: { implement: 'gpt-5.6-sol' }, // tier 어휘 아님 = concrete pin
  });
  const imp = snap.routing_diff.find((d) => d.phase === 'implement');
  assert.deepStrictEqual(imp, { phase: 'implement', excluded_reason: 'concrete-pin' });
});

test('routing_diff — tier pin은 정상 비교 대상', () => {
  const snap = compilePolicySnapshot({
    riskProfile: { class: 'medium' }, difficulty: null, runtime: 'claude',
    actualRouting: { research: 'sonnet', implement: 'opus', test: 'haiku' },
    actualTiers: { research: 'standard', implement: 'deep', test: 'light' },
    actualPinned: { implement: 'deep' }, // tier 어휘 = tier pin
  });
  const imp = snap.routing_diff.find((d) => d.phase === 'implement');
  assert.strictEqual(imp.excluded_reason, undefined);
  assert.strictEqual(imp.actual_tier, 'deep');
});

test('routing_diff — 비-tier 값(main 등)은 excluded_reason 기록', () => {
  const snap = compilePolicySnapshot({
    riskProfile: { class: 'low' }, difficulty: null, runtime: 'claude',
    actualRouting: { research: 'main', implement: 'sonnet', test: 'haiku' },
    actualTiers: { research: 'main', implement: 'standard', test: 'light' },
    actualPinned: {},
  });
  const res = snap.routing_diff.find((d) => d.phase === 'research');
  assert.ok(res.excluded_reason && res.excluded_reason !== 'concrete-pin');
});

test('property: profile이 risk class에 대해 약해지지 않는다 (§8.2-4)', () => {
  const strength = { lean: 0, standard: 1, strict: 2, critical: 3 };
  let prev = -1;
  for (const cls of CLASS_ORDER) {
    const cur = strength[PROFILE_BY_CLASS[cls]];
    assert.ok(cur >= prev);
    prev = cur;
  }
});

test('알 수 없는 class → standard fallback (fail-open)', () => {
  const snap = compilePolicySnapshot({ riskProfile: { class: 'wat' }, difficulty: null,
    runtime: 'unknown', actualRouting: {}, actualTiers: {}, actualPinned: {} });
  assert.strictEqual(snap.profile, 'standard');
});
