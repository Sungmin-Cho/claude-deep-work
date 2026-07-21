'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('orchestrator init wires risk-only -> risk-aware routing -> reused provisional policy', () => {
  const skill = read('skills/deep-work-orchestrator/SKILL.md');
  const riskOnly = skill.indexOf('--risk-only');
  const routing = skill.indexOf('--risk-class', riskOnly + 1);
  const reusedPolicy = skill.indexOf('--reuse-input', routing + 1);

  assert.ok(riskOnly >= 0, 'provisional risk-only CLI argv must be documented');
  assert.ok(routing > riskOnly, 'model routing must consume provisional risk class');
  assert.ok(reusedPolicy > routing, 'policy snapshot must reuse the risk-only input last');
  assert.match(skill.slice(0, routing + 400), /risk-profile-cli\.js[\s\S]*--stage provisional[\s\S]*--risk-only/);
  assert.match(skill.slice(riskOnly, reusedPolicy), /model-routing-cli\.js[\s\S]*--risk-class/);
  assert.match(skill.slice(routing), /risk-profile-cli\.js[\s\S]*--stage provisional[\s\S]*--reuse-input/);
});

test('orchestrator persists canonical routing carriers and adaptive flag decisions', () => {
  const skill = read('skills/deep-work-orchestrator/SKILL.md');
  assert.match(skill, /model_routing_json[\s\S]*JSON\.stringify/);
  assert.match(skill, /model_routing_meta_json[\s\S]*JSON\.stringify/);
  assert.match(skill, /--policy[\s\S]*--risk[\s\S]*--review/);
  assert.match(skill, /risk_acceptances/);
  assert.match(skill, /floor_overridden_by_pin/);
  assert.match(skill, /(?:high|critical)[\s\S]*⚠️/);
});

test('deep-research uses state-file extraction and authoritative floor-aware rerouting', () => {
  const skill = read('skills/deep-research/SKILL.md');
  assert.match(skill, /risk-profile-cli\.js[\s\S]*--stage authoritative[\s\S]*--state-file "\$STATE_FILE"/);
  assert.match(skill, /model-routing-cli\.js[\s\S]*--risk-class[\s\S]*--floor-baseline/);
  assert.match(skill, /methodology_policy_json[\s\S]*floors_effective/);
  assert.match(skill, /risk_profile_json\.errors/);
  assert.match(skill, /유일한 state writer/);
  assert.doesNotMatch(skill, /스킬\(LLM\)이 직접 읽|미확정 후보 필드명|LLM 추출 절차/);
});

test('all eight routing readers use the shared scalar-first decode contract', () => {
  const readers = [
    'skills/deep-implement/SKILL.md',
    'skills/deep-status/SKILL.md',
    'skills/deep-resume/SKILL.md',
    'skills/deep-test/SKILL.md',
    'skills/deep-finish/SKILL.md',
    'skills/deep-research/SKILL.md',
    'skills/deep-report/SKILL.md',
    'skills/shared/references/implementation-guide.md',
  ];
  const directNestedAccess = /state\.model_routing\.(?:research|implement|test)|model_routing_meta\.tiers|state\.model_routing_meta/;

  for (const reader of readers) {
    const body = read(reader);
    assert.match(body, /model-routing-guide\.md#model-routing-state-decode-v612/, `${reader} must reference the decode contract`);
    assert.doesNotMatch(body, directNestedAccess, `${reader} must not read nested routing state directly`);
  }

  const guide = read('skills/shared/references/model-routing-guide.md');
  assert.match(guide, /## Model routing state decode \(v6\.12\)/);
  assert.match(guide, /model_routing_json[\s\S]*model_routing_meta_json[\s\S]*JSON\.parse/);
  assert.match(guide, /부재[\s\S]*legacy nested[\s\S]*model_routing[\s\S]*model_routing_meta/);
});

test('slice routing and resume consume the new adaptive state', () => {
  const plan = read('skills/deep-plan/SKILL.md');
  const resume = read('skills/deep-resume/SKILL.md');
  assert.match(plan, /sliceModelTierWithRisk/);
  assert.match(plan, /slice_risk_shadow_json/);
  assert.match(resume, /methodology_policy_json[\s\S]*review_execution_json/);
  assert.match(resume, /신규 state 필드 복원/);
});
