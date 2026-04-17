const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PHASE_TRANSITION = path.resolve(__dirname, 'phase-transition.sh');
const FILE_TRACKER = path.resolve(__dirname, 'file-tracker.sh');

describe('phase-transition.sh stdin-cache fallback (v6.2.4 — C-1)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-cache-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeStateFile(sid, fields) {
    const yaml = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
    const fp = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(fp, `---\n${yaml}\n---\n`);
    return fp;
  }

  function writePointer(sid) {
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
  }

  it('reads stdin cache when CLAUDE_TOOL_USE_INPUT is unset (Claude Code prod reality)', () => {
    const sid = 's-cache1';
    const stateFile = writeStateFile(sid, {
      current_phase: 'plan',
      worktree_enabled: 'true',
      worktree_path: '"/tmp/wt"',
      team_mode: 'team',
    });
    writePointer(sid);

    // Simulate what file-tracker.sh does: write the tool input to a PPID-keyed
    // cache file before phase-transition.sh runs. Use a stable test PPID.
    const testPpid = String(process.pid);
    const cacheFile = path.join(tmpDir, '.claude', `.hook-tool-input.${testPpid}`);
    fs.writeFileSync(cacheFile, JSON.stringify({ file_path: stateFile }));

    // Run phase-transition.sh with env vars unset, but with $$ matching testPpid
    // is impossible; instead we spawn a bash wrapper that sets PPID indirectly.
    // Trick: `exec bash phase-transition.sh` so the PPID inherits from our child.
    // Easier: set a PPID override via a helper script.
    // Simplest and most honest: write the cache with $PPID the phase-transition
    // script will see. That PPID is the PID of the spawned `bash` process's
    // parent, which is `node` (our test). So write cache keyed by `node`'s PID.
    // That matches $PPID inside the bash subprocess.
    // Clean up the old cache and rewrite with correct key.
    fs.unlinkSync(cacheFile);
    const correctCache = path.join(tmpDir, '.claude', `.hook-tool-input.${process.pid}`);
    fs.writeFileSync(correctCache, JSON.stringify({ file_path: stateFile }));

    const env = { ...process.env };
    delete env.CLAUDE_TOOL_USE_INPUT;
    delete env.CLAUDE_TOOL_INPUT;

    const result = spawnSync('bash', [PHASE_TRANSITION], {
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Phase Transition/, `stdout: ${result.stdout}`);
    assert.match(result.stdout, /worktree_path/);
    assert.match(result.stdout, /team_mode: team/);
  });

  it('file-tracker.sh + phase-transition.sh integration: cache flows end-to-end', async () => {
    const sid = 's-cache2';
    const stateFile = writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: '/tmp/integ',
      tdd_mode: 'strict',
      work_dir: '.deep-work/integ',
    });
    writePointer(sid);
    fs.mkdirSync(path.join(tmpDir, '.deep-work', 'integ'), { recursive: true });

    // Spawn both hooks sequentially, sharing PPID (this node process).
    // Step 1: file-tracker.sh writes cache.
    const toolInput = JSON.stringify({ file_path: stateFile });
    const ft = spawnSync('bash', [FILE_TRACKER], {
      input: toolInput,
      cwd: tmpDir,
      env: {
        ...process.env,
        CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
        DEEP_WORK_SESSION_ID: sid,
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(ft.status, 0, `file-tracker failed: ${ft.stderr}`);

    // Verify cache was written (keyed by this node process's PID = bash's PPID)
    const cacheFile = path.join(tmpDir, '.claude', `.hook-tool-input.${process.pid}`);
    assert.ok(fs.existsSync(cacheFile), 'file-tracker.sh must write the PPID cache');

    // Step 2: phase-transition.sh runs with env unset; should read the cache.
    // But since this state file has current_phase=implement and no OLD_PHASE,
    // the transition detection should fire (cache OLD=""  ≠ NEW="implement").
    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };
    delete env.CLAUDE_TOOL_USE_INPUT;
    delete env.CLAUDE_TOOL_INPUT;

    const pt = spawnSync('bash', [PHASE_TRANSITION], {
      cwd: tmpDir,
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(pt.status, 0, `phase-transition failed: ${pt.stderr}`);
    assert.match(pt.stdout, /Phase Transition/, `stdout: ${pt.stdout}`);
    assert.match(pt.stdout, /worktree_path/);
    assert.match(pt.stdout, /tdd_mode: strict/);
  });
});
