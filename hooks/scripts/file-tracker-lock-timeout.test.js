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
//
// Phase 2 (round-3 strengthening): the canonical receipt's existence is only
// half the recovery contract — the production code also promises that the
// pending sidecar entries are drained into `changes.files_modified` on the
// next successful lock-acquire. Phase 2 releases the pre-created lock and
// invokes file-tracker again with a different file path; both files must
// then appear in the canonical receipt and the pending sidecar must be drained.

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

  it('creates the canonical receipt under lock timeout AND drains pending sidecar on next acquire', () => {
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

    // Touch the target files so file-tracker doesn't bail on missing paths.
    const firstFile = path.join(tmpDir, 'src', 'feature.js');
    const secondFile = path.join(tmpDir, 'src', 'feature-2.js');
    fs.mkdirSync(path.dirname(firstFile), { recursive: true });
    fs.writeFileSync(firstFile, '// payload one');
    fs.writeFileSync(secondFile, '// payload two');

    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };

    // ─── Phase 1 — invoke under stale lock; timeout path engages. ───────
    const t0 = Date.now();
    const phase1 = spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ file_path: firstFile }),
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    const phase1Elapsed = Date.now() - t0;

    // PostToolUse hooks must always exit 0 even when the lock times out.
    assert.equal(phase1.status, 0, `phase 1 hook failed: ${phase1.stderr}`);

    // Sanity: the stale lock must still be present (we never released it,
    // and file-tracker must NOT force-remove an external lock).
    assert.ok(fs.existsSync(lockPath), 'phase 1: external stale lock must not be force-removed');

    // The pending sidecar should have captured the change (last-resort path).
    const pendingPath = `${receiptPath}.pending-changes.jsonl`;
    assert.ok(
      fs.existsSync(pendingPath),
      `phase 1: expected pending sidecar at ${pendingPath} after lock timeout. dir contents: ${fs.readdirSync(receiptDir)}`
    );
    const pendingLines = fs.readFileSync(pendingPath, 'utf8').split('\n').filter(Boolean);
    assert.ok(
      pendingLines.some(l => JSON.parse(l).file_path === firstFile),
      `phase 1: pending sidecar must include ${firstFile}. contents:\n${fs.readFileSync(pendingPath, 'utf8')}`
    );

    // Core assertion (phase 1): canonical SLICE-001.json MUST exist with the
    // initial schema. Pre-fix (6982166): this fails — only the pending
    // sidecar exists. Post-fix: the unconditional pre-lock init created the
    // receipt before _acquire_lock was even attempted.
    assert.ok(
      fs.existsSync(receiptPath),
      `phase 1: canonical receipt missing at ${receiptPath}. ` +
        `dir contents: ${JSON.stringify(fs.readdirSync(receiptDir))}, elapsed=${phase1Elapsed}ms`
    );

    const phase1Receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.equal(phase1Receipt.slice_id, 'SLICE-001', 'phase 1: slice_id must match active_slice');
    assert.equal(phase1Receipt.status, 'in_progress', 'phase 1: initial status must be in_progress');
    assert.equal(phase1Receipt.tdd_state, 'PENDING', 'phase 1: initial tdd_state must be PENDING');
    assert.ok(phase1Receipt.changes, 'phase 1: changes object must exist');
    assert.ok(Array.isArray(phase1Receipt.changes.files_modified), 'phase 1: changes.files_modified must be an array');
    // On the timeout path, the canonical receipt does NOT yet contain the
    // file change — that lives in the pending sidecar until a later
    // invocation drains it.
    assert.deepEqual(
      phase1Receipt.changes.files_modified,
      [],
      `phase 1: files_modified must be empty on timeout path; was ${JSON.stringify(phase1Receipt.changes.files_modified)}`
    );

    // ─── Phase 2 — release the stale lock and invoke again. ─────────────
    // The successful lock acquire must drain the pending sidecar AND add the
    // new file. End-to-end recovery: both files land in the canonical receipt.
    fs.rmdirSync(lockPath);

    const phase2 = spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ file_path: secondFile }),
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(phase2.status, 0, `phase 2 hook failed: ${phase2.stderr}`);

    const phase2Receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.ok(
      Array.isArray(phase2Receipt.changes.files_modified),
      'phase 2: changes.files_modified must remain an array after drain'
    );
    assert.ok(
      phase2Receipt.changes.files_modified.includes(firstFile),
      `phase 2: drained first file missing from canonical receipt. ` +
        `files_modified=${JSON.stringify(phase2Receipt.changes.files_modified)}`
    );
    assert.ok(
      phase2Receipt.changes.files_modified.includes(secondFile),
      `phase 2: directly-added second file missing from canonical receipt. ` +
        `files_modified=${JSON.stringify(phase2Receipt.changes.files_modified)}`
    );

    // Pending sidecar must be drained — either unlinked or empty.
    if (fs.existsSync(pendingPath)) {
      const remaining = fs.readFileSync(pendingPath, 'utf8').split('\n').filter(Boolean);
      assert.deepEqual(
        remaining,
        [],
        `phase 2: pending sidecar must be drained. residual lines:\n${remaining.join('\n')}`
      );
    }

    // No leftover .draining.<pid> files either.
    const leftover = fs.readdirSync(receiptDir).filter(n => n.includes('.draining.'));
    assert.deepEqual(leftover, [], `phase 2: leftover draining files: ${leftover}`);
  });
});
