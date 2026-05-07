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

  it('--only-completed flag filters mixed-status receipts before verification (W-3.2)', () => {
    // W-3.2: ensure the runner's `onlyCompleted === '1'` branch filters out
    // blocked/blocked-upstream receipts so resume paths can verify only
    // already-accepted slices without the blocked ones forcing a fail.
    const { execFileSync } = require('node:child_process');
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');

    // Build a temp fixture with 1 complete + 1 blocked receipt.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'only-completed-'));
    fs.writeFileSync(path.join(tmp, 'state.md'),
      '---\ntdd_mode: "strict"\n---\n');
    fs.writeFileSync(path.join(tmp, 'plan.md'), [
      '# Plan',
      '',
      '## Slice Checklist',
      '',
      '- [ ] SLICE-001: done',
      '  - files: [a.js]',
      '  - size: S',
      '',
      '- [ ] SLICE-002: blocked',
      '  - files: [b.js]',
      '  - size: S',
    ].join('\n'));
    const rdir = path.join(tmp, 'receipts');
    fs.mkdirSync(rdir);
    const baseReceipt = (id, status) => ({
      slice_id: id, status,
      tdd: {
        state_transitions: ['PENDING', 'RED_VERIFIED', 'GREEN', 'SENSOR_CLEAN'],
        red_verification_output: 'AssertionError: real\n  at x.js:1',
      },
      git_before_slice: 'A', git_after_slice: 'B',
      changes: { git_diff: '' },
      sensor_results: { lint: 'pass' },
      spec_compliance: {},
      slice_review: {}, harness_metadata: {},
    });
    fs.writeFileSync(path.join(rdir, 'SLICE-001.json'),
      JSON.stringify(baseReceipt('SLICE-001', 'complete')));
    fs.writeFileSync(path.join(rdir, 'SLICE-002.json'),
      JSON.stringify(baseReceipt('SLICE-002', 'blocked')));

    // Without --only-completed: runner should fail (item 2 rejects blocked)
    const scriptDir = path.join(__dirname, '..', '..', 'hooks', 'scripts');
    let failed = false;
    try {
      execFileSync('node',
        [path.join(scriptDir, 'verify-delegated-receipt-runner.js'),
         scriptDir,
         path.join(tmp, 'state.md'),
         rdir,
         path.join(tmp, 'plan.md'),
         '',    // skipItemsCsv empty
         '0'],  // onlyCompleted=0
        { stdio: 'pipe' });
    } catch (e) {
      failed = true;
    }
    assert.equal(failed, true, 'without --only-completed, blocked receipt should fail');

    // With --only-completed: runner should pass (blocked filtered out,
    // only SLICE-001 is verified, plan has 2 slices but skip_items needed
    // to avoid item 1 count mismatch. Simulating resume path: complete
    // receipts are already accepted.)
    // Use skip_items=1 to bypass count mismatch since plan has 2 slices
    // but we're only verifying 1 after filter.
    const out = execFileSync('node',
      [path.join(scriptDir, 'verify-delegated-receipt-runner.js'),
       scriptDir,
       path.join(tmp, 'state.md'),
       rdir,
       path.join(tmp, 'plan.md'),
       '1',   // skipItemsCsv = skip item 1 (count mismatch)
       '1'],  // onlyCompleted=1
      { stdio: 'pipe', encoding: 'utf8' });
    assert.match(out, /all items pass \(1 receipts\)/,
      '--only-completed with skip_items=1 should pass, filtering blocked');

    // cleanup
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('v6.4.0 integration — Health Engine command contracts', () => {
  it('deep-research Phase 1 instructions connect topology, fitness, health_report, and baseline state', () => {
    const skill = fs.readFileSync(path.join(__dirname, '..', '..', 'skills', 'deep-research', 'SKILL.md'), 'utf8');

    assert.match(skill, /Health Engine Preflight/);
    assert.match(skill, /templates\/topology-detector\.js/);
    assert.match(skill, /health\/fitness\/fitness-generator\.js/);
    assert.match(skill, /health\/health-check\.js/);
    assert.match(skill, /health_report/);
    assert.match(skill, /fitness_baseline/);
    assert.match(skill, /unresolved_required_issues/);
  });

  it('status and receipt commands read the actual health_report schema', () => {
    const status = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'deep-status.md'), 'utf8');
    const receipt = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'deep-receipt.md'), 'utf8');
    const combined = `${status}\n${receipt}`;

    assert.match(combined, /health_report\.drift\.dead_exports\.count/);
    assert.match(combined, /health_report\.drift\.coverage_trend\.delta/);
    assert.match(combined, /health_report\.drift\.dependency_vuln\.critical/);
    assert.match(combined, /health_report\.drift\.stale_config\.count/);
    assert.match(combined, /health_report\.fitness\.total_rules/);
    assert.doesNotMatch(combined, /coverage_delta/);
    assert.doesNotMatch(combined, /vulnerability\.critical/);
    assert.doesNotMatch(combined, /stale_deps\.count/);
  });
});

describe('release metadata', () => {
  it('current release metadata and docs are bumped to 6.5.0', () => {
    const root = path.join(__dirname, '..', '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const changelogKo = fs.readFileSync(path.join(root, 'CHANGELOG.ko.md'), 'utf8');

    assert.equal(pkg.version, '6.5.0');
    assert.equal(plugin.version, '6.5.0');
    assert.match(claude, /^# deep-work v6\.5\.0/m);
    assert.match(changelog, /^## \[6\.5\.0\] - 2026-05-07/m);
    assert.match(changelogKo, /^## \[6\.5\.0\] - 2026-05-07/m);
  });
});
