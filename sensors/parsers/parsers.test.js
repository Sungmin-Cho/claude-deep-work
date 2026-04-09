'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseGenericJson } = require('./generic-json.js');
const { parseGenericLine } = require('./generic-line.js');
const { parseEslint } = require('./eslint-parser.js');
const { parseTsc } = require('./tsc-parser.js');
const { parseRuff } = require('./ruff-parser.js');
const { parseStryker } = require('./stryker-parser.js');
const { parseDotnet } = require('./dotnet-parser.js');
const { parseClang } = require('./clang-parser.js');

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

// ── eslint-parser tests ───────────────────────────────────────────────────────

test('eslint: JSON with 2 files, errors + warnings + auto-fixable', () => {
  const raw = JSON.stringify([
    {
      filePath: 'src/auth.ts',
      messages: [
        { ruleId: 'no-unused-vars', severity: 2, message: "Variable 'x' is declared but never used.", line: 10, column: 5, fix: { text: '', range: [0, 1] } },
        { ruleId: 'no-console', severity: 1, message: 'Unexpected console statement.', line: 20, column: 3 },
      ],
      errorCount: 1,
      warningCount: 1,
    },
    {
      filePath: 'src/utils.ts',
      messages: [
        { ruleId: 'eqeqeq', severity: 2, message: "Expected '===' and instead saw '=='.", line: 5, column: 8 },
      ],
      errorCount: 1,
      warningCount: 0,
    },
  ]);

  const result = parseEslint(raw);

  assert.equal(result.sensor, 'eslint');
  assert.equal(result.type, 'lint');
  assert.equal(result.gate, 'required');
  assert.equal(result.status, 'fail');
  assert.equal(result.errors, 2);
  assert.equal(result.warnings, 1);
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].file, 'src/auth.ts');
  assert.equal(result.items[0].line, 10);
  assert.equal(result.items[0].rule, 'no-unused-vars');
  assert.equal(result.items[0].severity, 'error');
  assert.ok(result.items[0].fix.includes('Auto-fixable'));
  assert.equal(result.items[1].severity, 'warning');
  assert.equal(result.items[1].fix, '');
});

test('eslint: empty results → pass', () => {
  const raw = JSON.stringify([
    { filePath: 'src/clean.ts', messages: [], errorCount: 0, warningCount: 0 },
  ]);

  const result = parseEslint(raw);

  assert.equal(result.sensor, 'eslint');
  assert.equal(result.status, 'pass');
  assert.equal(result.errors, 0);
  assert.equal(result.warnings, 0);
  assert.equal(result.items.length, 0);
});

// ── tsc-parser tests ──────────────────────────────────────────────────────────

test('tsc: two file(line,col): error TSXXXX: lines → 2 errors with correct rule extraction', () => {
  const raw = [
    'src/auth.ts(42,5): error TS7006: Parameter \'x\' implicitly has an \'any\' type.',
    'src/utils.ts(10,3): error TS2304: Cannot find name \'foo\'.',
  ].join('\n');

  const result = parseTsc(raw);

  assert.equal(result.sensor, 'tsc');
  assert.equal(result.type, 'typecheck');
  assert.equal(result.gate, 'required');
  assert.equal(result.status, 'fail');
  assert.equal(result.errors, 2);
  assert.equal(result.warnings, 0);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].file, 'src/auth.ts');
  assert.equal(result.items[0].line, 42);
  assert.equal(result.items[0].rule, 'TS7006');
  assert.equal(result.items[0].severity, 'error');
  assert.ok(result.items[0].fix.includes('Add explicit type annotation'));
  assert.equal(result.items[1].file, 'src/utils.ts');
  assert.equal(result.items[1].rule, 'TS2304');
  assert.ok(result.items[1].fix.includes('Import or declare the missing name'));
});

test('tsc: empty output → pass', () => {
  const result = parseTsc('');

  assert.equal(result.sensor, 'tsc');
  assert.equal(result.status, 'pass');
  assert.equal(result.errors, 0);
  assert.equal(result.items.length, 0);
});

// ── ruff-parser tests ─────────────────────────────────────────────────────────

test('ruff: JSON with code, filename, location.row, fix.message', () => {
  const raw = JSON.stringify([
    {
      code: 'F401',
      message: "'os' imported but unused",
      filename: 'src/utils.py',
      location: { row: 1, column: 0 },
      fix: { message: 'Remove unused import: `os`', applicability: 'safe' },
    },
    {
      code: 'E501',
      message: 'Line too long (100 > 79 characters)',
      filename: 'src/utils.py',
      location: { row: 15, column: 79 },
      fix: null,
    },
  ]);

  const result = parseRuff(raw);

  assert.equal(result.sensor, 'ruff');
  assert.equal(result.type, 'lint');
  assert.equal(result.gate, 'required');
  assert.equal(result.status, 'fail');
  assert.equal(result.errors, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].file, 'src/utils.py');
  assert.equal(result.items[0].line, 1);
  assert.equal(result.items[0].rule, 'F401');
  assert.equal(result.items[0].severity, 'error');
  assert.ok(result.items[0].fix.includes('Remove unused import'));
  assert.equal(result.items[1].fix, '');
});

// ── stryker-parser tests ──────────────────────────────────────────────────────

test('stryker: 3 mutants (Killed, Survived, NoCoverage) → correct counts and score', () => {
  const raw = JSON.stringify({
    files: {
      'src/math.js': {
        mutants: [
          { id: '1', mutatorName: 'ArithmeticOperator', replacement: '-', status: 'Killed', location: { start: { line: 5, column: 10 } } },
          { id: '2', mutatorName: 'ArithmeticOperator', replacement: '+', status: 'Survived', location: { start: { line: 8, column: 5 } } },
          { id: '3', mutatorName: 'BooleanLiteral', replacement: 'false', status: 'NoCoverage', location: { start: { line: 12, column: 3 } } },
        ],
      },
    },
  });

  const result = parseStryker(raw);

  assert.equal(result.total_mutants, 3);
  assert.equal(result.killed, 1);
  assert.equal(result.survived, 1);
  assert.equal(result.no_coverage, 1);
  assert.equal(result.equivalent, 0);
  assert.equal(result.timeout, 0);
  // score = killed / (killed + survived) * 100 = 1/2*100 = 50
  assert.equal(result.score, 50);
  assert.equal(result.survived_details.length, 1);
  assert.equal(result.survived_details[0].file, 'src/math.js');
  assert.equal(result.survived_details[0].line, 8);
  assert.equal(result.survived_details[0].mutator, 'ArithmeticOperator');
});

test('stryker: NoCoverage excluded from score denominator', () => {
  const raw = JSON.stringify({
    files: {
      'src/a.js': {
        mutants: [
          { id: '1', mutatorName: 'ArithmeticOperator', replacement: '-', status: 'Killed', location: { start: { line: 1, column: 1 } } },
          { id: '2', mutatorName: 'ArithmeticOperator', replacement: '+', status: 'Killed', location: { start: { line: 2, column: 1 } } },
          { id: '3', mutatorName: 'BooleanLiteral', replacement: 'false', status: 'NoCoverage', location: { start: { line: 3, column: 1 } } },
          { id: '4', mutatorName: 'BooleanLiteral', replacement: 'true', status: 'NoCoverage', location: { start: { line: 4, column: 1 } } },
        ],
      },
    },
  });

  const result = parseStryker(raw);

  assert.equal(result.killed, 2);
  assert.equal(result.survived, 0);
  assert.equal(result.no_coverage, 2);
  // score = 2 / (2 + 0) * 100 = 100 (NoCoverage excluded from denominator)
  assert.equal(result.score, 100);
});

test('stryker: StringLiteral mutant on console.log line → possibly_equivalent tag', () => {
  const raw = JSON.stringify({
    files: {
      'src/logger.js': {
        source: 'console.log("debug info");\nconsole.error("oops");\nconst x = 1 + 1;',
        mutants: [
          { id: '1', mutatorName: 'StringLiteral', replacement: '""', status: 'Survived', location: { start: { line: 1, column: 12 } } },
          { id: '2', mutatorName: 'StringLiteral', replacement: '""', status: 'NoCoverage', location: { start: { line: 2, column: 14 } } },
          { id: '3', mutatorName: 'ArithmeticOperator', replacement: '-', status: 'Survived', location: { start: { line: 3, column: 10 } } },
        ],
      },
    },
  });

  const result = parseStryker(raw);

  // id:1 StringLiteral on line 1 (console.log) → possibly_equivalent
  const detail1 = result.survived_details.find(d => d.id === '1');
  assert.ok(detail1, 'survived mutant id:1 should be in survived_details');
  assert.equal(detail1.tag, 'possibly_equivalent');

  // id:3 ArithmeticOperator on line 3 (no console) → no special tag
  const detail3 = result.survived_details.find(d => d.id === '3');
  assert.ok(detail3, 'survived mutant id:3 should be in survived_details');
  assert.notEqual(detail3.tag, 'possibly_equivalent');
});

test('stryker: all Killed → score 100, empty survived_details', () => {
  const raw = JSON.stringify({
    files: {
      'src/clean.js': {
        mutants: [
          { id: '1', mutatorName: 'ArithmeticOperator', replacement: '-', status: 'Killed', location: { start: { line: 1, column: 1 } } },
          { id: '2', mutatorName: 'ArithmeticOperator', replacement: '+', status: 'Killed', location: { start: { line: 2, column: 1 } } },
        ],
      },
    },
  });

  const result = parseStryker(raw);

  assert.equal(result.score, 100);
  assert.equal(result.survived_details.length, 0);
  assert.equal(result.survived, 0);
  assert.equal(result.killed, 2);
});

// ── dotnet/clang delegation tests ────────────────────────────────────────────

test('dotnet: delegates to generic-line and sets correct sensor name', () => {
  const raw = 'src/Program.cs(10,5): error CS0103: The name \'foo\' does not exist in the current context';

  const result = parseDotnet(raw);

  assert.equal(result.sensor, 'dotnet');
  assert.equal(result.type, 'typecheck');
  assert.equal(result.status, 'fail');
  assert.equal(result.errors, 1);
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].message.length > 0);
});

test('clang: delegates to generic-line and sets correct sensor name', () => {
  const raw = 'src/main.cpp:25:3: warning: unused variable \'x\' [-Wunused-variable]';

  const result = parseClang(raw);

  assert.equal(result.sensor, 'clang-tidy');
  assert.equal(result.type, 'lint');
  assert.equal(result.status, 'pass');
  assert.equal(result.warnings, 1);
  assert.equal(result.items[0].severity, 'warning');
});
