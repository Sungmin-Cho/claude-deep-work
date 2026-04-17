const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'file-tracker.sh');

// Spawn file-tracker.sh as a child process that writes the given file_path
// into the active receipt. Returns a promise that resolves when the process exits.
function runOnce(cwd, env, filePath) {
  return new Promise((resolve) => {
    const p = spawn('bash', [SCRIPT], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    p.stdin.write(JSON.stringify({ file_path: filePath }));
    p.stdin.end();
    let stderr = '';
    p.stderr.on('data', d => { stderr += d; });
    p.on('close', (code) => resolve({ code, stderr }));
  });
}

describe('file-tracker.sh receipt race — no lost entries under concurrency', () => {
  const TRIALS = 10;     // kept modest for CI runtime; bug reproduces at ≥5 trials empirically
  const PARALLEL = 8;

  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it(`${TRIALS} trials of ${PARALLEL}-way concurrent Write: all entries land`, async () => {
    const sid = 's-race';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);

    for (let trial = 0; trial < TRIALS; trial++) {
      // Fresh state each trial
      const workDir = `.deep-work/trial-${trial}`;
      fs.writeFileSync(
        statePath,
        `---\ncurrent_phase: implement\nwork_dir: ${workDir}\nactive_slice: SLICE-001\n---\n`
      );
      fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
      fs.mkdirSync(path.join(tmpDir, workDir), { recursive: true });

      const env = {
        ...process.env,
        CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
        DEEP_WORK_SESSION_ID: sid,
      };

      // Spawn PARALLEL file-tracker invocations with distinct file paths
      const paths = Array.from({ length: PARALLEL }, (_, i) =>
        path.join(tmpDir, `src-${trial}-${i}.js`)
      );
      // Touch each file so file-tracker doesn't bail on exclusion logic
      for (const p of paths) fs.writeFileSync(p, '// payload');

      await Promise.all(paths.map(p => runOnce(tmpDir, env, p)));

      const receiptPath = path.join(tmpDir, workDir, 'receipts', 'SLICE-001.json');
      assert.ok(fs.existsSync(receiptPath), `trial ${trial}: receipt missing`);
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const recorded = new Set(receipt.changes.files_modified);

      // v6.2.4 post-review: the CANONICAL receipt must contain every
      // entry after the race settles. The previous version unioned the
      // pending sidecar to claim success — that only proved recovery was
      // possible, not that downstream consumers (/deep-finish) would see
      // a complete picture. With extended retries (2s, was 1s), all writers
      // should succeed serially without touching the pending file.
      for (const p of paths) {
        assert.ok(
          recorded.has(p),
          `trial ${trial}: lost entry ${p} in canonical receipt. Recorded: ${JSON.stringify([...recorded])}`
        );
      }

      // Pending sidecar must be empty after the race — if it is not, the
      // canonical receipt is missing some entries that downstream readers
      // cannot recover on their own.
      const pendingPath = receiptPath + '.pending-changes.jsonl';
      if (fs.existsSync(pendingPath) && fs.statSync(pendingPath).size > 0) {
        assert.fail(`trial ${trial}: pending sidecar non-empty after race:\n${fs.readFileSync(pendingPath, 'utf8')}`);
      }

      // No leftover .draining.<pid> files either (should have been unlinked
      // after canonical write).
      const receiptDir = path.dirname(receiptPath);
      const leftover = fs.readdirSync(receiptDir).filter(n => n.includes('.draining.'));
      assert.deepEqual(leftover, [], `trial ${trial}: leftover draining files: ${leftover}`);
    }
  });
});
