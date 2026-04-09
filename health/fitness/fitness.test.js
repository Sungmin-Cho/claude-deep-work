'use strict';
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { checkFileMetric } = require('./rule-checkers/file-metric-checker.js');
const { checkForbiddenPattern } = require('./rule-checkers/pattern-checker.js');
const { checkStructure } = require('./rule-checkers/structure-checker.js');
const { checkDependency } = require('./rule-checkers/dependency-checker.js');
const { validateFitness } = require('./fitness-validator.js');
const { generateFitnessRules, formatFitnessJson, isJsTsProject } = require('./fitness-generator.js');

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

// ---------------------------------------------------------------------------
// dependency-checker
// ---------------------------------------------------------------------------

describe('checkDependency', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('dep-cruiser not installed + required severity → required_missing, passed: false', () => {
    const rule = { id: 'no-circular', type: 'dependency', severity: 'required' };
    const result = checkDependency(tmpDir, rule, { depCruiserAvailable: false });

    assert.equal(result.status, 'required_missing');
    assert.equal(result.passed, false);
  });

  it('dep-cruiser not installed + advisory severity → not_applicable, passed: true', () => {
    const rule = { id: 'no-circular', type: 'dependency', severity: 'advisory' };
    const result = checkDependency(tmpDir, rule, { depCruiserAvailable: false });

    assert.equal(result.status, 'not_applicable');
    assert.equal(result.passed, true);
  });
});

// ---------------------------------------------------------------------------
// fitness-validator
// ---------------------------------------------------------------------------

describe('validateFitness', () => {
  it('unsupported version (99) → valid: false, error mentions "version"', () => {
    const parsed = { version: 99, rules: [] };
    const result = validateFitness(parsed);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.toLowerCase().includes('version')));
  });

  it('rule missing required field (id) → valid: false, error mentions "id"', () => {
    const parsed = { version: 1, rules: [{ type: 'structure', severity: 'advisory' }] };
    const result = validateFitness(parsed);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('id')));
  });

  it('unknown type "custom" → valid: false, error mentions "custom"', () => {
    const parsed = { version: 1, rules: [{ id: 'r1', type: 'custom', severity: 'advisory' }] };
    const result = validateFitness(parsed);

    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('custom')));
  });

  it('valid fitness.json → valid: true, validRules.length: 1', () => {
    const parsed = {
      version: 1,
      rules: [{ id: 'max-lines', type: 'file-metric', severity: 'advisory', check: 'line-count', max: 500, include: 'src/**/*.js' }],
    };
    const result = validateFitness(parsed);

    assert.equal(result.valid, true);
    assert.equal(result.validRules.length, 1);
  });

  it('mixed valid+invalid rules → validRules has valid ones, skippedRules has invalid ones', () => {
    const parsed = {
      version: 1,
      rules: [
        { id: 'good-rule', type: 'structure', severity: 'advisory', check: 'colocated' },
        { type: 'file-metric', severity: 'advisory' }, // missing id
        { id: 'bad-type', type: 'custom', severity: 'advisory' }, // unknown type
      ],
    };
    const result = validateFitness(parsed);

    assert.equal(result.valid, false);
    assert.equal(result.validRules.length, 1);
    assert.equal(result.validRules[0].id, 'good-rule');
    assert.equal(result.skippedRules.length, 2);
  });
});

// ---------------------------------------------------------------------------
// fitness-generator
// ---------------------------------------------------------------------------

describe('generateFitnessRules', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('JS/TS project includes no-circular-deps and max-file-lines', () => {
    writeFile(tmpDir, 'package.json', '{}');
    writeFile(tmpDir, 'src/index.js', '');

    const rules = generateFitnessRules(tmpDir);
    const ids = rules.map(r => r.id);

    assert.ok(ids.includes('max-file-lines'), 'should include max-file-lines');
    assert.ok(ids.includes('no-circular-deps'), 'should include no-circular-deps');
  });

  it('layer structure detected → proposes layer-direction rule', () => {
    writeFile(tmpDir, 'package.json', '{}');
    writeFile(tmpDir, 'src/controllers/.keep', '');
    writeFile(tmpDir, 'src/services/.keep', '');
    writeFile(tmpDir, 'src/repositories/.keep', '');

    const rules = generateFitnessRules(tmpDir);
    const ids = rules.map(r => r.id);

    assert.ok(ids.includes('layer-direction'), 'should include layer-direction');
  });

  it('config module detected → proposes no-direct-env-access rule', () => {
    writeFile(tmpDir, 'package.json', '{}');
    writeFile(tmpDir, 'src/config/db.js', '');

    const rules = generateFitnessRules(tmpDir);
    const ids = rules.map(r => r.id);

    assert.ok(ids.includes('no-direct-env-access'), 'should include no-direct-env-access');
  });

  it('empty project → max-file-lines + generic template rules (no dependency rules)', () => {
    // No package.json, no tsconfig.json, no src/ — truly empty
    // Topology detection yields "generic", which adds generic template rules
    const rules = generateFitnessRules(tmpDir);
    const ids = rules.map(r => r.id);

    assert.ok(ids.includes('max-file-lines'), 'should include max-file-lines');
    assert.ok(!ids.includes('no-circular-deps'), 'should NOT include no-circular-deps');
    // Universal max-file-lines + generic template rules (deduplicated by id)
    assert.ok(rules.length >= 1, 'should have at least max-file-lines');
  });

  it('non-JS/TS project → no-circular-deps EXCLUDED', () => {
    // Python project: no package.json, no tsconfig.json
    writeFile(tmpDir, 'requirements.txt', 'flask==2.0\n');
    writeFile(tmpDir, 'src/app.py', 'print("hello")\n');

    const rules = generateFitnessRules(tmpDir);
    const ids = rules.map(r => r.id);

    assert.ok(!ids.includes('no-circular-deps'), 'should NOT include no-circular-deps for non-JS/TS');
    assert.equal(isJsTsProject(tmpDir), false, 'should not detect as JS/TS project');
  });

  it('colocated tests detected → proposes colocated-tests rule', () => {
    writeFile(tmpDir, 'package.json', '{}');
    writeFile(tmpDir, 'src/utils.ts', 'export const x = 1;');
    writeFile(tmpDir, 'src/utils.test.ts', 'import { x } from "./utils";');

    const rules = generateFitnessRules(tmpDir);
    const ids = rules.map(r => r.id);

    assert.ok(ids.includes('colocated-tests'), 'should include colocated-tests');
  });
});
