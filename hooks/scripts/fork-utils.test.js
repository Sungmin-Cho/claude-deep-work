#!/usr/bin/env node
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-fork-test-'));
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

// ─── validate_fork_target ───────────────────────────────────

describe('validate_fork_target', () => {
  before(setup);
  after(cleanup);

  it('should reject idle sessions', () => {
    writeStateFile('s-aaa11111', { current_phase: 'idle', task_description: 'test' });
    const result = bash('validate_fork_target "$PROJECT_ROOT/.claude/deep-work.s-aaa11111.md" 2>&1 || true');
    assert.match(result, /idle/);
  });

  it('should accept active sessions', () => {
    writeStateFile('s-bbb22222', { current_phase: 'implement', task_description: 'test' });
    const result = bash('validate_fork_target "$PROJECT_ROOT/.claude/deep-work.s-bbb22222.md"');
    assert.equal(result, 'valid');
  });

  it('should reject nonexistent state files', () => {
    const result = bash('validate_fork_target "$PROJECT_ROOT/.claude/deep-work.s-nope.md" 2>&1 || true');
    assert.match(result, /not found|존재하지/);
  });
});

// ─── get_fork_generation ────────────────────────────────────

describe('get_fork_generation', () => {
  before(setup);
  after(cleanup);

  it('should return 0 for non-fork sessions', () => {
    writeRegistryFile({
      version: 1, shared_files: [], sessions: {
        's-aaa11111': { current_phase: 'implement', file_ownership: [] },
      },
    });
    const gen = bash('get_fork_generation "s-aaa11111"');
    assert.equal(gen, '0');
  });

  it('should return parent generation + 1 for fork sessions', () => {
    writeRegistryFile({
      version: 1, shared_files: [], sessions: {
        's-aaa11111': { current_phase: 'implement', file_ownership: [], fork_generation: 0 },
        's-bbb22222': { current_phase: 'plan', file_ownership: [], fork_parent: 's-aaa11111', fork_generation: 1 },
      },
    });
    const gen = bash('get_fork_generation "s-bbb22222"');
    assert.equal(gen, '1');
  });

  it('should return generation number without rejecting (command handles warning)', () => {
    writeRegistryFile({
      version: 1, shared_files: [], sessions: {
        's-ccc33333': { current_phase: 'plan', file_ownership: [], fork_generation: 3 },
      },
    });
    const gen = bash('get_fork_generation "s-ccc33333"');
    assert.equal(gen, '3');
    // Note: generation >= 3 warning is handled by /deep-fork command, not this function
  });
});

// ─── update_parent_fork_children ────────────────────────────

describe('update_parent_fork_children', () => {
  before(setup);
  after(cleanup);

  it('should add fork_children entry to parent state file', () => {
    writeStateFile('s-parent01', {
      current_phase: 'implement',
      task_description: 'test',
    });
    bash('update_parent_fork_children "$PROJECT_ROOT/.claude/deep-work.s-parent01.md" "s-child001" "plan"');
    const content = fs.readFileSync(
      path.join(tmpDir, '.claude', 'deep-work.s-parent01.md'), 'utf8',
    );
    assert.match(content, /fork_children:/);
    assert.match(content, /s-child001/);
  });
});

// ─── register_fork_session ──────────────────────────────────

describe('register_fork_session', () => {
  before(setup);
  after(cleanup);

  it('should register fork session with fork_parent and fork_generation', () => {
    writeRegistryFile({ version: 1, shared_files: [], sessions: {} });
    bash('register_fork_session "s-child001" "s-parent01" 1 "test task" ".deep-work/20260407-fork/"');
    const reg = readRegistryFile();
    assert.equal(reg.sessions['s-child001'].fork_parent, 's-parent01');
    assert.equal(reg.sessions['s-child001'].fork_generation, 1);
    assert.equal(reg.sessions['s-child001'].current_phase, 'plan');
    assert.deepEqual(reg.sessions['s-child001'].file_ownership, []);
  });
});
