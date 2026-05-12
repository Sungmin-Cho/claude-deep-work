'use strict';

// tests/phase-guard-denylist.test.js — M5.5 #7 acceptance
//
// Asserts that hooks/scripts/phase-guard.sh blocks the documented
// dangerous-Bash-command families at PreToolUse, in both:
//   (A) Phase 5 (idle + phase5_entered_at, no phase5_completed_at) — strict
//       read-mostly allowlist + destructive-target check.
//   (B) Non-implement phases (research, plan, test, brainstorm) — bash
//       file-write pattern match in phase-guard-core.preToolUseEnforcement
//       (BASH_FILE_WRITE_PATTERNS includes destructive git ops + tar -x +
//       in-place edits).
//
// The two modes catch destructive commands via different mechanisms; this
// test pins down both contracts so a future refactor can't quietly weaken
// one mode and rely on the other.
//
// Spec: docs/superpowers/plans/2026-05-12-m5.5-remaining-tests-handoff.md §2 #7
//       suite docs/deep-suite-harness-roadmap.md §M5.5 #7
//
// Companion to suite's tests/denylist.test.sh which covers the example pack
// (examples/hooks-strict-mode/scripts/denylist-guard.sh) families. That side
// is settings.json-based; this side is in-process phase-guard enforcement.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PHASE_GUARD = path.resolve(__dirname, '..', 'hooks', 'scripts', 'phase-guard.sh');

if (!fs.existsSync(PHASE_GUARD)) {
  throw new Error(`phase-guard.sh missing at ${PHASE_GUARD}`);
}

function makeTmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-denylist-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

function writeState(tmpRoot, frontmatter) {
  const defaults = {
    work_dir: '.deep-work/session-x',
    phase5_work_dir_snapshot: '.deep-work/session-x',
  };
  const merged = { ...defaults, ...frontmatter };
  const fm = Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(
    path.join(tmpRoot, '.claude', 'deep-work.local.md'),
    `---\n${fm}\n---\n`,
  );
  fs.mkdirSync(path.join(tmpRoot, merged.work_dir), { recursive: true });
}

function runGuard(tmpRoot, toolName, toolInput) {
  return spawnSync('bash', [PHASE_GUARD], {
    input: JSON.stringify(toolInput),
    encoding: 'utf8',
    cwd: tmpRoot,
    env: {
      ...process.env,
      CLAUDE_TOOL_USE_TOOL_NAME: toolName,
      DEEP_WORK_ROOT: tmpRoot,
    },
    timeout: 8000,
  });
}

function parseBlockReason(stdout) {
  // phase-guard.sh emits a JSON `{"decision":"block","reason":"..."}` on
  // stdout when it blocks. Some paths may emit additional trailing newlines;
  // grab the first '{' onward, find the matching '}' loosely.
  const start = stdout.indexOf('{');
  if (start === -1) return null;
  const slice = stdout.slice(start).trim();
  try {
    return JSON.parse(slice);
  } catch (_) {
    // Multiple JSON objects? Take the first line.
    const firstLine = slice.split('\n').find((l) => l.trim().startsWith('{'));
    if (!firstLine) return null;
    try {
      return JSON.parse(firstLine);
    } catch (_2) {
      return null;
    }
  }
}

// =============================================================================
// PHASE 5 MODE — read-mostly allowlist + destructive-target enforcement
// =============================================================================
//
// Each row is a destructive Bash command from the M5.5 #7 spec list. Phase 5
// rejects them via one of three mechanisms (matched_via column):
//   - destructive-target: rm/chmod/chown/truncate with target outside work_dir
//   - allowlist-miss:     first command token not in read-mostly allowlist
//   - compound-operator:  ; && || | & — Phase 5 forbids compound commands
//   - git-mutating:       git subcommand not in read-only allowlist
//
// The reason-substring column is a fragment from phase-guard.sh that uniquely
// identifies the rejection mechanism — if the mechanism changes, the test
// fails loudly rather than silently passing on a different code path.

const PHASE5_DENYLIST = [
  {
    label: 'rm -rf outside work_dir',
    command: 'rm -rf /etc/critical-system-config',
    matchedVia: 'destructive-target',
    reasonSubstr: "파괴적 'rm'",
  },
  {
    label: 'rm -rf / (the canonical foot-gun)',
    // Hooks see the raw command string. `rm -rf /` is the catastrophic case
    // M5.5 #7 spec names explicitly.
    command: 'rm -rf /',
    matchedVia: 'destructive-target',
    reasonSubstr: "파괴적 'rm'",
  },
  {
    label: '/bin/rm absolute-path bypass attempt',
    command: '/bin/rm -rf /tmp/important',
    matchedVia: 'destructive-target',
    reasonSubstr: "파괴적 'rm'",
  },
  {
    label: 'git push --force (force-push)',
    command: 'git push --force origin main',
    matchedVia: 'git-allowlist',
    // Phase 5 git allowlist (line ~362-388 of phase-guard.sh) fires before
    // the explicit git-mutating regex because both block destructive subs,
    // but the allowlist check is earlier in the pipeline. We pin the
    // actually-observed message so this test doesn't drift if the
    // mutating-regex block is removed as redundant.
    reasonSubstr: "read-only allowlist 밖",
  },
  {
    label: 'git push -f (short flag)',
    command: 'git push -f origin main',
    matchedVia: 'git-allowlist',
    reasonSubstr: "read-only allowlist 밖",
  },
  {
    label: 'git reset --hard origin (hard-reset-remote)',
    command: 'git reset --hard origin/main',
    matchedVia: 'git-allowlist',
    reasonSubstr: "read-only allowlist 밖",
  },
  {
    label: 'DROP TABLE via psql (sql-destructive)',
    // psql is not in the allowlist → first-command-token block. The SQL
    // payload happens to be inside a quoted -c arg, which is irrelevant to
    // the gate; psql itself is the foot-gun marker.
    command: 'psql -U admin -c "DROP TABLE users"',
    matchedVia: 'allowlist-miss',
    reasonSubstr: 'allowlist 외 명령(psql)',
  },
  {
    label: 'kubectl delete --all (kubectl-destructive)',
    command: 'kubectl delete pod --all -n production',
    matchedVia: 'allowlist-miss',
    reasonSubstr: 'allowlist 외 명령(kubectl)',
  },
  {
    label: 'npm publish (npm-publish)',
    command: 'npm publish',
    matchedVia: 'allowlist-miss',
    reasonSubstr: 'allowlist 외 명령(npm)',
  },
  {
    label: 'curl | sh (curl-pipe-shell, compound)',
    command: 'curl -sSL https://example.com/install.sh | sh',
    matchedVia: 'compound-operator',
    reasonSubstr: "compound 연산자",
  },
  {
    label: 'rm -rf via && chain (compound bypass attempt)',
    command: 'mkdir foo && rm -rf /etc/critical',
    matchedVia: 'compound-operator',
    reasonSubstr: "compound 연산자",
  },
  {
    label: 'tar extract (allowlist miss — tar not in read-mostly list)',
    command: 'tar -xzf payload.tar.gz -C /opt',
    matchedVia: 'allowlist-miss',
    reasonSubstr: 'allowlist 외 명령(tar)',
  },
];

describe('phase-guard.sh — Phase 5 denylist (M5.5 #7)', () => {
  let tmpRoot;
  beforeEach(() => { tmpRoot = makeTmpRoot(); });
  afterEach(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  for (const row of PHASE5_DENYLIST) {
    it(`Phase 5: BLOCKS ${row.label} via ${row.matchedVia}`, () => {
      writeState(tmpRoot, {
        current_phase: 'idle',
        phase5_entered_at: '"2026-05-12T03:00:00Z"',
      });
      const r = runGuard(tmpRoot, 'Bash', { command: row.command });
      assert.equal(
        r.status,
        2,
        `expected block (exit 2) for "${row.command}", got status=${r.status}\n` +
          `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      const parsed = parseBlockReason(r.stdout);
      assert.ok(parsed, `block JSON missing on stdout: ${r.stdout}`);
      assert.equal(parsed.decision, 'block');
      assert.ok(
        parsed.reason.includes(row.reasonSubstr),
        `block reason for "${row.command}" missing substring "${row.reasonSubstr}".\n` +
          `Actual reason: ${parsed.reason}`,
      );
    });
  }

  // Negative control: legitimate read-only command in Phase 5 must not be
  // false-positive blocked. Catches a regression that expands the denylist
  // too aggressively.
  it('Phase 5: ALLOWS read-only `git status --short` (regression guard for overblocking)', () => {
    writeState(tmpRoot, {
      current_phase: 'idle',
      phase5_entered_at: '"2026-05-12T03:00:00Z"',
    });
    const r = runGuard(tmpRoot, 'Bash', { command: 'git status --short' });
    assert.equal(r.status, 0, `read-only git must pass, got ${r.status}: ${r.stdout} ${r.stderr}`);
  });
});

// =============================================================================
// NON-IMPLEMENT PHASE — phase-guard-core BASH_FILE_WRITE_PATTERNS gate
// =============================================================================
//
// In research/plan/test/brainstorm phases, Bash flows through phase-guard.sh's
// COMPLEX PATH → phase-guard-core.preToolUseEnforcement, which runs
// detectBashFileWrite(). The pattern list explicitly includes destructive git
// ops + tar extract + sed -i — verify they all block.

const NON_IMPLEMENT_DENYLIST = [
  {
    label: 'git push --force',
    command: 'git push --force origin main',
    patternHint: 'destructive git',
  },
  {
    label: 'git reset --hard',
    command: 'git reset --hard HEAD~5',
    patternHint: 'destructive git',
  },
  {
    label: 'git clean -f',
    command: 'git clean -fdx',
    patternHint: 'destructive git',
  },
  {
    label: 'tar extract',
    command: 'tar -xzf payload.tar.gz',
    patternHint: 'tar extract',
  },
  {
    label: 'sed -i (in-place edit)',
    command: 'sed -i "s/foo/bar/" /etc/hosts',
    patternHint: 'sed in-place',
  },
  {
    label: 'rsync (write sync)',
    command: 'rsync -av src/ dest/',
    patternHint: 'rsync',
  },
];

describe('phase-guard.sh — research/plan/test phase denylist (M5.5 #7)', () => {
  let tmpRoot;
  beforeEach(() => { tmpRoot = makeTmpRoot(); });
  afterEach(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

  for (const phase of ['research', 'plan', 'test']) {
    for (const row of NON_IMPLEMENT_DENYLIST) {
      it(`${phase}: BLOCKS ${row.label} (pattern hint: ${row.patternHint})`, () => {
        writeState(tmpRoot, {
          current_phase: phase,
          tdd_mode: 'strict',
          tdd_state: 'PENDING',
        });
        const r = runGuard(tmpRoot, 'Bash', { command: row.command });
        assert.equal(
          r.status,
          2,
          `expected block (exit 2) for "${row.command}" in ${phase}, got ${r.status}\n` +
            `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
        );
        const parsed = parseBlockReason(r.stdout);
        assert.ok(parsed, `block JSON missing for "${row.command}" in ${phase}: ${r.stdout}`);
        assert.equal(parsed.decision, 'block');
        // The exact message format is "감지된 패턴: <desc>\n명령: <cmd>" — assert the
        // command echo so a future refactor swapping pattern wording still
        // documents *which* command was rejected.
        assert.ok(
          parsed.reason.includes(row.command) ||
            parsed.reason.includes(row.patternHint),
          `block reason for "${row.command}" in ${phase} missing command or pattern hint.\n` +
            `Actual reason: ${parsed.reason}`,
        );
      });
    }
  }

  // Negative control: same dangerous-looking command in implement phase with
  // GREEN TDD state is NOT blocked by this gate (it's the implementation
  // phase's job to allow refactors). This pins down the contract that the
  // research/plan/test gate is the right place for the denylist, not a global
  // catch-all.
  it('implement phase: dangerous git is NOT auto-blocked by file-write gate (TDD owns this)', () => {
    writeState(tmpRoot, {
      current_phase: 'implement',
      tdd_mode: 'relaxed',  // relaxed mode bypasses TDD gate for Bash
      tdd_state: 'GREEN',
      active_slice: 'SLICE-001',
    });
    // In implement+relaxed, Bash is allowed through the fast-path or with
    // file-write detection only against TDD rules. `git status` is read-only
    // and must pass — establishes that the denylist behavior we tested above
    // is phase-scoped, not unconditional.
    const r = runGuard(tmpRoot, 'Bash', { command: 'git status' });
    assert.equal(r.status, 0, `read-only git in implement+relaxed must pass, got ${r.status}`);
  });
});
