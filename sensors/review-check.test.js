'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { runReviewCheck, formatReviewCheckFeedback } = require('./review-check.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deep-work-review-check-test-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFitnessJson(dir, data) {
  const reviewDir = path.join(dir, '.deep-review');
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, 'fitness.json'), JSON.stringify(data));
}

function writeConfigJson(dir, data) {
  const configDir = path.join(dir, '.deep-work');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(data));
}

// Test 1: Returns not_applicable when all sources missing (generic + no fitness)
test('runReviewCheck: generic topology + no fitness → not_applicable', () => {
  const dir = makeTempDir();
  try {
    const result = runReviewCheck(dir, { topology: 'generic' });
    assert.equal(result.status, 'not_applicable');
    assert.equal(result.alwaysOn, null);
    assert.equal(result.fitness, null);
    assert.deepEqual(result.violations, []);
  } finally {
    cleanupDir(dir);
  }
});

// Test 2: Runs always-on layer with topology guides (nextjs-app)
test('runReviewCheck: nextjs-app topology → always-on guides returned', () => {
  const dir = makeTempDir();
  try {
    const result = runReviewCheck(dir, { topology: 'nextjs-app' });
    assert.equal(result.status, 'completed');
    assert.ok(result.alwaysOn !== null, 'alwaysOn should not be null');
    assert.ok(Array.isArray(result.alwaysOn.guides), 'guides should be an array');
    assert.ok(result.alwaysOn.guides.length > 0, 'guides should have entries');
    assert.equal(result.alwaysOn.topology, 'Next.js App Router');
    // No fitness.json → fitness should be null
    assert.equal(result.fitness, null);
  } finally {
    cleanupDir(dir);
  }
});

// Test 3: Runs fitness layer when fitness.json exists with a file-metric rule that triggers
test('runReviewCheck: fitness.json with file-metric rule → fitness violations collected', () => {
  const dir = makeTempDir();
  try {
    // Create a file that will violate the max line-count rule
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    // Write a file with 5 lines; our rule says max 2 → violation
    const lines = Array.from({ length: 5 }, (_, i) => `const x${i} = ${i};`);
    fs.writeFileSync(path.join(srcDir, 'big.js'), lines.join('\n'));

    writeFitnessJson(dir, {
      version: 1,
      rules: [
        {
          id: 'max-file-lines',
          type: 'file-metric',
          check: 'line-count',
          max: 2,
          include: 'src/**/*.js',
          severity: 'advisory',
        },
      ],
    });

    const result = runReviewCheck(dir, { topology: 'generic' });
    assert.equal(result.status, 'completed');
    assert.ok(result.fitness !== null, 'fitness should not be null');
    assert.ok(result.fitness.total >= 1, 'should have at least 1 rule');
    assert.ok(result.violations.length > 0, 'should have violations');
    assert.equal(result.violations[0].source, 'fitness');
    assert.equal(result.violations[0].ruleId, 'max-file-lines');
    assert.equal(result.violations[0].severity, 'advisory');
  } finally {
    cleanupDir(dir);
  }
});

// Test 4: Skips fitness layer when fitness.json absent
test('runReviewCheck: nextjs-app + no fitness.json → fitness is null', () => {
  const dir = makeTempDir();
  try {
    const result = runReviewCheck(dir, { topology: 'nextjs-app' });
    assert.equal(result.status, 'completed');
    assert.ok(result.alwaysOn !== null, 'alwaysOn should be present');
    assert.equal(result.fitness, null, 'fitness should be null when no fitness.json');
  } finally {
    cleanupDir(dir);
  }
});

// Test 5: Returns disabled when config.json has review_check: false
test('runReviewCheck: config.json review_check=false → disabled', () => {
  const dir = makeTempDir();
  try {
    writeConfigJson(dir, { review_check: false });
    const result = runReviewCheck(dir, { topology: 'nextjs-app' });
    assert.equal(result.status, 'disabled');
    assert.equal(result.alwaysOn, null);
    assert.equal(result.fitness, null);
    assert.deepEqual(result.violations, []);
  } finally {
    cleanupDir(dir);
  }
});

// Test 6: formatReviewCheckFeedback returns null for non-completed status
test('formatReviewCheckFeedback: disabled status → null', () => {
  const result = { status: 'disabled', alwaysOn: null, fitness: null, violations: [] };
  assert.equal(formatReviewCheckFeedback(result, 'auth-slice'), null);
});

// Test 7: formatReviewCheckFeedback returns null when no violations and no alwaysOn
test('formatReviewCheckFeedback: completed + no violations + no alwaysOn → null', () => {
  const result = { status: 'completed', alwaysOn: null, fitness: null, violations: [] };
  assert.equal(formatReviewCheckFeedback(result, 'auth-slice'), null);
});

// Test 8: formatReviewCheckFeedback formats violations with topology guides
test('formatReviewCheckFeedback: violations + alwaysOn → formatted string with [REVIEW-CHECK] and [TOPOLOGY GUIDES]', () => {
  const result = {
    status: 'completed',
    alwaysOn: {
      topology: 'Next.js App Router',
      guides: ['Minimize use client', 'Use Server Actions'],
    },
    fitness: null,
    violations: [
      {
        source: 'fitness',
        ruleId: 'max-file-lines',
        severity: 'advisory',
        details: [{ file: 'src/big.tsx', lines: 400, max: 300 }],
      },
    ],
    hasRequired: false,
  };

  const output = formatReviewCheckFeedback(result, 'dashboard-slice');

  assert.ok(output.includes('[REVIEW-CHECK]'), 'should include [REVIEW-CHECK] header');
  assert.ok(output.includes('dashboard-slice'), 'should include slice name');
  assert.ok(output.includes('[ADVISORY]'), 'should include severity tag');
  assert.ok(output.includes('max-file-lines'), 'should include rule ID');
  assert.ok(output.includes('[TOPOLOGY GUIDES]'), 'should include topology guides section');
  assert.ok(output.includes('Next.js App Router'), 'should include topology name');
  assert.ok(output.includes('Minimize use client'), 'should include first guide');
});

// Test 9: hasRequired is true when a required severity violation exists
test('runReviewCheck: required severity violation → hasRequired=true', () => {
  const dir = makeTempDir();
  try {
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const lines = Array.from({ length: 5 }, (_, i) => `const x${i} = ${i};`);
    fs.writeFileSync(path.join(srcDir, 'big.js'), lines.join('\n'));

    writeFitnessJson(dir, {
      version: 1,
      rules: [
        {
          id: 'max-file-lines-required',
          type: 'file-metric',
          check: 'line-count',
          max: 2,
          include: 'src/**/*.js',
          severity: 'required',
        },
      ],
    });

    const result = runReviewCheck(dir, { topology: 'generic' });
    assert.equal(result.status, 'completed');
    assert.equal(result.hasRequired, true, 'hasRequired should be true for required violations');
  } finally {
    cleanupDir(dir);
  }
});
