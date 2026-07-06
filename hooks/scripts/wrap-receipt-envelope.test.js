const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WRAP = path.resolve(__dirname, 'wrap-receipt-envelope.js');

// Deterministic test-verification signal: for session-receipt kind, the wrapper
// reads the session state's `test_passed` marker via --session-state-file and
// stamps x-test-verified:true|false on the payload. It does NOT rewrite outcome
// — merge/pr are already physically complete by §7-Z, so the receipt records
// the fact (outcome) and the verification signal (x-test-verified) separately.

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

describe('wrap-receipt-envelope.js — test_passed verification signal', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('test_passed=false + outcome=merge → outcome KEPT, x-test-verified=false', () => {
    writePayload('merge');
    const state = writeState('test_passed: false');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge', 'outcome must record the real (already-done) action');
    assert.equal(payload['x-test-verified'], false);
    assert.equal('x-declared-outcome' in payload, false, 'no outcome shadow field');
  });

  it('test_passed=false + outcome=pr → outcome KEPT, x-test-verified=false', () => {
    writePayload('pr');
    const state = writeState('test_passed: false');
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'pr');
    assert.equal(payload['x-test-verified'], false);
    assert.equal('x-declared-outcome' in payload, false);
  });

  it('test_passed missing entirely + outcome=merge → outcome KEPT, x-test-verified=false', () => {
    writePayload('merge');
    const state = writeState('finished_at: 2026-07-06T01:00:00Z'); // no test_passed line
    const { r, payload } = runWrap(['--session-state-file', state]);
    assert.equal(r.status, 0, `wrapper failed: ${r.stderr}`);
    assert.equal(payload.outcome, 'merge');
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

  it('test_passed=false + outcome=discard → outcome KEPT, x-test-verified=false', () => {
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
