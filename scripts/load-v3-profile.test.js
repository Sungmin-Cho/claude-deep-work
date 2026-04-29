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

// C1: regex injection 차단
test('C1 — initialPreset에 regex 메타문자가 포함되면 invalid-preset-name 반환', () => {
  const v3 = `version: 3
default_preset: solo
presets:
  solo:
    defaults:
      team_mode: solo
`;
  const file = tmpProfile(v3);
  const result = loadV3Profile(file, { initialPreset: '.*' });
  assert.strictEqual(result.error, 'invalid-preset-name');
  assert.strictEqual(result.requested_preset, '.*');
});

// C2: defaults 블록 내 주석 줄 + trailing comment 처리
test('C2 — defaults 블록 내 주석 줄 및 trailing comment가 있어도 모든 필드 추출', () => {
  const v3 = `version: 3
default_preset: annotated
presets:
  annotated:
    defaults:
      # 팀 모드 설정
      team_mode: solo # 단독 작업
      start_phase: research # 연구부터
      git: # git 설정
        use_worktree: false # 기본값
        use_branch: true
`;
  const file = tmpProfile(v3);
  const result = loadV3Profile(file);
  assert.strictEqual(result.preset_name, 'annotated');
  assert.strictEqual(result.defaults.team_mode, 'solo');
  assert.strictEqual(result.defaults.start_phase, 'research');
  assert.strictEqual(result.defaults.git.use_worktree, 'false');
  assert.strictEqual(result.defaults.git.use_branch, 'true');
});

// I1: version에 trailing comment가 있어도 v3 인식
test('I1 — version: 3  # legacy 형식도 v3로 인식', () => {
  const v3 = `version: 3  # legacy format
default_preset: minimal
presets:
  minimal:
    defaults:
      team_mode: solo
`;
  const file = tmpProfile(v3);
  const result = loadV3Profile(file);
  assert.strictEqual(result.preset_name, 'minimal');
  assert.ok(!result.error, `예상치 못한 에러: ${result.error}`);
});

// I2: 따옴표로 감싼 scalar value 언래핑
test('I2 — team_mode: "solo" 따옴표 없이 solo로 반환', () => {
  const v3 = `version: 3
default_preset: quoted
presets:
  quoted:
    defaults:
      team_mode: "solo"
      start_phase: 'research'
`;
  const file = tmpProfile(v3);
  const result = loadV3Profile(file);
  assert.strictEqual(result.defaults.team_mode, 'solo');
  assert.strictEqual(result.defaults.start_phase, 'research');
});
