'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, main } = require('./validate-spec-contract.js');

function specFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-cli-'));
  const contract = {
    schema_version: 1, spec_id: 'SPEC-CLI', risk_class: 'medium',
    requirements: [{ id: 'REQ-001', statement: 'Validate', acceptance: 'exit zero', priority: 'must',
      negative_test_ids: ['NEG-001'], evidence_gate_ids: ['GATE-negative-tests'] }],
    invariants: [{ id: 'INV-001', statement: 'Read only', requirement_ids: ['REQ-001'] }],
    failure_matrix: [],
    negative_tests: [{ id: 'NEG-001', statement: 'bad input', requirement_ids: ['REQ-001'],
      failure_mode_ids: [], expected_signal: 'exit one', gate_id: 'GATE-negative-tests' }],
    compatibility: { legacy_inputs: 'explicit', migration: 'none' }, open_questions: [],
  };
  const source = ['# Executable Spec: CLI', '## Scope', '- validation', '## Non-goals', '- writes',
    '## Contract', '```json spec-contract', JSON.stringify(contract), '```', '## Requirement Notes',
    '### REQ-001', 'note', '## Failure and Recovery Notes', 'None.', '## Decisions and Trade-offs',
    '- pure', '## Open Questions', '- None.', '## Spec Gate Result', '- Status: PASS'].join('\n');
  const file = path.join(dir, 'spec.md'); fs.writeFileSync(file, source); return file;
}

test('parseArgs rejects duplicate, unknown, and valueless flags', () => {
  assert.throws(() => parseArgs(['--spec', 'a', '--spec', 'b', '--risk-class', 'medium']), /duplicate/);
  assert.throws(() => parseArgs(['--wat']), /unknown/);
  assert.throws(() => parseArgs(['--spec', '--risk-class', 'medium']), /missing value/);
});

test('CLI emits one JSON object', () => {
  let stdout = ''; let stderr = '';
  const code = main(['--spec', specFile(), '--risk-class', 'medium'], {
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
  });
  assert.equal(code, 0, stderr);
  assert.equal(stdout.trim().split('\n').length, 1);
  const result = JSON.parse(stdout);
  assert.equal(result.pass, true);
  assert.equal(result.requirement_coverage.execution, null);
  assert.equal(result.failure_matrix_coverage.execution, null);
});

test('CLI distinguishes validated gate failure from usage failure', () => {
  let stdout = '';
  const code = main(['--spec', specFile(), '--risk-class', 'high'], {
    stdout: { write(value) { stdout += value; } }, stderr: { write() {} },
  });
  assert.equal(code, 1, 'validated contract gate failure uses exit 1');
  assert.equal(JSON.parse(stdout).pass, false);
  let bad = '';
  assert.equal(main(['--unknown'], { stdout: { write(value) { bad += value; } }, stderr: { write() {} } }), 2);
  assert.equal(JSON.parse(bad).pass, false);
});
