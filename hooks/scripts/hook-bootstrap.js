'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const MODES = Object.freeze({
  'session-start-update': Object.freeze({
    rel: Object.freeze(['hooks', 'scripts', 'session-start-adapter.js']),
    args: Object.freeze(['update-check']),
    fail: 1,
    polarity: 'exact',
  }),
  'session-start-sensor': Object.freeze({
    rel: Object.freeze(['hooks', 'scripts', 'session-start-adapter.js']),
    args: Object.freeze(['sensor-detect']),
    fail: 1,
    polarity: 'exact',
  }),
  'pre-tool-use': Object.freeze({
    rel: Object.freeze(['hooks', 'scripts', 'hook-shell-adapter.js']),
    args: Object.freeze(['phase-guard']),
    fail: 2,
    polarity: 'guard',
  }),
  'post-tool-main': Object.freeze({
    rel: Object.freeze(['hooks', 'scripts', 'hook-shell-adapter.js']),
    args: Object.freeze(['post-tool']),
    fail: 1,
    polarity: 'exact',
  }),
  'post-tool-sensor': Object.freeze({
    rel: Object.freeze(['hooks', 'scripts', 'sensor-trigger.js']),
    args: Object.freeze([]),
    fail: 0,
    polarity: 'exact',
  }),
  stop: Object.freeze({
    rel: Object.freeze(['hooks', 'scripts', 'hook-shell-adapter.js']),
    args: Object.freeze(['session-end']),
    fail: 1,
    polarity: 'exact',
  }),
});

function isFullyQualified(value, platform = process.platform, sep = path.sep) {
  const input = String(value || '');
  const first = input.charAt(0);
  const second = input.charAt(1);
  const third = input.charAt(2);
  if (platform !== 'win32') return first === '/';
  return (second === ':' && (third === sep || third === '/'))
    || ((first === sep || first === '/') && (second === sep || second === '/'));
}

function isStrictlyInside(canonicalRoot, canonicalTarget, pathApi = path) {
  let target = canonicalTarget;
  for (;;) {
    const parent = pathApi.dirname(target);
    if (parent === target) return false;
    if (parent === canonicalRoot) return true;
    target = parent;
  }
}

function canonicalIdentities(rawRoot, rawTarget, {
  pathApi = path,
  realpathSync = fs.realpathSync,
} = {}) {
  const canonicalRoot = pathApi.resolve(realpathSync(String(rawRoot)));
  const canonicalTarget = pathApi.resolve(realpathSync(String(rawTarget)));
  return { canonicalRoot, canonicalTarget };
}

function writeFailure(mode, detail, childStarted) {
  const spec = MODES[mode];
  const message = `deep-work hook bootstrap: ${detail}`;
  process.stderr.write(`${message}\n`);
  if (spec && spec.fail === 2 && childStarted !== true) {
    process.stdout.write(`${JSON.stringify({
      decision: 'block',
      reason: `deep-work hook bootstrap failed: ${detail}`,
    })}\n`);
  }
  return spec ? spec.fail : 2;
}

function run(mode, root) {
  const spec = MODES[mode];
  if (!spec) return writeFailure(mode, `unknown mode: ${mode || '<missing>'}`, false);

  let canonicalRoot;
  let canonicalTarget;
  try {
    if (root === undefined || root === null || String(root) === '') {
      throw new Error('plugin root argument is required');
    }
    if (!isFullyQualified(root)) {
      throw new Error(`plugin root is not a fully qualified absolute path: ${root}`);
    }
    const identities = canonicalIdentities(
      root,
      path.resolve(String(root), ...spec.rel),
    );
    if (identities.canonicalRoot !== String(root)) {
      throw new Error('plugin root identity changed between bootstrap stages');
    }
    canonicalRoot = String(root);
    canonicalTarget = identities.canonicalTarget;
    if (!isStrictlyInside(canonicalRoot, canonicalTarget, path)) {
      throw new Error(`${path.basename(canonicalTarget)} escapes the plugin root`);
    }
  } catch (error) {
    return writeFailure(mode, error && error.message ? error.message : String(error), false);
  }

  let result;
  try {
    result = childProcess.spawnSync(
      process.execPath,
      [canonicalTarget, ...spec.args],
      {
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
      },
    ) || {};
  } catch (error) {
    return writeFailure(mode,
      `child could not start: ${error && error.message ? error.message : String(error)}`,
      false);
  }

  if (typeof result.status !== 'number') {
    if (result.error) {
      const detail = result.error.message
        ? `child could not start: ${result.error.message}`
        : `child could not start: ${String(result.error)}`;
      return writeFailure(mode, detail, false);
    }
    const detail = result.signal
      ? `child terminated by signal ${result.signal}`
      : 'child returned no exit status';
    return writeFailure(mode, detail, true);
  }

  const status = result.status;
  if (spec.polarity === 'guard' && status !== 0 && status !== 2) {
    process.stderr.write(
      `deep-work hook bootstrap: guard child exited ${status} — coerced to block\n`,
    );
    return 2;
  }
  return status;
}

function coerce(mode, value) {
  return Number.isInteger(value) && value >= 0 && value <= 255
    ? value
    : (MODES[mode] ? MODES[mode].fail : 2);
}

function main(mode, root) {
  process.exitCode = coerce(mode, run(mode, root));
}

if (require.main === module) main(process.argv[2], process.argv[3]);

module.exports = {
  MODES,
  canonicalIdentities,
  isFullyQualified,
  isStrictlyInside,
  run,
  main,
};
