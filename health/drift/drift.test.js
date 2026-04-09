'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { scanDeadExports, loadHealthIgnore } = require('./dead-export.js');

describe('scanDeadExports', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'de-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  /** helper: write a file relative to tmpDir */
  function write(relPath, content) {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  // 1. Detect unused named export
  it('detects an unused named export', async () => {
    write('src/utils.js', 'export function unusedHelper() {}\nexport function usedHelper() {}\n');
    write('src/main.js', "import { usedHelper } from './utils';\nusedHelper();\n");
    write('package.json', '{}');

    const result = await scanDeadExports(tmpDir, ['.js']);
    assert.equal(result.count, 1);
    assert.ok(result.deadExports.some(e => e.name === 'unusedHelper'));
  });

  // 2. All exports imported -> count 0
  it('returns count 0 when all exports are imported', async () => {
    write('src/a.js', 'export function foo() {}\nexport function bar() {}\n');
    write('src/b.js', "import { foo, bar } from './a';\nfoo(); bar();\n");
    write('package.json', '{}');

    const result = await scanDeadExports(tmpDir, ['.js']);
    assert.equal(result.count, 0);
    assert.deepEqual(result.deadExports, []);
  });

  // 3. Barrel file (index.js) exports excluded
  it('excludes barrel file (index.js) exports', async () => {
    write('src/index.js', "export { foo } from './foo';\nexport { bar } from './bar';\n");
    write('src/foo.js', 'export function foo() {}\n');
    write('src/bar.js', 'export function bar() {}\n');
    write('package.json', '{}');

    const result = await scanDeadExports(tmpDir, ['.js']);
    // barrel file exports should not be flagged even if not directly imported
    const barrelDead = result.deadExports.filter(e => e.file.includes('index.js'));
    assert.equal(barrelDead.length, 0);
  });

  // 4. Re-export (export { foo } from './bar') excluded
  it('excludes re-exports and counts them as usage', async () => {
    write('src/original.js', 'export function foo() {}\n');
    write('src/reexporter.js', "export { foo } from './original';\n");
    write('package.json', '{}');

    const result = await scanDeadExports(tmpDir, ['.js']);
    // foo is re-exported, so it should count as used
    const fooDead = result.deadExports.filter(e => e.name === 'foo' && e.file.includes('original.js'));
    assert.equal(fooDead.length, 0);
  });

  // 5. module.exports pattern handling
  it('handles module.exports pattern', async () => {
    write('lib/helper.js', "module.exports = { helperA, helperB };\nfunction helperA() {}\nfunction helperB() {}\n");
    write('lib/main.js', "const { helperA } = require('./helper');\nhelperA();\n");
    write('package.json', '{}');

    const result = await scanDeadExports(tmpDir, ['.js']);
    assert.ok(result.deadExports.some(e => e.name === 'helperB'));
    assert.ok(!result.deadExports.some(e => e.name === 'helperA'));
  });

  // 6. Ignore list applied (from .deep-work/health-ignore.json dead_export_ignore array)
  it('applies ignore list to skip specified exports', async () => {
    write('src/utils.js', 'export function ignoredExport() {}\nexport function deadExport() {}\n');
    write('package.json', '{}');

    const result = await scanDeadExports(tmpDir, ['.js'], {
      ignoreList: ['src/utils.js:ignoredExport'],
    });
    assert.ok(!result.deadExports.some(e => e.name === 'ignoredExport'));
    assert.ok(result.deadExports.some(e => e.name === 'deadExport'));
  });

  // 7. Empty project -> count 0
  it('returns count 0 for an empty project', async () => {
    write('package.json', '{}');

    const result = await scanDeadExports(tmpDir, ['.js']);
    assert.equal(result.count, 0);
    assert.deepEqual(result.deadExports, []);
  });

  // 8. Entry point excluded: exports from file specified in package.json main/bin are excluded
  it('excludes exports from package.json main/bin entry points', async () => {
    write('src/entry.js', 'export function start() {}\n');
    write('src/other.js', 'export function orphan() {}\n');
    write('package.json', JSON.stringify({ bin: { mycli: './src/entry.js' } }));

    const result = await scanDeadExports(tmpDir, ['.js']);
    const entryDead = result.deadExports.filter(e => e.file.includes('entry.js'));
    assert.equal(entryDead.length, 0, 'entry point exports should be excluded');
    // orphan is not entry point, so it should be flagged
    assert.ok(result.deadExports.some(e => e.name === 'orphan'));
  });

  // 9. Library project excluded: if package.json has main or exports field -> not_applicable
  it('returns not_applicable for library projects (package.json has exports field)', async () => {
    write('src/lib.js', 'export function libFunc() {}\n');
    write('package.json', JSON.stringify({ exports: { '.': './src/lib.js' } }));

    const result = await scanDeadExports(tmpDir, ['.js']);
    assert.equal(result.status, 'not_applicable');
    assert.equal(result.reason, 'library_project');
    assert.equal(result.count, 0);
    assert.deepEqual(result.deadExports, []);
  });

  // 10. health-ignore.json load: reads .deep-work/health-ignore.json and passes dead_export_ignore array
  it('loadHealthIgnore reads .deep-work/health-ignore.json', () => {
    const ignoreData = { dead_export_ignore: ['src/foo.js:bar', 'src/baz.js:qux'] };
    write('.deep-work/health-ignore.json', JSON.stringify(ignoreData));

    const result = loadHealthIgnore(tmpDir);
    assert.deepEqual(result.dead_export_ignore, ['src/foo.js:bar', 'src/baz.js:qux']);
  });
});

describe('loadHealthIgnore', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns empty object when health-ignore.json does not exist', () => {
    const result = loadHealthIgnore(tmpDir);
    assert.deepEqual(result, {});
  });
});

// ==========================================================================
// stale-config tests
// ==========================================================================
const { scanStaleConfig } = require('./stale-config.js');

describe('scanStaleConfig', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function write(relPath, content) {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  // 1. Broken package.json main path detected
  it('detects broken package.json main path', () => {
    write('package.json', JSON.stringify({ main: './dist/index.js' }));
    // dist/index.js does NOT exist

    const result = scanStaleConfig(tmpDir);
    assert.ok(result.count > 0, 'should detect broken main path');
    assert.ok(result.issues.some(i => i.file === 'package.json' && i.field === 'main'));
  });

  // 2. Valid paths -> pass (count 0)
  it('returns count 0 when all paths are valid', () => {
    write('dist/index.js', 'module.exports = {};');
    write('package.json', JSON.stringify({ main: './dist/index.js' }));

    const result = scanStaleConfig(tmpDir);
    assert.equal(result.count, 0);
  });

  // 3. Broken tsconfig.json paths detected
  it('detects broken tsconfig.json compilerOptions.paths', () => {
    write('tsconfig.json', JSON.stringify({
      compilerOptions: {
        paths: { '@utils/*': ['./src/utils/*'] }
      }
    }));
    // src/utils does NOT exist

    const result = scanStaleConfig(tmpDir);
    assert.ok(result.count > 0, 'should detect broken tsconfig paths');
    assert.ok(result.issues.some(i => i.file === 'tsconfig.json'));
  });

  // 4. No config files -> count 0
  it('returns count 0 when no config files exist', () => {
    // empty tmpDir, no package.json, no tsconfig, no eslintrc
    const result = scanStaleConfig(tmpDir);
    assert.equal(result.count, 0);
  });

  // 5. Broken .eslintrc extends (uninstalled plugin) detected
  it('detects broken .eslintrc extends with uninstalled plugin', () => {
    write('.eslintrc.json', JSON.stringify({
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
      plugins: ['@typescript-eslint']
    }));
    write('package.json', '{}');
    // node_modules/@typescript-eslint does NOT exist

    const result = scanStaleConfig(tmpDir);
    assert.ok(result.count > 0, 'should detect uninstalled eslint plugin');
    assert.ok(result.issues.some(i => i.file.includes('eslintrc')));
  });

  // 6. No .eslintrc -> skip
  it('skips eslintrc scan when no .eslintrc exists', () => {
    write('package.json', '{}');
    // no .eslintrc or .eslintrc.json

    const result = scanStaleConfig(tmpDir);
    // should not have any eslintrc-related issues
    const eslintIssues = result.issues.filter(i => i.file.includes('eslintrc'));
    assert.equal(eslintIssues.length, 0);
  });
});

// ==========================================================================
// dependency-vuln tests
// ==========================================================================
const { parseNpmAudit, scanDependencyVuln } = require('./dependency-vuln.js');
const { analyzeCoverageTrend } = require('./coverage-trend.js');

describe('parseNpmAudit', () => {
  // 1. npm audit JSON with high vuln -> parsed correctly
  it('parses npm audit JSON with high vulnerability', () => {
    const auditJson = JSON.stringify({
      vulnerabilities: {
        'lodash': { severity: 'high', name: 'lodash', range: '<4.17.21' },
        'express': { severity: 'moderate', name: 'express', range: '<4.18.0' },
        'minimist': { severity: 'low', name: 'minimist', range: '<1.2.6' }
      }
    });

    const result = parseNpmAudit(auditJson);
    assert.equal(result.high, 1);
    assert.equal(result.critical, 0);
    assert.ok(result.vulnerabilities.length > 0);
    assert.ok(!result.error);
  });

  // 2. Clean audit -> high: 0, critical: 0, empty vulnerabilities
  it('returns zeros for clean audit', () => {
    const auditJson = JSON.stringify({ vulnerabilities: {} });

    const result = parseNpmAudit(auditJson);
    assert.equal(result.high, 0);
    assert.equal(result.critical, 0);
    assert.deepEqual(result.vulnerabilities, []);
  });

  // 3. Malformed JSON -> error: true, graceful handling
  it('handles malformed JSON gracefully', () => {
    const result = parseNpmAudit('not valid json {{{');
    assert.equal(result.error, true);
    assert.deepEqual(result.vulnerabilities, []);
    assert.equal(result.high, 0);
    assert.equal(result.critical, 0);
  });
});

// ==========================================================================
// coverage-trend tests
// ==========================================================================

describe('analyzeCoverageTrend', () => {
  // 1. Degradation beyond threshold (5%p) -> degraded: true
  it('detects degradation beyond threshold', () => {
    const baseline = { coverage: { line: 80 } };
    const current = { line: 70 };

    const result = analyzeCoverageTrend(baseline, current);
    assert.equal(result.status, 'completed');
    assert.equal(result.baseline, 80);
    assert.equal(result.current, 70);
    assert.equal(result.delta, -10);
    assert.equal(result.degraded, true);
  });

  // 2. Within threshold -> degraded: false
  it('returns degraded false when within threshold', () => {
    const baseline = { coverage: { line: 80 } };
    const current = { line: 77 };

    const result = analyzeCoverageTrend(baseline, current);
    assert.equal(result.status, 'completed');
    assert.equal(result.delta, -3);
    assert.equal(result.degraded, false);
  });

  // 3. Null baseline -> status: 'not_applicable'
  it('returns not_applicable when baseline is null', () => {
    const result = analyzeCoverageTrend(null, { line: 80 });
    assert.equal(result.status, 'not_applicable');
    assert.equal(result.baseline, null);
    assert.equal(result.current, null);
    assert.equal(result.delta, null);
    assert.equal(result.degraded, false);
  });

  // 4. Baseline with no coverage field -> status: 'not_applicable'
  it('returns not_applicable when baseline has no coverage field', () => {
    const result = analyzeCoverageTrend({}, { line: 80 });
    assert.equal(result.status, 'not_applicable');
    assert.equal(result.baseline, null);
    assert.equal(result.degraded, false);
  });

  // 5. Improvement -> degraded: false, positive delta
  it('returns degraded false with positive delta on improvement', () => {
    const baseline = { coverage: { line: 70 } };
    const current = { line: 85 };

    const result = analyzeCoverageTrend(baseline, current);
    assert.equal(result.status, 'completed');
    assert.equal(result.delta, 15);
    assert.ok(result.delta > 0, 'delta should be positive');
    assert.equal(result.degraded, false);
  });
});
