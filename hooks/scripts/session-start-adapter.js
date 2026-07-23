'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runHookScript } = require('./hook-shell-adapter.js');

const PLUGIN_ROOT = path.resolve(__dirname, '../..');

function probeSpec(mode, pluginRoot) {
  if (mode === 'update-check') {
    return {
      hookScript: 'update-check',
    };
  }
  if (mode === 'sensor-detect') {
    return {
      executable: process.execPath,
      args: [path.join(pluginRoot, 'sensors', 'detect.js')],
    };
  }
  return null;
}

function runSessionStartAdapter(mode, options = {}) {
  const run = options.run || spawnSync;
  const spec = probeSpec(mode, options.pluginRoot || PLUGIN_ROOT);
  if (!spec) {
    return { status: 2, output: null, stderr: `unknown SessionStart probe: ${mode || '<missing>'}\n` };
  }

  const result = spec.hookScript
    ? runHookScript(spec.hookScript, {
      capture: true,
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      exists: options.exists,
      platform: options.platform,
      pluginRoot: options.pluginRoot || PLUGIN_ROOT,
      run,
    })
    : run(spec.executable, spec.args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      encoding: 'utf8',
      shell: false,
      timeout: 7_000,
      windowsHide: true,
    });
  const status = Number.isInteger(result.status) ? result.status : 1;
  const stderr = typeof result.stderr === 'string'
    ? result.stderr
    : (result.error ? `${result.error.message}\n` : '');
  if (status !== 0) return { status, output: null, stderr };

  const additionalContext = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (additionalContext.length === 0) return { status: 0, output: null, stderr };
  return {
    status: 0,
    output: {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    },
    stderr,
  };
}

function main() {
  const result = runSessionStartAdapter(process.argv[2]);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.output) process.stdout.write(`${JSON.stringify(result.output)}\n`);
  process.exitCode = result.status;
}

if (require.main === module) main();

module.exports = { probeSpec, runSessionStartAdapter };
