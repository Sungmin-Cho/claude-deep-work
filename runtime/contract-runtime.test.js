'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSpecMarkdown,
  parsePlanContractMarkdown,
  validateSpecContract,
  specContractDigest,
  computeRequirementCoverage,
} = require('./contract-runtime.js');
const {canonicalJson}=require('./operation-journal.js');

function contract(overrides = {}) {
  return {
    schema_version: 1,
    spec_id: 'SPEC-CONTRACT',
    risk_class: 'medium',
    requirements: [{ id: 'REQ-001', statement: 'The command validates contracts',
      acceptance: 'invalid contracts fail', priority: 'must', negative_test_ids: ['NEG-001'],
      evidence_gate_ids: ['GATE-negative-tests'] }],
    invariants: [{ id: 'INV-001', statement: 'The validator is pure', requirement_ids: ['REQ-001'] }],
    failure_matrix: [],
    negative_tests: [{ id: 'NEG-001', statement: 'Reject duplicate IDs', requirement_ids: ['REQ-001'],
      failure_mode_ids: [], expected_signal: 'contract-duplicate-id', gate_id: 'GATE-negative-tests' }],
    compatibility: { legacy_inputs: 'accepted explicitly', migration: 'none' },
    open_questions: [],
    ...overrides,
  };
}

function markdown(value = contract()) {
  return [
    '# Executable Spec: Contract runtime', '## Scope', '- validation', '## Non-goals', '- execution',
    '## Contract', '```json spec-contract', JSON.stringify(value, null, 2), '```',
    '## Requirement Notes', '### REQ-001', 'note', '## Failure and Recovery Notes', 'None.',
    '## Decisions and Trade-offs', '- pure runtime', '## Open Questions', '- None.',
    '## Spec Gate Result', '- Status: PASS',
  ].join('\n');
}

test('valid Medium contract has stable digest and complete requirement coverage', () => {
  const parsed = parseSpecMarkdown(markdown(), { path: 'spec.md' });
  const result = validateSpecContract(parsed, { riskClass: 'medium' });
  assert.equal(result.pass, true, JSON.stringify(result.errors));
  assert.equal(result.requirementCoverage.contract.ratio, 1);
  assert.match(specContractDigest(parsed), /^[0-9a-f]{64}$/);
  assert.equal(specContractDigest(parsed), specContractDigest({ ...parsed }));
});

test('Medium partial requirement coverage is rejected', () => {
  const value = contract({ requirements: [...contract().requirements,
    { id: 'REQ-002', statement: 'Second behavior', acceptance: '', priority: 'must',
      negative_test_ids: [], evidence_gate_ids: [] }] });
  const result = validateSpecContract(value, { riskClass: 'medium' });
  assert.equal(result.pass, false);
  assert.ok(result.errors.some((error) => error.code === 'contract-requirement-coverage'));
  assert.equal(computeRequirementCoverage(value).contract.ratio, 0.5);
});

test('High requires a non-empty complete failure matrix', () => {
  const value = contract({ risk_class: 'high' });
  const result = validateSpecContract(value, { riskClass: 'high' });
  assert.equal(result.pass, false);
  assert.ok(result.errors.some((error) => error.code === 'contract-failure-matrix-coverage'));
});

test('duplicate, dangling and embedded digest inputs fail with stable codes', () => {
  const duplicate = contract({ requirements: [contract().requirements[0], contract().requirements[0]] });
  assert.ok(validateSpecContract(duplicate, { riskClass: 'medium' }).errors
    .some((error) => error.code === 'contract-duplicate-id'));
  const dangling = contract({ invariants: [{ id: 'INV-001', statement: 'x', requirement_ids: ['REQ-999'] }] });
  assert.ok(validateSpecContract(dangling, { riskClass: 'medium' }).errors
    .some((error) => error.code === 'contract-dangling-reference'));
  assert.throws(() => specContractDigest({ ...contract(), spec_sha256: 'a'.repeat(64) }),
    (error) => error.code === 'contract-embedded-digest');
});

test('parser requires heading order and exactly one canonical fence', () => {
  assert.throws(() => parseSpecMarkdown(markdown().replace('## Scope', '## Missing')),
    (error) => error.code === 'spec-heading-order');
  assert.throws(() => parseSpecMarkdown(`${markdown()}\n\n${markdown()}`),
    (error) => error.code === 'spec-contract-fence-count');
  assert.deepEqual(parseSpecMarkdown(markdown().replace(/\n/g, '\r\n')), parseSpecMarkdown(markdown()));
});

test('strict v6.14 Plan parses exact capability facts and functional/release verification carriers',()=>{
  const verificationSpec={schema_version:2,executable:{kind:'node-toolchain',name:'node',
    supported_patches_sha256:'1'.repeat(64)},args:['--test','--test-reporter=tap','--','runtime/a.test.js'],
    cwd_role:'worktree',timeout_ms:120000,max_output_bytes:1048576,
    environment:{mode:'closed',values:{LANG:'C',LC_ALL:'C',TZ:'UTC'}},
    red_failure:{adapter:'node-test-tap',adapter_version:1,expected_class:'expected-failure',
      expected_signal:{kind:'assertion',operator:'strictEqual',test_identity:{test_file:'runtime/a.test.js',
        test_name:'rejects absent carrier',start_line:10},expected_digest:'2'.repeat(64),actual_digest:null,
        message_pattern:'carrier unavailable'}}};
  const facts={schema_version:1,authority:'reviewed-plan',destructive:false,external_action:false,
    has_backward_compat:true,has_migration:true,host_dependent:true,source_requirement_ids:['REQ-001'],
    source_slice_ids:['SLICE-001','SLICE-002']};
  facts.facts_sha256=require('node:crypto').createHash('sha256').update(Buffer.concat([
    Buffer.from('capability-facts-v1\0'),Buffer.from(canonicalJson(facts))])).digest('hex');
  const source=['## Spec Contract Binding','```json',JSON.stringify({schema_version:1,mode:'strict-spec',
    created_by_version:'6.14.0',spec_contract:{schema_version:1,spec_id:'SPEC-CONTRACT',
      spec_sha256:'3'.repeat(64),spec_approved_hash:'4'.repeat(64)},risk_profile_sha256:'5'.repeat(64)}),'```',
    `capability_facts: ${canonicalJson(facts)}`,'## Slice Checklist',
    '- [ ] SLICE-001: Functional carrier','  - slice_kind: functional',
    `  - verification_spec: ${canonicalJson(verificationSpec)}`,
    '  - outcome: exact carrier','  - files: [runtime/a.js, runtime/a.test.js]','  - depends_on: []',
    '  - integration_touchpoints: [plan]','  - requirements: [REQ-001]','  - invariants: [INV-001]',
    '  - failure_modes: []','  - risk: { class: medium, score: 5, triggers: [] }',
    '  - negative_tests: [NEG-001]','  - evidence_required: [GATE-negative-tests]',
    '  - rollback: { method: revert, verification: [GATE-recovery] }','  - review_policy: single',
    '  - scope_expansion_trigger: [scope]','  - failing_test: absent carrier',
    '  - verification_cmd: node --test runtime/a.test.js','  - expected_output: fail',
    '  - code_sketch: carrier()','  - spec_checklist: [REQ-001]','  - contract: [exact]',
    '  - acceptance_threshold: all','  - size: M','  - steps:','    1. fail','    2. pass',
    '- [ ] SLICE-002: Release verification','  - slice_kind: release-verification',
    '  - verification_spec: null','  - outcome: release gates','  - files: []','  - depends_on: [SLICE-001]',
    '  - integration_touchpoints: [release]','  - requirements: [REQ-001]','  - invariants: [INV-001]',
    '  - failure_modes: []','  - risk: { class: medium, score: 5, triggers: [] }',
    '  - negative_tests: [NEG-001]','  - evidence_required: [GATE-negative-tests]',
    '  - rollback: { method: none, verification: [GATE-recovery] }','  - review_policy: dual',
    '  - scope_expansion_trigger: [write]','  - failing_test: none','  - verification_scope: [npm test]',
    '  - release_gate_ids: [GATE-full-relevant-suite]','  - verification_cmd: none',
    '  - expected_output: pass','  - code_sketch: none','  - spec_checklist: [REQ-001]',
    '  - contract: [write-free]','  - acceptance_threshold: all','  - size: S','  - steps:',
    '    1. verify'].join('\n');
  const parsed=parsePlanContractMarkdown(source,{specIndex:{requirements:new Set(['REQ-001']),
    invariants:new Set(['INV-001']),failureModes:new Set(),negativeTests:new Set(['NEG-001'])}});
  assert.equal(parsed.capability_facts.facts_sha256,facts.facts_sha256);
  assert.equal(parsed.slices[0].slice_kind,'functional');
  assert.equal(parsed.slices[0].verification_spec.red_failure.expected_signal.test_identity.start_line,10);
  assert.equal(parsed.slices[1].slice_kind,'release-verification');
  assert.equal(parsed.slices[1].verification_spec,null);
  assert.deepEqual(parsed.slices[1].release_gate_ids,['GATE-full-relevant-suite']);
  assert.throws(()=>parsePlanContractMarkdown(source.replace('verification_spec: null',
    `verification_spec: ${canonicalJson(verificationSpec)}`)),/release-verification-spec/);
});
