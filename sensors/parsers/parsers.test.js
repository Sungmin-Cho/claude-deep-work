import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenericJson } from './generic-json.js';
import { parseGenericLine } from './generic-line.js';

// ── generic-json tests ────────────────────────────────────────────────────────

test('generic-json: flat array of {file,line,message,severity} objects → correct items extraction', () => {
  const raw = JSON.stringify([
    { file: 'src/auth.ts', line: 42, message: "Variable 'tempToken' is declared but never used.", severity: 'error' },
    { file: 'src/utils.ts', line: 10, message: 'Prefer const.', severity: 'warning' },
  ]);

  const result = parseGenericJson(raw, 'lint', 'required');

  assert.equal(result.sensor, 'generic-json');
  assert.equal(result.type, 'lint');
  assert.equal(result.gate, 'required');
  assert.equal(result.status, 'fail');
  assert.equal(result.errors, 1);
  assert.equal(result.warnings, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].file, 'src/auth.ts');
  assert.equal(result.items[0].line, 42);
  assert.equal(result.items[0].severity, 'error');
  assert.equal(result.items[0].message, "Variable 'tempToken' is declared but never used.");
  assert.equal(result.summary, '1 errors, 1 warnings');
});

test('generic-json: ESLint-style nested {results:[{filePath,messages:[{ruleId,severity,message,line}]}]} → correct extraction', () => {
  const raw = JSON.stringify({
    results: [
      {
        filePath: '/project/src/auth.ts',
        messages: [
          { ruleId: 'no-unused-vars', severity: 2, message: "Variable 'tempToken' is declared but never used.", line: 42 },
          { ruleId: 'no-console', severity: 1, message: 'Unexpected console statement.', line: 7 },
        ],
      },
      {
        filePath: '/project/src/utils.ts',
        messages: [],
      },
    ],
  });

  const result = parseGenericJson(raw, 'lint', 'required');

  assert.equal(result.sensor, 'generic-json');
  assert.equal(result.status, 'fail');
  assert.equal(result.errors, 1);
  assert.equal(result.warnings, 1);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].file, '/project/src/auth.ts');
  assert.equal(result.items[0].line, 42);
  assert.equal(result.items[0].rule, 'no-unused-vars');
  assert.equal(result.items[0].severity, 'error');
  assert.equal(result.items[0].message, "Variable 'tempToken' is declared but never used.");
  assert.equal(result.items[1].severity, 'warning');
  assert.equal(result.items[1].rule, 'no-console');
});

test('generic-json: empty array → status "pass", 0 errors', () => {
  const raw = JSON.stringify([]);

  const result = parseGenericJson(raw, 'lint', 'advisory');

  assert.equal(result.status, 'pass');
  assert.equal(result.errors, 0);
  assert.equal(result.warnings, 0);
  assert.equal(result.items.length, 0);
  assert.equal(result.summary, '0 errors, 0 warnings');
});

test('generic-json: invalid JSON → status "fail" with parse error message', () => {
  const raw = 'this is not json {{{';

  const result = parseGenericJson(raw, 'lint', 'required');

  assert.equal(result.sensor, 'generic-json');
  assert.equal(result.status, 'fail');
  assert.equal(result.errors, 1);
  assert.ok(result.items.length === 1);
  assert.ok(result.items[0].message.toLowerCase().includes('parse') || result.items[0].message.toLowerCase().includes('json') || result.items[0].message.toLowerCase().includes('invalid'));
});

// ── generic-line tests ────────────────────────────────────────────────────────

test('generic-line: file:line:col: severity: message format → correct extraction', () => {
  const raw = 'src/auth.ts:42:5: error TS2304: Cannot find name "foo"';

  const result = parseGenericLine(raw, 'typecheck', 'required');

  assert.equal(result.sensor, 'generic-line');
  assert.equal(result.type, 'typecheck');
  assert.equal(result.gate, 'required');
  assert.equal(result.status, 'fail');
  assert.equal(result.errors, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].file, 'src/auth.ts');
  assert.equal(result.items[0].line, 42);
  assert.equal(result.items[0].severity, 'error');
  assert.ok(result.items[0].message.includes('TS2304') || result.items[0].message.includes('Cannot find name'));
});

test('generic-line: file:line: message format (no column, no severity keyword) → defaults to error', () => {
  const raw = 'src/utils.py:15: unused import os';

  const result = parseGenericLine(raw, 'lint', 'advisory');

  assert.equal(result.sensor, 'generic-line');
  assert.equal(result.status, 'fail');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].file, 'src/utils.py');
  assert.equal(result.items[0].line, 15);
  assert.equal(result.items[0].severity, 'error');
  assert.ok(result.items[0].message.includes('unused import os'));
});

test('generic-line: empty string → status "pass"', () => {
  const raw = '';

  const result = parseGenericLine(raw, 'lint', 'advisory');

  assert.equal(result.sensor, 'generic-line');
  assert.equal(result.status, 'pass');
  assert.equal(result.errors, 0);
  assert.equal(result.warnings, 0);
  assert.equal(result.items.length, 0);
});

test('generic-line: message containing colons → message captures everything after severity', () => {
  const raw = 'src/a.ts:10:1: error: Expected type: string but got: number';

  const result = parseGenericLine(raw, 'typecheck', 'required');

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].file, 'src/a.ts');
  assert.equal(result.items[0].line, 10);
  assert.equal(result.items[0].severity, 'error');
  assert.equal(result.items[0].message, 'Expected type: string but got: number');
});
