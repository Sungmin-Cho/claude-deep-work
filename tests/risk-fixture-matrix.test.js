'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decideRiskProfile } = require('../runtime/risk-runtime.js');
const { PROFILE_BY_CLASS } = require('../runtime/policy-runtime.js');

const FIXTURES = [
  // ── 제안서 §19.1 시나리오
  { name: 'README typo (en)', input: { stage: 'provisional', taskText: 'fix a typo in README' },
    expected_class: 'low' },
  { name: 'README 오타 수정 (ko)', input: { stage: 'provisional', taskText: 'README 오타 수정' },
    expected_class: 'low' },
  { name: '작은 pure function 버그', input: { stage: 'provisional', taskText: 'fix off-by-one in formatDate helper' },
    expected_class: 'low' },
  // 산출 근거 (shipped 렉시콘 기준, 총 4점 — medium 4~7 대역): blast_radius=2
  // (keyword:public-api → +1, paths:5개 → +1) + data_security_integrity=1
  // (keyword:integrity "무결성" 매칭) + external_side_effects=1 (keyword:publish-deploy
  // "deploy" 매칭) = 4. 파일명은 path 패턴(hooks/, auth, payment/billing,
  // migration|schema, .github/workflows|release|publish)과 우연히 매칭되지 않도록
  // 선택했다 — 예: "schema.js"를 쓰면 path:migration-schema가 추가로 매칭되어
  // irreversibility+1 (총 5점)이 되므로 의도적으로 배제했다.
  { name: 'API endpoint 추가', input: { stage: 'authoritative', taskText: 'add REST endpoint',
    evidence: { changed_paths: ['src/api/routes.js', 'src/api/handler.js', 'src/api/validators.js',
        'src/api/serializer.js', 'src/api/index.js'],
      keywords: ['public api', '응답 무결성 검증'], side_effects: ['deploy 필요'], evidence_refs: [] } },
    expected_class: 'medium' },
  { name: 'public schema 변경', input: { stage: 'authoritative', taskText: 'change public response schema — breaking change',
    evidence: { changed_paths: ['schemas/response.schema.json'], keywords: ['backward compat'], side_effects: [], evidence_refs: [] } },
    expected_class: 'high' }, // public-contract-break trigger
  { name: 'auth permission 조건 (en)', input: { stage: 'provisional', taskText: 'fix permission check in auth middleware' },
    expected_class: 'high' }, // auth-boundary trigger
  { name: '인증 권한 조건 (ko)', input: { stage: 'provisional', taskText: '인증 권한 조건 한 줄 수정' },
    expected_class: 'high' },
  { name: 'lease/state machine (en)', input: { stage: 'provisional', taskText: 'implement lease renewal state machine with retry' },
    expected_class: 'high' }, // state-machine-concurrency trigger
  { name: 'lease 상태 머신 (ko)', input: { stage: 'provisional', taskText: 'lease 갱신 상태 머신과 재시도 구현' },
    expected_class: 'high' },
  { name: 'destructive migration (en)', input: { stage: 'provisional', taskText: 'destructive schema migration dropping legacy table' },
    expected_class: 'critical' }, // destructive-migration trigger
  { name: '파괴적 마이그레이션 (ko)', input: { stage: 'provisional', taskText: '레거시 테이블 삭제하는 파괴적 스키마 마이그레이션' },
    expected_class: 'critical' },
  { name: 'deploy/publish 자동화', input: { stage: 'provisional', taskText: 'CI에서 npm publish 자동화' },
    expected_class: 'critical' }, // external-destructive-action trigger
  // 산출 근거 (shipped 렉시콘 기준, 총 4점 — medium 4~7 대역): blast_radius=2
  // (keyword:global "전체" + keyword:refactor "리팩터"/"refactor" → 2건, cap 2) +
  // verification_difficulty=1 (signal:has_tests=false) + irreversibility=1
  // (keyword:schema-change "스키마 변경" 매칭) = 4. hard trigger는 미매칭 — 점수만으로 medium.
  { name: '테스트 없는 legacy 모듈', input: { stage: 'authoritative', taskText: 'legacy 모듈 리팩터',
    signals: { has_tests: false },
    evidence: { changed_paths: ['legacy/a.js', 'legacy/b.js', 'legacy/c.js', 'legacy/d.js', 'legacy/e.js'],
      keywords: ['refactor', '전체', '스키마 변경 동반'], side_effects: [], evidence_refs: [] } },
    expected_class: 'medium' }, // trigger 없이 점수 기반 — 4~7 대역
  // ── hard trigger 단독 (저점수 강제 승급)
  { name: 'secret rotation', input: { stage: 'provisional', taskText: 'rotate api token' },
    expected_class: 'high' },
  { name: 'host-dependent smoke', input: { stage: 'provisional', taskText: 'Windows Git Bash hook payload 처리' },
    expected_class: 'high' },
  { name: '복구 불가 변경', input: { stage: 'provisional', taskText: '이 작업은 rollback 불가' },
    expected_class: 'critical' },
  // ── 신호 전무 / 최저 confidence
  { name: '신호 전무', input: { stage: 'provisional', taskText: 'do the thing' },
    expected_class: 'low' },
  { name: '탐색성 작업 (ambiguity만)', input: { stage: 'provisional', taskText: '어디를 고칠지 불명확 — 탐색 필요' },
    expected_class: 'low' },
  // ── concurrency (한/영)
  { name: 'race condition fix (en)', input: { stage: 'provisional', taskText: 'fix race condition with lock in queue' },
    expected_class: 'high' },
  { name: '동시성 락 수정 (ko)', input: { stage: 'provisional', taskText: '큐의 동시성 문제를 lock으로 수정' },
    expected_class: 'high' },
  // ── 결제
  { name: '결제 idempotency (ko)', input: { stage: 'provisional', taskText: '결제 idempotency 조건 변경' },
    expected_class: 'high' }, // payment-financial + state-machine-concurrency
  { name: 'billing invoice (en)', input: { stage: 'provisional', taskText: 'change billing invoice rounding' },
    expected_class: 'high' },
];

test(`fixture matrix — ${FIXTURES.length}개 (>=20) 결정론 분류`, () => {
  assert.ok(FIXTURES.length >= 20);
  for (const f of FIXTURES) {
    const r1 = decideRiskProfile(f.input);
    const r2 = decideRiskProfile(f.input);
    assert.deepStrictEqual(r1, r2, `${f.name}: 비결정`);
    assert.strictEqual(r1.class, f.expected_class,
      `${f.name}: expected ${f.expected_class}, got ${r1.class} (score=${r1.score}, triggers=${r1.hard_triggers.map((t) => t.id)})`);
    const expectedProfile = f.expected_profile ?? PROFILE_BY_CLASS[f.expected_class];
    assert.strictEqual(PROFILE_BY_CLASS[r1.class], expectedProfile, `${f.name}: profile 불일치`);
  }
});

test('한/영 변형 쌍은 같은 class', () => {
  const pairs = [['auth permission 조건 (en)', '인증 권한 조건 (ko)'],
    ['lease/state machine (en)', 'lease 상태 머신 (ko)'],
    ['destructive migration (en)', '파괴적 마이그레이션 (ko)'],
    ['README typo (en)', 'README 오타 수정 (ko)'],
    ['race condition fix (en)', '동시성 락 수정 (ko)']];
  const byName = new Map(FIXTURES.map((f) => [f.name, f]));
  for (const [en, ko] of pairs) {
    assert.strictEqual(decideRiskProfile(byName.get(en).input).class,
      decideRiskProfile(byName.get(ko).input).class, `${en} vs ${ko}`);
  }
});
