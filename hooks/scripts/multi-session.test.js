const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const UTILS_SH = path.resolve(__dirname, 'utils.sh');

// ─── Test Helpers ───────────────────────────────────────────

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-test-'));
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
}

function cleanup() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
}

/** Executes bash code after sourcing utils.sh in the tmp project dir. */
function bash(code, env = {}) {
  const script = `source "${UTILS_SH}"\n${code}`;
  return execFileSync('bash', ['-c', script], {
    encoding: 'utf8',
    cwd: tmpDir,
    env: { ...process.env, ...env },
    timeout: 10000,
  }).trim();
}

function writeRegistryFile(data) {
  fs.writeFileSync(
    path.join(tmpDir, '.claude', 'deep-work-sessions.json'),
    JSON.stringify(data),
  );
}

function readRegistryFile() {
  return JSON.parse(
    fs.readFileSync(
      path.join(tmpDir, '.claude', 'deep-work-sessions.json'),
      'utf8',
    ),
  );
}

// ─── generate_session_id ──────────────────────────────────

describe('generate_session_id', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('produces s-{8 hex} format', () => {
    const id = bash('generate_session_id');
    assert.match(id, /^s-[0-9a-f]{8}$/);
  });

  it('produces unique IDs on consecutive calls', () => {
    const ids = bash('generate_session_id; generate_session_id').split('\n');
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);
  });
});

// ─── init_deep_work_state ──────────────────────────────────

describe('init_deep_work_state', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('uses DEEP_WORK_SESSION_ID env var when set', () => {
    const result = bash('init_deep_work_state; echo "$STATE_FILE"', {
      DEEP_WORK_SESSION_ID: 's-abc12345',
    });
    assert.ok(result.endsWith('/.claude/deep-work.s-abc12345.md'));
  });

  it('falls back to pointer file when env var not set', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'deep-work-current-session'),
      's-def67890\n',
    );
    const result = bash('init_deep_work_state; echo "$STATE_FILE"');
    assert.ok(result.endsWith('/.claude/deep-work.s-def67890.md'));
  });

  it('falls back to legacy path when no env var or pointer', () => {
    const result = bash('init_deep_work_state; echo "$STATE_FILE"');
    assert.ok(result.endsWith('/.claude/deep-work.local.md'));
  });
});

// ─── write_session_pointer / read_session_pointer ──────────

describe('session pointer', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('round-trips session ID via write/read', () => {
    bash('init_deep_work_state; write_session_pointer "s-aabb1122"');
    const result = bash('init_deep_work_state; read_session_pointer');
    assert.equal(result, 's-aabb1122');
  });

  it('returns empty when no pointer file exists', () => {
    const result = bash('init_deep_work_state; read_session_pointer');
    assert.equal(result, '');
  });
});

// ─── read_registry / write_registry ────────────────────────

describe('registry read/write', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('creates default registry when none exists', () => {
    const json = bash('init_deep_work_state; read_registry');
    const data = JSON.parse(json);
    assert.equal(data.version, 1);
    assert.ok(Array.isArray(data.shared_files));
    assert.ok(data.shared_files.length > 0);
    assert.deepEqual(data.sessions, {});
  });

  it('reads existing registry data', () => {
    const testData = {
      version: 1,
      shared_files: ['package.json'],
      sessions: { 's-test1234': { pid: 12345, file_ownership: [] } },
    };
    writeRegistryFile(testData);
    const json = bash('init_deep_work_state; read_registry');
    const data = JSON.parse(json);
    assert.equal(data.sessions['s-test1234'].pid, 12345);
  });

  it('write_registry creates file via atomic rename', () => {
    const inputFile = path.join(tmpDir, '_test_input.json');
    const testData = {
      version: 1,
      shared_files: [],
      sessions: { 's-w1': { pid: 1 } },
    };
    fs.writeFileSync(inputFile, JSON.stringify(testData));
    bash(`init_deep_work_state; write_registry "$(cat "${inputFile}")"`);
    const data = readRegistryFile();
    assert.equal(data.sessions['s-w1'].pid, 1);
  });
});

// ─── register_session / unregister_session ──────────────────

describe('register/unregister session', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('registers a new session in registry', () => {
    bash(
      'init_deep_work_state; register_session "s-new12345" "$$" "Test task" "work/dir"',
    );
    const data = readRegistryFile();
    assert.ok(data.sessions['s-new12345']);
    assert.equal(data.sessions['s-new12345'].task_description, 'Test task');
    assert.equal(data.sessions['s-new12345'].current_phase, 'plan');
    assert.ok(Array.isArray(data.sessions['s-new12345'].file_ownership));
  });

  it('unregisters a session from registry', () => {
    writeRegistryFile({
      version: 1,
      shared_files: [],
      sessions: { 's-rm1': { pid: 1 }, 's-rm2': { pid: 2 } },
    });
    bash('init_deep_work_state; unregister_session "s-rm1"');
    const data = readRegistryFile();
    assert.equal(data.sessions['s-rm1'], undefined);
    assert.ok(data.sessions['s-rm2']);
  });
});

// ─── check_file_ownership ──────────────────────────────────

describe('check_file_ownership', () => {
  beforeEach(() => {
    setup();
    writeRegistryFile({
      version: 1,
      shared_files: ['package.json', 'package-lock.json', '*.config.js'],
      sessions: {
        's-me': {
          pid: process.pid,
          file_ownership: ['src/auth/**'],
        },
        's-other': {
          pid: 99999,
          file_ownership: ['src/db/**', 'src/models/user.ts'],
          task_description: 'DB work',
        },
      },
    });
  });
  afterEach(cleanup);

  it('allows own files (not blocked)', () => {
    bash(
      'init_deep_work_state; check_file_ownership "s-me" "src/auth/login.ts"',
    );
  });

  it('blocks other session files (exit non-zero)', () => {
    assert.throws(() => {
      bash(
        'init_deep_work_state; check_file_ownership "s-me" "src/db/connection.ts"',
      );
    });
  });

  it('allows shared files regardless of ownership', () => {
    bash('init_deep_work_state; check_file_ownership "s-me" "package.json"');
  });

  it('allows shared glob patterns (*.config.js)', () => {
    bash(
      'init_deep_work_state; check_file_ownership "s-me" "jest.config.js"',
    );
  });

  it('allows files not owned by anyone', () => {
    bash(
      'init_deep_work_state; check_file_ownership "s-me" "src/utils/helper.ts"',
    );
  });

  it('blocks nested files under other session glob', () => {
    assert.throws(() => {
      bash(
        'init_deep_work_state; check_file_ownership "s-me" "src/db/migrations/001.sql"',
      );
    });
  });

  it('blocks exact file match from other session', () => {
    assert.throws(() => {
      bash(
        'init_deep_work_state; check_file_ownership "s-me" "src/models/user.ts"',
      );
    });
  });

  it('outputs blocking session info as JSON on block', () => {
    try {
      bash(
        'init_deep_work_state; check_file_ownership "s-me" "src/db/query.ts"',
      );
      assert.fail('should have thrown');
    } catch (e) {
      const info = JSON.parse(e.stdout.toString().trim());
      assert.equal(info.blocked, true);
      assert.equal(info.owner_session, 's-other');
      assert.equal(info.task, 'DB work');
    }
  });
});

// ─── register_file_ownership ─────────────────────────────

describe('register_file_ownership', () => {
  beforeEach(() => {
    setup();
    writeRegistryFile({
      version: 1,
      shared_files: [],
      sessions: {
        's-own': { pid: process.pid, file_ownership: [], task_description: 'test' },
      },
    });
  });
  afterEach(cleanup);

  it('adds a file to session ownership', () => {
    bash(
      'init_deep_work_state; register_file_ownership "s-own" "src/auth/login.ts"',
    );
    const data = readRegistryFile();
    assert.ok(data.sessions['s-own'].file_ownership.includes('src/auth/login.ts'));
  });

  it('does not add duplicate files', () => {
    bash('init_deep_work_state; register_file_ownership "s-own" "src/foo.ts"');
    bash('init_deep_work_state; register_file_ownership "s-own" "src/foo.ts"');
    const data = readRegistryFile();
    const count = data.sessions['s-own'].file_ownership.filter(
      (f) => f === 'src/foo.ts',
    ).length;
    assert.equal(count, 1);
  });

  it('promotes to dir/** glob at 3+ files in same directory', () => {
    bash(
      'init_deep_work_state; register_file_ownership "s-own" "src/auth/login.ts"',
    );
    bash(
      'init_deep_work_state; register_file_ownership "s-own" "src/auth/logout.ts"',
    );
    bash(
      'init_deep_work_state; register_file_ownership "s-own" "src/auth/register.ts"',
    );
    const data = readRegistryFile();
    assert.ok(
      data.sessions['s-own'].file_ownership.includes('src/auth/**'),
      'should contain glob pattern',
    );
    assert.ok(
      !data.sessions['s-own'].file_ownership.includes('src/auth/login.ts'),
      'individual files should be removed after promotion',
    );
  });

  it('skips file already covered by existing glob', () => {
    writeRegistryFile({
      version: 1,
      shared_files: [],
      sessions: {
        's-own': {
          pid: process.pid,
          file_ownership: ['src/auth/**'],
          task_description: 'test',
        },
      },
    });
    bash(
      'init_deep_work_state; register_file_ownership "s-own" "src/auth/newfile.ts"',
    );
    const data = readRegistryFile();
    assert.ok(!data.sessions['s-own'].file_ownership.includes('src/auth/newfile.ts'));
    assert.equal(data.sessions['s-own'].file_ownership.length, 1);
  });
});

// ─── detect_stale_sessions ──────────────────────────────────

describe('detect_stale_sessions', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('detects dead PID as stale', () => {
    writeRegistryFile({
      version: 1,
      shared_files: [],
      sessions: {
        's-dead': {
          pid: 99999999,
          last_activity: new Date().toISOString(),
          task_description: 'Dead session',
        },
      },
    });
    const result = bash('init_deep_work_state; detect_stale_sessions');
    assert.ok(result.includes('s-dead'));
  });

  it('does not flag live PID as stale', () => {
    writeRegistryFile({
      version: 1,
      shared_files: [],
      sessions: {
        's-alive': {
          pid: process.pid,
          last_activity: new Date().toISOString(),
          task_description: 'Live session',
        },
      },
    });
    const result = bash('init_deep_work_state; detect_stale_sessions');
    assert.ok(!result.includes('s-alive'));
  });

  it('detects session with old last_activity and no PID as stale', () => {
    const oldTime = new Date(Date.now() - 120 * 60000).toISOString();
    writeRegistryFile({
      version: 1,
      shared_files: [],
      sessions: {
        's-old': {
          last_activity: oldTime,
          task_description: 'Old session',
        },
      },
    });
    const result = bash('init_deep_work_state; detect_stale_sessions');
    assert.ok(result.includes('s-old'));
  });
});

// ─── update_last_activity / update_registry_phase ──────────

describe('update_last_activity', () => {
  beforeEach(() => {
    setup();
    writeRegistryFile({
      version: 1,
      shared_files: [],
      sessions: {
        's-upd': {
          pid: process.pid,
          last_activity: '2020-01-01T00:00:00.000Z',
          current_phase: 'plan',
          task_description: 'test',
        },
      },
    });
  });
  afterEach(cleanup);

  it('updates last_activity timestamp', () => {
    bash('init_deep_work_state; update_last_activity "s-upd"');
    const data = readRegistryFile();
    assert.notEqual(
      data.sessions['s-upd'].last_activity,
      '2020-01-01T00:00:00.000Z',
    );
    const updated = new Date(data.sessions['s-upd'].last_activity);
    assert.ok(Date.now() - updated.getTime() < 10000);
  });
});

describe('update_registry_phase', () => {
  beforeEach(() => {
    setup();
    writeRegistryFile({
      version: 1,
      shared_files: [],
      sessions: {
        's-ph': {
          pid: process.pid,
          current_phase: 'plan',
          task_description: 'test',
        },
      },
    });
  });
  afterEach(cleanup);

  it('updates phase in registry', () => {
    bash('init_deep_work_state; update_registry_phase "s-ph" "implement"');
    const data = readRegistryFile();
    assert.equal(data.sessions['s-ph'].current_phase, 'implement');
  });
});

// ─── migrate_legacy_state ──────────────────────────────────

describe('migrate_legacy_state', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('migrates active legacy state file and returns new session ID', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'deep-work.local.md'),
      '---\ncurrent_phase: implement\ntask_description: "Legacy task"\n---\n',
    );
    const result = bash('init_deep_work_state; migrate_legacy_state');
    assert.match(result, /^s-[0-9a-f]{8}$/);
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.claude', 'deep-work.local.md')),
      'legacy file should be removed after migration',
    );
    // Verify new state file exists
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.claude', `deep-work.${result}.md`)),
      'new session state file should exist',
    );
    // Verify registered in registry
    const data = readRegistryFile();
    assert.ok(data.sessions[result], 'session should be registered');
  });

  it('skips idle legacy state', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'deep-work.local.md'),
      '---\ncurrent_phase: idle\ntask_description: "Done task"\n---\n',
    );
    const result = bash('init_deep_work_state; migrate_legacy_state');
    assert.equal(result, '');
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.claude', 'deep-work.local.md')),
      'idle legacy file should not be touched',
    );
  });

  it('returns empty when no legacy file exists', () => {
    const result = bash('init_deep_work_state; migrate_legacy_state');
    assert.equal(result, '');
  });
});

// ─── Lint Guard: No Hardcoded Legacy State Paths ────────────

describe('lint guard: deep-work.local.md references', () => {
  it('no active code files use deep-work.local.md as sole path', () => {
    const { execFileSync } = require('child_process');
    const pluginRoot = path.resolve(__dirname, '../..');

    // grep for deep-work.local.md in active code files
    let grepOutput = '';
    try {
      grepOutput = execFileSync('grep', [
        '-rn', 'deep-work\\.local\\.md',
        pluginRoot,
        '--include=*.md', '--include=*.sh', '--include=*.js',
      ], { encoding: 'utf8', timeout: 10000 });
    } catch (e) {
      // grep exits 1 when no matches — that's ideal
      if (e.status === 1) {
        grepOutput = '';
      } else {
        throw e;
      }
    }

    // Filter out allowed files and contexts
    const violations = grepOutput.split('\n').filter(line => {
      if (!line.trim()) return false;
      // Exclude: CHANGELOG, README, test files
      if (/CHANGELOG|README|\.test\.js/.test(line)) return false;
      // Exclude: utils.sh (core fallback implementation + migration)
      if (/utils\.sh/.test(line)) return false;
      // Exclude: notify.sh (backward-compat default)
      if (/notify\.sh/.test(line)) return false;
      // Exclude: lines that mention "legacy" or "fallback" or "레거시" (intentional fallback docs)
      if (/[Ll]egacy|fallback|레거시|auto-migrat/i.test(line)) return false;
      // Exclude: lines that mention "or legacy" or "또는" (dual-path references)
      if (/or legacy|또는/.test(line)) return false;
      // Exclude: migration check context (deep-work.md Step 1a)
      if (/[Mm]igrat/.test(line)) return false;
      return true;
    });

    assert.equal(
      violations.length, 0,
      `Found ${violations.length} hardcoded deep-work.local.md reference(s) in active code:\n${violations.join('\n')}`
    );
  });
});
