'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { checkFileMetric } = require('./rule-checkers/file-metric-checker.js');
const { checkForbiddenPattern } = require('./rule-checkers/pattern-checker.js');
const { checkStructure } = require('./rule-checkers/structure-checker.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fitness-'));
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function makeLongFile(lines) {
  return Array.from({ length: lines }, (_, i) => `// line ${i + 1}`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// file-metric-checker
// ---------------------------------------------------------------------------

describe('checkFileMetric', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects files exceeding 500-line limit', () => {
    writeFile(tmpDir, 'src/big.js', makeLongFile(501));
    writeFile(tmpDir, 'src/small.js', makeLongFile(100));

    const rule = { id: 'max-lines', type: 'file-metric', check: 'line-count', max: 500, include: 'src/**/*.js', severity: 'advisory' };
    const result = checkFileMetric(tmpDir, rule);

    assert.equal(result.ruleId, 'max-lines');
    assert.equal(result.passed, false);
    assert.equal(result.violations.length, 1);
    assert.match(result.violations[0].file, /big\.js$/);
    assert.equal(result.violations[0].lines, 501);
    assert.equal(result.violations[0].max, 500);
  });

  it('passes when all files are within limit', () => {
    writeFile(tmpDir, 'src/a.js', makeLongFile(200));
    writeFile(tmpDir, 'src/b.js', makeLongFile(499));

    const rule = { id: 'max-lines', type: 'file-metric', check: 'line-count', max: 500, include: 'src/**/*.js', severity: 'advisory' };
    const result = checkFileMetric(tmpDir, rule);

    assert.equal(result.ruleId, 'max-lines');
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
  });
});

// ---------------------------------------------------------------------------
// pattern-checker
// ---------------------------------------------------------------------------

describe('checkForbiddenPattern', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects forbidden pattern (console.log in src/)', () => {
    writeFile(tmpDir, 'src/app.js', 'const x = 1;\nconsole.log("debug");\nreturn x;\n');

    const rule = { id: 'no-console', type: 'forbidden-pattern', pattern: 'console\\.(log|debug)', include: 'src/**/*.js', severity: 'advisory' };
    const result = checkForbiddenPattern(tmpDir, rule);

    assert.equal(result.ruleId, 'no-console');
    assert.equal(result.passed, false);
    assert.equal(result.violations.length, 1);
    assert.match(result.violations[0].file, /app\.js$/);
    assert.equal(result.violations[0].line, 2);
    assert.match(result.violations[0].match, /console\.log/);
  });

  it('respects exclude pattern (*.test.* files skipped)', () => {
    writeFile(tmpDir, 'src/app.test.js', 'console.log("in test");\n');

    const rule = { id: 'no-console', type: 'forbidden-pattern', pattern: 'console\\.(log|debug)', include: 'src/**/*.js', exclude: '**/*.test.*', severity: 'advisory' };
    const result = checkForbiddenPattern(tmpDir, rule);

    assert.equal(result.ruleId, 'no-console');
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
  });
});

// ---------------------------------------------------------------------------
// structure-checker
// ---------------------------------------------------------------------------

describe('checkStructure', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('detects non-colocated tests (test in tests/ dir, not src/)', () => {
    writeFile(tmpDir, 'src/utils.ts', 'export function add(a, b) { return a + b; }');
    writeFile(tmpDir, 'tests/utils.test.ts', 'import { add } from "../src/utils";');

    const rule = { id: 'colocated', type: 'structure', check: 'colocated', source: 'src/**/*.ts', test: 'src/**/*.test.ts', severity: 'advisory' };
    const result = checkStructure(tmpDir, rule);

    assert.equal(result.ruleId, 'colocated');
    assert.equal(result.passed, false);
    assert.equal(result.violations.length, 1);
    assert.match(result.violations[0].file, /utils\.ts$/);
    assert.ok(result.violations[0].message.includes('colocated'));
  });

  it('passes when tests are colocated (test in same dir as source)', () => {
    writeFile(tmpDir, 'src/utils.ts', 'export function add(a, b) { return a + b; }');
    writeFile(tmpDir, 'src/utils.test.ts', 'import { add } from "./utils";');

    const rule = { id: 'colocated', type: 'structure', check: 'colocated', source: 'src/**/*.ts', test: 'src/**/*.test.ts', severity: 'advisory' };
    const result = checkStructure(tmpDir, rule);

    assert.equal(result.ruleId, 'colocated');
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
  });
});
