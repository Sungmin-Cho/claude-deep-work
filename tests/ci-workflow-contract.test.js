const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('CI workflow — shellcheck advisory step (harnessability C)', () => {
  const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'tests.yml');
  let workflow;
  let stepBlock;

  before(() => {
    workflow = fs.readFileSync(workflowPath, 'utf8');
    const stepMarker = 'name: Shellcheck hooks (advisory)';
    const start = workflow.indexOf(stepMarker);
    assert.notEqual(start, -1, 'shellcheck advisory step is missing from tests.yml');
    const next = workflow.indexOf('\n      - name:', start + stepMarker.length);
    stepBlock = next === -1 ? workflow.slice(start) : workflow.slice(start, next);
  });

  it('declares the advisory shellcheck step by name', () => {
    assert.match(workflow, /name:\s*Shellcheck hooks \(advisory\)/);
  });

  it('marks the step as non-blocking (continue-on-error: true)', () => {
    assert.match(stepBlock, /continue-on-error:\s*true/);
  });

  it('targets hooks/scripts', () => {
    assert.match(stepBlock, /hooks\/scripts/);
  });

  it('handles a missing shellcheck binary gracefully', () => {
    assert.match(stepBlock, /command -v shellcheck/);
  });

  it('runs at severity=warning with --external-sources', () => {
    assert.match(stepBlock, /--severity=warning/);
    assert.match(stepBlock, /--external-sources/);
  });

  it('does not run before npm test (advisory must not gate primary tests)', () => {
    const shellcheckIdx = workflow.indexOf('name: Shellcheck hooks (advisory)');
    const npmTestIdx = workflow.indexOf('Run full Node test suite');
    assert.notEqual(shellcheckIdx, -1, 'shellcheck step name missing');
    assert.notEqual(npmTestIdx, -1, '"Run full Node test suite" step missing — workflow renamed?');
    assert.ok(shellcheckIdx > npmTestIdx,
      'shellcheck step must appear after the npm test step');
  });
});
