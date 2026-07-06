const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WRAP = path.resolve(__dirname, 'wrap-receipt-envelope.js');

// Deterministic test-verification gate: for session-receipt kind, the wrapper
// reads the session state's `test_passed` marker via --session-state-file. When
// it is not confirmed true, a success-asserting outcome (merge/pr) is demoted
// to "in-progress" with x-declared-outcome preserved and x-test-verified=false.
// The emit is NOT refused (normal finish paths stay intact).

let dir;
function setup() { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-gate-')); }
function cleanup() { if (dir) { fs.rmSync(dir, { recursive: true, force: true }); dir = null; } }

function writePayload(outcome) {
  const p = path.join(dir, 'payload.json');
  fs.writeFileSync(p, JSON.stringify({
    schema_version: '1.0',
    session_id: 'dw-test',
    started_at: '2026-07-06T00:00:00Z',
    outcome,
    slices: { total: 1 },
  }));
  return p;
}

function writeState(testPassedLine) {
  const p = path.join(dir, 'state.md');
  fs.writeFileSync(p, `---\ncurrent_phase: test\n${testPassedLine}\n---\n`);
  return p;
}

function runWrap(extraArgs) {
  const out = path.join(dir, 'receipt.json');
  const r = spawnSync('node', [
    WRAP,
    '--artifact-kind', 'session-receipt',
    '--payload-file', path.join(dir, 'payload.json'),
    '--output', out,
    ...extraArgs,
  ], { encoding: 'utf8', timeout: 10000 });
  const payload = r.status === 0 ? JSON.parse(fs.readFileSync(out, 'utf8')).payload : null;
  return { r, payload };
}

describe('wrap-receipt-envelope.js — test_passed gate', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('test_passed=false + outcome=merge → demotes to in-progress (emit NOT refused)', () => {
    writePayload('merge');
    const state = writeState('test_passed: false');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'in-progress');
    assert.equal(payload['x-test-verified'], false);
    assert.equal(payload['x-declared-outcome'], 'merge');
  });

  it('test_passed=false + outcome=pr → demotes to in-progress', () => {
    writePayload('pr');
    const state = writeState('test_passed: false');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'in-progress');
    assert.equal(payload['x-declared-outcome'], 'pr');
  });

  it('test_passed missing entirely + outcome=merge → treated as unverified, demoted', () => {
    writePayload('merge');
    const state = writeState('finished_at: 2026-07-06T01:00:00Z'); // no test_passed line
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'in-progress');
    assert.equal(payload['x-test-verified'], false);
  });

  it('test_passed=true + outcome=merge → outcome intact, x-test-verified=true', () => {
    writePayload('merge');
    const state = writeState('test_passed: true');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge');
    assert.equal(payload['x-test-verified'], true);
    assert.equal('x-declared-outcome' in payload, false);
  });

  it('test_passed=false + outcome=discard → NOT demoted (only marker set)', () => {
    writePayload('discard');
    const state = writeState('test_passed: false');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'discard');
    assert.equal(payload['x-test-verified'], false);
  });

  it('no --session-state-file → payload untouched (backward compatible)', () => {
    writePayload('merge');
    const { r, payload } = runWrap([]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge');
    assert.equal('x-test-verified' in payload, false);
  });

  it('--session-state-file pointing at a missing file → gate skipped (fail-open)', () => {
    writePayload('merge');
    const { r, payload } = runWrap(['--session-state-file', path.join(dir, 'does-not-exist.md')]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge');
    assert.equal('x-test-verified' in payload, false);
  });
});
