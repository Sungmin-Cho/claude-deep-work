// Regression test for the receipt-loss scenario introduced when the
// unconditional pre-lock receipt-init block was removed from file-tracker.sh
// (commit 6982166). When a stale lock causes `_acquire_lock` to time out on
// the very first PostToolUse invocation for a slice, the timeout branch
// only appends to the `<receipt>.pending-changes.jsonl` sidecar and never
// creates the canonical `SLICE-NNN.json`. Downstream `verifyReceipts` then
// sees zero canonical receipts.
//
// This test simulates the stale-lock condition by pre-creating the lock dir
// before invoking file-tracker.sh. With the pre-fix file-tracker, the
// canonical receipt does NOT exist after the run. With the fix restored,
// the unconditional init block creates the canonical receipt BEFORE
// `_acquire_lock` is attempted, so the receipt survives the lock timeout.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'file-tracker.sh');

describe('file-tracker.sh — canonical receipt survives lock timeout (C2 regression)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-c2-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates SLICE-001.json with initial schema even when the receipt lock is held', () => {
    const sid = 's-c2-lock';
    const workDir = '.deep-work/test';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(
      statePath,
      `---\ncurrent_phase: implement\nwork_dir: ${workDir}\nactive_slice: SLICE-001\n---\n`
    );
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);

    // Pre-create the receipt dir AND the stale lock dir to force the
    // `_acquire_lock` branch to time out (40 retries × 0.05s ≈ 2s wait).
    const receiptDir = path.join(tmpDir, workDir, 'receipts');
    fs.mkdirSync(receiptDir, { recursive: true });
    const receiptPath = path.join(receiptDir, 'SLICE-001.json');
    const lockPath = `${receiptPath}.lock`;
    fs.mkdirSync(lockPath);

    // Touch the target file so file-tracker doesn't bail on missing path.
    const targetFile = path.join(tmpDir, 'src', 'feature.js');
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, '// payload');

    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };

    const t0 = Date.now();
    const result = spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ file_path: targetFile }),
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    const elapsed = Date.now() - t0;

    // PostToolUse hooks must always exit 0 even when the lock times out.
    assert.equal(result.status, 0, `hook failed: ${result.stderr}`);

    // Sanity: the stale lock must still be present (we never released it,
    // and file-tracker must NOT force-remove an external lock).
    assert.ok(fs.existsSync(lockPath), 'external stale lock must not be force-removed');

    // The pending sidecar should have captured the change (last-resort path).
    const pendingPath = `${receiptPath}.pending-changes.jsonl`;
    assert.ok(
      fs.existsSync(pendingPath),
      `expected pending sidecar at ${pendingPath} after lock timeout. dir contents: ${fs.readdirSync(receiptDir)}`
    );

    // Core assertion: canonical SLICE-001.json MUST exist with the initial
    // schema. Pre-fix (6982166): this fails — only the pending sidecar exists.
    // Post-fix: the unconditional pre-lock init created the receipt before
    // _acquire_lock was even attempted.
    assert.ok(
      fs.existsSync(receiptPath),
      `canonical receipt missing at ${receiptPath}. ` +
        `dir contents: ${JSON.stringify(fs.readdirSync(receiptDir))}, elapsed=${elapsed}ms`
    );

    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.slice_id, 'SLICE-001', 'slice_id must match active_slice');
    assert.equal(receipt.status, 'in_progress', 'initial status must be in_progress');
    assert.equal(receipt.tdd_state, 'PENDING', 'initial tdd_state must be PENDING');
    assert.ok(receipt.changes, 'changes object must exist');
    assert.ok(Array.isArray(receipt.changes.files_modified), 'changes.files_modified must be an array');

    // Cleanup the external lock we created.
    fs.rmdirSync(lockPath);
  });
});
