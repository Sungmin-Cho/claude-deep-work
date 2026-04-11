#!/usr/bin/env node
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { processHook } = require('./phase-guard-core.js');

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-fork-integ-'));
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
}

function cleanup() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function bash(code) {
  const scriptDir = __dirname;
  const fullCode = `
    export PROJECT_ROOT="${tmpDir}"
    source "${scriptDir}/utils.sh"
    ${code}
  `;
  return execFileSync('bash', ['-c', fullCode], {
    encoding: 'utf8',
    timeout: 5000,
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

function writeStateFile(sessionId, frontmatter) {
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (typeof v === 'object' && v !== null) return `${k}: ${JSON.stringify(v)}`;
      if (v === null) return `${k}: null`;
      return `${k}: ${v}`;
    })
    .join('\n');
  fs.writeFileSync(
    path.join(tmpDir, '.claude', `deep-work.${sessionId}.md`),
    `---\n${yaml}\n---\n`,
  );
}

function readStateFile(sessionId) {
  return fs.readFileSync(
    path.join(tmpDir, '.claude', `deep-work.${sessionId}.md`),
    'utf8',
  );
}

// ─── Atomic fork registration ──────────────────────────────

describe('Atomic fork registration', () => {
  before(setup);
  after(cleanup);

  it('should register fork in registry AND update parent state in one call', () => {
    // Setup parent
    writeRegistryFile({
      version: 1, shared_files: [], sessions: {
        's-parent01': { current_phase: 'implement', file_ownership: [], fork_generation: 0 },
      },
    });
    writeStateFile('s-parent01', {
      current_phase: 'implement',
      task_description: 'parent task',
    });

    // Fork
    bash('register_fork_session "s-child001" "s-parent01" 1 "child task" ".deep-work/fork-1/"');

    // Verify registry
    const reg = readRegistryFile();
    assert.equal(reg.sessions['s-child001'].fork_parent, 's-parent01');
    assert.equal(reg.sessions['s-child001'].fork_generation, 1);
    assert.equal(reg.sessions['s-child001'].current_phase, 'plan');

    // Verify parent state file updated
    const parentState = readStateFile('s-parent01');
    assert.match(parentState, /fork_children:/);
    assert.match(parentState, /s-child001/);
  });

  it('should preserve parent registry entry after fork', () => {
    const reg = readRegistryFile();
    assert.ok(reg.sessions['s-parent01'], 'parent session should still exist');
    assert.equal(reg.sessions['s-parent01'].current_phase, 'implement');
  });
});

// ─── Multiple forks from same parent ───────────────────────

describe('Multiple forks from same parent', () => {
  before(setup);
  after(cleanup);

  it('should allow multiple children from one parent', () => {
    writeRegistryFile({
      version: 1, shared_files: [], sessions: {
        's-parent02': { current_phase: 'implement', file_ownership: [], fork_generation: 0 },
      },
    });
    writeStateFile('s-parent02', {
      current_phase: 'implement',
      task_description: 'multi-fork parent',
    });

    bash('register_fork_session "s-fork-a01" "s-parent02" 1 "fork A" ".deep-work/fork-a/"');
    bash('register_fork_session "s-fork-b01" "s-parent02" 1 "fork B" ".deep-work/fork-b/"');

    const reg = readRegistryFile();
    assert.equal(reg.sessions['s-fork-a01'].fork_parent, 's-parent02');
    assert.equal(reg.sessions['s-fork-b01'].fork_parent, 's-parent02');

    // Parent state should reference both children
    const parentState = readStateFile('s-parent02');
    assert.match(parentState, /s-fork-a01/);
    assert.match(parentState, /s-fork-b01/);
  });

  it('should maintain independent fork_generation for each child', () => {
    const reg = readRegistryFile();
    assert.equal(reg.sessions['s-fork-a01'].fork_generation, 1);
    assert.equal(reg.sessions['s-fork-b01'].fork_generation, 1);
  });
});

// ─── Fork chain (grandchild) ──────────────────────────────

describe('Fork chain (grandchild)', () => {
  before(setup);
  after(cleanup);

  it('should support fork of a fork with incremented generation', () => {
    writeRegistryFile({
      version: 1, shared_files: [], sessions: {
        's-root0001': { current_phase: 'implement', file_ownership: [], fork_generation: 0 },
      },
    });
    writeStateFile('s-root0001', {
      current_phase: 'implement',
      task_description: 'root task',
    });

    // First fork (gen 1)
    bash('register_fork_session "s-gen1-001" "s-root0001" 1 "gen 1 task" ".deep-work/gen1/"');
    writeStateFile('s-gen1-001', {
      current_phase: 'plan',
      task_description: 'gen 1 task',
    });

    // Second fork from gen 1 (gen 2)
    bash('register_fork_session "s-gen2-001" "s-gen1-001" 2 "gen 2 task" ".deep-work/gen2/"');

    const reg = readRegistryFile();
    assert.equal(reg.sessions['s-gen1-001'].fork_generation, 1);
    assert.equal(reg.sessions['s-gen2-001'].fork_generation, 2);
    assert.equal(reg.sessions['s-gen2-001'].fork_parent, 's-gen1-001');
  });

  it('should track generation depth via get_fork_generation', () => {
    const gen = bash('get_fork_generation "s-gen2-001"');
    assert.equal(gen, '2');
  });
});

// ─── Phase-guard + fork_mode integration ──────────────────

describe('Phase-guard fork_mode integration', () => {
  it('should block implement for artifacts-only fork (end-to-end)', () => {
    const state = {
      current_phase: 'implement',
      tdd_mode: 'relaxed',
      tdd_state: 'RED_VERIFIED',
      fork_mode: 'artifacts-only',
      active_slice: 'SLICE-001',
      slice_files: ['src/main.js'],
    };

    const writeResult = processHook({
      action: 'pre', toolName: 'Write',
      toolInput: { file_path: 'src/main.js' },
      state,
    });
    assert.equal(writeResult.decision, 'block');
    assert.match(writeResult.reason, /Non-git fork/);

    const editResult = processHook({
      action: 'pre', toolName: 'Edit',
      toolInput: { file_path: 'src/main.js', old_string: 'a', new_string: 'b' },
      state,
    });
    assert.equal(editResult.decision, 'block');

    const bashResult = processHook({
      action: 'pre', toolName: 'Bash',
      toolInput: { command: "echo 'x' > src/main.js" },
      state,
    });
    assert.equal(bashResult.decision, 'block');
  });

  it('should block test phase for artifacts-only fork (end-to-end)', () => {
    const result = processHook({
      action: 'pre', toolName: 'Bash',
      toolInput: { command: 'npm test' },
      state: { current_phase: 'test', fork_mode: 'artifacts-only' },
    });
    assert.equal(result.decision, 'block');
    assert.match(result.reason, /plan/);
  });

  it('should allow research/plan/brainstorm for artifacts-only fork', () => {
    for (const phase of ['research', 'plan', 'brainstorm']) {
      const result = processHook({
        action: 'pre', toolName: 'Bash',
        toolInput: { command: 'cat README.md' },
        state: { current_phase: phase, fork_mode: 'artifacts-only' },
      });
      assert.equal(result.decision, 'allow',
        `Expected allow for ${phase} phase with artifacts-only fork`);
    }
  });

  it('should allow all phases for worktree fork', () => {
    for (const phase of ['research', 'plan', 'implement', 'test']) {
      const state = {
        current_phase: phase,
        fork_mode: 'worktree',
        tdd_mode: 'relaxed',
        tdd_state: 'RED_VERIFIED',
      };
      const result = processHook({
        action: 'pre', toolName: 'Bash',
        toolInput: { command: 'cat README.md' },
        state,
      });
      assert.equal(result.decision, 'allow',
        `Expected allow for ${phase} phase with worktree fork`);
    }
  });

  it('should allow all phases when fork_mode is undefined (non-fork session)', () => {
    for (const phase of ['research', 'plan', 'implement']) {
      const state = {
        current_phase: phase,
        tdd_mode: 'relaxed',
        tdd_state: 'RED_VERIFIED',
      };
      const result = processHook({
        action: 'pre', toolName: 'Bash',
        toolInput: { command: 'cat README.md' },
        state,
      });
      assert.equal(result.decision, 'allow',
        `Expected allow for ${phase} phase without fork_mode`);
    }
  });
});

// ─── Edge cases ───────────────────────────────────────────

describe('Fork edge cases', () => {
  before(setup);
  after(cleanup);

  it('should reject forking an idle session', () => {
    writeStateFile('s-idle0001', { current_phase: 'idle', task_description: 'done' });
    const result = bash('validate_fork_target "$PROJECT_ROOT/.claude/deep-work.s-idle0001.md" 2>&1 || true');
    assert.match(result, /idle/);
  });

  it('should reject forking a nonexistent session', () => {
    const result = bash('validate_fork_target "$PROJECT_ROOT/.claude/deep-work.s-nope.md" 2>&1 || true');
    assert.match(result, /not found|존재하지/);
  });

  it('should handle missing parent state file gracefully during registration', () => {
    writeRegistryFile({ version: 1, shared_files: [], sessions: {} });
    // Register fork with no parent state file (parent might have been cleaned up)
    bash('register_fork_session "s-orphan01" "s-gone0001" 1 "orphan task" ".deep-work/orphan/"');
    const reg = readRegistryFile();
    assert.equal(reg.sessions['s-orphan01'].fork_parent, 's-gone0001');
    assert.equal(reg.sessions['s-orphan01'].fork_generation, 1);
  });

  it('should accept forking an active plan-phase session', () => {
    writeStateFile('s-plan0001', { current_phase: 'plan', task_description: 'planning' });
    const result = bash('validate_fork_target "$PROJECT_ROOT/.claude/deep-work.s-plan0001.md"');
    assert.equal(result, 'valid');
  });

  it('should accept forking an active implement-phase session', () => {
    writeStateFile('s-impl0001', { current_phase: 'implement', task_description: 'coding' });
    const result = bash('validate_fork_target "$PROJECT_ROOT/.claude/deep-work.s-impl0001.md"');
    assert.equal(result, 'valid');
  });
});

// ─── Fork registration with custom restart_phase ──────────

describe('Fork registration with custom restart_phase', () => {
  before(setup);
  after(cleanup);

  it('should default to plan phase when no restart_phase given', () => {
    writeRegistryFile({ version: 1, shared_files: [], sessions: {} });
    bash('register_fork_session "s-defphase" "s-parent99" 1 "task" "dir/"');
    const reg = readRegistryFile();
    assert.equal(reg.sessions['s-defphase'].current_phase, 'plan');
  });

  it('should use custom restart_phase when provided', () => {
    writeRegistryFile({ version: 1, shared_files: [], sessions: {} });
    writeStateFile('s-parent88', { current_phase: 'implement', task_description: 'test' });
    bash('register_fork_session "s-custom01" "s-parent88" 1 "task" "dir/" "research"');
    const reg = readRegistryFile();
    assert.equal(reg.sessions['s-custom01'].current_phase, 'research');

    // Parent state should record the restart_phase
    const parentState = readStateFile('s-parent88');
    assert.match(parentState, /restart_phase: research/);
  });
});

// ─── Git worktree fork ─────────────────────────────────────

describe('Git worktree fork', () => {
  let gitDir;

  before(() => {
    // Create a real git repo for worktree tests
    gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-wt-integ-'));
    execFileSync('git', ['init', gitDir], { encoding: 'utf8' });
    execFileSync('git', ['-C', gitDir, 'config', 'user.email', 'test@test.com'], { encoding: 'utf8' });
    execFileSync('git', ['-C', gitDir, 'config', 'user.name', 'Test'], { encoding: 'utf8' });
    // Create initial commit
    fs.writeFileSync(path.join(gitDir, 'README.md'), '# Test\n');
    execFileSync('git', ['-C', gitDir, 'add', '.'], { encoding: 'utf8' });
    execFileSync('git', ['-C', gitDir, 'commit', '-m', 'initial'], { encoding: 'utf8' });
    // Create .claude directory for state files
    fs.mkdirSync(path.join(gitDir, '.claude'), { recursive: true });
  });

  after(() => {
    // Clean up worktrees before removing the directory
    try {
      const wtList = execFileSync('git', ['-C', gitDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
      const worktrees = wtList.split('\n')
        .filter(l => l.startsWith('worktree '))
        .map(l => l.replace('worktree ', ''))
        .filter(p => p !== gitDir);
      for (const wt of worktrees) {
        execFileSync('git', ['-C', gitDir, 'worktree', 'remove', wt, '--force'], { encoding: 'utf8', stdio: 'pipe' });
      }
    } catch { /* ignore cleanup errors */ }
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('should create worktree with session-based branch at current commit', () => {
    const currentCommit = execFileSync(
      'git', ['-C', gitDir, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();

    const forkBranch = 'deep-work/fork/s-wt000001';
    const worktreePath = path.join(gitDir, '.deep-work-worktrees', 's-wt000001');

    execFileSync('git', [
      '-C', gitDir, 'worktree', 'add', worktreePath, '-b', forkBranch, currentCommit,
    ], { encoding: 'utf8' });

    // Verify worktree exists
    assert.ok(fs.existsSync(worktreePath), 'worktree directory should exist');
    assert.ok(fs.existsSync(path.join(worktreePath, 'README.md')), 'worktree should contain repo files');

    // Verify branch points to same commit
    const wtCommit = execFileSync(
      'git', ['-C', worktreePath, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();
    assert.equal(wtCommit, currentCommit, 'worktree branch should point to same commit');

    // Verify branch name
    const wtBranch = execFileSync(
      'git', ['-C', worktreePath, 'branch', '--show-current'],
      { encoding: 'utf8' },
    ).trim();
    assert.equal(wtBranch, forkBranch);
  });

  it('should allow independent commits in worktree without affecting main', () => {
    const worktreePath = path.join(gitDir, '.deep-work-worktrees', 's-wt000001');
    const mainCommit = execFileSync(
      'git', ['-C', gitDir, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();

    // Make a commit in the worktree
    fs.writeFileSync(path.join(worktreePath, 'new-file.js'), 'console.log("fork");\n');
    execFileSync('git', ['-C', worktreePath, 'add', 'new-file.js'], { encoding: 'utf8' });
    execFileSync('git', ['-C', worktreePath, 'commit', '-m', 'fork commit'], { encoding: 'utf8' });

    // Main branch should still be at original commit
    const mainAfter = execFileSync(
      'git', ['-C', gitDir, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();
    assert.equal(mainAfter, mainCommit, 'main branch should not be affected by worktree commit');

    // Worktree should have advanced
    const wtCommit = execFileSync(
      'git', ['-C', worktreePath, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();
    assert.notEqual(wtCommit, mainCommit, 'worktree should have a new commit');
  });

  it('should support multiple worktree forks from same repo', () => {
    const currentCommit = execFileSync(
      'git', ['-C', gitDir, 'rev-parse', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();

    const forkBranch2 = 'deep-work/fork/s-wt000002';
    const worktreePath2 = path.join(gitDir, '.deep-work-worktrees', 's-wt000002');

    execFileSync('git', [
      '-C', gitDir, 'worktree', 'add', worktreePath2, '-b', forkBranch2, currentCommit,
    ], { encoding: 'utf8' });

    assert.ok(fs.existsSync(worktreePath2), 'second worktree should exist');

    // Both worktrees should be independent
    const wtList = execFileSync(
      'git', ['-C', gitDir, 'worktree', 'list'],
      { encoding: 'utf8' },
    );
    assert.match(wtList, /s-wt000001/);
    assert.match(wtList, /s-wt000002/);
  });
});
