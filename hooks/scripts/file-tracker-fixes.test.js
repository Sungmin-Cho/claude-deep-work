const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'file-tracker.sh');
const UTILS = path.resolve(__dirname, 'utils.sh');

describe('file-tracker.sh v6.2.4 post-review: cache happens BEFORE phase check', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-c3a-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeState(sid, phase) {
    const sp = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(sp, `---\ncurrent_phase: ${phase}\n---\n`);
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
    return sp;
  }

  for (const phase of ['research', 'plan', 'test', 'idle']) {
    it(`caches stdin even when current_phase=${phase} (was missing pre-fix)`, () => {
      const sid = `s-c3a-${phase}`;
      const statePath = writeState(sid, phase);
      const env = {
        ...process.env,
        CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
        DEEP_WORK_SESSION_ID: sid,
      };
      const toolInput = JSON.stringify({ file_path: statePath });
      const result = spawnSync('bash', [SCRIPT], {
        input: toolInput, cwd: tmpDir, env, encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.status, 0, `hook failed: ${result.stderr}`);

      // Cache file should be written (key = this process's pid, which is the bash subprocess's PPID)
      const cacheFile = path.join(tmpDir, '.claude', `.hook-tool-input.${process.pid}`);
      assert.ok(fs.existsSync(cacheFile),
        `cache file missing for phase=${phase}. dir contents: ${fs.readdirSync(path.join(tmpDir, '.claude'))}`);
      assert.equal(fs.readFileSync(cacheFile, 'utf8'), toolInput);
    });
  }
});

describe('file-tracker.sh v6.2.4 post-review: marker flip is lock-guarded', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-c1-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('skips marker flip when ${STATE_FILE}.lock is already held (was unsynchronized pre-fix)', () => {
    const sid = 's-c1';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(
      statePath,
      '---\ncurrent_phase: implement\nwork_dir: .deep-work/wd\nactive_slice: SLICE-001\nsensor_cache_valid: true\n---\n'
    );
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}');

    // Hold the state-file lock externally to simulate sensor-trigger.js mid-write.
    const lockPath = `${statePath}.lock`;
    fs.mkdirSync(lockPath);

    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };
    const result = spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ file_path: path.join(tmpDir, 'package.json') }),
      cwd: tmpDir, env, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0, `hook failed: ${result.stderr}`);

    // Because we held the lock for longer than retry budget (20 × 0.05s = 1s),
    // file-tracker must NOT have flipped sensor_cache_valid (stayed true).
    const content = fs.readFileSync(statePath, 'utf8');
    assert.match(content, /sensor_cache_valid:\s*true/,
      `expected true (lock held), got:\n${content}`);

    // Lock dir must still exist (not force-removed).
    assert.ok(fs.existsSync(lockPath), 'external lock must not be force-removed');

    // Cleanup
    fs.rmdirSync(lockPath);
  });

  it('flips sensor_cache_valid when lock is free (normal case)', () => {
    const sid = 's-c1-ok';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(
      statePath,
      '---\ncurrent_phase: implement\nwork_dir: .deep-work/wd\nsensor_cache_valid: true\n---\n'
    );
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}');

    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };
    spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ file_path: path.join(tmpDir, 'package.json') }),
      cwd: tmpDir, env, encoding: 'utf8', timeout: 5000,
    });

    const content = fs.readFileSync(statePath, 'utf8');
    assert.match(content, /sensor_cache_valid:\s*false/,
      `expected false after flip, got:\n${content}`);

    // Lock dir must be released (cleaned up).
    assert.equal(fs.existsSync(`${statePath}.lock`), false, 'lock must be released');
  });
});

describe('file-tracker.sh v6.2.4 post-review: cache write is atomic (tmp+mv)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-w3-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('after run, no stray .tmp.* files remain in .claude/', () => {
    const sid = 's-w3';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(statePath, '---\ncurrent_phase: implement\nwork_dir: .deep-work/wd\nactive_slice: SLICE-001\n---\n');
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
    fs.writeFileSync(path.join(tmpDir, 'a.js'), '// x');

    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sid,
    };
    spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ file_path: path.join(tmpDir, 'a.js') }),
      cwd: tmpDir, env, encoding: 'utf8', timeout: 5000,
    });

    const stray = fs.readdirSync(path.join(tmpDir, '.claude'))
      .filter(n => n.startsWith('.hook-tool-input.') && n.includes('.tmp.'));
    assert.deepEqual(stray, [], `stray tmp files: ${JSON.stringify(stray)}`);
  });
});

// ─── Bash-write ownership registration (require-path + isFileWrite fix) ──
// Regression guard: a file created via the Bash tool (e.g. `echo … > file`)
// must land in the cross-session ownership registry. The old node snippet used
// a bare `require('./phase-guard-core.js')` (resolved against the hook CWD, not
// the script dir → MODULE_NOT_FOUND) AND truthy-checked the returned OBJECT
// `if(detectBashFileWrite(d))` (always true). The `2>/dev/null || echo ""`
// swallowed the module error, so Bash-created files were NEVER registered. The
// fix mirrors phase-guard.sh:565-572 (absolute require via argv + r.isFileWrite).

describe('file-tracker.sh: Bash-write registers file ownership (cross-session)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-own-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function readOwnership(sid) {
    const reg = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'deep-work-sessions.json'), 'utf8'),
    );
    return (reg.sessions[sid] && reg.sessions[sid].file_ownership) || [];
  }

  it('registers the redirect target of a Bash write in implement phase', () => {
    const sid = 's-own1';
    // implement phase + work_dir → receipt/ownership path is active.
    fs.writeFileSync(
      path.join(tmpDir, '.claude', `deep-work.${sid}.md`),
      '---\ncurrent_phase: implement\nwork_dir: .deep-work/wd\n---\n',
    );
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
    // Session must exist in the registry for ownership to attach to it.
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'deep-work-sessions.json'),
      JSON.stringify({ version: 1, shared_files: [], sessions: { [sid]: { pid: 1, file_ownership: [] } } }),
    );

    const result = spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ command: 'echo hi > src/newfile.ts' }),
      cwd: tmpDir,
      env: { ...process.env, CLAUDE_TOOL_USE_TOOL_NAME: 'Bash', DEEP_WORK_SESSION_ID: sid },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, `hook failed: ${result.stderr}`);

    const ownership = readOwnership(sid);
    assert.ok(
      ownership.includes('src/newfile.ts'),
      `expected src/newfile.ts in ownership, got ${JSON.stringify(ownership)}`,
    );
  });

  it('does not register when the Bash command writes no file (read-only)', () => {
    const sid = 's-own2';
    fs.writeFileSync(
      path.join(tmpDir, '.claude', `deep-work.${sid}.md`),
      '---\ncurrent_phase: implement\nwork_dir: .deep-work/wd\n---\n',
    );
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'deep-work-sessions.json'),
      JSON.stringify({ version: 1, shared_files: [], sessions: { [sid]: { pid: 1, file_ownership: [] } } }),
    );

    const result = spawnSync('bash', [SCRIPT], {
      input: JSON.stringify({ command: 'grep -r foo src/' }),
      cwd: tmpDir,
      env: { ...process.env, CLAUDE_TOOL_USE_TOOL_NAME: 'Bash', DEEP_WORK_SESSION_ID: sid },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
    assert.deepEqual(readOwnership(sid), [], 'read-only command must not register ownership');
  });
});
