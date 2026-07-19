#!/usr/bin/env node
'use strict';
const { collectCodebaseSignals, decideModelRouting, PHASES } = require('../runtime/model-routing-runtime.js');
const { detectRuntime } = require('./detect-runtime.js');

function parseArgs(argv) {
  const out = { root: process.cwd(), task: '', difficulty: null, runtime: null, pinnedRaw: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i] || out.root;
    else if (a === '--task') out.task = argv[++i] || '';
    else if (a === '--difficulty') out.difficulty = argv[++i] || null;
    else if (a === '--runtime') out.runtime = argv[++i] || null;
    else if (a === '--pinned') out.pinnedRaw = argv[++i] || '';
  }
  return out;
}

function parsePinned(raw, warnings) {
  const pinned = {};
  if (!raw) return pinned;
  for (const entry of raw.split(',')) {
    const m = entry.match(/^(research|implement|test|brainstorm|plan)=([A-Za-z0-9._-]+)$/);
    if (!m) { warnings.push(`--pinned 항목 '${entry}' 형식 오류(phase=value) — 무시`); continue; }
    pinned[m[1]] = m[2];
  }
  return pinned;
}

function main() {
  const warnings = [];
  try {
    const args = parseArgs(process.argv.slice(2));
    const runtime = args.runtime || detectRuntime(process.env);
    const signals = collectCodebaseSignals(args.root);
    const pinned = parsePinned(args.pinnedRaw, warnings);
    const decision = decideModelRouting({ signals, taskText: args.task,
      difficulty: args.difficulty, runtime, pinned });
    decision.warnings = [...warnings, ...decision.warnings];
    process.stdout.write(JSON.stringify(decision));
  } catch (e) {
    const routing = {}; for (const p of PHASES) routing[p] = 'main';
    process.stdout.write(JSON.stringify({ model_routing: routing,
      meta: { runtime: 'unknown', error: true }, warnings: [...warnings, `cli-error: ${e.message}`] }));
  }
}
main();
