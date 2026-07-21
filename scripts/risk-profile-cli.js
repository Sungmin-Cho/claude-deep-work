#!/usr/bin/env node
'use strict';

// Fail-safe 계약 (scripts/model-routing-cli.js와 동일): 어떤 실패에도 exit 0 +
// 정확히 1줄의 fallback JSON. shadow 단계는 세션을 절대 막지 않는다 (스펙 §7).

let alreadyEmitted = false;
let stageForFallback = null;

function emitFallback(errMessage, warnings = []) {
  if (alreadyEmitted) return;
  alreadyEmitted = true;
  process.stdout.write(JSON.stringify({ stage: stageForFallback, risk_profile: null,
    error: errMessage, errors: [{ stage: stageForFallback, code: 'cli-failure', message: errMessage }], warnings }));
}

if (require.main === module) {
  process.on('uncaughtException', (e) => {
    emitFallback(e && e.message ? e.message : String(e));
    process.exit(0);
  });
}

function parseArgs(argv) {
  const out = { stage: null, root: process.cwd(), workDir: null, inputFile: null,
    riskOnly: false, reuseInput: null, stateFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--stage') out.stage = argv[++i] || null;
    else if (a === '--root') out.root = argv[++i] || out.root;
    else if (a === '--work-dir') out.workDir = argv[++i] || null;
    else if (a === '--input-file') out.inputFile = argv[++i] || null;
    else if (a === '--risk-only') out.riskOnly = true;
    else if (a === '--reuse-input') out.reuseInput = argv[++i] || null;
    else if (a === '--state-file') out.stateFile = argv[++i] || null;
  }
  return out;
}

function readInput(inputFile, fs) {
  const raw = inputFile ? fs.readFileSync(inputFile, 'utf8') : fs.readFileSync(0, 'utf8');
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw); // 실패 시 catch → fallback
  // 비객체(숫자/문자열/배열) 입력이 garbage 유효입력이 되지 않게 방어 (리뷰 I1)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

// slice_id는 artifact 파일명에 들어가므로 경로 구성 문자를 금지한다 (리뷰 W1 —
// `../` 주입 시 risk-inputs/ 밖 임의 경로 쓰기가 가능했음). model-routing-cli의
// parsePinned 값 sanitize 선례와 동일 접근이되 `..`는 명시 차단.
function isSafeSliceId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && !id.includes('..');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function legacyScalar(raw) {
  const value = raw.trim();
  if (value === '{}') return {};
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') || value.startsWith("'")) {
    if (value.startsWith('"')) return JSON.parse(value);
    return value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
  }
  return value;
}

function extractLegacyRoutingState(rawStateText) {
  const lines = String(rawStateText).replace(/\r\n/g, '\n').split('\n');
  const routing = {};
  const meta = { tiers: {}, pinned: {} };
  let block = null;
  let subsection = null;
  for (const line of lines) {
    if (line === 'model_routing:') { block = 'routing'; subsection = null; continue; }
    if (line === 'model_routing_meta:') { block = 'meta'; subsection = null; continue; }
    if (block && line && !/^\s/.test(line)) { block = null; subsection = null; }
    if (block === 'routing') {
      const match = line.match(/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*(.+)$/);
      if (match) routing[match[1]] = legacyScalar(match[2]);
    } else if (block === 'meta') {
      const nested = line.match(/^  (tiers|pinned):\s*(.*)$/);
      if (nested) {
        subsection = nested[1];
        if (nested[2]) meta[subsection] = legacyScalar(nested[2]);
        continue;
      }
      const child = line.match(/^    ([A-Za-z_][A-Za-z0-9_-]*):\s*(.+)$/);
      if (child && subsection && isPlainObject(meta[subsection])) {
        meta[subsection][child[1]] = legacyScalar(child[2]);
      }
    }
  }
  if (!Object.keys(routing).length || !isPlainObject(meta.tiers) || !Object.keys(meta.tiers).length) {
    throw new Error('routing state carrier를 찾거나 해석할 수 없음');
  }
  return { model_routing: routing, tiers: meta.tiers,
    pinned: isPlainObject(meta.pinned) ? meta.pinned : {}, extraction_mode: 'legacy-scan' };
}

function extractRoutingState(rawStateText) {
  try {
    const { parseFrontmatter } = require('../runtime/frontmatter.js');
    const fields = parseFrontmatter(rawStateText).fields;
    if (fields.model_routing_json !== undefined || fields.model_routing_meta_json !== undefined) {
      if (typeof fields.model_routing_json !== 'string' || typeof fields.model_routing_meta_json !== 'string') {
        throw new Error('canonical routing scalar 2종이 모두 필요함');
      }
      const routing = JSON.parse(fields.model_routing_json);
      const meta = JSON.parse(fields.model_routing_meta_json);
      if (!isPlainObject(routing) || !isPlainObject(meta) || !isPlainObject(meta.tiers)) {
        throw new Error('canonical routing scalar shape가 유효하지 않음');
      }
      return { model_routing: routing, tiers: meta.tiers,
        pinned: isPlainObject(meta.pinned) ? meta.pinned : {}, extraction_mode: 'scalar' };
    }
  } catch (error) {
    try { return extractLegacyRoutingState(rawStateText); } catch {
      throw new Error(`routing state 추출 실패: ${error.message}`);
    }
  }
  return extractLegacyRoutingState(rawStateText);
}

function reusableSignals(artifactPath, fs, canonicalDigest, warnings) {
  if (!artifactPath) return null;
  try {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    if (!isPlainObject(artifact)) throw new Error('artifact가 object가 아님');
    const { input_digest: embeddedDigest, ...preimage } = artifact;
    if (typeof embeddedDigest !== 'string' || canonicalDigest(preimage) !== embeddedDigest) {
      throw new Error('digest 불일치');
    }
    if (!isPlainObject(artifact.signals)) throw new Error('signals 결측');
    return artifact.signals;
  } catch (error) {
    warnings.push(`--reuse-input ${error.message} — signals 재수집(fail-open)`);
    return null;
  }
}

function main() {
  const warnings = [];
  const errors = [];
  try {
    // parseArgs는 의존성이 없으므로 require보다 먼저 실행 — 모듈 손상 시에도
    // fallback JSON이 stage를 보존한다 (리뷰 I3).
    const args = parseArgs(process.argv.slice(2));
    stageForFallback = args.stage;

    const fs = require('node:fs');
    const path = require('node:path');
    const { decideRiskProfile, canonicalDigest, STAGES } = require('../runtime/risk-runtime.js');
    const { compilePolicySnapshot } = require('../runtime/policy-runtime.js');
    const { collectCodebaseSignals } = require('../runtime/model-routing-runtime.js');
    if (process.env.DEEP_WORK_RISK_CLI_TEST_THROW === '1') throw new Error('test-throw');

    if (!STAGES.includes(args.stage)) throw new Error(`--stage는 ${STAGES.join('|')} 중 하나여야 함`);
    let received = readInput(args.inputFile, fs);
    if (args.stage === 'slice' && !isSafeSliceId(received.slice_id)) {
      throw new Error('slice stage는 유효한 slice_id가 필요함 (영숫자/._- 만 허용, ".." 금지)');
    }

    let routingState = null;
    if (args.stateFile) {
      try {
        routingState = extractRoutingState(fs.readFileSync(args.stateFile, 'utf8'));
        received = { ...received, model_routing: routingState.model_routing,
          tiers: routingState.tiers, pinned: routingState.pinned };
      } catch (error) {
        errors.push({ stage: args.stage, code: 'routing-state-extraction', message: error.message });
      }
    }

    // 유효 입력 = 수신 입력 + 검증된 재사용 signals 또는 자체 재수집 signals.
    const signals = reusableSignals(args.reuseInput, fs, canonicalDigest, warnings)
      || collectCodebaseSignals(args.root);
    const { input_digest: _discardedInputDigest, ...receivedWithoutDigest } = received;
    const preimage = { ...receivedWithoutDigest, signals };
    // digest 계산 지점은 CLI 1곳 — input_ref.digest와 risk_profile.input_digest 양쪽에
    // 동일 값을 쓴다 (재현 계약 §4.6, P1 fix). 유효 입력에는 시각 필드가 없으므로
    // §4.1 "시각 필드는 digest에서 제외" 원칙이 별도 처리 없이 자동 충족된다.
    const digest = canonicalDigest(preimage);
    const effective = { ...preimage, input_digest: digest };

    // artifact 기록 — stage별 고유 파일명 (스펙 §4.6). work-dir 미지정/실패는 fail-open 경고.
    let inputRef = null;
    if (args.workDir) {
      try {
        const dir = path.join(args.workDir, 'risk-inputs');
        fs.mkdirSync(dir, { recursive: true });
        const name = args.stage === 'slice' ? `slice-${received.slice_id}.json` : `${args.stage}.json`;
        const artifactPath = path.join(dir, name);
        fs.writeFileSync(artifactPath, JSON.stringify(effective, null, 2));
        inputRef = { path: artifactPath, digest };
      } catch (e) { warnings.push(`artifact 기록 실패(fail-open): ${e.message}`); }
    } else warnings.push('--work-dir 미지정 — artifact 미기록(fail-open)');

    const profile = decideRiskProfile({ stage: args.stage, taskText: received.task_text,
      signals, evidence: received.evidence, priorProfile: received.prior_profile });
    profile.decided_at = new Date().toISOString(); // 시각은 CLI가 부착 (스펙 §4.1)
    profile.input_digest = digest; // digest는 CLI가 1회 계산해 부착 — input_ref.digest와 동일값 (P1 fix)

    const out = { stage: args.stage, risk_profile: profile, input_ref: inputRef, warnings, errors };
    if (routingState) {
      out.extraction_mode = routingState.extraction_mode;
      out.routing_state = routingState;
    }
    if (args.stage === 'slice') {
      out.slice_id = received.slice_id; // risk-only (스펙 §4.6)
    } else if (!args.riskOnly) {
      const routingFields = ['model_routing', 'tiers', 'pinned'];
      const missing = routingFields.filter((key) => !isPlainObject(received[key]));
      if (missing.length) errors.push({ stage: args.stage, code: 'routing-input-missing', missing,
        message: `policy 컴파일 routing 입력 결측: ${missing.join(', ')}` });
      const snapshot = compilePolicySnapshot({ riskProfile: profile,
        difficulty: received.difficulty ?? null, runtime: received.runtime ?? 'unknown',
        actualRouting: received.model_routing, actualTiers: received.tiers,
        actualPinned: received.pinned });
      snapshot.compiled_at = profile.decided_at;
      snapshot.based_on = args.stage;
      out.policy_snapshot = snapshot;
    }
    process.stdout.write(JSON.stringify(out));
    alreadyEmitted = true;
  } catch (e) {
    emitFallback(e.message, warnings);
  }
}

module.exports = { parseArgs, extractRoutingState };

if (require.main === module) main();
