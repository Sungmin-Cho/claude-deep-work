'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '../..');
const HOOKS_PATH = path.join(PLUGIN_ROOT, 'hooks', 'hooks.json');

function commandHandlers(document) {
  return Object.values(document.hooks)
    .flatMap((registrations) => registrations)
    .flatMap((registration) => registration.hooks)
    .filter((handler) => handler.type === 'command');
}

test('every hook command survives a plugin root containing spaces', {
  skip: process.platform === 'win32' ? 'POSIX command path regression' : false,
}, (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deep work plugin '));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const shellScripts = [
    'hooks/scripts/update-check.sh',
    'hooks/scripts/phase-guard.sh',
    'hooks/scripts/file-tracker.sh',
    'hooks/scripts/phase-transition.sh',
    'hooks/scripts/session-end.sh',
  ];
  const nodeScripts = [
    'hooks/scripts/session-start-adapter.js',
    'hooks/scripts/sensor-trigger.js',
    'sensors/detect.js',
  ];
  for (const relativePath of shellScripts) {
    const target = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '#!/usr/bin/env bash\nexit 0\n');
  }
  for (const relativePath of nodeScripts) {
    const target = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "'use strict';\nprocess.exitCode = 0;\n");
  }

  const document = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf8'));
  for (const handler of commandHandlers(document)) {
    const command = handler.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', fixtureRoot);
    const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
    assert.equal(result.status, 0,
      `${command}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
});

test('SessionStart adapter emits the shared Claude and Codex additionalContext contract', () => {
  const { runSessionStartAdapter } = require('./session-start-adapter.js');
  const result = runSessionStartAdapter('update-check', {
    run: () => ({ status: 0, stdout: 'UPGRADE_AVAILABLE 6.12.0 6.13.0\n', stderr: '' }),
  });

  assert.equal(result.status, 0);
  assert.deepEqual(result.output, {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'UPGRADE_AVAILABLE 6.12.0 6.13.0',
    },
  });
});

test('SessionStart adapter stays silent when its probe has no context', () => {
  const { runSessionStartAdapter } = require('./session-start-adapter.js');
  const result = runSessionStartAdapter('sensor-detect', {
    run: () => ({ status: 0, stdout: '', stderr: '' }),
  });

  assert.deepEqual(result, { status: 0, output: null, stderr: '' });
});
