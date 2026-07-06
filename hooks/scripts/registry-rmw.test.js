const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { scrubHostEnv } = require('./test-helpers/run-phase-guard');

// Registry read-modify-write hardening: the lock must span the WHOLE read →
// transform → write cycle (previously the read was unlocked, so concurrent
// sessions clobbered each other — lost update). The fix splits lock-free inner
// helpers (_read_registry_unlocked / _write_registry_unlocked) from the public
// locking wrappers, and RMW callers run both under ONE lock via _registry_rmw.

const UTILS = path.resolve(__dirname, 'utils.sh');

let tmpDir;
function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmw-'));
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
}
function cleanup() {
  if (tmpDir) { fs.rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null; }
}

function run(code) {
  return spawnSync('bash', ['-c', `source "${UTILS}"\n${code}`], {
    cwd: tmpDir, encoding: 'utf8', timeout: 15000, env: scrubHostEnv({}),
  });
}
const registryPath = () => path.join(tmpDir, '.claude', 'deep-work-sessions.json');
function seedRegistry(data) { fs.writeFileSync(registryPath(), JSON.stringify(data)); }
function readRegistry() { return JSON.parse(fs.readFileSync(registryPath(), 'utf8')); }

// ─── Re-entrancy (the reviewer's mandated regression guard) ──

describe('registry RMW: re-entrancy (no self-deadlock)', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('RMW callers use the unlocked helpers, never the public locking wrappers', () => {
    seedRegistry({ version: 1, shared_files: [], sessions: { 's-x': { pid: 1, current_phase: 'plan', file_ownership: [] } } });
    // If an RMW caller re-entered read_registry/write_registry while already
    // holding the lock, it would try to re-acquire the (non-reentrant) lock and
    // self-deadlock. Shadow both public wrappers so any such call is observable
    // (stderr marker) AND fatal (return 1). The fixed RMW path calls only the
    // *_unlocked helpers, so the shadows are never hit and the mutation lands.
    const r = run(`
      init_deep_work_state
      write_registry() { echo "REENTERED_WRITE" >&2; return 1; }
      read_registry() { echo "REENTERED_READ" >&2; return 1; }
      register_file_ownership "s-x" "src/a.ts"
      update_registry_phase "s-x" "implement"
      update_last_activity "s-x"
      echo DONE
    `);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /DONE/, 'RMW calls completed (no hang / deadlock)');
    assert.doesNotMatch(r.stderr, /REENTERED_(WRITE|READ)/,
      'RMW must not route through the public locking wrappers (would self-deadlock)');
    const reg = readRegistry();
    assert.ok(reg.sessions['s-x'].file_ownership.includes('src/a.ts'), 'ownership mutation applied');
    assert.equal(reg.sessions['s-x'].current_phase, 'implement', 'phase mutation applied');
  });
});

// ─── Lost-update fix (the actual concurrency bug) ────────────

describe('registry RMW: concurrent writers do not lose updates', () => {
  beforeEach(setup);
  afterEach(cleanup);

  function spawnRegister(file) {
    return new Promise((resolve) => {
      const cp = spawn(
        'bash',
        ['-c', `source "${UTILS}"; init_deep_work_state; register_file_ownership "s-c" "${file}"`],
        { cwd: tmpDir, env: scrubHostEnv({}) },
      );
      let stderr = '';
      cp.stderr.on('data', (d) => { stderr += d; });
      cp.on('close', (code) => resolve({ code, stderr }));
    });
  }

  it('N concurrent register_file_ownership calls all persist', async () => {
    seedRegistry({ version: 1, shared_files: [], sessions: { 's-c': { pid: 1, file_ownership: [] } } });
    const N = 5;
    // Distinct directories so the 3-files-in-a-dir → dir/** glob promotion never
    // fires — each path stays individually observable.
    const files = Array.from({ length: N }, (_, i) => `dir${i}/f.ts`);
    const results = await Promise.all(files.map(spawnRegister));
    for (const res of results) {
      assert.equal(res.code, 0, `child failed: ${res.stderr}`);
    }
    const own = readRegistry().sessions['s-c'].file_ownership;
    for (const f of files) {
      assert.ok(own.includes(f), `${f} missing — lost update. ownership=${JSON.stringify(own)}`);
    }
  });
});

// ─── Inner helper contract (default-write moved under the lock) ──

describe('registry read helpers', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('_read_registry_unlocked returns the default WITHOUT creating the file', () => {
    const r = run('init_deep_work_state; _read_registry_unlocked');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).version, 1);
    assert.equal(fs.existsSync(registryPath()), false,
      'lock-free read must not write the default file (side-effect moved under the lock)');
  });

  it('public read_registry creates the default file (default-write now under the lock)', () => {
    const r = run('init_deep_work_state; read_registry >/dev/null');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(registryPath()), true);
    assert.equal(readRegistry().version, 1);
  });
});
