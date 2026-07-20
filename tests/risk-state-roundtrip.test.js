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

// session-store.js parseStoredObject와 동일 계약 (비공개 함수라 동일 로직 재기술)
function parseStoredObjectContract(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const p = JSON.parse(value); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch {}
  }
  return {};
}

test('§5.1 인코딩 round-trip — updateFrontmatterText → parseFrontmatter → 양쪽 리더', () => {
  const base = '---\nsession_id: s-test\ncurrent_phase: research\n---\nbody\n';
  const patched = updateFrontmatterText(base, {
    risk_profile_json: JSON.stringify(RISK_PROFILE),
    policy_shadow_json: JSON.stringify(POLICY_SHADOW),
    slice_risk_shadow_json: JSON.stringify(SLICE_SHADOW),
  });
  const { fields } = parseFrontmatter(patched); // §5.1: frontmatter-invalid 없이 통과해야 함
  // Node 리더 경로 (§5.2)
  assert.deepStrictEqual(parseStoredObjectContract(fields.risk_profile_json), RISK_PROFILE);
  assert.deepStrictEqual(parseStoredObjectContract(fields.policy_shadow_json), POLICY_SHADOW);
  assert.deepStrictEqual(parseStoredObjectContract(fields.slice_risk_shadow_json), SLICE_SHADOW);
  // 스킬(LLM) 리더 경로 (§5.2)
  assert.deepStrictEqual(JSON.parse(fields.risk_profile_json), RISK_PROFILE);
  // 기존 필드 보존
  assert.strictEqual(fields.session_id, 's-test');
});

test('2회 patch (provisional → authoritative 추가)에도 provisional 블록 보존 (§6, I5)', () => {
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
  assert.deepStrictEqual(parseStoredObjectContract('{broken'), {});
});
