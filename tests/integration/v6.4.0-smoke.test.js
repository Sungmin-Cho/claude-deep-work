const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyReceipts, parsePlanMd, parseStateFile } =
  require('../../hooks/scripts/verify-receipt-core.js');

const FIXTURES = path.join(__dirname, 'fixtures');

// N-R7: load plan from .md (via parsePlanMd) and state from .md (via parseStateFile)
// to exercise the SAME production code paths used by the runner.
function loadFixture(name) {
  const base = path.join(FIXTURES, name);
  const plan = parsePlanMd(path.join(base, 'plan.md'));
  const state = parseStateFile(path.join(base, 'state.md'));
  const rdir = path.join(base, 'receipts');
  const receipts = fs.readdirSync(rdir).sort().map((f) =>
    JSON.parse(fs.readFileSync(path.join(rdir, f), 'utf8'))
  );
  return { plan, state, receipts };
}

describe('v6.4.0 integration — verify-delegated-receipt', () => {
  it('passing fixture → pass=true (exercises parsePlanMd + parseStateFile)', () => {
    const { plan, state, receipts } = loadFixture('passing');
    // Sanity: fixtures actually drive parse paths
    assert.equal(plan.slices.length, 2, 'parsePlanMd must find both slices');
    assert.deepEqual(plan.slices[0].files, ['src/a.js']);
    assert.equal(state.tdd_mode, 'strict');

    const r = verifyReceipts({ plan, receipts, tdd_mode: state.tdd_mode, skip_git_checks: true });
    assert.equal(r.pass, true, JSON.stringify(r.errors));
  });

  it('blocked-fail → pass=false with item 2 error (F10)', () => {
    const { plan, state, receipts } = loadFixture('blocked-fail');
    const r = verifyReceipts({ plan, receipts, tdd_mode: state.tdd_mode, skip_git_checks: true });
    assert.equal(r.pass, false);
    assert.match(r.errors.join('\n'), /\[item 2\].*blocked/);
  });

  it('tdd-hardfail → pass=false with item 7 error (W8)', () => {
    const { plan, state, receipts } = loadFixture('tdd-hardfail');
    const r = verifyReceipts({ plan, receipts, tdd_mode: state.tdd_mode, skip_git_checks: true });
    assert.equal(r.pass, false);
    assert.match(r.errors.join('\n'), /\[item 7\].*red_verification_output.*trivial/i);
  });

  it('item 8 advisory warning when verification_output mismatches (N-R5)', () => {
    // Synthetic fixture — receipt with verification_cmd + mismatched output
    const { plan, state } = loadFixture('passing');
    const receipts = [{
      slice_id: 'SLICE-001',
      status: 'complete',
      tdd: {
        state_transitions: ['PENDING', 'RED_VERIFIED', 'GREEN', 'SENSOR_CLEAN'],
        red_verification_output: 'AssertionError: real\n  at a.js:1',
      },
      git_before_slice: 'x', git_after_slice: 'y',
      changes: { git_diff: '' },
      sensor_results: { lint: 'pass' },
      spec_compliance: {
        verification_cmd: 'npm test',
        expected_output: 'Tests: 2 passed',
        verification_output: 'Tests: 1 passed',  // mismatch
      },
      slice_review: {}, harness_metadata: {},
    }];
    const r = verifyReceipts({
      plan: { slices: [plan.slices[0]] },  // single-slice view
      receipts, tdd_mode: state.tdd_mode, skip_git_checks: true,
    });
    // pass still true (advisory, not hard fail), warnings present
    assert.equal(r.pass, true);
    assert.ok(r.warnings && r.warnings.length > 0);
    assert.match(r.warnings.join('\n'), /item 8 ADVISORY/);
  });
});
