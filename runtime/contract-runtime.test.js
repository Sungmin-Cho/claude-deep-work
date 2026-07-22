'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSpecMarkdown,
  validateSpecContract,
  specContractDigest,
  computeRequirementCoverage,
} = require('./contract-runtime.js');

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
