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
