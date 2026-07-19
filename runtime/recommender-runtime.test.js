'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectCapability, buildRecommenderInput, validateRecommendation, formatAskOptions,
  KEYS, filterAskItems, parseRecommendation, capabilityToDisabled } =
  require('./recommender-runtime.js');

test('recommender transforms are pure bounded and exact-schema', () => {
  const capability = detectCapability({is_git:true,worktree_supported:false,team_env_set:true});
  const input = buildRecommenderInput({task_description:'한'.repeat(10_000),capability,
    recent_commits:[],top_level_dirs:[],current_defaults:{},git_status:'',ask_items:[]});
  assert.ok(Buffer.byteLength(input.task_description) <= 4096);
  const data = validateRecommendation(JSON.stringify({git:'current-branch',team_mode:'solo',
    tdd_mode:'strict',start_phase:'research'}), capability);
  assert.deepEqual(Object.keys(data).sort(), ['git','start_phase','tdd_mode','team_mode']);
  assert.throws(() => validateRecommendation(JSON.stringify({...data,extra:true}), capability),
    /recommendation-schema/);
  assert.equal(formatAskOptions({item:'git', recommendation:'worktree',default_value:'worktree',
    enum_values:['worktree','current-branch'],capability}).some((option) => option.value === 'worktree'),
    false);
});

test('KEYS는 4-key (model_routing 제외)', () => {
  assert.deepStrictEqual([...KEYS], ['team_mode', 'start_phase', 'tdd_mode', 'git']);
});

test('filterAskItems: 구프로필 잔존 model_routing·미지 항목 제거 (리뷰 Medium-3)', () => {
  assert.deepStrictEqual(
    filterAskItems(['team_mode', 'model_routing', 'git', 'bogus']),
    ['team_mode', 'git']);
  assert.deepStrictEqual(filterAskItems(null), [...KEYS]); // null → 전 항목
});

test('4-key + task_difficulty 응답 파싱', () => {
  const raw = '```json\n' + JSON.stringify({
    team_mode: { value: 'solo', reason: 'r' }, start_phase: { value: 'research', reason: 'r' },
    tdd_mode: { value: 'strict', reason: 'r' }, git: { value: 'new-branch', reason: 'r' },
    task_difficulty: { value: 'high', reason: '전면 리팩터' },
  }) + '\n```';
  const p = parseRecommendation(raw, { capability: {} });
  assert.strictEqual(p.ok, true);
  assert.deepStrictEqual(p.data.task_difficulty, { value: 'high', reason: '전면 리팩터' });
});

test('구버전 5-key 응답 관용 파싱: model_routing 키 무시 (리뷰 Low-4)', () => {
  const raw = '```json\n' + JSON.stringify({
    team_mode: { value: 'solo', reason: 'r' }, start_phase: { value: 'research', reason: 'r' },
    tdd_mode: { value: 'strict', reason: 'r' }, git: { value: 'new-branch', reason: 'r' },
    model_routing: { value: 'default', reason: 'r' },
  }) + '\n```';
  const p = parseRecommendation(raw, { capability: {} });
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.data.model_routing, undefined);
  assert.strictEqual(p.data.task_difficulty, null); // 부재 → null (무보정)
});

test('task_difficulty enum 위반/형식 오류 → null 처리 (전체 실패 아님)', () => {
  const raw = '```json\n' + JSON.stringify({
    team_mode: { value: 'solo', reason: 'r' }, start_phase: { value: 'research', reason: 'r' },
    tdd_mode: { value: 'strict', reason: 'r' }, git: { value: 'new-branch', reason: 'r' },
    task_difficulty: { value: 'extreme', reason: 'r' },
  }) + '\n```';
  const p = parseRecommendation(raw, { capability: {} });
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.data.task_difficulty, null);
});

test('capabilityToDisabled는 model_routing에 대해 throw (비-KEYS)', () => {
  assert.throws(() => capabilityToDisabled({}, 'model_routing'));
});

// validateRecommendation은 production 도달 경로(dispatcher-routes 'recommender validate') — 전용 RED (리뷰 M-2)
test('validateRecommendation: 4-key + task_difficulty 통과', () => {
  const raw = '```json\n' + JSON.stringify({
    team_mode: { value: 'solo', reason: 'r' }, start_phase: { value: 'research', reason: 'r' },
    tdd_mode: { value: 'strict', reason: 'r' }, git: { value: 'new-branch', reason: 'r' },
    task_difficulty: { value: 'medium', reason: 'r' },
  }) + '\n```';
  const flat = validateRecommendation(raw, {});
  assert.deepStrictEqual(Object.keys(flat).sort(),
    ['git', 'start_phase', 'tdd_mode', 'team_mode']);
});

test('validateRecommendation: legacy model_routing 키는 허용-무시', () => {
  const raw = '```json\n' + JSON.stringify({
    team_mode: { value: 'solo', reason: 'r' }, start_phase: { value: 'research', reason: 'r' },
    tdd_mode: { value: 'strict', reason: 'r' }, git: { value: 'new-branch', reason: 'r' },
    model_routing: { value: 'auto', reason: 'r' },
  }) + '\n```';
  const flat = validateRecommendation(raw, {});
  assert.strictEqual(flat.model_routing, undefined);
});

test('validateRecommendation: 진짜 extra 키는 여전히 throw', () => {
  const raw = '```json\n' + JSON.stringify({
    team_mode: { value: 'solo', reason: 'r' }, start_phase: { value: 'research', reason: 'r' },
    tdd_mode: { value: 'strict', reason: 'r' }, git: { value: 'new-branch', reason: 'r' },
    bogus_key: { value: 'x', reason: 'r' },
  }) + '\n```';
  assert.throws(() => validateRecommendation(raw, {}), /recommendation-schema/);
});
