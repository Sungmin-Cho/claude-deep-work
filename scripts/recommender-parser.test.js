// scripts/recommender-parser.test.js
const test = require('node:test');
const assert = require('node:assert');
const { parseRecommendation } = require('./recommender-parser.js');

const okOutput = '```json\n' + JSON.stringify({
  team_mode: { value: 'solo', reason: 'small task' },
  start_phase: { value: 'research', reason: 'existing code dependency' },
  tdd_mode: { value: 'strict', reason: 'core path' },
  git: { value: 'new-branch', reason: 'medium scope' },
  model_routing: { value: 'default', reason: 'standard flow' }
}) + '\n```';

test('valid fenced JSON parse + enum 통과', () => {
  const r = parseRecommendation(okOutput, { capability: { git_worktree: true, team_mode_available: true } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.team_mode.value, 'solo');
});

test('fence 부재 → fallback', () => {
  const r = parseRecommendation('Here is recommendation: { "team_mode": ... }', {});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.fallback_reason, 'no-json-fence');
});

test('enum 위반 → fallback (모든 5-key 완전 + 타겟만 invalid)', () => {
  // C-C fix: 5-key 검증이 enum 검증을 차단하지 않도록 모든 key 포함, team_mode만 enum 외 값
  const bad = '```json\n' + JSON.stringify({
    team_mode: { value: 'group', reason: 'x' }, // not in enum
    start_phase: { value: 'research', reason: 'x' },
    tdd_mode: { value: 'strict', reason: 'x' },
    git: { value: 'new-branch', reason: 'x' },
    model_routing: { value: 'default', reason: 'x' }
  }) + '\n```';
  const r = parseRecommendation(bad, {});
  assert.strictEqual(r.ok, false);
  assert.match(r.fallback_reason, /enum/);
});

test('capability false 항목 추천 → fallback', () => {
  const bad = '```json\n' + JSON.stringify({
    team_mode: { value: 'team', reason: 'x' },
    start_phase: { value: 'research', reason: 'x' },
    tdd_mode: { value: 'strict', reason: 'x' },
    git: { value: 'new-branch', reason: 'x' },
    model_routing: { value: 'default', reason: 'x' }
  }) + '\n```';
  const r = parseRecommendation(bad, { capability: { team_mode_available: false } });
  assert.strictEqual(r.ok, false);
  assert.match(r.fallback_reason, /capability/);
});

test('5-key 미만 → fallback (missing key)', () => {
  const partial = '```json\n' + JSON.stringify({
    team_mode: { value: 'solo', reason: 'x' },
    start_phase: { value: 'research', reason: 'x' },
    tdd_mode: { value: 'strict', reason: 'x' }
    // git, model_routing 누락
  }) + '\n```';
  const r = parseRecommendation(partial, {});
  assert.strictEqual(r.ok, false);
  assert.match(r.fallback_reason, /missing key/);
});

test('multi-fence → fallback', () => {
  const dual = '```json\n{"team_mode":{"value":"solo","reason":"x"}}\n```\n그러나 사실은\n```json\n{"team_mode":{"value":"team","reason":"y"}}\n```';
  const r = parseRecommendation(dual, {});
  assert.strictEqual(r.ok, false);
  assert.match(r.fallback_reason, /multiple-fences/);
});
