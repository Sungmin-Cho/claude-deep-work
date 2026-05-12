'use strict';

// tests/phase-guard-golden.test.js — M5.5 #3 hook golden test (deep-work side).
//
// **Goal**: pin phase-guard.sh's stdout JSON + exit code on a fixture corpus
// so the contract (decision + reason regex match) is regression-protected
// across all six phases × representative tool invocations. Adding a new
// scenario = adding a `<name>.input.json` + `<name>.expected.json` pair
// under `tests/fixtures/golden/`. The loader fails loud if one side is
// missing (catches accidental half-commits).
//
// Spec: docs/superpowers/plans/2026-05-12-m5.5-remaining-tests-handoff.md §2 #3
//       suite docs/deep-suite-harness-roadmap.md §M5.5 #3
//
// Helper rationale (shared with phase-guard-denylist.test.js sibling tests
// via §9.2 W-R2.2 follow-up): see hooks/scripts/test-helpers/run-phase-guard.js.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runPhaseGuard, parseGuardOutput } = require(
  '../hooks/scripts/test-helpers/run-phase-guard',
);

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'golden');

function loadFixtureCorpus() {
  const entries = fs.readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.input.json') || f.endsWith('.expected.json'));
  const map = new Map();
  for (const file of entries) {
    const m = file.match(/^(.+)\.(input|expected)\.json$/);
    if (!m) continue;
    const [, name, kind] = m;
    if (!map.has(name)) map.set(name, { name });
    map.get(name)[kind] = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'),
    );
  }
  for (const [name, fixture] of map) {
    if (!fixture.input || !fixture.expected) {
      const missing = fixture.input ? '.expected' : '.input';
      throw new Error(
        `Golden fixture "${name}" is missing ${missing}.json — half-commit?`,
      );
    }
  }
  // Stable test order (sort by basename) so CI diff output is deterministic
  // when a new fixture is added mid-list.
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function writeStateFile(tmpRoot, sessionId, frontmatter) {
  fs.mkdirSync(path.join(tmpRoot, '.claude'), { recursive: true });
  const lines = [];
  for (const [k, v] of Object.entries(frontmatter || {})) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${item}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  fs.writeFileSync(
    path.join(tmpRoot, '.claude', `deep-work.${sessionId}.md`),
    `---\n${lines.join('\n')}\n---\n`,
  );
  // Mirror phase-guard-hardening.test.js pointer convention so utils.sh's
  // current-session resolution finds the state file when DEEP_WORK_SESSION_ID
  // is supplied via env.
  fs.writeFileSync(
    path.join(tmpRoot, '.claude', 'deep-work-current-session'),
    sessionId,
  );
  // Create the work_dir if frontmatter set one (some non-implement paths in
  // phase-guard.sh stat the directory).
  if (frontmatter && typeof frontmatter.work_dir === 'string') {
    fs.mkdirSync(path.join(tmpRoot, frontmatter.work_dir), { recursive: true });
  }
}

const CORPUS = loadFixtureCorpus();
if (CORPUS.length === 0) {
  throw new Error('No golden fixtures discovered under tests/fixtures/golden/');
}

describe('phase-guard golden fixtures (M5.5 #3)', () => {
  // Each fixture gets its own `it` so a single regression shows the
  // failing scenario name in the test output.
  for (const [name, fixture] of CORPUS) {
    const desc = fixture.input.description || '(no description)';
    it(`${name} — ${desc}`, () => {
      const tmpRoot = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'pg-golden-')),
      );
      try {
        const sid = fixture.input.session_id || 'golden-default';
        if (fixture.input.state) {
          writeStateFile(tmpRoot, sid, fixture.input.state);
        } else {
          fs.mkdirSync(path.join(tmpRoot, '.claude'), { recursive: true });
        }
        const result = runPhaseGuard({
          cwd: tmpRoot,
          env: {
            DEEP_WORK_SESSION_ID: sid,
            ...(fixture.input.env || {}),
          },
          toolName: fixture.input.tool_name,
          toolInput: fixture.input.tool_input,
        });

        const expected = fixture.expected;
        assert.equal(
          result.status,
          expected.exit_code,
          `exit code mismatch: status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`,
        );

        if (expected.decision || expected.reason_match) {
          const parsed = parseGuardOutput(result.stdout);
          assert.ok(
            parsed,
            `expected JSON decision in stdout for assertions; got: ${result.stdout}`,
          );
          if (expected.decision) {
            assert.equal(
              parsed.decision,
              expected.decision,
              `decision mismatch in ${name}`,
            );
          }
          if (expected.reason_match) {
            assert.ok(
              typeof parsed.reason === 'string' && parsed.reason.length > 0,
              `expected reason text in ${name}; got ${JSON.stringify(parsed)}`,
            );
            assert.match(parsed.reason, new RegExp(expected.reason_match));
          }
        }
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    });
  }
});
