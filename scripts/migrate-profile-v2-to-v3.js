'use strict';
const fs = require('node:fs');
const path = require('node:path');
// NOTE: 외부 yaml 라이브러리 사용 금지 (deep-work 컨벤션, 기존 migrate-model-routing.js와 일관).
// v2 → v3 변환은 line-by-line regex 기반(migrate-model-routing.js 패턴 참조).

// ── Native YAML helpers (no external deps; mirrors `scripts/migrate-model-routing.js` 컨벤션) ──
// v2 → v3 변환은 round-trip 안전성을 위해 라인 단위 변환 + scope tracking 사용.
//
// **지원 schema (spec §5.1 example만)**:
//   version: 2
//   default_preset: <name>
//   presets:
//     <name>:
//       team_mode: <solo|team>
//       ...
//
// **미지원 변형 (감지 시 에러 + 수동 이전 가이드 출력 + version rewrite 거부)**:
//   - `profiles:` (presets 대신)
//   - `active:` 또는 `active_profile:` (default_preset 대신)
//   - `git_branch:` 단일 라인 (git: 블록 대신)
//   - YAML anchor (`&`) / alias (`*`) / inline flow style
//
// 미지원 변형 감지 시 plan은 변환 거부 — 사용자가 manual migration 가이드를 따라
// 직접 spec §5.1 형식으로 정렬한 후 재실행하도록 안내.

// Indent 변환 단일 매핑 (chained replace cascade 회피 — R3-A1 fix)
const INDENT_MAP = {
  4: '      ',   // 4-space → 6-space (preset field → defaults child)
  6: '        ', // 6-space → 8-space (defaults child → grandchild)
  8: '          ' // 8-space → 10-space (grandchild → great-grandchild)
};

function remapIndent(line) {
  return line.replace(/^( +)/, m => INDENT_MAP[m.length] || m);
}

/**
 * 미지원 v2 schema 변형 감지. 발견 시 명시적 에러 throw로 변환 거부.
 * R3-A2/W8 fix: 사용자 실 v2 profile에서 `profiles:`/`active:`/`git_branch:` 변형 발견.
 */
function detectUnsupportedV2Schema(v2Text) {
  const issues = [];
  if (/^profiles:\s*$/m.test(v2Text)) issues.push("'profiles:' 블록 (spec은 'presets:'을 요구)");
  if (/^active:\s/m.test(v2Text)) issues.push("'active:' 필드 (spec은 'default_preset:'을 요구)");
  if (/^active_profile:\s/m.test(v2Text)) issues.push("'active_profile:' 필드 (spec은 'default_preset:'을 요구)");
  if (/^\s+git_branch:\s/m.test(v2Text)) issues.push("'git_branch:' 단일 라인 (spec은 'git:' 블록 + use_branch 자식을 요구)");
  if (/&[\w-]+/.test(v2Text)) issues.push("YAML anchor (&...) 사용");
  if (/\*[\w-]+/.test(v2Text)) issues.push("YAML alias (*...) 사용");
  // C1 fix: 탭 들여쓰기 감지 — space-based regex가 매칭 실패하여 silent corruption 유발
  if (/^\t/m.test(v2Text)) issues.push("탭 들여쓰기 사용 — spec §5.1은 space 들여쓰기만 지원");
  // R3-W8 fix: 비정규 indent (spec §5.1은 2/4/6/8-space만 사용)
  const lines = v2Text.split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.match(/^( *)/)[1].length;
    // 0/2/4/6/8 외 indent는 spec 비정규
    if (indent !== 0 && indent !== 2 && indent !== 4 && indent !== 6 && indent !== 8) {
      issues.push(`비정규 indent (${indent}-space) 사용 — spec §5.1 example은 2/4/6/8-space만 지원`);
      break;
    }
  }
  // C2 fix: 알 수 없는 preset 필드 감지 — closed-set spec 위반 시 변환 거부
  const KNOWN_FIELDS = new Set([
    'team_mode', 'start_phase', 'tdd_mode', 'git', 'model_routing',
    'project_type', 'cross_model_preference', 'auto_update', 'label', 'description', 'notifications'
  ]);
  const presetFieldRe = /^( {4})([\w_]+):\s*(.*)$/gm;
  let m;
  while ((m = presetFieldRe.exec(v2Text)) !== null) {
    if (!KNOWN_FIELDS.has(m[2])) {
      const lineNum = v2Text.slice(0, m.index).split('\n').length;
      issues.push(`알 수 없는 preset 필드 '${m[2]}' (line ~${lineNum}) — spec §5.1 closed set 위반`);
      break; // first issue is enough
    }
  }
  return issues;
}

/**
 * v2 YAML 텍스트를 v3 YAML 텍스트로 변환.
 * - notifications.* 블록 전체 drop
 * - 자동 적용 필드(project_type/cross_model_preference/auto_update)는 그대로 보존
 * - team_mode/start_phase/tdd_mode/git/model_routing은 defaults 블록 안으로 이동
 *   (model_routing.plan: 'main'은 보존 — v6.4.0 D1 W1)
 * - interactive_each_session 배열 추가
 * - version: 3 추가
 * 라인 단위 변환이므로 v2 schema가 spec §5.1 example 형식을 따른다고 가정.
 * 검증된 형식 외(주석/anchor/alias/inline JSON 등)는 fallback으로 raw 보존 + 경고.
 */
function v2TextToV3Text(v2Text) {
  const lines = v2Text.split('\n');
  const out = [];
  const warnings = [];

  // version 갱신 / 추가
  let versionWritten = false;
  let inNotificationsBlock = false;
  let notificationsBlockIndent = -1;

  // preset 내부 필드 수집 → defaults 블록으로 재배치
  // 첫 패스에서 preset 단위로 raw 라인을 분류, 두 번째 패스에서 직렬화.
  const presets = {}; // name → { headerLines: [...], autoApply: [...], defaults: [...], skipped: [...] }
  let currentPreset = null;
  let inPresetsBlock = false;
  let presetsBlockIndent = -1;
  const preamble = []; // version, default_preset, presets: 헤더 등

  const MOVE_TO_DEFAULTS = new Set(['team_mode', 'start_phase', 'tdd_mode', 'git', 'model_routing']);
  const KEEP_AT_PRESET = new Set(['label', 'description', 'project_type', 'cross_model_preference', 'auto_update']);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // version handling (I4 fix: allow trailing comments e.g. "version: 2  # legacy")
    if (/^version:\s*\d+\s*(#.*)?$/.test(line)) {
      preamble.push('version: 3');
      versionWritten = true;
      continue;
    }
    if (/^default_preset:/.test(line) || /^presets:\s*$/.test(line)) {
      if (/^presets:\s*$/.test(line)) {
        inPresetsBlock = true;
        presetsBlockIndent = 0;
      }
      preamble.push(line);
      continue;
    }

    if (!inPresetsBlock) {
      if (line.trim() !== '') preamble.push(line);
      continue;
    }

    // preset 이름 라인 (e.g. "  solo-strict:")
    const presetNameMatch = line.match(/^( {2})([\w-]+):\s*$/);
    if (presetNameMatch) {
      currentPreset = presetNameMatch[2];
      presets[currentPreset] = {
        headerIndent: '  ',
        autoApply: [],     // project_type/cross_model_preference/auto_update/label/description
        defaults: {},      // team_mode/start_phase/tdd_mode/git/model_routing 의 raw 라인 그룹
        notificationsSkipped: false
      };
      continue;
    }

    if (!currentPreset) {
      // presets: 블록 안인데 preset 이름이 아닌 라인 (잘못된 형식). 보존.
      if (line.trim() !== '') preamble.push(line);
      continue;
    }

    // notifications 블록 전체 skip
    if (/^ {4}notifications:\s*$/.test(line)) {
      inNotificationsBlock = true;
      notificationsBlockIndent = 4;
      presets[currentPreset].notificationsSkipped = true;
      continue;
    }
    if (inNotificationsBlock) {
      // 들여쓰기가 4 초과면 notifications 블록 내부
      const indent = line.match(/^( *)/)[1].length;
      if (line.trim() !== '' && indent > notificationsBlockIndent) continue;
      inNotificationsBlock = false;
      notificationsBlockIndent = -1;
      // 현재 라인은 notifications 종료 — fallthrough하여 처리
    }

    // 4-space 들여쓰기 필드 (preset 내부 1차 필드)
    const fieldMatch = line.match(/^( {4})([\w_]+):\s*(.*)$/);
    if (fieldMatch) {
      const [, , field, value] = fieldMatch;
      if (MOVE_TO_DEFAULTS.has(field)) {
        // 이 필드 + 모든 자식 라인을 defaults 그룹으로 수집
        const group = [line];
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j];
          if (next.trim() === '') { group.push(next); j++; continue; }
          const nextIndent = next.match(/^( *)/)[1].length;
          if (nextIndent > 4) { group.push(next); j++; continue; }
          break;
        }
        // I1 fix: strip trailing blank lines to prevent leaking into serialized output
        while (group.length > 0 && group[group.length - 1].trim() === '') group.pop();
        presets[currentPreset].defaults[field] = group;
        i = j - 1;
        continue;
      }
      if (KEEP_AT_PRESET.has(field)) {
        const group = [line];
        let j = i + 1;
        while (j < lines.length) {
          const next = lines[j];
          if (next.trim() === '') { group.push(next); j++; continue; }
          const nextIndent = next.match(/^( *)/)[1].length;
          if (nextIndent > 4) { group.push(next); j++; continue; }
          break;
        }
        // I1 fix: strip trailing blank lines
        while (group.length > 0 && group[group.length - 1].trim() === '') group.pop();
        presets[currentPreset].autoApply.push(...group);
        i = j - 1;
        continue;
      }
      // 알 수 없는 필드는 detectUnsupportedV2Schema에서 이미 감지되어 migrateProfile에서 throw됨.
      // 이 경로는 v2TextToV3Text가 직접 호출되는 경우를 위한 안전망.
      warnings.push(`알 수 없는 preset 필드: ${field} — 변환 건너뜀`);
    }
  }

  // 직렬화
  if (!versionWritten) preamble.unshift('version: 3');
  out.push(...preamble);

  for (const [name, p] of Object.entries(presets)) {
    out.push(`  ${name}:`);
    out.push(...p.autoApply);
    out.push('    interactive_each_session:');
    for (const item of ['team_mode', 'start_phase', 'tdd_mode', 'git', 'model_routing']) {
      out.push(`      - ${item}`);
    }
    out.push('    defaults:');
    // defaults 안의 그룹들은 4-space 들여쓰기 → 6-space로 재들여쓰기
    for (const field of ['team_mode', 'start_phase', 'tdd_mode', 'git', 'model_routing']) {
      const group = p.defaults[field];
      if (!group) {
        // v2에 없던 필드 — fallback default
        const fallbacks = {
          team_mode: '      team_mode: solo',
          start_phase: '      start_phase: research',
          tdd_mode: '      tdd_mode: strict',
          git: '      git:\n        use_worktree: false\n        use_branch: true',
          model_routing: '      model_routing:\n        brainstorm: main\n        research: sonnet\n        plan: main\n        implement: sonnet\n        test: haiku'
        };
        out.push(fallbacks[field]);
        continue;
      }
      for (const gline of group) {
        // model_routing.plan: 'main'은 그대로 보존 (변환 안 함)
        // 4-space → 6-space 재들여쓰기 (단일 INDENT_MAP 사용 — R3-A1 fix)
        out.push(remapIndent(gline));
      }
    }
  }

  return { text: out.join('\n'), warnings };
}

function readVersion(yamlText) {
  // I4 fix: handle trailing comments e.g. "version: 2  # legacy"
  const m = yamlText.match(/^version:\s*(\d+)\s*(#.*)?$/m);
  return m ? Number.parseInt(m[1], 10) : null;
}

// ── Lock with stale PID detection (no infinite recursion) ──

function acquireLock(lockPath) {
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  }
}

/**
 * stale lock 판정. ESRCH → dead PID → stale. EPERM → alive other-user → not stale.
 * R3-W2 fix: EPERM은 다른 user가 소유한 live process — stale 아님.
 */
function isStaleLock(lockPath) {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return true;
    process.kill(pid, 0); // throws ESRCH if dead, EPERM if alive but other-user
    return false; // alive
  } catch (e) {
    if (e.code === 'ESRCH') return true; // dead PID → stale
    if (e.code === 'EPERM') return false; // alive (다른 user 소유 — R3-W2 fix: 안전 default)
    return false; // 모르면 alive 가정 (lock 보존)
  }
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
}

/**
 * 신규 v3 profile 작성 (마이그레이션이 not-found일 때 호출).
 * @param profilePath 프로필 파일 절대 경로
 * @param defaultPreset 옵션, default_preset 이름 (R3-W3 fix — 사용자 --profile=X 의도 반영용)
 */
function createV3Profile(profilePath, defaultPreset = 'solo-strict') {
  // R3-D fix: defensive sanitization (PROFILE_NAME_ALLOWLIST — CLI 외 다른 호출 경로 보호)
  if (!/^[a-z0-9][a-z0-9_-]{0,30}$/i.test(defaultPreset)) {
    throw new Error(`잘못된 프리셋 이름: ${defaultPreset} (영문/숫자/-/_만 허용, ≤31자)`);
  }
  // R3-G fix: parent directory 미존재 시 ENOENT 회피
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });

  const v3Text = `version: 3
default_preset: ${defaultPreset}
presets:
  ${defaultPreset}:
    label: ${defaultPreset === 'solo-strict' ? 'Solo + Strict TDD' : defaultPreset}
    description: ${defaultPreset === 'solo-strict' ? '단독 작업 + Strict TDD 기본값' : '사용자 정의 프리셋 — /deep-work --setup으로 편집'}
    project_type: zero-base
    cross_model_preference:
      use_codex: false
      use_gemini: false
    auto_update: prompt
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
  const tmp = profilePath + '.v3-tmp';
  fs.writeFileSync(tmp, v3Text, { mode: 0o600 });
  const fd = fs.openSync(tmp, 'r+');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, profilePath);
  return { created: true, default_preset: defaultPreset };
}

function migrateProfile(profilePath, opts = {}) {
  const { _retryDepth = 0 } = opts;
  if (_retryDepth > 2) {
    throw new Error('migrate-profile: lock acquisition retry exhausted (3 attempts)');
  }
  if (!fs.existsSync(profilePath)) return { migrated: false, reason: 'not-found' };
  const text = fs.readFileSync(profilePath, 'utf8');
  const version = readVersion(text);
  if (version === 3) return { migrated: false, reason: 'already-v3' };
  if (version != null && version > 3) {
    throw new Error(`알 수 없는 프로필 버전 ${version} — 플러그인 업데이트가 필요할 수 있습니다`);
  }

  // R3-A2 fix: 미지원 v2 schema 변형 감지 (version rewrite 전에 체크 — silent corruption 방지)
  const schemaIssues = detectUnsupportedV2Schema(text);
  if (schemaIssues.length > 0) {
    const guide = [
      `프로필 형식이 v6.4.2 자동 마이그레이션이 지원하는 spec §5.1 example 형식과 다릅니다.`,
      `미지원 요소: ${schemaIssues.join(', ')}`,
      ``,
      `수동 이전 가이드:`,
      `1. ${profilePath}을 백업: cp "${profilePath}" "${profilePath}.manual-backup"`,
      `2. spec §5.1 example을 참조하여 'profiles:' → 'presets:', 'active:' → 'default_preset:'`,
      `   'git_branch: <bool>' → 'git:' 블록 + '  use_branch: <bool>' 자식 (들여쓰기 2-space)으로 정렬`,
      `3. /deep-work 재실행 시 자동 마이그레이션이 정상 동작합니다`,
      ``,
      `또는 새 프로필을 작성하려면: rm "${profilePath}" 후 /deep-work 재실행 (createV3Profile 호출됨)`,
    ].join('\n');
    throw new Error(`v2 profile 변형 감지 — 자동 마이그레이션 거부:\n${guide}`);
  }

  const lockPath = path.join(path.dirname(profilePath), '.deep-work-profile.lock');
  if (!acquireLock(lockPath)) {
    // 5초 polling
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (!fs.existsSync(lockPath)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    if (fs.existsSync(lockPath)) {
      // 5초 후에도 lock 존재 — stale 검사
      if (isStaleLock(lockPath)) {
        releaseLock(lockPath); // 강제 해제
      } else {
        throw new Error(
          `migrate-profile: lock held by another process for >5s at ${lockPath}. ` +
          `다른 deep-work 세션이 마이그레이션 중일 수 있습니다. 잠시 후 재시도하세요.`
        );
      }
    }
    return migrateProfile(profilePath, { _retryDepth: _retryDepth + 1 });
  }

  try {
    // 1. backup (이미 .v2-backup 있으면 skip — 첫 backup 보존)
    const backupPath = profilePath + '.v2-backup';
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath + '.tmp', text, { mode: 0o600 });
      fs.renameSync(backupPath + '.tmp', backupPath);
    }
    // 2. native YAML 변환
    const { text: v3Text, warnings } = v2TextToV3Text(text);
    // 3. write v3-tmp + fsync + atomic rename, mode 0o600
    const tmpPath = profilePath + '.v3-tmp';
    fs.writeFileSync(tmpPath, v3Text, { mode: 0o600 });
    const fd = fs.openSync(tmpPath, 'r+');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmpPath, profilePath);

    return { migrated: true, reason: 'v2-to-v3', warnings };
  } finally {
    releaseLock(lockPath);
  }
}

module.exports = { migrateProfile, readVersion, v2TextToV3Text, createV3Profile, isStaleLock };

// ── CLI entrypoint (orchestrator/regression test가 직접 호출) ──
if (require.main === module) {
  const profilePath = process.argv[2];
  if (!profilePath) {
    process.stderr.write('Usage: node migrate-profile-v2-to-v3.js <profile-path>\n');
    process.exit(2);
  }
  try {
    const result = migrateProfile(profilePath);
    if (result.migrated === false && result.reason === 'not-found') {
      // 신규 프로필 작성. 사용자가 --profile=X로 호출했다면 그 이름을 default_preset으로
      // R3-W3 fix: orchestrator가 환경변수 DEEP_WORK_INITIAL_PRESET=X를 전달
      const initialPreset = process.env.DEEP_WORK_INITIAL_PRESET || 'solo-strict';
      createV3Profile(profilePath, initialPreset);
      process.stdout.write(JSON.stringify({
        migrated: false,
        reason: 'not-found-created-v3',
        default_preset: initialPreset
      }) + '\n');
    } else {
      process.stdout.write(JSON.stringify(result) + '\n');
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`migrate-profile error: ${e.message}\n`);
    process.exit(1);
  }
}
