# 자동 모델 선택 (Auto Model Selection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** deep-work 세션 초기화에서 model_routing 유저 질문을 제거하고, 코드베이스 규모·작업 난이도 기반으로 AI가 phase별 모델을 자동 선택하며 Claude Code/Codex 양쪽 런타임에서 각자에 맞는 모델로 해석되게 한다.

**Architecture:** 순수 Node 엔진(`runtime/model-routing-runtime.js` + `runtime/model-catalog.js` + `scripts/detect-runtime.js`)이 결정론적 신호로 baseline tier를 산출하고 session-recommender의 `task_difficulty`로 ±1 보정한 뒤, 런타임별 카탈로그로 concrete 모델명을 해석해 세션 init 시 state에 기록한다(승인 설계 r2 접근 A: init 해석 + resume 재해석). 소비 skill 중 research/test는 무변경, implement는 per-slice tier 규칙(설계 §2.5)으로 resolver 호출이 추가된다.

**Tech Stack:** Node 22+ (`package.json` `engines.node >=22`; zero-dep, `node --test`), YAML frontmatter state, 마크다운 SKILL.md 프롬프트 배선.

> **개정 r2**: plan 리뷰(episode `004-deep-review`, CONCERN — `docs/reviews/2026-07-19-plan-review-auto-model-selection.md`) Medium 2건(M-1 deep-finish payload 커버, M-2 validateRecommendation RED 테스트) + Low 6건 반영.

**Spec:** `docs/design/auto-model-selection.md` (r2, 커밋 19f887f). 리뷰: `docs/reviews/2026-07-19-design-review-auto-model-selection.md` (CONCERN — Medium 3건 해소 규칙 포함).

## Global Constraints

- Node 22+ (`engines.node >=22`) / zero-dependency. 테스트는 `node --test`(개별) / `npm test`(전체, `test:all` glob이 `runtime/**/*.test.js`·`scripts/**/*.test.js`를 자동 포함). 신규 테스트 파일은 **해당 디렉터리의 기존 테스트 import 스타일**(`require('node:test')` 계열)을 따른다.
- 파일 스타일: 기존 `runtime/*.js`의 `'use strict'` + 압축 서술 스타일을 따르되 가독성 유지.
- tier 어휘: `light` / `standard` / `deep` + sentinel `main`(세션 모델, 카탈로그 미해석). 이 문자열은 절대 Agent spawn `model=`로 직접 전달되지 않는다 — state에는 항상 concrete 값 또는 `main`만 저장.
- 하위 호환: 기존 프로필/state 파일을 강제 수정하지 않는다. `model_routing_meta`는 옵셔널 신규 필드.
- 불변식(설계 §3.3): 어떤 경우에도 Claude 모델명이 Codex 경로에 전달되지 않는다(역방향 동일). 런타임 판별 불가 → 전 phase `main`.
- 커밋: 태스크당 1커밋, `git add <명시 경로>` (`-A` 금지), HEREDOC 메시지 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- 버전: 완료 시 6.9.4 → **6.10.0** (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`) + CHANGELOG en/ko. deep-suite 마켓플레이스 동기화는 이 repo PR 범위 밖(머지 후 별도).

---

### Task 1: runtime/model-catalog.js — tier→모델 카탈로그

**Files:**
- Create: `runtime/model-catalog.js`
- Test: `runtime/model-catalog.test.js`

**Interfaces:**
- Consumes: 없음 (zero-dep leaf 모듈)
- Produces: `TIERS` (`['light','standard','deep']`), `MAIN` (`'main'`), `CATALOG_VERSION` (number), `DEFAULT_CATALOG`, `mergeCatalog(override) → catalog`, `resolveTier(tier, runtime, catalog?) → { model, warning }`, `concreteModelsFor(runtime, catalog?) → string[]`, `allConcreteModels(catalog?) → string[]`. 이후 Task 4/5/8이 이 시그니처를 그대로 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `runtime/model-catalog.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TIERS, MAIN, CATALOG_VERSION, DEFAULT_CATALOG, mergeCatalog, resolveTier,
  concreteModelsFor, allConcreteModels } = require('./model-catalog.js');

test('TIERS/MAIN 어휘 고정', () => {
  assert.deepStrictEqual(TIERS, ['light', 'standard', 'deep']);
  assert.strictEqual(MAIN, 'main');
  assert.strictEqual(typeof CATALOG_VERSION, 'number');
});

test('claude 기본 카탈로그 해석', () => {
  assert.deepStrictEqual(resolveTier('light', 'claude'), { model: 'haiku', warning: null });
  assert.deepStrictEqual(resolveTier('standard', 'claude'), { model: 'sonnet', warning: null });
  assert.deepStrictEqual(resolveTier('deep', 'claude'), { model: 'opus', warning: null });
});

test('main sentinel은 카탈로그 미경유', () => {
  assert.deepStrictEqual(resolveTier('main', 'claude'), { model: 'main', warning: null });
  assert.deepStrictEqual(resolveTier('main', 'codex'), { model: 'main', warning: null });
});

test('unknown 런타임 → main fail-safe + 경고', () => {
  const r = resolveTier('standard', 'unknown');
  assert.strictEqual(r.model, 'main');
  assert.match(r.warning, /unknown/);
});

test('카탈로그 값 null(미pin) → main fail-safe + 경고', () => {
  // Task 12 pin 전 codex 슬롯은 null — 안전 degrade가 계약이다
  const r = resolveTier('standard', 'codex', DEFAULT_CATALOG);
  if (DEFAULT_CATALOG.codex.standard === null) {
    assert.strictEqual(r.model, 'main');
    assert.match(r.warning, /codex/);
  } else {
    assert.strictEqual(r.model, DEFAULT_CATALOG.codex.standard);
  }
});

test('잘못된 tier → main + 경고 (fail-safe, throw 금지)', () => {
  const r = resolveTier('opus', 'claude'); // concrete명은 tier가 아니다
  assert.strictEqual(r.model, 'main');
  assert.match(r.warning, /tier/);
});

test('mergeCatalog는 2-레벨 부분 override + 미지 키 무시', () => {
  const merged = mergeCatalog({ claude: { deep: 'opus-next' }, bogus: { light: 'x' } });
  assert.strictEqual(merged.claude.deep, 'opus-next');
  assert.strictEqual(merged.claude.light, 'haiku');
  assert.strictEqual(merged.bogus, undefined);
});

test('concreteModelsFor/allConcreteModels는 null 제외', () => {
  assert.deepStrictEqual(concreteModelsFor('claude'), ['haiku', 'sonnet', 'opus']);
  assert.ok(allConcreteModels().includes('sonnet'));
  assert.ok(!allConcreteModels().includes(null));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test runtime/model-catalog.test.js`
Expected: FAIL — `Cannot find module './model-catalog.js'`

- [ ] **Step 3: 최소 구현** — `runtime/model-catalog.js`

```js
'use strict';

const TIERS = Object.freeze(['light', 'standard', 'deep']);
const MAIN = 'main';
const CATALOG_VERSION = 1;
// codex 슬롯은 Task 12(실기 검증)에서 pin — 그 전까지 null = main fail-safe (설계 §3.2)
const DEFAULT_CATALOG = Object.freeze({
  claude: Object.freeze({ light: 'haiku', standard: 'sonnet', deep: 'opus', main: MAIN }),
  codex: Object.freeze({ light: null, standard: null, deep: null, main: MAIN }),
});

function mergeCatalog(override) {
  const merged = {};
  for (const runtime of Object.keys(DEFAULT_CATALOG)) {
    merged[runtime] = { ...DEFAULT_CATALOG[runtime] };
    const layer = override && typeof override === 'object' ? override[runtime] : null;
    if (!layer || typeof layer !== 'object') continue;
    for (const tier of [...TIERS, MAIN]) {
      if (typeof layer[tier] === 'string' && layer[tier]) merged[runtime][tier] = layer[tier];
    }
  }
  return merged;
}

function resolveTier(tier, runtime, catalog = DEFAULT_CATALOG) {
  if (tier === MAIN) return { model: MAIN, warning: null };
  if (!TIERS.includes(tier)) {
    return { model: MAIN, warning: `'${tier}'은(는) 유효한 tier가 아님 — main(세션 모델) fallback` };
  }
  const layer = catalog && catalog[runtime];
  if (!layer) return { model: MAIN, warning: `런타임 '${runtime}' 카탈로그 없음(unknown 포함) — main fallback` };
  const model = layer[tier];
  if (typeof model !== 'string' || !model) {
    return { model: MAIN, warning: `${runtime} 카탈로그의 '${tier}' 미지정(pin 전) — main fallback` };
  }
  return { model, warning: null };
}

function concreteModelsFor(runtime, catalog = DEFAULT_CATALOG) {
  const layer = catalog[runtime] || {};
  return TIERS.map((t) => layer[t]).filter((v) => typeof v === 'string' && v && v !== MAIN);
}

function allConcreteModels(catalog = DEFAULT_CATALOG) {
  return Object.keys(catalog).flatMap((r) => concreteModelsFor(r, catalog));
}

module.exports = { TIERS, MAIN, CATALOG_VERSION, DEFAULT_CATALOG, mergeCatalog, resolveTier,
  concreteModelsFor, allConcreteModels };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test runtime/model-catalog.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add runtime/model-catalog.js runtime/model-catalog.test.js
git commit -m "$(cat <<'EOF'
feat(model-routing): tier→모델 카탈로그 모듈 (claude 기본값, codex는 pin 전 null fail-safe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: scripts/detect-runtime.js — 호스트 런타임 감지

**Files:**
- Create: `scripts/detect-runtime.js`
- Test: `scripts/detect-runtime.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `detectRuntime(env) → 'claude'|'codex'|'unknown'`, `CODEX_ENV_MARKERS: string[]`, `CLAUDE_ENV_MARKERS: string[]`. Task 6 CLI와 Task 11 SKILL.md 배선, Task 12 pin이 사용.

- [ ] **Step 1: 실패하는 테스트 작성** — `scripts/detect-runtime.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectRuntime, CODEX_ENV_MARKERS, CLAUDE_ENV_MARKERS } = require('./detect-runtime.js');

test('명시 override가 최우선 (대소문자 무시)', () => {
  assert.strictEqual(detectRuntime({ DEEP_WORK_RUNTIME: 'codex', CLAUDE_PLUGIN_ROOT: '/x' }), 'codex');
  assert.strictEqual(detectRuntime({ DEEP_WORK_RUNTIME: 'Claude', CODEX_HOME: '/y' }), 'claude');
});

test('override 무효값은 무시하고 마커 감지로 진행', () => {
  assert.strictEqual(detectRuntime({ DEEP_WORK_RUNTIME: 'gpt', CLAUDE_PLUGIN_ROOT: '/x' }), 'claude');
});

test('codex 마커 > claude 마커 (codex 세션 안에서 claude 잔존 env 오탐 방지)', () => {
  const env = { CODEX_HOME: '/home/u/.codex', CLAUDE_PLUGIN_ROOT: '/stale' };
  assert.strictEqual(detectRuntime(env), 'codex');
});

test('claude 마커 단독', () => {
  assert.strictEqual(detectRuntime({ CLAUDE_PLUGIN_ROOT: '/p' }), 'claude');
  assert.strictEqual(detectRuntime({ CLAUDECODE: '1' }), 'claude');
  assert.strictEqual(detectRuntime({ CLAUDE_CODE_ENTRYPOINT: 'cli' }), 'claude');
});

test('마커 부재 → unknown (fail-safe)', () => {
  assert.strictEqual(detectRuntime({}), 'unknown');
  assert.strictEqual(detectRuntime({ PATH: '/usr/bin' }), 'unknown');
});

test('마커 목록은 비어있지 않은 export', () => {
  assert.ok(CODEX_ENV_MARKERS.length >= 1);
  assert.ok(CLAUDE_ENV_MARKERS.length >= 1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test scripts/detect-runtime.test.js`
Expected: FAIL — `Cannot find module './detect-runtime.js'`

- [ ] **Step 3: 최소 구현** — `scripts/detect-runtime.js`

```js
'use strict';
// 호스트 런타임 감지 (설계 §3.1). 마커 우선순위: 명시 override > codex > claude > unknown.
// codex 마커를 claude보다 먼저 보는 이유: codex 세션이 claude 관련 잔존 env를 물려받는
// 오염 시나리오에서 codex가 이겨야 Claude 모델명 유출(§3.3 불변식 위반)을 막는다.
// CODEX_ENV_MARKERS는 Task 12(실기 검증)에서 관측 근거로 갱신될 수 있다.
const CODEX_ENV_MARKERS = Object.freeze(['CODEX_HOME']);
const CLAUDE_ENV_MARKERS = Object.freeze(['CLAUDE_PLUGIN_ROOT', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']);

function detectRuntime(env = process.env) {
  const override = String(env.DEEP_WORK_RUNTIME || '').toLowerCase();
  if (override === 'claude' || override === 'codex') return override;
  if (CODEX_ENV_MARKERS.some((k) => env[k])) return 'codex';
  if (CLAUDE_ENV_MARKERS.some((k) => env[k])) return 'claude';
  return 'unknown';
}

module.exports = { detectRuntime, CODEX_ENV_MARKERS, CLAUDE_ENV_MARKERS };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test scripts/detect-runtime.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add scripts/detect-runtime.js scripts/detect-runtime.test.js
git commit -m "$(cat <<'EOF'
feat(model-routing): 호스트 런타임 감지 모듈 (override > codex > claude > unknown)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: model-routing-runtime — 신호 수집 + 규모 분류

**Files:**
- Create: `runtime/model-routing-runtime.js`
- Test: `runtime/model-routing-runtime.test.js`

**Interfaces:**
- Consumes: `node:fs`, `node:path`, `node:child_process`(execFileSync — 주입 가능)
- Produces: `collectCodebaseSignals(root, deps?) → { tracked_files, loc_estimate, languages, has_tests, deps_count, errors }`(각 필드 nullable), `classifyRepoScale(signals) → 'small'|'medium'|'large'`, 상수 `SCALE_SMALL_MAX=200`, `SCALE_MEDIUM_MAX=2000`, `FS_WALK_CAP=5000`, `LOC_SAMPLE_CAP=200`. Task 4/5가 같은 파일에 함수를 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `runtime/model-routing-runtime.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectCodebaseSignals, classifyRepoScale, SCALE_SMALL_MAX, SCALE_MEDIUM_MAX,
} = require('./model-routing-runtime.js');

function makeFixture(fileCount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-sig-'));
  fs.mkdirSync(path.join(dir, 'src'));
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(path.join(dir, 'src', `f${i}.js`), 'const a = 1;\nconst b = 2;\n');
  }
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'tests', 'a.test.js'), 'test();\n');
  fs.writeFileSync(path.join(dir, 'package.json'),
    JSON.stringify({ dependencies: { x: '1' }, devDependencies: { y: '1' } }));
  return dir;
}

test('fs walk 기반 신호 수집 (비-git 픽스처)', () => {
  const dir = makeFixture(10);
  const s = collectCodebaseSignals(dir, { gitLsFiles: () => null }); // git 경로 강제 차단
  assert.strictEqual(typeof s.tracked_files, 'number');
  assert.ok(s.tracked_files >= 11); // src 10 + tests 1 (+ package.json은 소스 외)
  assert.ok(s.loc_estimate > 0);
  assert.ok(s.languages >= 1);
  assert.strictEqual(s.has_tests, true);
  assert.strictEqual(s.deps_count, 2);
  assert.deepStrictEqual(s.errors, []);
});

test('git ls-files 성공 시 그 count를 사용', () => {
  const dir = makeFixture(3);
  const s = collectCodebaseSignals(dir, { gitLsFiles: () => ['a.js', 'b.js', 'c.py', 'd.md'] });
  assert.strictEqual(s.tracked_files, 4);
});

test('수집 실패 시 null + errors 기록 (throw 금지)', () => {
  const s = collectCodebaseSignals('/nonexistent-path-xyz', { gitLsFiles: () => null });
  assert.strictEqual(s.tracked_files, null);
  assert.ok(s.errors.length >= 1);
});

test('규모 분류: tracked_files 우선, null→medium (리뷰 Low-7)', () => {
  assert.strictEqual(classifyRepoScale({ tracked_files: SCALE_SMALL_MAX - 1 }), 'small');
  assert.strictEqual(classifyRepoScale({ tracked_files: SCALE_SMALL_MAX }), 'medium');
  assert.strictEqual(classifyRepoScale({ tracked_files: SCALE_MEDIUM_MAX }), 'large');
  assert.strictEqual(classifyRepoScale({ tracked_files: null }), 'medium');
  assert.strictEqual(classifyRepoScale({}), 'medium');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test runtime/model-routing-runtime.test.js`
Expected: FAIL — `Cannot find module './model-routing-runtime.js'`

- [ ] **Step 3: 최소 구현** — `runtime/model-routing-runtime.js`

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCALE_SMALL_MAX = 200;
const SCALE_MEDIUM_MAX = 2000;
const FS_WALK_CAP = 5000;
const LOC_SAMPLE_CAP = 200;
const LOC_FILE_BYTE_CAP = 1024 * 1024;
const SOURCE_EXTS = Object.freeze(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.rb', '.go',
  '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.sh', '.ps1']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.claude', '.deep-work', '.deep-loop']);

function defaultGitLsFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', timeout: 3000 });
    return out.split('\n').filter(Boolean);
  } catch { return null; }
}

function walkFiles(root, cap) {
  const out = []; const stack = [root];
  while (stack.length && out.length < cap) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (out.length >= cap) break;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(path.join(dir, e.name)); }
      else if (e.isFile()) out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function collectCodebaseSignals(root, deps = {}) {
  const gitLsFiles = deps.gitLsFiles || defaultGitLsFiles;
  const errors = [];
  let files = null;
  const tracked = gitLsFiles(root);
  if (Array.isArray(tracked)) files = tracked.map((f) => path.join(root, f));
  else {
    try {
      if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
      files = walkFiles(root, FS_WALK_CAP);
    } catch (e) { errors.push(`walk: ${e.message}`); }
  }
  if (files === null) {
    return { tracked_files: null, loc_estimate: null, languages: null, has_tests: null, deps_count: null, errors };
  }
  const sourceFiles = files.filter((f) => SOURCE_EXTS.includes(path.extname(f).toLowerCase()));
  const exts = new Set(sourceFiles.map((f) => path.extname(f).toLowerCase()));
  const sample = sourceFiles.slice(0, LOC_SAMPLE_CAP);
  let sampleLoc = 0; let sampled = 0;
  for (const f of sample) {
    try {
      const st = fs.statSync(f);
      if (st.size > LOC_FILE_BYTE_CAP) continue;
      sampleLoc += fs.readFileSync(f, 'utf8').split('\n').length; sampled += 1;
    } catch { /* 개별 파일 실패는 무시 — 샘플에서 제외 */ }
  }
  const locEstimate = sampled > 0 ? Math.round((sampleLoc / sampled) * sourceFiles.length) : null;
  const hasTests = files.some((f) => {
    const rel = path.relative(root, f);
    return /(^|[\\/])(tests?|__tests__|spec)([\\/])/.test(rel) || /\.(test|spec)\.[a-z]+$/.test(rel);
  });
  let depsCount = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    depsCount = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
  } catch { /* 매니페스트 없음 — null 유지 */ }
  return { tracked_files: files.length, loc_estimate: locEstimate, languages: exts.size,
    has_tests: hasTests, deps_count: depsCount, errors };
}

function classifyRepoScale(signals = {}) {
  const n = signals.tracked_files;
  if (typeof n !== 'number') return 'medium'; // null/부재 → medium 수렴 (리뷰 Low-7: LOC은 보조 신호)
  if (n < SCALE_SMALL_MAX) return 'small';
  if (n < SCALE_MEDIUM_MAX) return 'medium';
  return 'large';
}

module.exports = { SCALE_SMALL_MAX, SCALE_MEDIUM_MAX, FS_WALK_CAP, LOC_SAMPLE_CAP,
  collectCodebaseSignals, classifyRepoScale };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test runtime/model-routing-runtime.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add runtime/model-routing-runtime.js runtime/model-routing-runtime.test.js
git commit -m "$(cat <<'EOF'
feat(model-routing): 코드베이스 신호 수집 + 규모 분류 (샘플링 캡, null-안전)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: model-routing-runtime — baseline tier + 난이도 보정 + per-slice 규칙

**Files:**
- Modify: `runtime/model-routing-runtime.js` (Task 3 파일에 함수 추가)
- Test: `runtime/model-routing-runtime.test.js` (테스트 추가)

**Interfaces:**
- Consumes: Task 1 `TIERS`/`MAIN`, Task 3 `classifyRepoScale`
- Produces: `PHASES=['brainstorm','research','plan','implement','test']`, `DIFFICULTY=['low','medium','high']`, `tierIndex(t)→0|1|2`, `shiftTier(tier, offset)→tier`(clamp), `baselineTiers(signals, taskText) → { tiers, scale, reasons }`, `applyDifficulty(tiers, difficulty) → tiers`, `sizeToTier(size)→tier|null`, `sliceModelTier(sessionImplementTier, size)→tier`. Task 5의 `decideModelRouting`과 Task 11 deep-implement 배선이 사용.

- [ ] **Step 1: 실패하는 테스트 추가** — `runtime/model-routing-runtime.test.js`에 append

```js
const { PHASES, DIFFICULTY, tierIndex, shiftTier, baselineTiers, applyDifficulty,
  sizeToTier, sliceModelTier } = require('./model-routing-runtime.js');

test('baseline 규칙표 (설계 §2.2 전 분기)', () => {
  const small = baselineTiers({ tracked_files: 50 }, '작업');
  assert.deepStrictEqual(small.tiers,
    { brainstorm: 'main', research: 'light', plan: 'main', implement: 'standard', test: 'light' });
  assert.strictEqual(small.scale, 'small');
  const medium = baselineTiers({ tracked_files: 500 }, '작업');
  assert.deepStrictEqual(medium.tiers,
    { brainstorm: 'main', research: 'standard', plan: 'main', implement: 'standard', test: 'light' });
  const large = baselineTiers({ tracked_files: 5000, languages: 2 }, '작업');
  assert.deepStrictEqual(large.tiers,
    { brainstorm: 'main', research: 'standard', plan: 'main', implement: 'deep', test: 'standard' });
});

test('대형+다언어(>=4) → research deep 상향', () => {
  const b = baselineTiers({ tracked_files: 5000, languages: 4 }, '작업');
  assert.strictEqual(b.tiers.research, 'deep');
});

test('소형+좁은 task 키워드 → implement light 하향', () => {
  const b = baselineTiers({ tracked_files: 50 }, 'typo fix 한 줄 수정');
  assert.strictEqual(b.tiers.implement, 'light');
});

test('난이도 보정: research/implement/test만 ±1, main 불변, clamp', () => {
  const base = { brainstorm: 'main', research: 'standard', plan: 'main', implement: 'deep', test: 'light' };
  const high = applyDifficulty(base, 'high');
  assert.deepStrictEqual(high,
    { brainstorm: 'main', research: 'deep', plan: 'main', implement: 'deep', test: 'standard' }); // deep은 상한 clamp
  const low = applyDifficulty(base, 'low');
  assert.deepStrictEqual(low,
    { brainstorm: 'main', research: 'light', plan: 'main', implement: 'standard', test: 'light' }); // light 하한 clamp
  assert.deepStrictEqual(applyDifficulty(base, 'medium'), base);
  assert.deepStrictEqual(applyDifficulty(base, null), base); // 부재 → 무보정
});

test('sizeToTier 매핑', () => {
  assert.strictEqual(sizeToTier('S'), 'light');
  assert.strictEqual(sizeToTier('M'), 'standard');
  assert.strictEqual(sizeToTier('L'), 'standard');
  assert.strictEqual(sizeToTier('XL'), 'deep');
  assert.strictEqual(sizeToTier('??'), null);
  assert.strictEqual(sizeToTier(undefined), null);
});

test('per-slice 규칙 (설계 §2.5): 세션 standard = 기존 slice-size auto와 동일', () => {
  assert.strictEqual(sliceModelTier('standard', 'S'), 'light');     // → haiku on Claude
  assert.strictEqual(sliceModelTier('standard', 'M'), 'standard');  // → sonnet
  assert.strictEqual(sliceModelTier('standard', 'L'), 'standard');
  assert.strictEqual(sliceModelTier('standard', 'XL'), 'deep');     // → opus
});

test('per-slice 규칙: offset 시프트 + clamp + size 부재 fallback', () => {
  assert.strictEqual(sliceModelTier('deep', 'S'), 'standard');  // +1 시프트
  assert.strictEqual(sliceModelTier('deep', 'XL'), 'deep');     // 상한 clamp
  assert.strictEqual(sliceModelTier('light', 'M'), 'light');    // -1 시프트
  assert.strictEqual(sliceModelTier('light', 'S'), 'light');    // 하한 clamp
  assert.strictEqual(sliceModelTier('standard', undefined), 'standard'); // size 부재 → 세션값
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test runtime/model-routing-runtime.test.js`
Expected: FAIL — `baselineTiers is not a function` (기존 4 tests는 PASS 유지)

- [ ] **Step 3: 구현** — `runtime/model-routing-runtime.js`에 추가 (module.exports 갱신 포함)

```js
const { TIERS, MAIN } = require('./model-catalog.js');

const PHASES = Object.freeze(['brainstorm', 'research', 'plan', 'implement', 'test']);
const DIFFICULTY = Object.freeze(['low', 'medium', 'high']);
const NARROW_TASK_RE = /\b(fix|typo|oneline|one-line)\b|한\s*줄|오타/i;

function tierIndex(tier) { return TIERS.indexOf(tier); }
function shiftTier(tier, offset) {
  const i = tierIndex(tier);
  if (i < 0) return tier; // main 등 비-tier는 불변
  return TIERS[Math.min(TIERS.length - 1, Math.max(0, i + offset))];
}

function baselineTiers(signals = {}, taskText = '') {
  const scale = classifyRepoScale(signals);
  const reasons = [`규모 ${scale} (tracked_files=${signals.tracked_files ?? 'null'})`];
  const tiers = { brainstorm: MAIN, research: 'standard', plan: MAIN, implement: 'standard', test: 'light' };
  if (scale === 'small') tiers.research = 'light';
  if (scale === 'large') { tiers.implement = 'deep'; tiers.test = 'standard'; }
  if (scale === 'large' && (signals.languages ?? 0) >= 4) {
    tiers.research = 'deep'; reasons.push(`다언어(${signals.languages}) → research deep`);
  }
  if (scale === 'small' && NARROW_TASK_RE.test(String(taskText))) {
    tiers.implement = 'light'; reasons.push('좁은 task 키워드 → implement light');
  }
  return { tiers, scale, reasons };
}

function applyDifficulty(tiers, difficulty) {
  if (difficulty !== 'high' && difficulty !== 'low') return { ...tiers };
  const offset = difficulty === 'high' ? 1 : -1;
  const out = { ...tiers };
  for (const phase of ['research', 'implement', 'test']) out[phase] = shiftTier(out[phase], offset);
  return out;
}

function sizeToTier(size) {
  if (size === 'S') return 'light';
  if (size === 'M' || size === 'L') return 'standard';
  if (size === 'XL') return 'deep';
  return null;
}

function sliceModelTier(sessionImplementTier, size) {
  const base = sizeToTier(size);
  if (base === null) return sessionImplementTier;
  const offset = tierIndex(sessionImplementTier) - tierIndex('standard');
  return shiftTier(base, offset);
}
```

`module.exports`에 `PHASES, DIFFICULTY, tierIndex, shiftTier, baselineTiers, applyDifficulty, sizeToTier, sliceModelTier` 추가.

- [ ] **Step 4: 통과 확인**

Run: `node --test runtime/model-routing-runtime.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add runtime/model-routing-runtime.js runtime/model-routing-runtime.test.js
git commit -m "$(cat <<'EOF'
feat(model-routing): baseline 규칙표 + 난이도 ±1 보정 + per-slice tier 규칙 (설계 §2.2/§2.3/§2.5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: model-routing-runtime — decideModelRouting (우선순위 + 해석 + meta)

**Files:**
- Modify: `runtime/model-routing-runtime.js`
- Test: `runtime/model-routing-runtime.test.js`

**Interfaces:**
- Consumes: Task 1 `resolveTier`/`mergeCatalog`/`concreteModelsFor`/`CATALOG_VERSION`, Task 4 전부
- Produces: `decideModelRouting({ signals, taskText, difficulty, runtime, catalogOverride, pinned }) → { model_routing, meta, warnings }`. `model_routing`은 phase→concrete(또는 `main`) 맵, `meta = { tiers, scale, signals_summary, difficulty, reasons, runtime, catalog_version, pinned, decided_at }`. Task 6 CLI와 Task 11 배선이 이 반환 형태를 그대로 직렬화한다.

- [ ] **Step 1: 실패하는 테스트 추가**

```js
const { decideModelRouting } = require('./model-routing-runtime.js');

test('엔진 자동 경로: claude 런타임 해석 + meta 병행 기록', () => {
  const r = decideModelRouting({ signals: { tracked_files: 500 }, taskText: '기능 추가',
    difficulty: 'medium', runtime: 'claude' });
  assert.deepStrictEqual(r.model_routing,
    { brainstorm: 'main', research: 'sonnet', plan: 'main', implement: 'sonnet', test: 'haiku' });
  assert.deepStrictEqual(r.meta.tiers,
    { brainstorm: 'main', research: 'standard', plan: 'main', implement: 'standard', test: 'light' });
  assert.strictEqual(r.meta.runtime, 'claude');
  assert.strictEqual(typeof r.meta.catalog_version, 'number');
  assert.strictEqual(typeof r.meta.decided_at, 'string');
  assert.deepStrictEqual(r.warnings, []);
});

test('unknown 런타임 → 전 phase main + 경고 (설계 §3.1 fail-safe)', () => {
  const r = decideModelRouting({ signals: { tracked_files: 500 }, taskText: 't', runtime: 'unknown' });
  for (const phase of ['research', 'implement', 'test']) assert.strictEqual(r.model_routing[phase], 'main');
  assert.ok(r.warnings.length >= 1);
});

test('pinned tier는 tier를 교체 후 해석', () => {
  const r = decideModelRouting({ signals: { tracked_files: 500 }, taskText: 't', runtime: 'claude',
    pinned: { implement: 'deep' } });
  assert.strictEqual(r.model_routing.implement, 'opus');
  assert.strictEqual(r.meta.tiers.implement, 'deep');
  assert.deepStrictEqual(r.meta.pinned, { implement: 'deep' });
});

test('pinned concrete(현재 런타임)는 그대로 통과', () => {
  const r = decideModelRouting({ signals: { tracked_files: 500 }, taskText: 't', runtime: 'claude',
    pinned: { implement: 'opus' } });
  assert.strictEqual(r.model_routing.implement, 'opus');
});

test('pinned concrete(런타임 불일치)는 거부+경고 후 자동값 (리뷰 Low-6)', () => {
  const r = decideModelRouting({ signals: { tracked_files: 500 }, taskText: 't', runtime: 'codex',
    pinned: { implement: 'opus' } });
  assert.notStrictEqual(r.model_routing.implement, 'opus'); // codex 경로에 Claude명 유출 금지
  assert.ok(r.warnings.some((w) => /opus/.test(w)));
});

test('brainstorm/plan pinned는 거부+경고 (main 고정)', () => {
  const r = decideModelRouting({ signals: { tracked_files: 500 }, taskText: 't', runtime: 'claude',
    pinned: { plan: 'opus' } });
  assert.strictEqual(r.model_routing.plan, 'main');
  assert.ok(r.warnings.some((w) => /plan/.test(w)));
});

test('catalogOverride 반영', () => {
  const r = decideModelRouting({ signals: { tracked_files: 500 }, taskText: 't', runtime: 'claude',
    catalogOverride: { claude: { standard: 'sonnet-next' } } });
  assert.strictEqual(r.model_routing.research, 'sonnet-next');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test runtime/model-routing-runtime.test.js`
Expected: FAIL — `decideModelRouting is not a function`

- [ ] **Step 3: 구현** — `runtime/model-routing-runtime.js`에 추가

```js
const { resolveTier, mergeCatalog, concreteModelsFor, CATALOG_VERSION } = require('./model-catalog.js');

function decideModelRouting({ signals = {}, taskText = '', difficulty = null, runtime = 'unknown',
  catalogOverride = null, pinned = {} } = {}) {
  const warnings = [];
  const catalog = mergeCatalog(catalogOverride);
  const base = baselineTiers(signals, taskText);
  const tiers = applyDifficulty(base.tiers, DIFFICULTY.includes(difficulty) ? difficulty : null);
  const appliedPinned = {};
  const routing = {};
  const runtimeConcrete = new Set(concreteModelsFor(runtime, catalog));
  for (const phase of PHASES) {
    const pin = pinned && typeof pinned === 'object' ? pinned[phase] : undefined;
    if (pin !== undefined) {
      if (phase === 'brainstorm' || phase === 'plan') {
        warnings.push(`--model-routing: '${phase}'은 main 고정 — '${pin}' 무시`);
      } else if (TIERS.includes(pin) || pin === MAIN) {
        tiers[phase] = pin; appliedPinned[phase] = pin;
      } else if (runtimeConcrete.has(pin)) {
        routing[phase] = pin; appliedPinned[phase] = pin;
      } else {
        warnings.push(`--model-routing: '${pin}'은 ${runtime} 런타임의 모델/tier가 아님 — '${phase}' 자동값 사용`);
      }
    }
    if (routing[phase] === undefined) {
      const { model, warning } = resolveTier(tiers[phase], runtime, catalog);
      routing[phase] = model;
      if (warning) warnings.push(warning);
    }
  }
  return {
    model_routing: routing,
    meta: { tiers, scale: base.scale, signals_summary: { tracked_files: signals.tracked_files ?? null,
        loc_estimate: signals.loc_estimate ?? null, languages: signals.languages ?? null },
      difficulty: DIFFICULTY.includes(difficulty) ? difficulty : null, reasons: base.reasons,
      runtime, catalog_version: CATALOG_VERSION, pinned: appliedPinned,
      decided_at: new Date().toISOString() },
    warnings: [...new Set(warnings)], // unknown 런타임 등 phase 반복 경고 dedupe (리뷰 Low-5)
  };
}
```

`module.exports`에 `decideModelRouting` 추가.

- [ ] **Step 4: 통과 확인**

Run: `node --test runtime/model-routing-runtime.test.js`
Expected: PASS (18 tests)

- [ ] **Step 5: 커밋**

```bash
git add runtime/model-routing-runtime.js runtime/model-routing-runtime.test.js
git commit -m "$(cat <<'EOF'
feat(model-routing): decideModelRouting — 우선순위(§2.4)·런타임 불일치 거부·meta 기록

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: scripts/model-routing-cli.js — orchestrator 호출용 CLI

**Files:**
- Create: `scripts/model-routing-cli.js`
- Test: `scripts/model-routing-cli.test.js`

**Interfaces:**
- Consumes: Task 5 `decideModelRouting`, Task 3 `collectCodebaseSignals`, Task 2 `detectRuntime`
- Produces: CLI — `node scripts/model-routing-cli.js --root <path> --task <text> [--difficulty low|medium|high] [--runtime claude|codex|unknown] [--pinned "implement=opus,test=light"]`. stdout에 `{ model_routing, meta, warnings }` JSON 한 개. **항상 exit 0** — 내부 오류 시 전 phase `main` fallback JSON + `warnings`에 사유(orchestrator 진행 차단 방지). `--pinned` 값 형식은 콤마 구분·공백 불가(Task 8 플래그와 동일 문자열을 그대로 전달받는다).

- [ ] **Step 1: 실패하는 테스트 작성** — `scripts/model-routing-cli.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test scripts/model-routing-cli.test.js`
Expected: FAIL — CLI 파일 부재로 execFileSync throw

- [ ] **Step 3: 구현** — `scripts/model-routing-cli.js`

```js
#!/usr/bin/env node
'use strict';
const { collectCodebaseSignals, decideModelRouting, PHASES } = require('../runtime/model-routing-runtime.js');
const { detectRuntime } = require('./detect-runtime.js');

function parseArgs(argv) {
  const out = { root: process.cwd(), task: '', difficulty: null, runtime: null, pinnedRaw: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i] || out.root;
    else if (a === '--task') out.task = argv[++i] || '';
    else if (a === '--difficulty') out.difficulty = argv[++i] || null;
    else if (a === '--runtime') out.runtime = argv[++i] || null;
    else if (a === '--pinned') out.pinnedRaw = argv[++i] || '';
  }
  return out;
}

function parsePinned(raw, warnings) {
  const pinned = {};
  if (!raw) return pinned;
  for (const entry of raw.split(',')) {
    const m = entry.match(/^(research|implement|test|brainstorm|plan)=([A-Za-z0-9._-]+)$/);
    if (!m) { warnings.push(`--pinned 항목 '${entry}' 형식 오류(phase=value) — 무시`); continue; }
    pinned[m[1]] = m[2];
  }
  return pinned;
}

function main() {
  const warnings = [];
  try {
    const args = parseArgs(process.argv.slice(2));
    const runtime = args.runtime || detectRuntime(process.env);
    const signals = collectCodebaseSignals(args.root);
    const pinned = parsePinned(args.pinnedRaw, warnings);
    const decision = decideModelRouting({ signals, taskText: args.task,
      difficulty: args.difficulty, runtime, pinned });
    decision.warnings = [...warnings, ...decision.warnings];
    process.stdout.write(JSON.stringify(decision));
  } catch (e) {
    const routing = {}; for (const p of PHASES) routing[p] = 'main';
    process.stdout.write(JSON.stringify({ model_routing: routing,
      meta: { runtime: 'unknown', error: true }, warnings: [...warnings, `cli-error: ${e.message}`] }));
  }
}
main();
```

- [ ] **Step 4: 통과 확인**

Run: `node --test scripts/model-routing-cli.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add scripts/model-routing-cli.js scripts/model-routing-cli.test.js
git commit -m "$(cat <<'EOF'
feat(model-routing): 세션 init용 CLI 래퍼 (항상 exit 0, 오류 시 all-main fallback)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: recommender 4-key화 + task_difficulty + filterAskItems

**Files:**
- Modify: `runtime/recommender-runtime.js`
- Modify: `agents/session-recommender.md`
- Test: `runtime/recommender-runtime.test.js`

**Interfaces:**
- Consumes: 없음 (독립 모듈)
- Produces: `KEYS=['team_mode','start_phase','tdd_mode','git']`(4-key), `DIFFICULTY_ENUM=['low','medium','high']`, `filterAskItems(items) → string[]`(KEYS 교집합), `parseRecommendation(raw, ctx) → { ok, data }`에서 `data.task_difficulty = { value, reason } | null`. Task 11 orchestrator 배선이 `filterAskItems`와 `data.task_difficulty.value`를 사용.

- [ ] **Step 1: 실패하는 테스트 추가** — `runtime/recommender-runtime.test.js`에 추가 (기존 5-key 기대 테스트는 이 태스크에서 4-key 기대로 갱신)

```js
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
```

기존 테스트 갱신 형태 명시(리뷰 M-2): `runtime/recommender-runtime.test.js:13-16`의 5-key `validateRecommendation` 단언은
입력에서 `model_routing` 항목을 제거하고 기대 key-set을 `['git','start_phase','tdd_mode','team_mode']`(4-key)로 바꾼다 —
위 신규 케이스와 중복되면 기존 것을 4-key 형태로 흡수하고 삭제한다.

- [ ] **Step 2: 실패 확인**

Run: `node --test runtime/recommender-runtime.test.js`
Expected: FAIL — KEYS 5-key 불일치, `filterAskItems is not a function`

- [ ] **Step 3: 구현** — `runtime/recommender-runtime.js` 수정

핵심 변경(리뷰 Low-4 blast radius 전부):

```js
const KEYS = Object.freeze(['team_mode', 'start_phase', 'tdd_mode', 'git']);      // model_routing 제거
const ENUMS = Object.freeze({ team_mode: ['solo', 'team'], start_phase: ['brainstorm', 'research', 'plan'],
  tdd_mode: ['strict', 'coaching', 'relaxed', 'spike'], git: ['worktree', 'new-branch', 'current-branch'],
  model_routing: ['auto', 'default', 'custom'] });                                 // ENUM은 하위호환 보존
const DIFFICULTY_ENUM = Object.freeze(['low', 'medium', 'high']);

function filterAskItems(items) {
  if (!Array.isArray(items)) return [...KEYS];
  return items.filter((item) => KEYS.includes(item));
}
```

- `parseRecommendation`: 루프를 `KEYS`(4-key)로 유지(model_routing 키는 순회 대상이 아니므로 자동 무시). 루프 후:
  ```js
  const td = data.task_difficulty;
  const difficulty = td && typeof td === 'object' && DIFFICULTY_ENUM.includes(td.value)
    && typeof td.reason === 'string' && td.reason ? { value: td.value, reason: td.reason } : null;
  const out = {}; for (const key of KEYS) out[key] = data[key];
  out.task_difficulty = difficulty;
  return { ok: true, data: out };
  ```
  (기존 `return {ok:true,data}`가 원본 `data`를 그대로 반환하던 것을 KEYS-화이트리스트 사본으로 교체 — 구버전 model_routing 키가 밖으로 새지 않게.)
- `validateRecommendation`: exact key-set 등치 검사를 `KEYS`(4-key) 기준 + **옵셔널 `task_difficulty` 허용**으로 변경:
  `Object.keys(parsed).filter((k)=>k!=='task_difficulty'&&k!=='model_routing').sort().join(',') !== [...KEYS].sort().join(',')` 이면 fail (legacy model_routing 키도 허용-무시).
- `capabilityToDisabled`/`formatOptions`: 코드 무변경 (KEYS 축소로 model_routing 인자가 자연 throw — 테스트로 고정).
- `buildRecommenderInput`: `ask_items: filterAskItems(value.ask_items)` 로 변경.
- `module.exports`에 `DIFFICULTY_ENUM, filterAskItems` 추가.

`agents/session-recommender.md` 수정 — 출력 형식 블록을 다음으로 교체:

```json
{
  "team_mode":       { "value": "solo|team",                          "reason": "..." },
  "start_phase":     { "value": "brainstorm|research|plan",           "reason": "..." },
  "tdd_mode":        { "value": "strict|coaching|relaxed|spike",      "reason": "..." },
  "git":             { "value": "worktree|new-branch|current-branch", "reason": "..." },
  "task_difficulty": { "value": "low|medium|high",                    "reason": "..." }
}
```

frontmatter description·example의 model_routing 항목 제거, 휴리스틱 섹션에서 model_routing 행을 다음으로 교체:
`- **task_difficulty**: "전면", "마이그레이션", "아키텍처", "동시성" 또는 다중 모듈 → high. "typo", "한 줄", "오타", 문서만 → low. 그 외 → medium. (모델은 시스템이 자동 배정 — 추천하지 않는다.)`

- [ ] **Step 4: 전체 recommender 테스트 통과 확인** (기존 테스트 중 5-key 기대는 4-key로 갱신)

Run: `node --test runtime/recommender-runtime.test.js`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add runtime/recommender-runtime.js runtime/recommender-runtime.test.js agents/session-recommender.md
git commit -m "$(cat <<'EOF'
feat(model-routing): recommender 4-key화 + task_difficulty 출력 + filterAskItems (리뷰 M-3/L-4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: flags-runtime — `--model-routing=` 플래그

**Files:**
- Modify: `runtime/flags-runtime.js:29` (flags 초기값), `runtime/flags-runtime.js:50` 앞 분기 추가
- Test: `runtime/flags-runtime.test.js`

**Interfaces:**
- Consumes: Task 1 `allConcreteModels`, `TIERS`, `MAIN`
- Produces: `parseFlags` 반환에 `model_routing: string | null` 추가 — **검증된 원문 문자열**(예: `"implement=deep,test=light"`). concrete/tier 어휘 검증만 하고 런타임 매칭은 Task 5 엔진이 수행(`--pinned`로 그대로 전달). 형식: 콤마 구분, 공백 불가(리뷰 Low-2).

- [ ] **Step 1: 실패하는 테스트 추가** — `runtime/flags-runtime.test.js`

```js
test('--model-routing 유효 항목 통과', () => {
  const f = parseFlags(['--model-routing=implement=deep,test=light', 'task']);
  assert.strictEqual(f.model_routing, 'implement=deep,test=light');
  assert.deepStrictEqual(f.warnings, []);
});

test('--model-routing concrete 어휘 허용 (런타임 매칭은 엔진 몫)', () => {
  const f = parseFlags(['--model-routing=implement=opus']);
  assert.strictEqual(f.model_routing, 'implement=opus');
});

test('--model-routing 무효 항목은 항목 단위 경고+제외, 유효 항목 유지', () => {
  const f = parseFlags(['--model-routing=implement=deep,test=gpt99']);
  assert.strictEqual(f.model_routing, 'implement=deep');
  assert.ok(f.warnings.some((w) => /gpt99/.test(w)));
});

test('--model-routing 전 항목 무효 → null + 경고', () => {
  const f = parseFlags(['--model-routing=bogus']);
  assert.strictEqual(f.model_routing, null);
  assert.ok(f.warnings.length >= 1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test runtime/flags-runtime.test.js`
Expected: FAIL — `f.model_routing`이 undefined

- [ ] **Step 3: 구현** — `runtime/flags-runtime.js`

flags 초기값 객체에 `model_routing:null` 추가. `--worktree=` 분기 다음에:

```js
else if(arg.startsWith('--model-routing=')){const v=arg.slice(16);
  const{entries,warnings:mw}=parseModelRoutingValue(v);flags.warnings.push(...mw);
  flags.model_routing=entries.length?entries.join(','):null;}
```

파일 상단에 헬퍼 추가:

```js
const { TIERS, MAIN, allConcreteModels } = require('./model-catalog.js');
const MODEL_ROUTING_PHASES = new Set(['brainstorm', 'research', 'plan', 'implement', 'test']);
function parseModelRoutingValue(raw) {
  const warnings = []; const entries = [];
  const allowed = new Set([...TIERS, MAIN, ...allConcreteModels()]);
  for (const entry of String(raw || '').split(',')) {
    const m = entry.match(/^([a-z]+)=([A-Za-z0-9._-]+)$/);
    if (!m || !MODEL_ROUTING_PHASES.has(m[1]) || !allowed.has(m[2])) {
      warnings.push(`--model-routing 항목 '${entry}' 무효 — 무시. 형식: phase=tier|model (공백 불가)`);
      continue;
    }
    entries.push(`${m[1]}=${m[2]}`);
  }
  return { entries, warnings };
}
```

`module.exports`에 `parseModelRoutingValue` 추가.

- [ ] **Step 4: 통과 확인**

Run: `node --test runtime/flags-runtime.test.js`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add runtime/flags-runtime.js runtime/flags-runtime.test.js
git commit -m "$(cat <<'EOF'
feat(model-routing): --model-routing=phase=tier|model 플래그 (항목 단위 allowlist, 리뷰 L-1/L-2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: profile-runtime — 신규 프로필 템플릿 auto화

**Files:**
- Modify: `runtime/profile-runtime.js` (createV3Profile 템플릿 + PRESET defaults 블록)
- Test: `runtime/profile-runtime.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: 신규 생성 프로필의 `interactive_each_session`에서 `- model_routing` 라인 제거, `defaults.model_routing`을 per-phase 블록 대신 스칼라 `auto`로. 기존 프로필 파일은 무변경(로더는 스칼라/블록 양쪽 지원 — 이미 구현되어 있음).

- [ ] **Step 1: 실패하는 테스트 추가** — `runtime/profile-runtime.test.js`

```js
test('신규 v3 프로필: ask 목록에 model_routing 없음 + defaults는 auto 스칼라', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-prof-'));
  const p = path.join(dir, 'profile.yaml');
  createV3Profile(p, 'solo-strict');
  const text = fs.readFileSync(p, 'utf8');
  assert.ok(!/interactive_each_session:[\s\S]*?- model_routing/.test(
    text.slice(0, text.indexOf('defaults:'))));
  assert.match(text, /model_routing: auto/);
  assert.ok(!/model_routing:\n\s+brainstorm:/.test(text)); // per-phase 블록 아님
  const loaded = loadV3Profile(p);
  assert.strictEqual(loaded.presets['solo-strict'].defaults.model_routing, 'auto');
  assert.ok(!loaded.presets['solo-strict'].interactive_each_session.includes('model_routing'));
});
```

(파일 상단 require에 `fs`/`os`/`path`가 이미 없으면 추가. `createV3Profile`/`loadV3Profile`는 기존 export.)

- [ ] **Step 2: 실패 확인**

Run: `node --test runtime/profile-runtime.test.js`
Expected: FAIL — 템플릿에 `- model_routing`과 per-phase 블록 존재

- [ ] **Step 3: 구현** — `runtime/profile-runtime.js`

`createV3Profile` 템플릿 문자열(`:51`)에서:
- `    interactive_each_session:\n      - team_mode\n      - start_phase\n      - tdd_mode\n      - git\n      - model_routing` → `- model_routing` 라인 삭제 (4개 항목만)
- `      model_routing:\n        brainstorm: main\n        research: sonnet\n        plan: main\n        implement: sonnet\n        test: haiku` → `      model_routing: auto`

`:32`의 `v2TextToV3Text` 내부 `fallback` 객체(리뷰 Low-6 — "PRESET defaults 상수" 아님)의 `model_routing` 배열도 `['      model_routing: auto']`로, `:34`의 interactive 목록에서 `'      - model_routing',` 제거. `v2TextToV3Text`가 export되어 있으면 Step 1 테스트에 "v2 텍스트 변환 출력에도 `- model_routing` 부재 + `model_routing: auto`" 케이스를 1개 추가한다(비-export면 생략 — 구프로필 ask 회귀는 `filterAskItems` 안전망이 덮음).

- [ ] **Step 4: 통과 확인** — 기존 profile 테스트 중 구 템플릿 기대(있다면)도 함께 갱신

Run: `node --test runtime/profile-runtime.test.js`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add runtime/profile-runtime.js runtime/profile-runtime.test.js
git commit -m "$(cat <<'EOF'
feat(model-routing): 신규 프로필 템플릿 — ask 4-key + defaults model_routing: auto

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: migrate-model-routing meta 가드 (리뷰 Medium-2)

**Files:**
- Modify: `scripts/migrate-model-routing.js` (`migrateStateFile`에 조기 반환 가드)
- Modify: `docs/design/auto-model-selection.md` §5 한 줄 (아래 Step 3 참조)
- Test: `scripts/migrate-model-routing.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `migrateStateFile(stateFile)` — state 텍스트에 `model_routing_meta:` 키가 있으면 `{ replaced: [], warnings: [], skipped: 'model-routing-meta-present' }` 반환(파일 무수정). 엔진이 쓴 fail-safe `main`을 legacy migration이 `sonnet`으로 clobber하는 것을 컴퓨테이셔널하게 차단.

- [ ] **Step 1: 실패하는 테스트 추가** — `scripts/migrate-model-routing.test.js` (파일 기존 import 스타일 확인 후 필요한 `test`/`fs`/`os`/`path` require를 그 스타일로 추가 — 리뷰 Low-4)

```js
test('model_routing_meta 존재 state는 migration skip (엔진 fail-safe main 보호)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-mig-'));
  const f = path.join(dir, 'state.md');
  fs.writeFileSync(f, ['---', 'model_routing:', '  research: main', '  implement: main',
    'model_routing_meta:', '  runtime: unknown', '---'].join('\n'));
  const r = migrateStateFile(f);
  assert.deepStrictEqual(r.replaced, []);
  assert.strictEqual(r.skipped, 'model-routing-meta-present');
  assert.match(fs.readFileSync(f, 'utf8'), /research: main/); // clobber 안 됨
});

test('meta 부재 legacy state는 기존 main→sonnet 동작 유지', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-mig2-'));
  const f = path.join(dir, 'state.md');
  fs.writeFileSync(f, ['---', 'model_routing:', '  research: main', '---'].join('\n'));
  const r = migrateStateFile(f);
  assert.ok(r.replaced.some((x) => /research/.test(String(x))));
  assert.match(fs.readFileSync(f, 'utf8'), /research: sonnet/);
});
```

(두 번째 테스트는 기존 스위트에 동등 케이스가 있으면 그것을 유지하고 이 케이스는 생략 — 중복 금지.)

- [ ] **Step 2: 실패 확인**

Run: `node --test scripts/migrate-model-routing.test.js`
Expected: FAIL — skip 가드 부재로 replaced 발생

- [ ] **Step 3: 구현**

`migrateStateFile` 내 파일 read 직후(치환 로직 전) — read 결과 변수명은 실제 코드 기준 `src`다(리뷰 Low-3):

```js
if (/^model_routing_meta:/m.test(src)) {
  return { replaced: [], warnings: [], skipped: 'model-routing-meta-present' };
}
```

설계 문서 동기화: `docs/design/auto-model-selection.md` §5의 "`migrate-model-routing.js` 자체는 무수정." 문장을 "가드는 `migrateStateFile` 내부 조기 반환으로 구현(호출부 prose 가드보다 테스트 가능)." 으로 교체.

- [ ] **Step 4: 통과 확인**

Run: `node --test scripts/migrate-model-routing.test.js`
Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add scripts/migrate-model-routing.js scripts/migrate-model-routing.test.js docs/design/auto-model-selection.md
git commit -m "$(cat <<'EOF'
fix(model-routing): migration meta-가드 — 엔진 fail-safe main clobber 차단 (리뷰 M-2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: SKILL.md/문서 배선 (orchestrator · deep-implement · deep-resume · guide)

프롬프트 문서 태스크 — 자동 테스트 없음. 검증은 각 Step의 grep 커맨드.

**Files:**
- Modify: `skills/deep-work-orchestrator/SKILL.md`
- Modify: `skills/deep-implement/SKILL.md`
- Modify: `skills/deep-resume/SKILL.md`
- Modify: `skills/deep-finish/SKILL.md` (리뷰 M-1 — Step 2.1 payload에 `model_routing_meta`)
- Modify: `skills/shared/references/model-routing-guide.md`

**Interfaces:**
- Consumes: Task 6 CLI(`scripts/model-routing-cli.js`), Task 7 `filterAskItems`, Task 4 `sliceModelTier`/`sizeToTier`, Task 1 `resolveTier`
- Produces: 세션 init/implement/resume의 프롬프트 계약. 이후 태스크 의존 없음.

- [ ] **Step 1: orchestrator §1-3 Step 1-3 migration 가드 문구**

`### Step 1-3: Model Routing Migration (v6.4.0)` 섹션의 호출 조건 문단에 추가:

> **v6.10.0 가드**: `migrateStateFile`은 state에 `model_routing_meta:`가 있으면 skip을 반환한다(자동 결정 엔진이 쓴 fail-safe `main` 보호 — 설계 §5). skip 시 알림 불필요.

- [ ] **Step 2: orchestrator §1-4 ask 필터링 + recommender 입력**

§1-4-2의 `sanitizeInput` 호출에서 `ask_items: PROFILE_DATA.interactive_each_session` →
`ask_items: filterAskItems(PROFILE_DATA.interactive_each_session)  // v6.10.0: model_routing 영구 제거 (구프로필 포함)`
§1-4-3 도입부에 추가:

> **v6.10.0**: 순회 전 `filterAskItems()`(recommender-runtime)를 적용한다 — 구프로필 `interactive_each_session`에 `model_routing`이 남아 있어도 ask하지 않는다(모델은 §1-8.5에서 자동 결정).

- [ ] **Step 3: orchestrator 신규 §1-8.5 — 자동 모델 결정 (state 작성 직전)**

§1-8과 §1-9 사이에 신규 섹션 (deep-implement의 "Section 1.5" decimal 삽입 컨벤션을 따름 — 리뷰 Low-6):

````markdown
## 1-8.5. 자동 모델 결정 (v6.10.0)

모델 라우팅은 유저에게 묻지 않는다 — 엔진이 결정한다:

```bash
MR_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/model-routing-cli.js" \
  --root "$PROJECT_ROOT" --task "$TASK_TEXT" \
  --difficulty "${REC_TASK_DIFFICULTY:-}" \
  --pinned "${FLAGS.model_routing:-}")
```

- `REC_TASK_DIFFICULTY`: §1-4-2 recommender 응답의 `task_difficulty.value` (없으면 빈 값 — 무보정).
- `--runtime` 생략 시 CLI가 env로 자동 감지(`DEEP_WORK_RUNTIME` override 지원).
- 프로필 defaults에 per-phase concrete 값이 남아 있으면(user-pinned) 해당 항목을
  `--pinned`에 병합하되 CLI 플래그가 프로필보다 우선한다(설계 §2.4). 프로필 값이 `auto` 스칼라면 병합 없음.
- `MR_OUT.model_routing` → §1-9 state의 `model_routing` 블록, `MR_OUT.meta` → `model_routing_meta` 블록.
- `MR_OUT.warnings` 각 항목을 1회씩 표시.
````

- [ ] **Step 4: orchestrator §1-9 state 필드 + §1-11 표시**

§1-9 필드 목록의 `team_mode, tdd_mode, model_routing, worktree_*, cross_model_*`에 `model_routing_meta`(옵셔널, v6.10.0) 추가.
§1-11 세션 확인 표시의 `모델 라우팅: R=[model] P=main I=[model] T=[model]` 줄을 다음으로 교체:

```
모델 라우팅(자동): R=[model] P=main I=[model] T=[model]
  근거: [meta.scale] 코드베이스([meta.signals_summary.tracked_files] files) · 난이도 [meta.difficulty ?? "기준선"]
  조정: --model-routing=implement=deep 형식 또는 /deep-slice model
```

- [ ] **Step 5: deep-implement §Model Routing 교체**

`## Model Routing` 섹션(":167" 부근) 본문을 다음으로 교체:

````markdown
## Model Routing (v6.10.0)

State에서 `model_routing.implement`와 `model_routing_meta` 확인.

- **"main"**: 현재 대화 모델로 inline 실행 → Solo Slice Loop 진행
- **pinned concrete** (`model_routing_meta.pinned.implement` 존재 또는 meta 부재): 해당 모델로 Agent 위임 — 기존 동작
- **엔진 자동** (`model_routing_meta.tiers.implement` 존재, pinned 아님): slice마다 per-slice 해석 (설계 §2.5):

```javascript
const { sliceModelTier } = require("${CLAUDE_PLUGIN_ROOT}/runtime/model-routing-runtime.js");
const { resolveTier } = require("${CLAUDE_PLUGIN_ROOT}/runtime/model-catalog.js");
const tier = sliceModelTier(state.model_routing_meta.tiers.implement, slice.size);
const { model } = resolveTier(tier, state.model_routing_meta.runtime);
// 세션 tier standard일 때: S→haiku, M/L→sonnet, XL→opus (기존 auto와 동일)
// model === "main"이면 inline 실행
```

- **legacy "auto" 문자열** (meta 부재 구세션): `sonnet` 취급 + 1회 경고 — 기존 S/M/L/XL 표는 위 per-slice 규칙으로 대체됨.
  (이 legacy 분기는 프롬프트 경로 산문 규칙이다 — Node 픽스처 고정 대상 아님. 설계 §8의 "픽스처로 고정" 항목 중 이 케이스만 산문 acceptance로 대체됨을 명시 — 리뷰 Low-6.)
````

같은 파일의 `model=state.model_routing.implement` 3개 지점(:191, :402, :425 부근) 각각에 주석 추가: `// 엔진 자동 경로에서는 위 per-slice 해석 결과 model 사용`.

- [ ] **Step 6: deep-resume 런타임 재해석**

`skills/deep-resume/SKILL.md`의 state 복원 절차(마이그레이션 단계 인근)에 추가:

> **모델 라우팅 재해석 (v6.10.0)**: state에 `model_routing_meta`가 있고 `meta.runtime`이 현재 감지 런타임(`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-runtime.js"` 기준 — CLI 없으므로 `node -e 'const{detectRuntime}=require(...);console.log(detectRuntime())'`)과 다르면, `meta.tiers`를 현재 런타임 카탈로그로 재해석해 `model_routing` 블록을 갱신하고 `meta.runtime`을 갱신한 뒤 1회 안내한다. meta 부재(구세션) → skip.

- [ ] **Step 6.5: deep-finish Step 2.1 payload에 model_routing_meta (리뷰 M-1)**

`skills/deep-finish/SKILL.md`의 `#### Step 2.1` payload 조립 필드 목록에 옵셔널 필드 추가:

> **v6.10.0**: state에 `model_routing_meta`가 있으면 payload에 `model_routing_meta` 필드로 그대로 포함한다(부재 시 필드 생략 — forward-compatible 옵셔널, 설계 §7). deep-suite payload-registry minor bump는 suite 측 후속 작업.

acceptance: 아래 Step 8 grep에 deep-finish 검증 포함.

- [ ] **Step 7: model-routing-guide.md 재작성**

`skills/shared/references/model-routing-guide.md` 전문 교체:

````markdown
# Model Routing Guide (v6.10.0 — 자동 선택)

## 개요

모델 라우팅은 유저가 선택하지 않는다. 세션 init 시 엔진이 코드베이스 규모·작업 난이도로
phase별 tier(light/standard/deep/main)를 결정하고, 런타임(Claude Code/Codex) 카탈로그로
실제 모델명을 해석해 state에 기록한다. 근거는 세션 시작 메시지에 표시된다.

## 결정 흐름

1. 결정론적 신호: tracked 파일 수(규모 분류 우선 신호), LOC 추정, 언어 수, 테스트 유무
2. baseline 규칙표(§설계 2.2) → 3. recommender `task_difficulty`로 ±1 보정(실패 시 무보정)
4. 런타임 카탈로그 해석: claude(light→haiku/standard→sonnet/deep→opus), codex(카탈로그 pin 값)
5. 판별 불가 런타임/미pin 카탈로그 → `main`(세션 모델) fail-safe

## Override 우선순위 (강한 순)

1. `--model-routing=implement=deep,test=light` (콤마 구분·공백 불가; tier명 또는 현재 런타임 모델명)
2. 프로필 defaults의 concrete 값(user-pinned — 엔진 skip)
3. `/deep-slice model SLICE-NNN <model>` (per-slice)
4. 엔진 자동

## Implement per-slice 규칙

엔진 자동 경로에서 slice 크기별 tier = clamp(sizeTier(S/M/L/XL) + 세션 난이도 offset).
세션 tier standard이면 기존 auto와 동일: S→haiku, M/L→sonnet, XL→opus.

## Plan/Brainstorm이 main인 이유

대화형 피드백 루프가 핵심 — Agent 위임 불가(기존 설계 유지).

## 하위 호환

- `model_routing` 필드 없는 구세션: 기존 기본값 경로.
- `model_routing_meta` 없는 구세션: legacy migration(main→sonnet)이 그대로 적용되고 재해석은 skip.
- 구프로필의 per-phase concrete 값: user-pinned로 존중(1회 안내).
````

- [ ] **Step 8: 검증 grep**

Run: `grep -c "filterAskItems" skills/deep-work-orchestrator/SKILL.md` → Expected: `2` 이상
Run: `grep -c "model-routing-cli" skills/deep-work-orchestrator/SKILL.md` → Expected: `1` 이상
Run: `grep -c "sliceModelTier" skills/deep-implement/SKILL.md` → Expected: `1` 이상
Run: `grep -c "model_routing_meta" skills/deep-resume/SKILL.md` → Expected: `1` 이상
Run: `grep -c "model_routing_meta" skills/deep-finish/SKILL.md` → Expected: `1` 이상
Run: `grep -c "자동 선택" skills/shared/references/model-routing-guide.md` → Expected: `1` 이상
Run: `npm test` → Expected: 전체 PASS (문서 변경이 테스트를 깨지 않음)

- [ ] **Step 9: 커밋**

```bash
git add skills/deep-work-orchestrator/SKILL.md skills/deep-implement/SKILL.md \
  skills/deep-resume/SKILL.md skills/deep-finish/SKILL.md \
  skills/shared/references/model-routing-guide.md
git commit -m "$(cat <<'EOF'
feat(model-routing): SKILL.md 배선 — ask 제거·엔진 호출·per-slice 규칙·resume 재해석

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Codex 실기 검증 + 카탈로그/마커 pin

**Files:**
- Modify: `runtime/model-catalog.js` (codex 슬롯 pin)
- Modify: `scripts/detect-runtime.js` (CODEX_ENV_MARKERS 근거 갱신 — 필요 시)
- Modify: `runtime/model-catalog.test.js` (pin 후 기대값 갱신)

**Interfaces:**
- Consumes: 로컬 설치된 codex CLI
- Produces: pin된 codex 카탈로그. **실패해도 blocker 아님** — null 유지 시 codex는 `main` fail-safe로 동작(acceptance ②).

- [ ] **Step 1: codex CLI 모델 어휘 실기 조사**

Run: `codex --version && codex exec --help 2>&1 | grep -i -A3 model`
Expected: `--model`/`-m` 옵션과 기본 모델명 확인. 추가 근거: `cat ~/.codex/config.toml 2>/dev/null | grep -i model`, `codex exec --help`의 모델 예시.

- [ ] **Step 2: env 마커 실기 조사**

Run: `codex exec -s read-only "env | grep -iE '^(CODEX|OPENAI)' | cut -d= -f1 | sort" 2>/dev/null`
Expected: codex 세션 내부에서 세팅되는 env 키 목록. `CODEX_HOME` 존재 여부 확인 — 다르면 `CODEX_ENV_MARKERS`를 관측된 키로 교체(관측 없는 추측 pin 금지). codex CLI 자체가 실행 불가하면 이 Step은 skip하고 마커는 현행 유지.

- [ ] **Step 3: 카탈로그 pin**

Step 1 관측값으로 `DEFAULT_CATALOG.codex`의 `light`/`standard`/`deep`을 실제 모델명으로 교체
(예상 형태 — 관측으로 확정: mini 계열→light, 기본 codex 모델→standard, max/high 계열→deep).
`runtime/model-catalog.test.js`의 codex null 분기 테스트가 pin 후 자동으로 concrete 분기를 타는지 확인.
**Step 1-2 모두 실기 확인 불가 시**: null 유지 + 이 태스크를 "미완(pin 불가 — fail-safe 유지)"으로 PR 본문에 기록. 이 경우에도 아래 Step 4는 수행.

- [ ] **Step 4: 통과 확인**

Run: `node --test runtime/model-catalog.test.js scripts/detect-runtime.test.js`
Expected: PASS — pin 여부와 무관(테스트가 null/concrete 양쪽 분기 지원)

- [ ] **Step 5: 커밋**

```bash
git add runtime/model-catalog.js runtime/model-catalog.test.js scripts/detect-runtime.js
git commit -m "$(cat <<'EOF'
feat(model-routing): codex 카탈로그/env 마커 실기 검증 pin (미검증 시 fail-safe null 유지)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: CHANGELOG + 버전 bump + 전체 회귀

**Files:**
- Modify: `CHANGELOG.md`, `CHANGELOG.ko.md` (v6.10.0 엔트리 추가)
- Modify: `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json` (`"version": "6.10.0"`)

**Interfaces:**
- Consumes: 전 태스크 결과
- Produces: 릴리스 준비 완료 브랜치

- [ ] **Step 1: CHANGELOG 엔트리 작성 (en/ko 동일 구조)**

`CHANGELOG.md` 최상단에:

```markdown
## v6.10.0 — Automatic model selection (Claude Code / Codex)

- **5-key ask → 4-key**: `model_routing` is no longer asked. The engine decides per-phase
  models from codebase scale + task difficulty (deterministic signals + recommender
  `task_difficulty` ±1 adjustment; deterministic fallback when the recommender is unavailable).
- **Runtime-neutral tiers**: `light`/`standard`/`deep`/`main` resolved via per-runtime catalog
  (`runtime/model-catalog.js`). Codex sessions resolve to Codex models; unknown runtime
  fails safe to `main` (session model). Claude model names never leak into Codex paths.
- **Per-slice rule**: implement delegation resolves `clamp(sizeTier + difficulty offset)` —
  identical to the legacy slice-size auto at `standard`.
- **Overrides**: `--model-routing=implement=deep,test=light` flag, profile pinned concrete
  values (respected, engine skipped), `/deep-slice model` unchanged.
- **Back-compat**: `model_routing_meta` is optional; legacy `main→sonnet` migration now skips
  engine-authored states (meta guard); old profiles keep working — `interactive_each_session`
  is filtered unconditionally (`filterAskItems`).
```

(ko 버전은 같은 내용 한국어로 `CHANGELOG.ko.md`에.)

- [ ] **Step 2: 버전 bump**

`.claude-plugin/plugin.json` / `.codex-plugin/plugin.json` / `package.json`의 `"version"`을 `"6.10.0"`으로.
Run: `jq -r .version .claude-plugin/plugin.json .codex-plugin/plugin.json package.json 2>/dev/null || node -e "for(const f of ['.claude-plugin/plugin.json','.codex-plugin/plugin.json','package.json'])console.log(JSON.parse(require('fs').readFileSync(f)).version)"`
Expected: `6.10.0` × 3

- [ ] **Step 3: 전체 회귀**

Run: `npm test`
Expected: 전체 PASS (0 fail). 실패 시 해당 태스크로 돌아가 수정 — 실패 상태로 이 태스크를 완료 표시하지 않는다.

- [ ] **Step 4: 커밋**

```bash
git add CHANGELOG.md CHANGELOG.ko.md .claude-plugin/plugin.json .codex-plugin/plugin.json package.json
git commit -m "$(cat <<'EOF'
chore(release): v6.10.0 — 자동 모델 선택 (CHANGELOG en/ko + manifest bump)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: 후속 안내 (커밋 아님)**

PR 본문에 기재: 머지 후 deep-suite 동기화(marketplace.json SHA, README 표, payload-registry의 `model_routing_meta` minor bump)는 CLAUDE.md CRITICAL 절차대로 별도 수행.

---

## Self-Review 결과

1. **Spec coverage**: 설계 §1 컴포넌트 표 12행 전부 태스크 매핑 확인 — model-catalog(T1), detect-runtime(T2), model-routing-runtime(T3-5), model-routing-cli(T6), session-recommender+recommender-runtime(T7), flags-runtime(T8), profile-runtime(T9), migrate 가드(T10), orchestrator/deep-implement/deep-resume/deep-finish/guide(T11), codex pin(T12), 버전/CHANGELOG(T13). design 리뷰 Medium-1(§2.5→T4/T11), Medium-2(→T10), Medium-3(→T7/T11) 해소 태스크 존재. **설계 §7 in-repo 산출물(session-receipt payload `model_routing_meta`)은 T11 Step 6.5로 커버**(plan 리뷰 M-1 반영) — suite payload-registry bump만 범위 밖.
2. **Placeholder scan**: "TBD"/"적절히 처리" 부재. Task 12의 codex 모델명만 의도된 실기-확정 항목이며 미확정 시의 동작(null fail-safe)까지 명세됨.
3. **Type consistency**: `sliceModelTier(sessionImplementTier, size)`(T4 정의 ↔ T11 Step 5 사용), `resolveTier(tier, runtime, catalog?) → {model, warning}`(T1 ↔ T5/T11), `filterAskItems(items)`(T7 ↔ T11 Step 2), `flags.model_routing`(T8 ↔ T6 `--pinned` 문자열) 일치 확인.
