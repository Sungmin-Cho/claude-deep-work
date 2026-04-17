const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'notify.sh');

function runNotify(cwd, env, args) {
  try {
    const result = execFileSync('bash', [SCRIPT, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: result, stderr: '' };
  } catch (e) {
    return { status: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

describe('notify.sh notifications.enabled parsing', () => {
  let tmpDir, fakeBin;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-'));
    fakeBin = path.join(tmpDir, 'fakebin');
    fs.mkdirSync(fakeBin);
    // Fake osascript that records its invocation args (including escaped message).
    fs.writeFileSync(
      path.join(fakeBin, 'osascript'),
      '#!/bin/sh\necho "$@" > "' + path.join(tmpDir, 'osascript-args') + '"\nexit 0\n'
    );
    fs.chmodSync(path.join(fakeBin, 'osascript'), 0o755);
    // Fake notify-send for Linux path.
    fs.writeFileSync(
      path.join(fakeBin, 'notify-send'),
      '#!/bin/sh\necho "$@" > "' + path.join(tmpDir, 'notify-send-args') + '"\nexit 0\n'
    );
    fs.chmodSync(path.join(fakeBin, 'notify-send'), 0o755);
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function localNotified() {
    return (
      fs.existsSync(path.join(tmpDir, 'osascript-args')) ||
      fs.existsSync(path.join(tmpDir, 'notify-send-args'))
    );
  }

  it('does NOT false-positive on unrelated team_mode.enabled: false', () => {
    const statePath = path.join(tmpDir, 'state.md');
    fs.writeFileSync(
      statePath,
      '---\nteam_mode:\n  enabled: false\nnotifications:\n  enabled: true\n  channels:\n    local: true\n---\n'
    );
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
    runNotify(tmpDir, env, [statePath, 'research', 'completed', 'test']);
    assert.ok(localNotified(), 'local notifier should fire — notifications.enabled=true');
  });

  it('correctly suppresses when notifications.enabled: false', () => {
    const statePath = path.join(tmpDir, 'state.md');
    fs.writeFileSync(
      statePath,
      '---\nteam_mode:\n  enabled: true\nnotifications:\n  enabled: false\n---\n'
    );
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
    runNotify(tmpDir, env, [statePath, 'research', 'completed', 'test']);
    assert.ok(!localNotified(), 'notifier must not fire when notifications.enabled=false');
  });

  it('defaults to enabled when notifications block is absent', () => {
    const statePath = path.join(tmpDir, 'state.md');
    fs.writeFileSync(statePath, '---\ncurrent_phase: idle\n---\n');
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
    runNotify(tmpDir, env, [statePath, 'research', 'completed', 'test']);
    assert.ok(localNotified(), 'default when missing must be enabled=true');
  });
});

describe('notify.sh osascript escape (macOS path)', () => {
  let tmpDir, fakeBin;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfy-esc-'));
    fakeBin = path.join(tmpDir, 'fakebin');
    fs.mkdirSync(fakeBin);
    // Fake osascript captures the exact args it received.
    fs.writeFileSync(
      path.join(fakeBin, 'osascript'),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "' + path.join(tmpDir, 'osa-args') + '"\nexit 0\n'
    );
    fs.chmodSync(path.join(fakeBin, 'osascript'), 0o755);
  });
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('osascript does not fail on message with double quotes (was syntax error pre-6.2.4)', function () {
    // On non-macOS systems, notify.sh does not invoke osascript — skip.
    if (process.platform !== 'darwin') return;

    const statePath = path.join(tmpDir, 'state.md');
    fs.writeFileSync(statePath, '---\ncurrent_phase: plan\n---\n');

    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
    const msgWithQuote = 'phase "done" with quotes';
    const result = runNotify(tmpDir, env, [statePath, 'plan', 'completed', msgWithQuote]);
    assert.equal(result.status, 0, `notify.sh exited non-zero: ${result.stderr}`);

    const osaArgsPath = path.join(tmpDir, 'osa-args');
    assert.ok(fs.existsSync(osaArgsPath), 'osascript should have been invoked');
    const osaArgs = fs.readFileSync(osaArgsPath, 'utf8');
    // The AppleScript expression should contain escaped quotes (`\"` form)
    // so that the osascript parser accepts the message string literal.
    assert.match(osaArgs, /display notification.*done.*with title/, `osa args: ${osaArgs}`);
    // Crucially: the message content should still carry the word "done" (not truncated)
    assert.ok(osaArgs.includes('done'), 'message must not be truncated at the first quote');
  });
});
