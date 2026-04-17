const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'file-tracker.sh');

describe('file-tracker.sh sensor_cache_valid flip portability', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-port-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runHook(sessionId, statePath, toolInput) {
    fs.writeFileSync(path.join(tmpDir, '.claude', 'deep-work-current-session'), sessionId);
    const env = {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: 'Write',
      DEEP_WORK_SESSION_ID: sessionId,
    };
    try {
      execFileSync('bash', [SCRIPT], {
        input: JSON.stringify(toolInput),
        cwd: tmpDir,
        env,
        encoding: 'utf8',
        timeout: 5000,
      });
    } catch (e) {
      // PostToolUse hooks never block; if it errored, propagate for debugging
      throw new Error(`hook failed: ${e.stderr || e.stdout || e.message}`);
    }
  }

  it('flips sensor_cache_valid: true → false exactly once (no duplicate line)', () => {
    const sid = 's-port1';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(
      statePath,
      '---\ncurrent_phase: implement\nwork_dir: .deep-work/test\nsensor_cache_valid: true\n---\n'
    );
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}');

    runHook(sid, statePath, { file_path: path.join(tmpDir, 'package.json') });

    const newContent = fs.readFileSync(statePath, 'utf8');
    const matches = newContent.match(/^sensor_cache_valid:/gm) || [];
    assert.equal(matches.length, 1, `expected exactly 1 sensor_cache_valid line, got ${matches.length}:\n${newContent}`);
    assert.match(newContent, /sensor_cache_valid:\s*false/);
  });

  it('inserts sensor_cache_valid: false when missing', () => {
    const sid = 's-port2';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(
      statePath,
      '---\ncurrent_phase: implement\nwork_dir: .deep-work/test\n---\n'
    );
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}');

    runHook(sid, statePath, { file_path: path.join(tmpDir, 'package.json') });

    const newContent = fs.readFileSync(statePath, 'utf8');
    const matches = newContent.match(/^sensor_cache_valid:/gm) || [];
    assert.equal(matches.length, 1, `expected exactly 1 sensor_cache_valid line, got ${matches.length}:\n${newContent}`);
    assert.match(newContent, /sensor_cache_valid:\s*false/);
  });

  it('ignores non-marker files (no flip)', () => {
    const sid = 's-port3';
    const statePath = path.join(tmpDir, '.claude', `deep-work.${sid}.md`);
    fs.writeFileSync(
      statePath,
      '---\ncurrent_phase: implement\nwork_dir: .deep-work/test\nsensor_cache_valid: true\n---\n'
    );
    fs.writeFileSync(path.join(tmpDir, 'src.js'), 'console.log(1);');

    runHook(sid, statePath, { file_path: path.join(tmpDir, 'src.js') });

    const newContent = fs.readFileSync(statePath, 'utf8');
    assert.match(newContent, /sensor_cache_valid:\s*true/, 'non-marker file must not flip the flag');
  });
});
