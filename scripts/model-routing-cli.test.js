'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const CLI = path.join(__dirname, 'model-routing-cli.js');

function run(args) {
  const out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('정상 경로: repo 루트에서 claude 런타임 결정 JSON', () => {
  const r = run(['--root', path.join(__dirname, '..'), '--task', '기능 추가', '--runtime', 'claude']);
  assert.ok(r.model_routing.implement);
  assert.ok(r.meta.tiers.implement);
  assert.notStrictEqual(r.model_routing.implement, 'standard'); // tier명 유출 금지
});

test('pinned 전달', () => {
  const r = run(['--root', path.join(__dirname, '..'), '--task', 't', '--runtime', 'claude',
    '--pinned', 'implement=deep']);
  assert.strictEqual(r.model_routing.implement, 'opus');
});

test('없는 root여도 exit 0 + fallback JSON (fail-safe)', () => {
  const r = run(['--root', '/nonexistent-xyz', '--task', 't', '--runtime', 'claude']);
  assert.ok(r.model_routing); // 신호 null → medium 수렴으로 정상 결정
});

test('pinned 형식 오류 항목은 경고 + 무시 (전체 거부 아님)', () => {
  const r = run(['--root', path.join(__dirname, '..'), '--task', 't', '--runtime', 'claude',
    '--pinned', 'implement=deep,bogus']);
  assert.strictEqual(r.model_routing.implement, 'opus');
  assert.ok(r.warnings.some((w) => /bogus/.test(w)));
});
