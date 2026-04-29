// scripts/load-v3-profile.test.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const { loadV3Profile } = require('./load-v3-profile.js');

function tmpProfile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-v3-'));
  const file = path.join(dir, 'deep-work-profile.yaml');
  fs.writeFileSync(file, content);
  return file;
}

test('v3 profile — default_preset에서 presets read + defaults/interactive_each_session 추출', () => {
  const v3 = `version: 3
default_preset: solo-strict
presets:
  solo-strict:
    label: Solo + Strict TDD
    description: 단독 작업
    project_type: zero-base
    interactive_each_session:
      - team_mode
      - start_phase
      - tdd_mode
      - git
      - model_routing
    defaults:
      team_mode: solo
      start_phase: research
      tdd_mode: strict
      git:
        use_worktree: false
        use_branch: true
      model_routing:
        brainstorm: main
        research: sonnet
        plan: main
        implement: sonnet
        test: haiku
`;
  const file = tmpProfile(v3);
  const result = loadV3Profile(file);
  assert.strictEqual(result.preset_name, 'solo-strict');
  assert.deepStrictEqual(result.interactive_each_session, ['team_mode', 'start_phase', 'tdd_mode', 'git', 'model_routing']);
  assert.strictEqual(result.defaults.team_mode, 'solo');
  assert.strictEqual(result.defaults.start_phase, 'research');
  assert.strictEqual(result.defaults.tdd_mode, 'strict');
  assert.strictEqual(result.defaults.model_routing.plan, 'main'); // v6.4.0 D1 W1 보존
});

test('overridden preset — DEEP_WORK_INITIAL_PRESET 환경변수가 default_preset 무시', () => {
  // (사용자가 --profile=team-relaxed로 호출했지만 profile에 team-relaxed가 없는 경우)
  const v3 = `version: 3
default_preset: solo-strict
presets:
  solo-strict:
    interactive_each_session:
      - team_mode
    defaults:
      team_mode: solo
`;
  const file = tmpProfile(v3);
  const result = loadV3Profile(file, { initialPreset: 'team-relaxed' });
  // preset name이 존재하지 않으면 명시적 에러
  assert.strictEqual(result.error, 'preset-not-found');
  assert.strictEqual(result.requested_preset, 'team-relaxed');
});

test('interactive_each_session 항목 일부 제거 — 사용자 customization', () => {
  const v3 = `version: 3
default_preset: minimal
presets:
  minimal:
    interactive_each_session:
      - team_mode
      - tdd_mode
    defaults:
      team_mode: solo
      start_phase: research
      tdd_mode: strict
      git:
        use_worktree: false
        use_branch: true
`;
  const file = tmpProfile(v3);
  const result = loadV3Profile(file);
  assert.deepStrictEqual(result.interactive_each_session, ['team_mode', 'tdd_mode']);
  // start_phase / git / model_routing은 ask 안 되지만 defaults에 값 보유 → 자동 적용
  assert.strictEqual(result.defaults.start_phase, 'research');
});

test('v3 형식이 아닌 경우 명시적 에러', () => {
  const v2 = `version: 2\ndefault_preset: x\n`;
  const file = tmpProfile(v2);
  const result = loadV3Profile(file);
  assert.strictEqual(result.error, 'not-v3');
});
