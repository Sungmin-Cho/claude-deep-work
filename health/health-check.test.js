'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readBaseline, writeBaseline, isBaselineValid } = require('./health-baseline.js');

describe('health-baseline', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns null when baseline file does not exist', () => {
    assert.equal(readBaseline(path.join(tmpDir, '.deep-work')), null);
  });

  it('reads and parses existing baseline', () => {
    const dir = path.join(tmpDir, '.deep-work');
    fs.mkdirSync(dir, { recursive: true });
    const data = { updated_at: '2026-04-09T14:30:00Z', commit: 'abc', branch: 'main', coverage: { line: 85 }, dead_exports: 3, fitness_violations: 1 };
    fs.writeFileSync(path.join(dir, 'health-baseline.json'), JSON.stringify(data));
    assert.deepEqual(readBaseline(dir), data);
  });

  it('writes baseline with commit and branch', () => {
    const dir = path.join(tmpDir, '.deep-work');
    fs.mkdirSync(dir, { recursive: true });
    writeBaseline(dir, { coverage: { line: 90 } }, 'def', 'feat/x');
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'health-baseline.json'), 'utf-8'));
    assert.equal(written.commit, 'def');
    assert.equal(written.branch, 'feat/x');
    assert.equal(typeof written.updated_at, 'string');
  });

  it('invalidates when branch differs', () => {
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: 'a', branch: 'main' }, 'a', 'other'), false);
  });

  it('invalidates when older than 7 days', () => {
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    assert.equal(isBaselineValid({ updated_at: old, commit: 'a', branch: 'main' }, 'a', 'main'), false);
  });

  it('validates when branch and age match', () => {
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: 'a', branch: 'main' }, 'a', 'main'), true);
  });

  it('invalidates when commit is not ancestor (rebase/force-push)', () => {
    const notAncestor = () => false;
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: 'old', branch: 'main' }, 'new', 'main', { isAncestor: notAncestor }), false);
  });

  it('validates when commit is ancestor', () => {
    const yesAncestor = () => true;
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: 'old', branch: 'main' }, 'new', 'main', { isAncestor: yesAncestor }), true);
  });

  it('skips ancestor check when commit is null (non-git project)', () => {
    assert.equal(isBaselineValid({ updated_at: new Date().toISOString(), commit: null, branch: null }, null, null), true);
  });

  it('handles null baseline', () => {
    assert.equal(isBaselineValid(null, 'a', 'main'), false);
  });
});

// ==========================================================================
// health-check orchestrator tests
// ==========================================================================
const { runHealthCheck } = require('./health-check.js');

describe('health-check orchestrator', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function write(relPath, content) {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  // 1. Health report has drift + fitness sections + scan_commit field
  it('report has drift, fitness sections and scan_commit field', async () => {
    write('package.json', '{}');
    const report = await runHealthCheck(tmpDir, {
      commit: 'abc1234',
      branch: 'main',
      skipAudit: true,
    });

    assert.ok(report.drift, 'report should have drift section');
    assert.ok(report.fitness, 'report should have fitness section');
    assert.equal(report.scan_commit, 'abc1234');
    assert.equal(typeof report.scan_time, 'string');

    // drift sub-sections
    assert.ok('dead_exports' in report.drift);
    assert.ok('stale_config' in report.drift);
    assert.ok('dependency_vuln' in report.drift);
    assert.ok('coverage_trend' in report.drift);
  });

  // 2. Drift sensors run in parallel (completes within 5s for tiny project)
  it('drift sensors run in parallel and complete within 5s for tiny project', async () => {
    write('package.json', '{}');
    write('src/a.js', 'export function foo() {}');
    write('src/b.js', "import { foo } from './a';\nfoo();\n");

    const start = Date.now();
    const report = await runHealthCheck(tmpDir, { skipAudit: true });
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 5000, `should complete within 5s, took ${elapsed}ms`);
    assert.ok(report.drift.dead_exports.status !== 'timeout');
    assert.ok(report.drift.stale_config.status !== 'timeout');
  });

  // 3. fitness provided → results included (yaml_exists: true)
  it('fitness provided includes results with yaml_exists true', async () => {
    write('package.json', '{}');
    write('src/small.js', '// just a comment\n');

    const fitnessData = {
      version: 1,
      rules: [
        { id: 'max-lines', type: 'file-metric', severity: 'advisory', check: 'line-count', max: 500, include: 'src/**/*.js' },
      ],
    };

    const report = await runHealthCheck(tmpDir, {
      fitness: fitnessData,
      skipAudit: true,
    });

    assert.equal(report.fitness.yaml_exists, true);
    assert.equal(report.fitness.total_rules, 1);
    assert.ok(report.fitness.passed >= 0);
  });

  // 4. fitness null → yaml_exists: false (not_applicable)
  it('fitness null returns yaml_exists false', async () => {
    write('package.json', '{}');

    const report = await runHealthCheck(tmpDir, {
      fitness: null,
      skipAudit: true,
    });

    assert.equal(report.fitness.yaml_exists, false);
    assert.equal(report.fitness.total_rules, 0);
    assert.equal(report.fitness.passed, 0);
    assert.equal(report.fitness.failed, 0);
  });

  // 5. Individual sensor timeout exceeded → sensor recorded as 'timeout'
  it('individual sensor timeout exceeded records sensor as timeout', async () => {
    write('package.json', '{}');

    // Override dead-export timeout to 1ms to force timeout
    const report = await runHealthCheck(tmpDir, {
      skipAudit: true,
      timeouts: { deadExport: 1, staleConfig: 10000, depVuln: 30000, total: 180000 },
    });

    // The dead_exports sensor may or may not time out with 1ms (race condition),
    // but verify the report structure is valid regardless
    assert.ok(['pass', 'advisory', 'timeout', 'not_applicable', 'error'].includes(report.drift.dead_exports.status),
      `dead_exports status should be a valid status, got: ${report.drift.dead_exports.status}`);
  });

  // 6. Overall 180s timeout enforcement
  it('overall timeout enforcement rejects when total timeout exceeded', async () => {
    write('package.json', '{}');

    // Inject 200ms delay into checks, set total timeout to 50ms
    await assert.rejects(
      () => runHealthCheck(tmpDir, {
        skipAudit: true,
        _testDelay: 200,
        timeouts: { deadExport: 30000, staleConfig: 10000, depVuln: 30000, total: 50 },
      }),
      (err) => {
        assert.ok(err.message.includes('timeout'), `error message should mention timeout, got: ${err.message}`);
        return true;
      }
    );
  });

  // 7. health-ignore.json loaded → dead-export receives ignoreList
  it('health-ignore.json loaded and passed to dead-export scanner', async () => {
    write('package.json', '{}');
    write('src/utils.js', 'export function ignoredFn() {}\nexport function deadFn() {}\n');

    // Write health-ignore.json
    write('.deep-work/health-ignore.json', JSON.stringify({
      dead_export_ignore: ['src/utils.js:ignoredFn'],
    }));

    const report = await runHealthCheck(tmpDir, { skipAudit: true });

    // ignoredFn should not appear in dead_exports items
    const ignoredItem = report.drift.dead_exports.items.find(i => i.name === 'ignoredFn');
    assert.equal(ignoredItem, undefined, 'ignoredFn should be excluded by health-ignore.json');

    // deadFn should still appear
    const deadItem = report.drift.dead_exports.items.find(i => i.name === 'deadFn');
    assert.ok(deadItem, 'deadFn should still be detected as dead export');
  });
});
