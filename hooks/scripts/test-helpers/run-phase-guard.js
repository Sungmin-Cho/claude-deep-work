'use strict';

// Test-isolation helper for phase-guard.sh / phase-guard-core.js test files.
//
// **Why this exists** — phase-guard.sh's session-state lookup is steered by
// three env vars that a developer's interactive shell or a CI runner may
// have set:
//   - DEEP_WORK_SESSION_ID  (utils.sh:233 — ACTIVE redirect: chooses which
//                            .claude/deep-work.<id>.md to read)
//   - DEEP_WORK_ROOT        (forward-compat redirect — not currently
//                            consumed by utils.sh but pre-emptively scrubbed
//                            so a future consumer doesn't silently break
//                            host independence)
//   - CLAUDE_PROJECT_DIR    (same forward-compat reasoning)
//
// If any of these leak into the spawned process, phase-guard.sh reads state
// from somewhere other than the test's tmpRoot — typically falling through
// to a "no state file" silent-pass and masking the failure path the test
// intended to exercise. M5.5 #7 H1 (deep-work PR #28) scrubbed these inline
// in `tests/phase-guard-denylist.test.js`; the §9.2 W-R2.2 follow-up
// consolidates the same defense as a shared helper so future hook tests
// inherit host-env isolation for free.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_PHASE_GUARD = path.resolve(__dirname, '..', 'phase-guard.sh');

// Verified consumer list (grep hooks/scripts/ as of v6.6.2). Update this
// list AND the comment block above when a new consumer of a host-leakable
// env var is added or removed — a stale list silently weakens isolation.
const HOST_LEAK_VARS = ['DEEP_WORK_SESSION_ID', 'DEEP_WORK_ROOT', 'CLAUDE_PROJECT_DIR'];

/**
 * Return a copy of process.env with the known host-leak vars removed,
 * then merged with caller-supplied overrides. Use this in tests that
 * spawn phase-guard via a non-standard pattern (e.g. `execFileSync` with
 * `bash -c`) where the high-level runPhaseGuard wrapper does not fit.
 *
 * @param {object} extra — env vars to merge AFTER scrub (test-specific)
 * @returns {object}
 */
function scrubHostEnv(extra = {}) {
  const scrubbed = { ...process.env };
  for (const k of HOST_LEAK_VARS) delete scrubbed[k];
  return { ...scrubbed, ...extra };
}

/**
 * Spawn phase-guard.sh under test isolation. Centralizes the spawn
 * convention shared by phase-guard-denylist.test.js and the new
 * tests/phase-guard-golden.test.js so a future change to the JSON stdin
 * contract or the bash invocation pattern is updated in one place.
 *
 * @param {object} opts
 * @param {string} opts.cwd          — tmpRoot where .claude/* state lives
 * @param {object} [opts.env]        — extra env vars (merged after scrub)
 * @param {string} [opts.toolName]   — shorthand for CLAUDE_TOOL_USE_TOOL_NAME
 * @param {any}    [opts.toolInput]  — payload JSON-stringified onto stdin
 * @param {string} [opts.script]     — defaults to phase-guard.sh
 * @param {number} [opts.timeout]    — defaults to 8000ms
 * @returns {{status:number,stdout:string,stderr:string,signal:string|null,error:Error|undefined}}
 */
function runPhaseGuard({
  cwd,
  env: extraEnv = {},
  toolName,
  toolInput,
  script = DEFAULT_PHASE_GUARD,
  timeout = 8000,
} = {}) {
  const env = scrubHostEnv({
    ...(toolName ? { CLAUDE_TOOL_USE_TOOL_NAME: toolName } : {}),
    ...extraEnv,
  });
  const input = typeof toolInput === 'undefined' ? '' : JSON.stringify(toolInput);
  return spawnSync('bash', [script], {
    input,
    cwd,
    env,
    encoding: 'utf8',
    timeout,
  });
}

/**
 * Parse the JSON object embedded in phase-guard.sh stdout. Multi-line
 * HEREDOC (`cat <<JSON ... JSON`) and single-line `printf '{...}'` both
 * produce a single JSON document; slicing from the first `{` to trimmed
 * end and feeding to JSON.parse handles both shapes.
 *
 * @param {string} stdout
 * @returns {object|null} parsed decision object, or null if no JSON found
 */
function parseGuardOutput(stdout) {
  if (!stdout) return null;
  const start = stdout.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start).trim());
  } catch (_) {
    return null;
  }
}

module.exports = {
  scrubHostEnv,
  runPhaseGuard,
  parseGuardOutput,
  HOST_LEAK_VARS,
  DEFAULT_PHASE_GUARD,
};
