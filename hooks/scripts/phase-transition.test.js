const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'phase-transition.sh');

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-test-'));
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
  const filePath = path.join(tmpDir, '.claude', `deep-work.${sessionId}.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writePointerFile(sessionId) {
  fs.writeFileSync(
    path.join(tmpDir, '.claude', 'deep-work-current-session'),
    sessionId
  );
}

function runHook(toolInput) {
  try {
    const result = execFileSync('bash', [SCRIPT], {
      encoding: 'utf8',
      cwd: tmpDir,
      env: {
        ...process.env,
        CLAUDE_TOOL_INPUT: JSON.stringify(toolInput),
      },
      timeout: 10000,
    });
    return { exitCode: 0, stdout: result };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '' };
  }
}

describe('P1: Phase Transition Injector', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('injects checklist on phase transition', () => {
    const sid = 's-pt1';
    const stateFile = writeStateFile(sid, {
      current_phase: 'plan',
      worktree_enabled: 'true',
      worktree_path: '"/tmp/wt/test"',
      team_mode: 'team',
    });
    writePointerFile(sid);

    const result = runHook({ file_path: stateFile });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Phase Transition'));
    assert.ok(result.stdout.includes('worktree_path'));
    assert.ok(result.stdout.includes('team_mode: team'));
  });

  it('normalizes a backslash (Windows) state-file path and still injects', () => {
    // Windows/Git Bash tool inputs can report the target with backslashes.
    // phase-transition.sh must normalize before its `.claude/deep-work.*.md`
    // guard, or the injection is silently dropped (round-3 review finding).
    const sid = 's-ptwin';
    const stateFile = writeStateFile(sid, {
      current_phase: 'implement',
      worktree_path: '"/tmp/wt/win"',
      team_mode: 'solo',
    });
    writePointerFile(sid);

    const backslashPath = stateFile.replace('.claude/deep-work.', '.claude\\deep-work.');
    const result = runHook({ file_path: backslashPath });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Phase Transition'),
      'a backslash Windows state-file path must still trigger phase-transition injection');
  });

  it('does not inject on same phase (no transition)', () => {
    const sid = 's-pt2';
    const stateFile = writeStateFile(sid, {
      current_phase: 'research',
      team_mode: 'solo',
    });
    writePointerFile(sid);

    // First call: creates cache
    runHook({ file_path: stateFile });

    // Second call: same phase, no injection
    const result = runHook({ file_path: stateFile });

    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes('Phase Transition'));
  });

  it('ignores non-state file writes', () => {
    const sid = 's-pt3';
    writeStateFile(sid, { current_phase: 'implement' });
    writePointerFile(sid);

    const result = runHook({ file_path: '/tmp/some-other-file.ts' });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  it('shows tdd_mode on implement transition', () => {
    const sid = 's-pt4';
    const stateFile = writeStateFile(sid, {
      current_phase: 'implement',
      tdd_mode: 'strict',
      worktree_enabled: 'false',
      team_mode: 'solo',
    });
    writePointerFile(sid);

    const result = runHook({ file_path: stateFile });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('tdd_mode: strict'));
  });
});
