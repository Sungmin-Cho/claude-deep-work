#!/usr/bin/env node
'use strict';

const RISK_CLASSES = new Set(['low', 'medium', 'high', 'critical']);

function usage(message) {
  const error = new Error(message);
  error.code = 'usage';
  throw error;
}

function parseArgs(argv) {
  const out = { spec: null, plan: null, riskClass: null };
  const seen = new Set();
  const map = new Map([['--spec', 'spec'], ['--plan', 'plan'], ['--risk-class', 'riskClass']]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const key = map.get(flag);
    if (!key) usage(`unknown flag: ${flag}`);
    if (seen.has(flag)) usage(`duplicate flag: ${flag}`);
    seen.add(flag);
    const value = argv[++i];
    if (!value || value.startsWith('--')) usage(`missing value: ${flag}`);
    out[key] = value;
  }
  if (!out.spec || !out.riskClass) usage('--spec and --risk-class are required');
  if (!RISK_CLASSES.has(out.riskClass)) usage('invalid --risk-class');
  return out;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const fs = deps.fs || require('node:fs');
  const runtime = deps.runtime || require('../runtime/contract-runtime.js');
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  let output;
  let exitCode = 2;
  try {
    const args = parseArgs(argv);
    const spec = runtime.parseSpecMarkdown(fs.readFileSync(args.spec, 'utf8'), { path: args.spec });
    const plan = args.plan
      ? runtime.parsePlanContractMarkdown(fs.readFileSync(args.plan, 'utf8'), {
        path: args.plan,
        specIndex: runtime.validateSpecContract(spec, { riskClass: args.riskClass }).index,
      })
      : null;
    const result = runtime.validateSpecContract(spec, {
      riskClass: args.riskClass,
      ...(plan ? { slices: plan.slices } : {}),
    });
    output = {
      schema_version: 1,
      pass: result.pass,
      spec_id: spec.spec_id,
      spec_sha256: runtime.specContractDigest(spec),
      risk_class: args.riskClass,
      errors: result.errors,
      warnings: result.warnings,
      requirement_coverage: result.requirementCoverage,
      failure_matrix_coverage: result.failureMatrixCoverage,
    };
    exitCode = result.pass ? 0 : 1;
  } catch (error) {
    output = { schema_version: 1, pass: false, errors: [{ code: error.code || 'input-error',
      message: error.message }], warnings: [] };
    stderr.write(`${error.code || 'input-error'}: ${error.message}\n`);
  }
  stdout.write(`${JSON.stringify(output)}\n`);
  return exitCode;
}

if (require.main === module) process.exitCode = main();

module.exports = { parseArgs, main };
