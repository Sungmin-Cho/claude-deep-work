#!/usr/bin/env node
'use strict';

// Fail-safe contract: this CLI is the orchestrator session-init entry point and
// MUST always exit 0 with exactly one valid fallback JSON line on stdout (all
// phases → 'main'), even if a required module is broken or missing. To honor
// that even when `require()` itself fails, PHASES is NOT imported here — a
// local literal is used instead (see FALLBACK_PHASES below) — and an
// uncaughtException handler is installed before any require() call, as a
// safety net beyond main()'s own try/catch.

// require에 의존하지 않는 로컬 리터럴. require가 실패해도(모듈 손상/누락)
// fallback 경로는 동작해야 하므로 runtime 모듈의 PHASES를 가져오지 않고 여기서
// 직접 리터럴로 고정한다.
const FALLBACK_PHASES = ['brainstorm', 'research', 'plan', 'implement', 'test'];

// 정상 출력(main()의 try 블록 성공)이 이미 이뤄졌다면 uncaughtException 핸들러가
// 뒤늦게 발동하더라도 stdout에 두 번째 JSON을 쓰지 않도록 하는 가드.
let alreadyEmitted = false;
// requires/detectRuntime이 성공적으로 실행된 이후라면 감지된 런타임을 담아 둔다
// (성공적으로 감지된 값이 있으면 fallback에서도 그 값을 쓰고, 없으면 'unknown').
let detectedRuntime = null;

function buildFallback(warnings, errMessage) {
  const routing = {};
  const tiers = {};
  for (const p of FALLBACK_PHASES) { routing[p] = 'main'; tiers[p] = 'main'; }
  return {
    model_routing: routing,
    meta: { runtime: detectedRuntime || 'unknown', tiers, error: true },
    warnings: [...warnings, `cli-error: ${errMessage}`],
  };
}

function emitFallback(warnings, errMessage) {
  if (alreadyEmitted) return;
  alreadyEmitted = true;
  process.stdout.write(JSON.stringify(buildFallback(warnings, errMessage)));
}

// 어떤 require보다 먼저 설치되는 최후의 안전망. main()의 try/catch를 벗어나는
// (예: 비동기 예외) 예외까지 잡아 fallback JSON + exit 0을 보장한다.
process.on('uncaughtException', (e) => {
  emitFallback([], e && e.message ? e.message : String(e));
  process.exit(0);
});

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
    // require를 try 안으로 옮겨 fail-safe 계약을 지킨다 — 모듈이 손상/누락되어도
    // catch가 fallback JSON을 emit하며, 위 top-level uncaughtException 안전망을
    // 우회하지 않는다.
    const { collectCodebaseSignals, decideModelRouting } = require('../runtime/model-routing-runtime.js');
    const { detectRuntime } = require('./detect-runtime.js');

    // test-only hook: fallback(catch) 경로를 실제로 exercise하기 위한 테스트 전용 훅.
    if (process.env.DEEP_WORK_MR_CLI_TEST_THROW === '1') throw new Error('test-throw');

    const args = parseArgs(process.argv.slice(2));
    const runtime = args.runtime || detectRuntime(process.env);
    detectedRuntime = runtime;
    const signals = collectCodebaseSignals(args.root);
    const pinned = parsePinned(args.pinnedRaw, warnings);
    const decision = decideModelRouting({ signals, taskText: args.task,
      difficulty: args.difficulty, runtime, pinned });
    decision.warnings = [...warnings, ...decision.warnings];
    alreadyEmitted = true;
    process.stdout.write(JSON.stringify(decision));
  } catch (e) {
    emitFallback(warnings, e.message);
  }
}
main();
