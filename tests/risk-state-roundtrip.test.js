'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseFrontmatter, updateFrontmatterText } = require('../runtime/frontmatter.js');

// §5.1이 고정한 내부 구조 — input_ref 포함 (스펙 §8.3 round-trip fixture 계약)
const RISK_PROFILE = {
  schema_version: 1,
  provisional: { class: 'medium', score: 6, confidence: 0.62,
    dimensions: { ambiguity: 1, blast_radius: 1, irreversibility: 0, data_security_integrity: 1,
      concurrency_statefulness: 1, external_side_effects: 1, verification_difficulty: 1 },
    hard_triggers: [], rationale: ['keyword:retry → concurrency_statefulness+1'],
    decided_at: '2026-07-20T04:00:00Z', input_digest: 'sha256:abc',
    input_ref: { path: '/wd/risk-inputs/provisional.json', digest: 'sha256:abc' } },
  authoritative: { class: 'high', evidence_refs: ['research.md#RF-012'],
    input_ref: { path: '/wd/risk-inputs/authoritative.json', digest: 'sha256:def' } },
  history: [{ from: 'medium', to: 'high', stage: 'authoritative', reason: 'lease 확인', at: '2026-07-20T05:00:00Z' }],
  errors: [{ stage: 'authoritative', message: 'evidence JSON 파싱 실패', at: '2026-07-20T05:00:00Z' }],
};
const POLICY_SHADOW = {
  provisional: { profile: 'standard', role_routing: {}, review_policy: {}, verification_policy: {},
    routing_diff: [{ phase: 'implement', actual_tier: 'standard', recommended_tier: 'standard',
      recommended_effort: 'medium', actual_effort_axis: 'absent' }],
    compiled_at: '2026-07-20T04:00:00Z', based_on: 'provisional' },
  authoritative: { profile: 'strict', role_routing: {}, review_policy: {}, verification_policy: {},
    routing_diff: [{ phase: 'implement', excluded_reason: 'concrete-pin' }],
    compiled_at: '2026-07-20T05:00:00Z', based_on: 'authoritative' },
};
const SLICE_SHADOW = { 'SLICE-001': { class: 'medium', score: 4, triggers: [], rationale: [],
  input_ref: { path: '/wd/risk-inputs/slice-SLICE-001.json', digest: 'sha256:xyz' } } };

// §5.2 Node 리더 계약 — 실제 session-store.parseStoredObject를 import해 고정한다
// (Task 5 리뷰 W1: 복제본 검증은 drift를 못 잡음).
const { parseStoredObject } = require('../runtime/session-store.js');

test('§5.1 인코딩 round-trip — updateFrontmatterText → parseFrontmatter → 양쪽 리더', () => {
  const base = '---\nsession_id: s-test\ncurrent_phase: research\n---\nbody\n';
  const patched = updateFrontmatterText(base, {
    risk_profile_json: JSON.stringify(RISK_PROFILE),
    policy_shadow_json: JSON.stringify(POLICY_SHADOW),
    slice_risk_shadow_json: JSON.stringify(SLICE_SHADOW),
  });
  const { fields } = parseFrontmatter(patched); // §5.1: frontmatter-invalid 없이 통과해야 함
  // Node 리더 경로 (§5.2)
  assert.deepStrictEqual(parseStoredObject(fields.risk_profile_json), RISK_PROFILE);
  assert.deepStrictEqual(parseStoredObject(fields.policy_shadow_json), POLICY_SHADOW);
  assert.deepStrictEqual(parseStoredObject(fields.slice_risk_shadow_json), SLICE_SHADOW);
  // 스킬(LLM) 리더 경로 (§5.2) — 3필드 전부 bare JSON.parse (Task 5 리뷰 I2)
  assert.deepStrictEqual(JSON.parse(fields.risk_profile_json), RISK_PROFILE);
  assert.deepStrictEqual(JSON.parse(fields.policy_shadow_json), POLICY_SHADOW);
  assert.deepStrictEqual(JSON.parse(fields.slice_risk_shadow_json), SLICE_SHADOW);
  // 기존 필드 보존
  assert.strictEqual(fields.session_id, 's-test');
});

// NOTE: 이 테스트는 인코딩 RMW 누적 안전성(기존 키 in-place 교체·중복 키 미생성)을 고정한다.
// §6/I5의 "skill이 provisional을 spread해 보존" 자체는 스킬(LLM) 행위라 node:test 범위 밖 —
// Task 7 스킬 리뷰에서 별도 확인한다 (Task 5 리뷰 I1).
test('2회 patch (provisional → authoritative 추가) — 인코딩 RMW 누적 안전성', () => {
  const base = '---\nsession_id: s-test\n---\nbody\n';
  const step1 = updateFrontmatterText(base, {
    policy_shadow_json: JSON.stringify({ provisional: POLICY_SHADOW.provisional }) });
  const prev = JSON.parse(parseFrontmatter(step1).fields.policy_shadow_json);
  const step2 = updateFrontmatterText(step1, {
    policy_shadow_json: JSON.stringify({ ...prev, authoritative: POLICY_SHADOW.authoritative }) });
  const merged = JSON.parse(parseFrontmatter(step2).fields.policy_shadow_json);
  assert.deepStrictEqual(merged.provisional, POLICY_SHADOW.provisional);
  assert.deepStrictEqual(merged.authoritative, POLICY_SHADOW.authoritative);
});

test('파싱 실패 fail-open — 손상 문자열은 {} (§5.2)', () => {
  assert.deepStrictEqual(parseStoredObject('{broken'), {});
});
