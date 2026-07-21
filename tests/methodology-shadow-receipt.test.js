'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'hooks', 'scripts', 'validate-receipt.sh');

function makeFixtureDir({ withReceipts = true } = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-receipt-'));
  // baseline이 유의미하려면 실제 checks를 수행해야 한다 — receipts/ 에 최소 1개의
  // valid SLICE receipt를 만들어 둔다 (validate-receipt.sh:98-113 — receipts/ 없으면
  // 즉시 fail, 있어도 파일이 0개면 "at least one slice receipt" FAIL).
  if (withReceipts) {
    fs.mkdirSync(path.join(workDir, 'receipts'));
    fs.writeFileSync(path.join(workDir, 'receipts', 'SLICE-001.json'), JSON.stringify({
      schema_version: '1.0', slice_id: 'SLICE-001', tdd_state: 'GREEN',
      verification: { full_test_suite: 'pass' },
    }, null, 2));
  }
  return workDir;
}

function runValidator(workDir, payloadExtra) {
  // 최소 valid session receipt — 기존 검증기가 요구하는 필드는 실행 결과(첫 실패 메시지)를
  // 보고 보강한다. methodology_shadow 유/무 이외의 모든 필드는 두 실행에서 동일해야 한다.
  const payload = { schema_version: '1.0', session_id: 's-test', task: 'shadow test',
    outcome: 'merged', slices: { total: 1 }, ...payloadExtra };
  fs.writeFileSync(path.join(workDir, 'session-receipt.json'), JSON.stringify(payload, null, 2));
  try {
    // WORK_DIR은 positional 인자로만 전달 — env는 스크립트가 읽지 않는다 (validate-receipt.sh:11).
    const stdout = execFileSync('bash', [SCRIPT, workDir], { encoding: 'utf8' });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('vacuous 방지 — positional workDir이 실제로 소비된다 (receipts 유/무가 판정을 가른다)', () => {
  const broken = runValidator(makeFixtureDir({ withReceipts: false }), {});
  const healthy = runValidator(makeFixtureDir({ withReceipts: true }), {});
  assert.strictEqual(broken.code, 1, 'receipts/ 없는 fixture가 fail하지 않음 — baseline이 vacuous할 위험');
  assert.strictEqual(healthy.code, 0, 'receipts/ 있는 fixture가 pass하지 않음');
});

test('methodology_shadow 유/무가 validate-receipt.sh 판정을 바꾸지 않는다 (§8.3)', () => {
  const without = runValidator(makeFixtureDir({ withReceipts: true }), {});
  const withShadow = runValidator(makeFixtureDir({ withReceipts: true }), { methodology_shadow: { schema_version: 1,
    risk: { provisional_class: 'medium', authoritative_class: 'high', final_score: 9,
      hard_triggers: ['state-machine-concurrency'] },
    policy: { recommended_profile: 'strict', based_on: 'authoritative' },
    routing_diff_count: 1, errors_count: 0 } });
  // 판정(exit code) 동일 — total/passed/result JSON 필드는 위에서 설명한 기존 결함으로
  // 신뢰 불가하므로 비교하지 않는다.
  assert.strictEqual(withShadow.code, without.code,
    `unknown optional 필드가 판정을 바꿈: without=${without.code}(${without.out}) with=${withShadow.code}(${withShadow.out})`);
  assert.strictEqual(withShadow.code, 0, 'baseline 자체가 pass하지 않음 — 비교가 무의미');
  // methodology_shadow 관련 오류 문자열이 없다 (파서가 unknown optional 필드를 무시).
  assert.ok(!/methodology_shadow/i.test(withShadow.out),
    `출력에 methodology_shadow 관련 오류 문자열이 있음: ${withShadow.out}`);
});
