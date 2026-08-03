'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const BOOTSTRAP_PATH = path.join(__dirname, 'hook-bootstrap.js');

function loadBootstrap() {
  delete require.cache[require.resolve('./hook-bootstrap.js')];
  return require('./hook-bootstrap.js');
}

function makePluginRoot(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-work-bootstrap-unit-'));
  const rawRoot = path.join(base, 'plugin');
  const scripts = path.join(rawRoot, 'hooks', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  for (const target of [
    'hook-shell-adapter.js',
    'session-start-adapter.js',
    'sensor-trigger.js',
  ]) {
    fs.writeFileSync(path.join(scripts, target), "'use strict';\n");
  }
  const root = path.resolve(fs.realpathSync(rawRoot));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, rawRoot, root };
}

function captureWrites(fn) {
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk) => { stdout += String(chunk); return true; };
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    return { value: fn(), stdout, stderr };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

function withSpawnResult(result, fn) {
  const original = childProcess.spawnSync;
  const calls = [];
  childProcess.spawnSync = (...args) => {
    calls.push(args);
    return typeof result === 'function' ? result(...args) : result;
  };
  try {
    return { value: fn(), calls };
  } finally {
    childProcess.spawnSync = original;
  }
}

test('isFullyQualified reproduces POSIX, drive, and UNC qualification rules', () => {
  const { isFullyQualified } = loadBootstrap();
  const rows = [
    ['C:\\', 'win32', '\\', true],
    ['C:/', 'win32', '\\', true],
    ['\\\\server\\share', 'win32', '\\', true],
    ['//server/share', 'win32', '\\', true],
    ['C:foo', 'win32', '\\', false],
    ['\\foo', 'win32', '\\', false],
    ['relative', 'win32', '\\', false],
    ['/opt/deep work', 'darwin', '/', true],
    ['relative', 'linux', '/', false],
  ];
  for (const [value, platform, sep, expected] of rows) {
    assert.equal(isFullyQualified(value, platform, sep), expected, value);
  }
});

test('isStrictlyInside uses exact ancestor identity on POSIX and win32 paths', () => {
  const { isStrictlyInside } = loadBootstrap();
  const rows = [
    [path.posix, '/', '/hooks/scripts/hook-bootstrap.js', true],
    [path.win32, 'C:\\', 'C:\\hooks\\scripts\\hook-bootstrap.js', true],
    [path.win32, '\\\\srv\\share', '\\\\srv\\share\\hooks\\scripts\\hook-bootstrap.js', true],
    [path.win32, '\\\\srv\\share\\', '\\\\srv\\share\\hooks\\scripts\\hook-bootstrap.js', true],
    [path.win32, '//srv/share', '//srv/share/hooks/scripts/hook-bootstrap.js', true],
    [path.win32, 'C:\\p\\Root', 'C:\\p\\Root\\..safe\\bootstrap.js', true],
    [path.win32, 'C:\\p\\Root', 'C:\\p\\Root\\..\\evil.js', false],
    [path.win32, 'C:\\p\\Root', 'C:\\p\\root\\evil.js', false],
    [path.win32, 'C:\\p\\İ', 'C:\\p\\i̇\\evil.js', false],
    [path.win32, 'C:\\p\\Root', 'C:\\p\\Root-sibling\\evil.js', false],
  ];
  for (const [pathApi, rawRoot, rawTarget, expected] of rows) {
    const root = pathApi.resolve(rawRoot);
    const target = pathApi.resolve(rawTarget);
    assert.equal(isStrictlyInside(root, target, pathApi), expected,
      `${root} -> ${target}`);
  }
});

test('canonicalIdentities normalizes UNC root spellings and realpath trailing separators', () => {
  const { canonicalIdentities } = loadBootstrap();
  const canonicalRoot = '\\\\server\\share\\';
  const canonicalTarget = '\\\\server\\share\\hooks\\scripts\\hook-bootstrap.js';
  for (const rootResult of [
    '\\\\server\\share',
    '\\\\server\\share\\',
    '//server/share',
    '//server/share/',
  ]) {
    for (const targetResult of [canonicalTarget, `${canonicalTarget}\\`]) {
      const values = new Map([
        ['root-input', rootResult],
        ['target-input', targetResult],
      ]);
      const actual = canonicalIdentities('root-input', 'target-input', {
        pathApi: path.win32,
        realpathSync: (value) => values.get(value),
      });
      assert.deepEqual(actual, { canonicalRoot, canonicalTarget },
        `${rootResult} -> ${targetResult}`);
    }
  }
});

test('MODES maps all six manifest modes to the approved targets, args, failures, and polarities', () => {
  const { MODES } = loadBootstrap();
  assert.deepEqual(MODES, {
    'session-start-update': {
      rel: ['hooks', 'scripts', 'session-start-adapter.js'],
      args: ['update-check'], fail: 1, polarity: 'exact',
    },
    'session-start-sensor': {
      rel: ['hooks', 'scripts', 'session-start-adapter.js'],
      args: ['sensor-detect'], fail: 1, polarity: 'exact',
    },
    'pre-tool-use': {
      rel: ['hooks', 'scripts', 'hook-shell-adapter.js'],
      args: ['phase-guard'], fail: 2, polarity: 'guard',
    },
    'post-tool-main': {
      rel: ['hooks', 'scripts', 'hook-shell-adapter.js'],
      args: ['post-tool'], fail: 1, polarity: 'exact',
    },
    'post-tool-sensor': {
      rel: ['hooks', 'scripts', 'sensor-trigger.js'],
      args: [], fail: 0, polarity: 'exact',
    },
    stop: {
      rel: ['hooks', 'scripts', 'hook-shell-adapter.js'],
      args: ['session-end'], fail: 1, polarity: 'exact',
    },
  });
});

test('run preserves exact statuses and passes target and args without a shell', (t) => {
  const { MODES, run } = loadBootstrap();
  const fixture = makePluginRoot(t);
  for (const [mode, spec] of Object.entries(MODES)) {
    if (spec.polarity !== 'exact') continue;
    for (const status of [0, 1, 2, 7, 126, 127, 255]) {
      const observed = withSpawnResult({ status, signal: null },
        () => run(mode, fixture.root));
      assert.equal(observed.value, status, `${mode}: ${status}`);
      assert.equal(observed.calls.length, 1);
      const [executable, args, options] = observed.calls[0];
      assert.equal(executable, process.execPath);
      assert.equal(path.basename(args[0]), path.basename(spec.rel.at(-1)));
      assert.deepEqual(args.slice(1), spec.args);
      assert.equal(options.stdio, 'inherit');
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
    }
  }
});

test('run maps every non-{0,2} PreToolUse child status to block and reports the original', (t) => {
  const { run } = loadBootstrap();
  const fixture = makePluginRoot(t);
  for (const [status, expected] of [[0, 0], [2, 2], [1, 2], [7, 2], [126, 2], [127, 2], [255, 2]]) {
    const captured = captureWrites(() => withSpawnResult({ status, signal: null },
      () => run('pre-tool-use', fixture.root)).value);
    assert.equal(captured.value, expected, String(status));
    if (status !== 0 && status !== 2) {
      assert.match(captured.stderr, new RegExp(`guard child exited ${status}`));
      assert.equal(captured.stdout, '');
    }
  }
});

test('run rejects missing or changed root identity and never derives it from __dirname', (t) => {
  const { run } = loadBootstrap();
  const fixture = makePluginRoot(t);
  const alias = path.join(fixture.base, 'plugin-alias');
  fs.symlinkSync(fixture.rawRoot, alias);

  const missing = captureWrites(() => run('pre-tool-use'));
  assert.equal(missing.value, 2);
  assert.match(missing.stderr, /root.*required/i);
  assert.match(missing.stdout, /"decision":"block"/);

  const relative = captureWrites(() => run('pre-tool-use', 'hooks'));
  assert.equal(relative.value, 2);
  assert.match(relative.stderr, /not a fully qualified absolute path/);
  assert.match(relative.stdout, /"decision":"block"/);

  const changed = captureWrites(() => run('pre-tool-use', alias));
  assert.equal(changed.value, 2);
  assert.match(changed.stderr, /identity/i);
  assert.match(changed.stdout, /"decision":"block"/);
});

test('run rejects target escapes without starting the child', (t) => {
  const { run } = loadBootstrap();
  const fixture = makePluginRoot(t);
  const target = path.join(fixture.root, 'hooks', 'scripts', 'hook-shell-adapter.js');
  const outside = path.join(fixture.base, 'outside.js');
  fs.writeFileSync(outside, "'use strict';\n");
  fs.rmSync(target);
  fs.symlinkSync(outside, target);
  const observed = withSpawnResult({ status: 0 },
    () => captureWrites(() => run('pre-tool-use', fixture.root)));
  assert.equal(observed.value.value, 2);
  assert.match(observed.value.stderr, /escapes the plugin root/);
  assert.equal(observed.calls.length, 0);
});

test('spawn errors report PreToolUse block JSON while started-child signals avoid duplicates', (t) => {
  const { run } = loadBootstrap();
  const fixture = makePluginRoot(t);
  const rows = [
    ['pre-tool-use', 2],
    ['post-tool-main', 1],
    ['post-tool-sensor', 0],
    ['session-start-update', 1],
    ['session-start-sensor', 1],
    ['stop', 1],
  ];
  for (const result of [{ status: null, signal: 'SIGTERM' }]) {
    for (const [mode, expected] of rows) {
      const captured = captureWrites(() => withSpawnResult(result,
        () => run(mode, fixture.root)).value);
      assert.equal(captured.value, expected, mode);
      assert.match(captured.stderr, /deep-work hook bootstrap/);
      if (mode === 'pre-tool-use') assert.equal(captured.stdout, '');
    }
  }
  for (const [mode, expected] of rows) {
    const captured = captureWrites(() => withSpawnResult(
      { status: null, signal: null, error: new Error('spawn broke') },
      () => run(mode, fixture.root),
    ).value);
    assert.equal(captured.value, expected, mode);
    assert.match(captured.stderr, /child could not start: spawn broke/);
    if (mode === 'pre-tool-use') assert.match(captured.stdout, /"decision":"block"/);
    else assert.equal(captured.stdout, '');
  }
});

test('main coerces invalid statuses to each event failure status and preserves boundaries', (t) => {
  const { main } = loadBootstrap();
  const fixture = makePluginRoot(t);
  const originalExitCode = process.exitCode;
  try {
    for (const [mode, childStatus, expected] of [
      ['post-tool-main', 0, 0],
      ['post-tool-main', 255, 255],
      ['post-tool-main', 256, 1],
      ['post-tool-main', 1.5, 1],
      ['post-tool-sensor', Number.NaN, 0],
      ['pre-tool-use', 256, 2],
    ]) {
      process.exitCode = undefined;
      captureWrites(() => withSpawnResult({ status: childStatus, signal: null },
        () => main(mode, fixture.root)));
      assert.equal(process.exitCode, expected, `${mode}: ${childStatus}`);
    }
  } finally {
    process.exitCode = originalExitCode;
  }
});

test('source uses only built-in requires and never derives the security root from __dirname', () => {
  const source = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.{1,2}\//);
  assert.doesNotMatch(source, /__dirname/);
  assert.doesNotMatch(source, /realpathSync\.native/);
  assert.match(source, /identities\.canonicalRoot !== String\(root\)/);
  assert.match(source, /if \(!isFullyQualified\(root\)\)/);
});
