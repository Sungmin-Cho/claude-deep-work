'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlanScopeV1, canonicalizePlanScopeV1, deriveScopedWriteAuthority } =
  require('./plan-runtime.js');
const { compilePlanProjectionV1 } = require('./plan-runtime.js');
const { specContractDigest } = require('./contract-runtime.js');

test('plan approval is the sole plan.json producer', () => {
  const specContract = {
    schema_version: 1, spec_id: 'SPEC-PLAN', risk_class: 'medium',
    requirements: [{ id: 'REQ-001', statement: 'Project plan', acceptance: 'projection matches',
      priority: 'must', negative_test_ids: ['NEG-001'], evidence_gate_ids: ['GATE-plan-alignment'] }],
    invariants: [{ id: 'INV-001', statement: 'Bound identity', requirement_ids: ['REQ-001'] }],
    failure_matrix: [], negative_tests: [{ id: 'NEG-001', statement: 'stale plan',
      requirement_ids: ['REQ-001'], failure_mode_ids: [], expected_signal: 'digest mismatch',
      gate_id: 'GATE-plan-alignment' }], compatibility: { legacy_inputs: 'explicit', migration: 'none' },
    open_questions: [],
  };
  const markdown = ['## Spec Contract Binding', '', '```json', JSON.stringify({ schema_version: 1,
    mode: 'strict-spec', created_by_version: '6.13.0', spec_contract: { schema_version: 1,
      spec_id: 'SPEC-PLAN', spec_sha256: specContractDigest(specContract), spec_approved_hash: 'a'.repeat(64) },
    risk_profile_sha256: 'b'.repeat(64) }), '```', '', '## Slice Checklist', '',
    '- [ ] SLICE-001: Project one slice', '  - outcome: projection is authoritative',
    '  - files: [runtime/a.js, runtime/a.test.js]', '  - depends_on: []',
    '  - integration_touchpoints: [plan approval]', '  - requirements: [REQ-001]',
    '  - invariants: [INV-001]', '  - failure_modes: []',
    '  - risk: { class: medium, score: 6, triggers: [state-machine] }',
    '  - negative_tests: [NEG-001]', '  - evidence_required: [GATE-plan-alignment]',
    '  - rollback: { method: revert, verification: [GATE-recovery] }', '  - review_policy: single',
    '  - scope_expansion_trigger: [public API change]', '  - failing_test: projection absent',
    '  - verification_cmd: node --test runtime/a.test.js', '  - expected_output: fail 0',
    '  - code_sketch: compilePlanProjectionV1()', '  - spec_checklist: [REQ-001]',
    '  - contract: [exact digest]', '  - acceptance_threshold: all', '  - size: M',
    '  - steps:', '    1. runtime/a.test.js fails first', '    2. runtime/a.js compiles projection'].join('\n');
  const projection = compilePlanProjectionV1({ planMarkdown: markdown, specContract,
    sliceRiskState: { 'SLICE-001': { class: 'medium', score: 6, triggers: ['state-machine'] } } });
  assert.equal(projection.schema_version, 1);
  assert.equal(projection.contract_binding.spec_contract.spec_sha256, specContractDigest(specContract));
  assert.match(projection.contract_binding.source_plan_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(projection.slices[0].write_scope.failing_test, ['runtime/a.test.js']);
  assert.deepEqual(projection.slices[0].write_scope.production, ['runtime/a.js']);
  assert.equal(projection.slices[0].contract.outcome, 'projection is authoritative');
  assert.throws(() => compilePlanProjectionV1({ planMarkdown: markdown.replace('score: 6', 'score: 7'),
    specContract, sliceRiskState: { 'SLICE-001': { class: 'medium', score: 6, triggers: ['state-machine'] } } }),
  /risk/);
});

const plan = {schema_version:1, slices:[{id:'SLICE-001', checked:false,
  scope_schema_version:1, files:['src/a.js','tests/a.test.js'], write_scope:{
    failing_test:['tests/a.test.js'], production:['src/a.js'],
    refactor:['src/a.js','tests/a.test.js'],
  }}]};

test('plan scope is byte-sorted, disjoint, complete, and digest-bound', () => {
  const checked = validatePlanScopeV1(plan);
  const canonical = canonicalizePlanScopeV1(checked);
  assert.deepEqual(canonical.slices[0].files, ['src/a.js','tests/a.test.js']);
  assert.match(canonical.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => validatePlanScopeV1({schema_version:1, slices:[{
    ...plan.slices[0], files:['src/A.js','src/a.js','tests/a.test.js'],
  }]}), /plan-scope/);
  assert.throws(() => validatePlanScopeV1({schema_version:1, slices:[{
    ...plan.slices[0], files:['CON','tests/a.test.js'], write_scope:{
      failing_test:['tests/a.test.js'], production:['CON'], refactor:[],
    },
  }]}), /portable-path-v1/);
});

test('inline authority is the intersection of class paths and slice union', () => {
  const authority = deriveScopedWriteAuthority({plan, sliceId:'SLICE-001',
    writeClass:'failing-test'});
  assert.deepEqual(authority.authorized_paths, ['tests/a.test.js']);
  assert.equal(authority.cluster_id, null);
  assert.match(authority.sha256, /^[0-9a-f]{64}$/);
});

test('delegation assignment is an exact partition of the locked plan', () => {
  const twoSlicePlan = {...plan, slices:[...plan.slices, {
    id:'SLICE-002', checked:false, scope_schema_version:1,
    files:['src/b.js','tests/b.test.js'], write_scope:{
      failing_test:['tests/b.test.js'], production:['src/b.js'], refactor:[],
    },
  }]};
  assert.throws(() => deriveScopedWriteAuthority({plan:twoSlicePlan,
    sliceId:'SLICE-001', writeClass:'production', clusterId:'C1',
    assignment:{schema_version:1, clusters:[{id:'C1',slices:['SLICE-001']}]},
  }), /delegation-scope-partition/);
  assert.throws(() => deriveScopedWriteAuthority({plan:twoSlicePlan,
    sliceId:'SLICE-001', writeClass:'production', clusterId:'C1',
    assignment:{schema_version:1, clusters:[{id:'C1',slices:['SLICE-002','SLICE-001']}]},
  }), /delegation-scope-order/);
});
