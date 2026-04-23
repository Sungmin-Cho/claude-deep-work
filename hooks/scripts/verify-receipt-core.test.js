const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const {
  verifyReceipts,
  normalizeDiff,
  VERIFICATION_ITEMS,
} = require('./verify-receipt-core.js');

// ─── Fixture helpers (execFileSync, no shell) ────────────────
function makeTmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-test-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function makeReceipt(overrides = {}) {
  return Object.assign({
    slice_id: 'SLICE-001',
    status: 'complete',
    tdd: {
      // Delegated-path compact path (valid via STRICT_TRANSITIONS superset)
      state_transitions: ['PENDING', 'RED_VERIFIED', 'GREEN', 'SENSOR_CLEAN'],
      red_verification_output: 'AssertionError: expected 2 to equal 3\n  at test.js:12',
    },
    git_before_slice: 'HEAD0',
    git_after_slice: 'HEAD1',
    changes: { git_diff: '' },
    sensor_results: { lint: 'pass', typecheck: 'pass', reviewCheck: 'pass' },
    spec_compliance: {},  // no verification_cmd → item 8 skipped per receipt
    slice_review: { stage1: 'pass', stage2: 'pass' },
    harness_metadata: { model_id: 'sonnet' },
  }, overrides);
}

describe('verify-receipt item 1: file existence', () => {
  it('FAIL when receipts count mismatches slice count', () => {
    const result = verifyReceipts({
      receipts: [],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /slice count mismatch/i);
  });
});

describe('verify-receipt item 2: status complete only (F10)', () => {
  it('FAIL on any blocked receipt', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({ status: 'blocked' })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /status.*blocked/i);
  });

  it('FAIL on blocked-upstream', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({ status: 'blocked-upstream' })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
  });
});

describe('verify-receipt item 3: tdd_state transitions', () => {
  it('FAIL on invalid transition PENDING → GREEN', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt({
        tdd: {
          state_transitions: ['PENDING', 'GREEN'],
          red_verification_output: 'x',
        },
      })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      tdd_mode: 'strict',
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
  });

  it('PASS on delegated-path compact transition (PENDING→RED_VERIFIED→GREEN→SENSOR_CLEAN)', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt()],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      tdd_mode: 'strict',
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  it('PASS on phase-guard full FSM transitions (inline path) (W14)', () => {
    // Matches phase-guard-core.js VALID_TRANSITIONS full path
    const result = verifyReceipts({
      receipts: [makeReceipt({
        tdd: {
          state_transitions: [
            'PENDING', 'RED', 'RED_VERIFIED',
            'GREEN_ELIGIBLE', 'GREEN', 'SENSOR_RUN', 'SENSOR_CLEAN',
          ],
          red_verification_output: 'AssertionError: real\n  at x.js:1',
        },
      })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      tdd_mode: 'strict',
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('verify-receipt skip_items option (C7)', () => {
  it('skip_items: [1,2,3,4] — only item 5/6/7/8 evaluated (inline partial verify)', () => {
    // Intentionally break item 1-4 (count mismatch + bad status + bad transition)
    // but keep 5/6/7 valid. skip should silence all of 1-4.
    const result = verifyReceipts({
      receipts: [
        makeReceipt({ status: 'blocked' }),  // item 2 would fail
      ],
      plan: {
        slices: [
          { id: 'SLICE-001', files: ['a.js'] },
          { id: 'SLICE-002', files: ['b.js'] },  // item 1 count mismatch
        ],
      },
      tdd_mode: 'strict',
      skip_items: [1, 2, 3, 4],
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('verify-receipt item 5: out-of-scope detection (F2, unfiltered)', () => {
  it('FAIL when touched_files ⊄ declared_files', () => {
    const dir = makeTmpRepo();
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    fs.writeFileSync(path.join(dir, 'a.js'), 'in\n');
    fs.writeFileSync(path.join(dir, 'b.js'), 'OUT\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'edit'], { cwd: dir });
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    const result = verifyReceipts({
      repo_root: dir,
      receipts: [makeReceipt({ git_before_slice: before, git_after_slice: after })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_diff_match: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /out.of.scope|b\.js/i);
  });

  it('PASS when touched_files ⊆ declared_files', () => {
    const dir = makeTmpRepo();
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    fs.writeFileSync(path.join(dir, 'a.js'), 'in\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'edit'], { cwd: dir });
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    const result = verifyReceipts({
      repo_root: dir,
      receipts: [makeReceipt({ git_before_slice: before, git_after_slice: after })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_diff_match: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });

  // NB (W1): This test validates multi-FILE scope within a SINGLE slice.
  // The true "multi-CLUSTER union scope" (N2) — where a solo worker receives
  // cluster_ids=[C1,C2] and edits files from both clusters — is enforced at
  // the AGENT PROMPT level (see implement-slice-worker.md Out-of-scope
  // guardrails), not at verify-receipt level. verify-receipt operates
  // slice-by-slice. Multi-cluster enforcement is covered by Task 16
  // Manual step 3 (observe agent behavior).
  it('PASS for multi-file slice scope', () => {
    const dir = makeTmpRepo();
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();
    fs.writeFileSync(path.join(dir, 'a.js'), 'f1\n');
    fs.writeFileSync(path.join(dir, 'b.js'), 'f2\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'edit'], { cwd: dir });
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim();

    const result = verifyReceipts({
      repo_root: dir,
      receipts: [makeReceipt({ git_before_slice: before, git_after_slice: after })],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js', 'b.js'] }] },
      skip_diff_match: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('verify-receipt item 6: baseline chain continuity (F1)', () => {
  it('FAIL on broken chain', () => {
    const result = verifyReceipts({
      receipts: [
        makeReceipt({ slice_id: 'SLICE-001', git_before_slice: 'A', git_after_slice: 'B' }),
        makeReceipt({ slice_id: 'SLICE-002', git_before_slice: 'C', git_after_slice: 'D' }),
      ],
      plan: {
        slices: [
          { id: 'SLICE-001', files: ['a.js'] },
          { id: 'SLICE-002', files: ['b.js'] },
        ],
      },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /chain|continuity/i);
  });

  it('PASS on continuous chain', () => {
    const result = verifyReceipts({
      receipts: [
        makeReceipt({ slice_id: 'SLICE-001', git_before_slice: 'A', git_after_slice: 'B' }),
        makeReceipt({ slice_id: 'SLICE-002', git_before_slice: 'B', git_after_slice: 'C' }),
      ],
      plan: {
        slices: [
          { id: 'SLICE-001', files: ['a.js'] },
          { id: 'SLICE-002', files: ['b.js'] },
        ],
      },
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('verify-receipt item 7: TDD hard-fail (W8)', () => {
  it('FAIL when red_verification_output is missing', () => {
    const r = makeReceipt();
    delete r.tdd.red_verification_output;
    const result = verifyReceipts({
      receipts: [r],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('\n'), /red_verification_output/);
  });

  it('FAIL on trivial output (ok, pass, PASS)', () => {
    for (const trivial of ['ok', 'pass', 'PASS', 'passed', '  ok  ']) {
      const result = verifyReceipts({
        receipts: [makeReceipt({
          tdd: {
            state_transitions: ['PENDING', 'RED_VERIFIED', 'GREEN', 'SENSOR_CLEAN'],
            red_verification_output: trivial,
          },
        })],
        plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
        skip_git_checks: true,
      });
      assert.equal(result.pass, false, `should fail for trivial output: "${trivial}"`);
    }
  });

  it('PASS on real FAIL message', () => {
    const result = verifyReceipts({
      receipts: [makeReceipt()],
      plan: { slices: [{ id: 'SLICE-001', files: ['a.js'] }] },
      skip_git_checks: true,
    });
    assert.equal(result.pass, true, JSON.stringify(result.errors));
  });
});

describe('parseStateFile (N-R2 — YAML frontmatter)', () => {
  const { parseStateFile } = require('./verify-receipt-core.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  function writeState(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-test-'));
    const file = path.join(dir, 'deep-work.S1.md');
    fs.writeFileSync(file, content);
    return file;
  }

  it('reads tdd_mode from YAML frontmatter', () => {
    const f = writeState([
      '---',
      'work_dir: "/tmp/x"',
      'tdd_mode: "strict"',
      'team_mode: "team"',
      '---',
      '',
      '# body',
    ].join('\n'));
    const s = parseStateFile(f);
    assert.equal(s.tdd_mode, 'strict');
    assert.equal(s.team_mode, 'team');
  });

  it('handles unquoted YAML values', () => {
    const f = writeState([
      '---',
      'tdd_mode: strict',
      '---',
    ].join('\n'));
    assert.equal(parseStateFile(f).tdd_mode, 'strict');
  });

  it('ignores inline YAML comments', () => {
    const f = writeState([
      '---',
      'tdd_mode: "strict"  # fixed at session start',
      '---',
    ].join('\n'));
    assert.equal(parseStateFile(f).tdd_mode, 'strict');
  });

  it('returns empty object when no frontmatter', () => {
    const f = writeState('# No frontmatter here\n');
    assert.deepEqual(parseStateFile(f), {});
  });

  it('does NOT throw on Markdown content (was C9/N-R2 bug)', () => {
    const f = writeState([
      '---',
      'tdd_mode: "strict"',
      '---',
      '',
      '# deep-work session log',
      '',
      'This is Markdown, not JSON. Previous JSON.parse would throw.',
    ].join('\n'));
    // Must not throw
    const s = parseStateFile(f);
    assert.equal(s.tdd_mode, 'strict');
  });
});

describe('parsePlanMd (N-R1 — deep-plan template compat)', () => {
  const { parsePlanMd } = require('./verify-receipt-core.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  function writePlan(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-md-test-'));
    const file = path.join(dir, 'plan.md');
    fs.writeFileSync(file, content);
    return file;
  }

  it('parses unquoted bracket files list (deep-plan canonical format)', () => {
    const f = writePlan([
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: Parse config',
      '  - files: [src/config.js, src/parser.js]',
      '  - size: S',
      '',
      '- [x] SLICE-002: Add validation',
      '  - files: [src/validate.js]',
      '  - size: M',
      '',
      '## Open Questions',
      '- [ ] none',
    ].join('\n'));
    const plan = parsePlanMd(f);
    assert.equal(plan.slices.length, 2);
    assert.deepEqual(plan.slices[0].files, ['src/config.js', 'src/parser.js']);
    assert.equal(plan.slices[0].size, 'S');
    assert.deepEqual(plan.slices[1].files, ['src/validate.js']);
  });

  it('parses quoted bracket files (JSON-style) too', () => {
    const f = writePlan([
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: X',
      '  - files: ["src/a.js", "src/b.js"]',
      '  - size: S',
    ].join('\n'));
    const plan = parsePlanMd(f);
    assert.deepEqual(plan.slices[0].files, ['src/a.js', 'src/b.js']);
  });

  it('IGNORES SLICE-NNN mentions outside Slice Checklist section', () => {
    // Prose mention of SLICE-001 in Overview + duplicate mention in Review
    // should not create phantom slices.
    const f = writePlan([
      '# Plan',
      '',
      '## Overview',
      'SLICE-001 is the entry point. Subsequent work depends on SLICE-002.',
      '',
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: Real entry',
      '  - files: [a.js]',
      '  - size: S',
      '',
      '## Review Notes',
      'See SLICE-001 and SLICE-999 for details.',
    ].join('\n'));
    const plan = parsePlanMd(f);
    assert.equal(plan.slices.length, 1);
    assert.equal(plan.slices[0].id, 'SLICE-001');
    assert.deepEqual(plan.slices[0].files, ['a.js']);
  });

  it('returns empty when Slice Checklist section is missing', () => {
    const f = writePlan('# Plan\n\nNo checklist here.');
    assert.deepEqual(parsePlanMd(f), { slices: [] });
  });

  it('strips inline YAML comments on files line', () => {
    const f = writePlan([
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: X',
      '  - files: [a.js, b.js]  # two files',
      '  - size: S',
    ].join('\n'));
    const plan = parsePlanMd(f);
    assert.deepEqual(plan.slices[0].files, ['a.js', 'b.js']);
  });
});

describe('normalizeDiff (N3)', () => {
  it('strips trailing newlines', () => {
    assert.equal(normalizeDiff('line1\nline2\n\n\n'), 'line1\nline2');
  });
  it('strips diff index hash lines', () => {
    const input = 'diff --git a/x b/x\nindex abc123..def456 100644\n--- a/x\n+++ b/x';
    assert.ok(!normalizeDiff(input).includes('index abc123'));
  });
  it('preserves internal whitespace', () => {
    assert.equal(normalizeDiff('a  b\n'), 'a  b');
  });
});
