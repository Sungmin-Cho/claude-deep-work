'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scrubHostEnv } = require('./test-helpers/run-phase-guard.js');

const PLUGIN_ROOT = path.resolve(__dirname, '../..');
const HOOKS_PATH = path.join(PLUGIN_ROOT, 'hooks', 'hooks.json');

function commandHandlers(document) {
  return Object.values(document.hooks)
    .flatMap((registrations) => registrations)
    .flatMap((registration) => registration.hooks)
    .filter((handler) => handler.type === 'command');
}

test('every registered hook exposes shell-free POSIX and Windows commands', () => {
  const document = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf8'));
  const handlers = commandHandlers(document);

  assert.ok(handlers.length > 0);
  for (const handler of handlers) {
    assert.equal(typeof handler.command, 'string');
    assert.equal(typeof handler.commandWindows, 'string');
    for (const command of [handler.command, handler.commandWindows]) {
      assert.match(command, /^node "/);
      assert.doesNotMatch(command, /\b(?:bash|wsl)(?:\.exe)?\b/i);
      assert.doesNotMatch(command, /\.sh(?:"|\s|$)/i);
    }
    assert.match(handler.command, /\$\{CLAUDE_PLUGIN_ROOT\}\//);
    assert.match(handler.commandWindows, /\$\{CLAUDE_PLUGIN_ROOT\}\\/);
    assert.match(handler.commandWindows, /; exit \$LASTEXITCODE$/);
  }

  assert.equal(document.hooks.PostToolUse.length, 1);
  assert.match(
    document.hooks.PostToolUse[0].hooks[0].command,
    /hook-shell-adapter\.js" post-tool$/,
  );
});

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
    'hooks/scripts/hook-shell-adapter.js',
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
    const source = relativePath.endsWith('hook-shell-adapter.js')
      ? fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), 'utf8')
      : "'use strict';\nprocess.exitCode = 0;\n";
    fs.writeFileSync(target, source);
  }

  const document = JSON.parse(fs.readFileSync(HOOKS_PATH, 'utf8'));
  for (const handler of commandHandlers(document)) {
    const command = handler.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', fixtureRoot);
    const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
    assert.equal(result.status, 0,
      `${command}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
});

test('Windows shell adapter converts drive-letter, UNC, and spaced paths for Git Bash', () => {
  const { toGitBashPath } = require('./hook-shell-adapter.js');

  assert.equal(
    toGitBashPath('C:\\Users\\Codex User\\.codex\\plugins\\deep-work\\hooks\\scripts\\phase-guard.sh'),
    '/c/Users/Codex User/.codex/plugins/deep-work/hooks/scripts/phase-guard.sh',
  );
  assert.equal(
    toGitBashPath('\\\\server\\share name\\deep-work\\hooks\\scripts\\session-end.sh'),
    '//server/share name/deep-work/hooks/scripts/session-end.sh',
  );
});

test('Windows shell adapter selects Git for Windows without probing PATH bash', () => {
  const { resolveBashExecutable } = require('./hook-shell-adapter.js');
  const calls = [];
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const result = resolveBashExecutable({
    platform: 'win32',
    env: {},
    exists: (candidate) => candidate === gitBash,
    run: (executable, args) => {
      calls.push([executable, args]);
      assert.equal(executable, 'git');
      assert.deepEqual(args, ['--exec-path']);
      return {
        status: 0,
        stdout: 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core\r\n',
        stderr: '',
      };
    },
  });

  assert.equal(result, gitBash);
  assert.deepEqual(calls, [['git', ['--exec-path']]]);
  assert.equal(calls.some(([executable]) => /bash/i.test(executable)), false);
});

test('Windows shell adapter fails immediately with a specific unsupported-runtime error', () => {
  const { runHookScript } = require('./hook-shell-adapter.js');
  const result = runHookScript('session-end', {
    platform: 'win32',
    pluginRoot: 'C:\\Users\\Codex User\\.codex\\plugins\\deep-work\\6.13.0',
    env: {},
    exists: () => false,
    run: (executable, args) => {
      assert.equal(executable, 'git');
      assert.deepEqual(args, ['--exec-path']);
      return { status: 1, stdout: '', stderr: '' };
    },
    capture: true,
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git for Windows Bash was not found/);
  assert.match(result.stderr, /session-end/);
  assert.doesNotMatch(result.stderr, /timed out/i);
});

test('Windows StopHook uses the resolved Git Bash and preserves the script exit code', () => {
  const { runHookScript } = require('./hook-shell-adapter.js');
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const calls = [];
  const result = runHookScript('session-end', {
    platform: 'win32',
    pluginRoot: 'C:\\Users\\Codex User\\.codex\\plugins\\deep work\\6.13.0',
    cwd: 'C:\\Users\\Codex User\\repo with spaces',
    env: {},
    exists: (candidate) => candidate === gitBash,
    run: (executable, args, options) => {
      if (executable === 'git') {
        return {
          status: 0,
          stdout: 'C:\\Program Files\\Git\\mingw64\\libexec\\git-core\r\n',
          stderr: '',
        };
      }
      calls.push({ executable, args, options });
      return { status: 7, stdout: '', stderr: 'stop failed\n' };
    },
    capture: true,
  });

  assert.equal(result.status, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, gitBash);
  assert.deepEqual(calls[0].args, [
    '/c/Users/Codex User/.codex/plugins/deep work/6.13.0/hooks/scripts/session-end.sh',
  ]);
  assert.equal(calls[0].options.cwd, 'C:\\Users\\Codex User\\repo with spaces');
  assert.equal(calls[0].options.shell, false);
});

test('PostToolUse adapter forwards one input to file tracking and phase transition', () => {
  const { runPostToolHooks } = require('./hook-shell-adapter.js');
  const input = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: '/repo/.claude/deep-work.local.md', content: 'x' },
  });
  const calls = [];
  const result = runPostToolHooks({
    bashExecutable: '/opt/git/bin/bash',
    capture: true,
    cwd: '/repo',
    env: {},
    input,
    pluginRoot: '/plugin root',
    run: (executable, args, options) => {
      calls.push({ executable, args, options });
      if (args[0].endsWith('/file-tracker.sh')) {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0].endsWith('/phase-transition.sh')) {
        return { status: 0, stdout: 'Phase Transition', stderr: '' };
      }
      throw new Error(`unexpected command: ${executable} ${args.join(' ')}`);
    },
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'Phase Transition');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.input, input);
  assert.equal(calls[1].options.env.CLAUDE_TOOL_INPUT, input);
  assert.equal(calls[0].options.cwd, calls[1].options.cwd);
});

test('native adapter executes PreToolUse, PostToolUse, and StopHook end to end', (t) => {
  const {
    runHookScript,
    runPostToolHooks,
  } = require('./hook-shell-adapter.js');
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-work-hook-runtime-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const sessionId = 's-portable';
  const claudeDir = path.join(fixtureRoot, '.claude');
  const stateFile = path.join(claudeDir, `deep-work.${sessionId}.md`);
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'deep-work-current-session'), sessionId);
  fs.writeFileSync(stateFile, [
    '---',
    'current_phase: plan',
    'work_dir: ""',
    'worktree_enabled: true',
    `worktree_path: "${fixtureRoot}"`,
    'team_mode: team',
    'task_description: "Windows hook portability fixture"',
    '---',
    '',
  ].join('\n'));

  const env = scrubHostEnv({ DEEP_WORK_SESSION_ID: sessionId });
  const pre = runHookScript('phase-guard', {
    capture: true,
    cwd: fixtureRoot,
    env,
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
    }),
  });
  assert.equal(pre.status, 0, pre.stderr);

  const post = runPostToolHooks({
    capture: true,
    cwd: fixtureRoot,
    env,
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: stateFile, content: 'fixture' },
    }),
  });
  assert.equal(post.status, 0, post.stderr);
  assert.match(post.stdout, /Phase Transition/);
  assert.match(post.stdout, /team_mode: team/);

  const stop = runHookScript('session-end', {
    capture: true,
    cwd: fixtureRoot,
    env,
  });
  assert.equal(stop.status, 0, stop.stderr);
  assert.match(stop.stdout, /Deep Work/);

  const sensorDetect = runSessionStartAdapterForTest('sensor-detect', {
    cwd: fixtureRoot,
    env,
  });
  assert.equal(sensorDetect.status, 0, sensorDetect.stderr);

  const sensorTrigger = spawnSync(process.execPath, [
    path.join(PLUGIN_ROOT, 'hooks', 'scripts', 'sensor-trigger.js'),
  ], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env,
    shell: false,
  });
  assert.equal(sensorTrigger.status, 0, sensorTrigger.stderr);
});

function runSessionStartAdapterForTest(mode, options) {
  const { runSessionStartAdapter } = require('./session-start-adapter.js');
  return runSessionStartAdapter(mode, options);
}

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
