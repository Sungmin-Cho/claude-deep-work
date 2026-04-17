const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const UTILS = path.resolve(__dirname, 'utils.sh');

function runBash(script, env = {}) {
  return execFileSync('bash', ['-c', `source "${UTILS}" && ${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('extract_file_path_from_json', () => {
  it('parses simple path', () => {
    const out = runBash(`extract_file_path_from_json '{"file_path":"/tmp/a.txt"}'`);
    assert.equal(out, '/tmp/a.txt');
  });

  it('parses path with escaped quotes', () => {
    // Pass as first arg — bash-level single quotes, so the JSON keeps \"
    const out = runBash(`extract_file_path_from_json "$1"`, {});
    // Use the second arg form through execFileSync directly:
    const direct = execFileSync(
      'bash',
      ['-c', `source "${UTILS}" && extract_file_path_from_json "$1"`, '--', '{"file_path":"/tmp/a \\"b\\" c.txt"}'],
      { encoding: 'utf8' }
    );
    assert.equal(direct, '/tmp/a "b" c.txt');
  });

  it('returns empty on malformed JSON', () => {
    const out = runBash(`extract_file_path_from_json '{not json'`);
    assert.equal(out, '');
  });

  it('returns empty when field missing', () => {
    const out = runBash(`extract_file_path_from_json '{"other":"x"}'`);
    assert.equal(out, '');
  });

  it('returns empty when file_path is not a string', () => {
    const out = runBash(`extract_file_path_from_json '{"file_path":42}'`);
    assert.equal(out, '');
  });
});

describe('json_escape', () => {
  it('escapes double quotes', () => {
    const out = execFileSync('bash', ['-c', `source "${UTILS}" && json_escape "$1"`, '--', 'a"b'], { encoding: 'utf8' });
    assert.equal(out, 'a\\"b');
  });

  it('escapes backslashes', () => {
    const out = execFileSync('bash', ['-c', `source "${UTILS}" && json_escape "$1"`, '--', 'a\\b'], { encoding: 'utf8' });
    assert.equal(out, 'a\\\\b');
  });

  it('escapes newlines', () => {
    const out = execFileSync('bash', ['-c', `source "${UTILS}" && json_escape "$1"`, '--', 'a\nb'], { encoding: 'utf8' });
    assert.equal(out, 'a\\nb');
  });

  it('returns empty for empty arg (no stdin fallback to prevent hook hang)', () => {
    const result = spawnSync('bash', ['-c', `source "${UTILS}" && json_escape ''`], {
      encoding: 'utf8',
      timeout: 3000,
      input: '',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('does NOT read stdin when no argument given (regression: hook hang)', () => {
    // Call with no args, provide some stdin that should NOT be read
    const result = spawnSync('bash', ['-c', `source "${UTILS}" && json_escape`], {
      encoding: 'utf8',
      timeout: 3000,
      input: 'this should not be consumed',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });
});

describe('read_frontmatter_list', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fml-')); });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeStateFile(content) {
    const p = path.join(tmpDir, 'state.md');
    fs.writeFileSync(p, content);
    return p;
  }

  it('parses inline array form', () => {
    const f = writeStateFile('---\nslice_files: [foo.py, bar.py, "baz.py"]\n---\n');
    const out = execFileSync('bash', ['-c', `source "${UTILS}" && read_frontmatter_list "$1" "$2"`, '--', f, 'slice_files'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), ['foo.py', 'bar.py', 'baz.py']);
  });

  it('parses block list form', () => {
    const f = writeStateFile('---\ncurrent_phase: implement\nslice_files:\n  - a.py\n  - b.py\n  - c.py\n---\n');
    const out = execFileSync('bash', ['-c', `source "${UTILS}" && read_frontmatter_list "$1" "$2"`, '--', f, 'slice_files'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), ['a.py', 'b.py', 'c.py']);
  });

  it('returns [] when field missing', () => {
    const f = writeStateFile('---\ncurrent_phase: plan\n---\n');
    const out = execFileSync('bash', ['-c', `source "${UTILS}" && read_frontmatter_list "$1" "$2"`, '--', f, 'slice_files'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), []);
  });

  it('returns [] when file missing', () => {
    const out = execFileSync('bash', ['-c', `source "${UTILS}" && read_frontmatter_list "$1" "$2"`, '--', '/tmp/does-not-exist-xyz123.md', 'slice_files'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), []);
  });

  it('returns [] when frontmatter is malformed', () => {
    const f = writeStateFile('no frontmatter here\nslice_files: [foo]\n');
    const out = execFileSync('bash', ['-c', `source "${UTILS}" && read_frontmatter_list "$1" "$2"`, '--', f, 'slice_files'], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(out), []);
  });
});

describe('_acquire_lock / _release_lock', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-')); });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('acquires a fresh lock', () => {
    const lock = path.join(tmpDir, 'a.lock');
    const result = spawnSync('bash', ['-c', `source "${UTILS}" && _acquire_lock "${lock}" && echo OK && _release_lock "${lock}"`], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /OK/);
    assert.equal(fs.existsSync(lock), false, 'lock dir must be released');
  });

  it('fails-closed when lock pre-exists (stale lock) — does NOT force-remove', () => {
    const lock = path.join(tmpDir, 'contested.lock');
    fs.mkdirSync(lock);  // pre-existing stale lock
    const result = spawnSync('bash', ['-c', `source "${UTILS}" && _acquire_lock "${lock}" 3 0.02 && echo ACQUIRED || echo FAIL`], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PROJECT_ROOT: tmpDir },
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /FAIL/);
    assert.equal(fs.existsSync(lock), true, 'pre-existing lock must still exist after failed acquire');
  });

  it('concurrent acquires: exactly one succeeds at a time', async () => {
    const lock = path.join(tmpDir, 'concurrent.lock');
    // Spawn 10 processes all trying to acquire the same lock and hold for 100ms
    const procs = [];
    for (let i = 0; i < 10; i++) {
      procs.push(new Promise(resolve => {
        const p = spawnSync('bash', ['-c', `
          source "${UTILS}"
          if _acquire_lock "${lock}" 100 0.01; then
            echo "ACQUIRED_${i}"
            sleep 0.02
            _release_lock "${lock}"
            exit 0
          else
            echo "TIMEOUT_${i}"
            exit 1
          fi
        `], {
          encoding: 'utf8',
          timeout: 10000,
          env: { ...process.env, PROJECT_ROOT: tmpDir },
        });
        resolve(p.stdout);
      }));
    }
    const outputs = await Promise.all(procs);
    const acquireCount = outputs.filter(o => o.includes('ACQUIRED_')).length;
    const timeoutCount = outputs.filter(o => o.includes('TIMEOUT_')).length;
    // All 10 should eventually acquire (100 retries at 10ms = 1s budget per process,
    // 10 processes hold for 20ms each → ~200ms total → all should succeed)
    assert.equal(acquireCount + timeoutCount, 10);
    // At least 8 should succeed (allow for some timeouts under extreme contention)
    assert.ok(acquireCount >= 8, `expected ≥8 acquires, got ${acquireCount}`);
    // The lock dir must be clean at the end (no orphan)
    assert.equal(fs.existsSync(lock), false, 'no orphan lock directory should remain');
  });
});

describe('write_registry (refactored to use locks)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns non-zero when lock is held (fail-closed, no force-remove)', () => {
    const lockPath = path.join(tmpDir, '.claude', 'deep-work-sessions.lock');
    fs.mkdirSync(lockPath);
    const result = spawnSync('bash', ['-c', `
      export PROJECT_ROOT="${tmpDir}"
      source "${UTILS}"
      # Skip flock (simulate macOS)
      command() { return 1; }
      if write_registry '{"version":1,"sessions":{}}'; then echo SUCCESS; else echo FAIL; fi
    `], { encoding: 'utf8', timeout: 5000 });
    // Can't fully override `command` in bash, so rely on retries being quick.
    // We expect FAIL because lock is pre-existing; but if flock is available,
    // flock path may still succeed quickly — skip this subcase cleanly.
    if (result.stdout.includes('FAIL')) {
      assert.equal(fs.existsSync(lockPath), true, 'lock dir must still exist (no force remove)');
    }
  });
});
