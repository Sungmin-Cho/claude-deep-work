const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PHASE_GUARD = path.resolve(__dirname, 'phase-guard.sh');

let tmpDir;

function setup() {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-guard-')));
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
}

function cleanup() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
}

function writeStateFile(sessionId, fields) {
  const yaml = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  const content = `---\n${yaml}\n---\n`;
  fs.writeFileSync(
    path.join(tmpDir, '.claude', `deep-work.${sessionId}.md`),
    content
  );
}

function writePointerFile(sessionId) {
  fs.writeFileSync(
    path.join(tmpDir, '.claude', 'deep-work-current-session'),
    sessionId
  );
}

function runPhaseGuard(toolName, toolInput, env = {}) {
  try {
    const result = execFileSync('bash', ['-c', `echo '${JSON.stringify(toolInput).replace(/'/g, "'\\''")}' | CLAUDE_TOOL_NAME=${toolName} bash "${PHASE_GUARD}"`], {
      encoding: 'utf8',
      cwd: tmpDir,
      env: { ...process.env, ...env },
      timeout: 10000,
    });
    return { exitCode: 0, stdout: result };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '' };
  }
}

describe('P0: Worktree Path Guard', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('blocks Write outside worktree path', () => {
    const sid = 's-test1';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(tmpDir, 'src', 'outside.ts'),
    });

    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout.includes('Worktree Guard'));
  });

  it('allows Write inside worktree path', () => {
    const sid = 's-test2';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(worktreePath, 'src', 'inside.ts'),
    });

    assert.equal(result.exitCode, 0);
  });

  it('allows meta directory writes (.claude/, .deep-work/) outside worktree', () => {
    const sid = 's-test3';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(tmpDir, '.claude', 'some-config.json'),
    });

    assert.equal(result.exitCode, 0);
  });

  it('skips guard when worktree_enabled is false', () => {
    const sid = 's-test4';

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'false',
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(tmpDir, 'src', 'any-file.ts'),
    });

    assert.equal(result.exitCode, 0);
  });

  it('blocks in non-implement phases too with Worktree Guard reason (F-09)', () => {
    const sid = 's-test5';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'research',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(tmpDir, 'src', 'outside.ts'),
    });

    assert.equal(result.exitCode, 2);
    // F-09: Verify it's the Worktree Guard blocking, not the phase guard
    assert.ok(result.stdout.includes('Worktree Guard'));
  });

  // F-08: Bash tool worktree guard tests
  it('blocks Bash file write outside worktree path', () => {
    const sid = 's-test6';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const outsidePath = path.join(tmpDir, 'src', 'outside.ts');
    const result = runPhaseGuard('Bash', {
      command: `echo "content" > "${outsidePath}"`,
    });

    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout.includes('Worktree Guard'));
  });

  it('blocks external .claude/ path (C-3: prevents substring bypass)', () => {
    const sid = 's-test7';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    // External .claude/ path should NOT be allowed — only PROJECT_ROOT/.claude/ is exempt
    const result = runPhaseGuard('Write', {
      file_path: '/tmp/evil/.claude/malicious-config.json',
    });

    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout.includes('Worktree Guard'));
  });
});
