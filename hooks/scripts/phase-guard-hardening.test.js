const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PHASE_GUARD = path.resolve(__dirname, 'phase-guard.sh');
const PHASE_GUARD_CORE = path.resolve(__dirname, 'phase-guard-core.js');

function runPhaseGuard(cwd, env, toolInput) {
  return spawnSync('bash', [PHASE_GUARD], {
    input: JSON.stringify(toolInput),
    cwd,
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
}

describe('phase-guard-core.js exit-code discipline (v6.2.4)', () => {
  it('returns exit 3 + block JSON when input JSON is malformed', () => {
    const result = spawnSync('node', [PHASE_GUARD_CORE], {
      input: '{not json',
      encoding: 'utf8',
      timeout: 3000,
    });
    assert.equal(result.status, 3, `expected exit 3 for internal error, got ${result.status}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.decision, 'block');
    assert.match(parsed.reason, /내부 검증 오류/);
    assert.match(result.stderr, /INTERNAL_ERROR/);
  });

  it('returns exit 0 + decision=allow on valid idle-phase input', () => {
    const input = {
      action: 'pre',
      toolName: 'Write',
      toolInput: { file_path: '/tmp/a.py' },
      state: { current_phase: 'idle' },
    };
    const result = spawnSync('node', [PHASE_GUARD_CORE], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      timeout: 3000,
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).decision, 'allow');
  });
});

describe('phase-guard.sh slice_files enforcement (v6.2.4 — was silently no-op)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-hard-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupImplementState(sid, overrides = {}) {
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    // tdd_mode=strict + tdd_state=GREEN bypasses the TDD block while still
    // routing through the Node.js path where slice_scope is enforced.
    const lines = [
      '---',
      'current_phase: implement',
      'work_dir: .deep-work/test',
      `active_slice: ${overrides.active_slice || 'SLICE-001'}`,
      `tdd_mode: ${overrides.tdd_mode || 'strict'}`,
      `tdd_state: ${overrides.tdd_state || 'GREEN'}`,
      `strict_scope: ${overrides.strict_scope ?? 'true'}`,
    ];
    if (overrides.slice_files) {
      lines.push('slice_files:');
      for (const f of overrides.slice_files) lines.push(`  - ${f}`);
    }
    lines.push('---', '');
    fs.writeFileSync(statePath, lines.join('\n'));
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sid);
    return statePath;
  }

  it('allows a Write inside the slice_files scope', () => {
    setupImplementState('s-scope1', {
      slice_files: ['foo.py', 'bar.py'],
      strict_scope: 'true',
    });
    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: 's-scope1',
    };
    // Use a path that's clearly inside slice_files
    const result = runPhaseGuard(tmpDir, env, { file_path: 'foo.py' });
    assert.equal(result.status, 0, `expected allow, got ${result.status}: ${result.stdout} ${result.stderr}`);
  });

  it('blocks a Write outside the slice_files scope when strict_scope=true', () => {
    setupImplementState('s-scope2', {
      slice_files: ['foo.py', 'bar.py'],
      strict_scope: 'true',
    });
    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: 's-scope2',
    };
    const result = runPhaseGuard(tmpDir, env, { file_path: 'unrelated.py' });
    assert.equal(result.status, 2, `expected block, got ${result.status}: ${result.stdout} ${result.stderr}`);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.decision, 'block');
  });

  it('allows out-of-scope Write when strict_scope=false (warn only)', () => {
    setupImplementState('s-scope3', {
      slice_files: ['foo.py'],
      strict_scope: 'false',
    });
    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: 's-scope3',
    };
    const result = runPhaseGuard(tmpDir, env, { file_path: 'unrelated.py' });
    assert.equal(result.status, 0, `warn mode should allow, got ${result.status}: ${result.stdout} ${result.stderr}`);
  });

  it('skips scope check when slice_files is empty (backward-compatible)', () => {
    setupImplementState('s-scope4', {
      // no slice_files
      strict_scope: 'true',
    });
    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: 's-scope4',
    };
    const result = runPhaseGuard(tmpDir, env, { file_path: 'anything.py' });
    assert.equal(result.status, 0, `no slice_files → allow, got ${result.status}: ${result.stdout} ${result.stderr}`);
  });
});
