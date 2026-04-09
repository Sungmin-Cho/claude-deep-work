'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectSensorsForFiles, formatFeedback, buildSensorResult } = require('./run-sensors.js');

// ── selectSensorsForFiles ──────────────────────────────────────────────────────

test('selectSensorsForFiles: [src/auth.ts] with TS+Python ecosystems → selects only TS', () => {
  const changedFiles = ['src/auth.ts'];
  const ecosystems = [
    {
      name: 'typescript',
      file_extensions: ['.ts', '.tsx'],
      sensors: { lint: { status: 'available' }, typecheck: { status: 'available' } },
    },
    {
      name: 'python',
      file_extensions: ['.py'],
      sensors: { lint: { status: 'available' } },
    },
  ];

  const result = selectSensorsForFiles(changedFiles, ecosystems);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'typescript');
});

test('selectSensorsForFiles: [src/auth.ts, app.py] → selects both TS and Python', () => {
  const changedFiles = ['src/auth.ts', 'app.py'];
  const ecosystems = [
    {
      name: 'typescript',
      file_extensions: ['.ts', '.tsx'],
      sensors: { lint: { status: 'available' } },
    },
    {
      name: 'python',
      file_extensions: ['.py'],
      sensors: { lint: { status: 'available' } },
    },
  ];

  const result = selectSensorsForFiles(changedFiles, ecosystems);

  assert.equal(result.length, 2);
  const names = result.map(e => e.name);
  assert.ok(names.includes('typescript'));
  assert.ok(names.includes('python'));
});

test('selectSensorsForFiles: Python with typecheck not_installed → still selected (status preserved)', () => {
  const changedFiles = ['app.py'];
  const ecosystems = [
    {
      name: 'python',
      file_extensions: ['.py'],
      sensors: {
        lint: { status: 'available' },
        typecheck: { status: 'not_installed' },
      },
    },
  ];

  const result = selectSensorsForFiles(changedFiles, ecosystems);

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'python');
  assert.equal(result[0].sensors.typecheck.status, 'not_installed');
});

test('selectSensorsForFiles: selects ecosystem when only config file changed', () => {
  const ecosystems = [
    { name: 'typescript', file_extensions: ['.ts', '.tsx'], sensors: { lint: { status: 'available' } } },
  ];
  const selected = selectSensorsForFiles(['tsconfig.json'], ecosystems);
  assert.strictEqual(selected.length, 1);
  assert.strictEqual(selected[0].name, 'typescript');
});

// ── formatFeedback ─────────────────────────────────────────────────────────────

test('formatFeedback: error result → contains "[SENSOR_FAIL]"', () => {
  const sensorResult = {
    sensor: 'eslint',
    type: 'lint',
    gate: 'required',
    status: 'fail',
    errors: 2,
    warnings: 0,
    items: [
      { file: 'src/auth.ts', line: 10, rule: 'no-unused-vars', severity: 'error', message: "Variable 'x' is declared but never used.", fix: '' },
      { file: 'src/auth.ts', line: 20, rule: 'no-console', severity: 'error', message: 'Unexpected console statement.', fix: '' },
    ],
    summary: '2 errors, 0 warnings',
  };

  const output = formatFeedback(sensorResult, 1, 3);

  assert.ok(output.includes('[SENSOR_FAIL]'), `Expected "[SENSOR_FAIL]" in: ${output}`);
});

test('formatFeedback: round 2/3 → contains "correction round 2/3"', () => {
  const sensorResult = {
    sensor: 'tsc',
    type: 'typecheck',
    gate: 'required',
    status: 'fail',
    errors: 1,
    warnings: 0,
    items: [
      { file: 'src/auth.ts', line: 5, rule: 'TS2304', severity: 'error', message: "Cannot find name 'foo'.", fix: 'Import or declare the missing name' },
    ],
    summary: '1 errors, 0 warnings',
  };

  const output = formatFeedback(sensorResult, 2, 3);

  assert.ok(output.includes('correction round 2/3'), `Expected "correction round 2/3" in: ${output}`);
});

test('formatFeedback: items with fix → contains "FIX:"', () => {
  const sensorResult = {
    sensor: 'eslint',
    type: 'lint',
    gate: 'required',
    status: 'fail',
    errors: 1,
    warnings: 0,
    items: [
      { file: 'src/auth.ts', line: 10, rule: 'no-unused-vars', severity: 'error', message: "Variable 'x' unused.", fix: 'Auto-fixable: apply eslint --fix' },
    ],
    summary: '1 errors, 0 warnings',
  };

  const output = formatFeedback(sensorResult, 1, 3);

  assert.ok(output.includes('FIX:'), `Expected "FIX:" in: ${output}`);
});

// ── buildSensorResult ──────────────────────────────────────────────────────────

test('buildSensorResult: lint+typecheck both not_installed → all_not_applicable=true', () => {
  const eco = {
    name: 'typescript',
    sensors: {
      lint: { status: 'not_installed', cmd: 'npx eslint', parser: 'eslint' },
      typecheck: { status: 'not_installed', cmd: 'npx tsc --noEmit', parser: 'tsc' },
    },
  };

  const result = buildSensorResult(eco);

  assert.equal(result.all_not_applicable, true);
});

test('buildSensorResult: lint=available → all_not_applicable=false', () => {
  const eco = {
    name: 'typescript',
    sensors: {
      lint: { status: 'available', cmd: 'npx eslint', parser: 'eslint' },
      typecheck: { status: 'not_installed', cmd: 'npx tsc --noEmit', parser: 'tsc' },
    },
  };

  const result = buildSensorResult(eco);

  assert.equal(result.all_not_applicable, false);
});
