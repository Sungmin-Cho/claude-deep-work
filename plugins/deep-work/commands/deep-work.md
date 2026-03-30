---
allowed-tools: Bash, Read, Write, Glob, AskUserQuestion
description: "Start a deep work session with Evidence-Driven Protocol (Brainstorm → Research → Plan → Implement → Test)"
argument-hint: task description
---

# Deep Work Session Initialization

You are initializing a **Deep Work** session — an Evidence-Driven Development Protocol with 5 phases (Brainstorm → Research → Plan → Implement → Test) that enforces TDD, receipt-based evidence collection, and strict separation between planning and coding.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure. Do NOT mix languages within a single message.

## Your Task

The user wants to work on: **$ARGUMENTS**

## Instructions

Follow these steps exactly:

### 0. Update check

The SessionStart hook runs `update-check.sh` and may output one of:
- `JUST_UPGRADED <old> <new>` → Display: `deep-work v{new}으로 업그레이드되었습니다! (v{old}에서)` and continue.
- `UPGRADE_AVAILABLE <old> <new>` → Handle below.
- (nothing) → Skip, continue to Step 1.

**If `UPGRADE_AVAILABLE`:**

1. Read `.claude/deep-work-profile.yaml` for `auto_update` field.

2. **If `auto_update: true`**: Auto-upgrade without asking:
   - Detect install type: check if plugin directory has `.git` (git install) or not (npm/marketplace)
   - **Git install**: `cd <plugin-dir> && git fetch origin && git reset --hard origin/main`
   - **npm install**: `npm update @claude-deep-work/deep-work`
   - Write current version to `~/.claude/.deep-work-just-upgraded` as marker
   - Display: `deep-work v{old} → v{new} 자동 업그레이드 완료!`
   - If upgrade fails: display warning and continue with current version

3. **If `auto_update` is not set or false**: Use AskUserQuestion:
   ```
   deep-work v{new}이 사용 가능합니다 (현재 v{old}). 업그레이드하시겠습니까?
   ```
   Options:
   - A) 지금 업그레이드 → Execute upgrade (same as auto), continue
   - B) 항상 최신 상태 유지 → Set `auto_update: true` in profile, execute upgrade
   - C) 나중에 → Write snooze state to `~/.claude/.deep-work-update-snoozed` (escalating backoff: 24h → 48h → 1 week)
   - D) 다시 묻지 않기 → Set `update_check: false` in profile

### 1. Check for existing active session

Read `.claude/deep-work.local.md` if it exists. If `current_phase` is NOT `idle` and NOT empty, warn the user:

```
⚠️ 진행 중인 세션이 있습니다:
   작업: [task_description]
   현재 단계: [current_phase]
   작업 폴더: [work_dir]

계속하면 이전 세션 상태가 덮어쓰기됩니다.
(산출물 파일은 보존됩니다)
```

Ask the user to confirm using AskUserQuestion before proceeding. If the user declines, stop.

### 1.5. Profile load & flag parsing

#### 1.5a. Extract flags from $ARGUMENTS

Parse `$ARGUMENTS` for the following flags. Remove matched flags from the string — the remainder becomes the task description.

| Flag | Effect |
|------|--------|
| `--setup` | Force profile re-setup (all questions asked, profile overwritten) |
| `--team` | Override `team_mode` to `"team"` for this session only |
| `--zero-base` | Override `project_type` to `"zero-base"` for this session only |
| `--skip-research` | Override `start_phase` to `"plan"` for this session only |
| `--skip-brainstorm` | Skip Phase 0 brainstorm, start at research |
| `--tdd=MODE` | Set TDD mode: `strict` (default), `relaxed`, `coaching`, `spike` |
| `--skip-review` | Set `review_state` to `"skipped"` for this session |
| `--no-branch` | Override `git_branch` to `false` for this session only |
| `--profile=X` | Use preset named `X` directly (skip interactive selection) |

After removing flags, trim whitespace. The remainder is the task description.

#### 1.5b. Validate task description

If the task description is empty after flag removal:
- If `--setup` flag is present **without** a task description:
  - Read `.claude/deep-work-profile.yaml` if it exists
  - If profile exists (v1 or v2): Show preset management UI (see Step 1.5d)
  - If profile does not exist: Proceed to Steps 4~6 to ask all questions, save as v2 profile (Step 7.5)
  - Display: `프로필이 업데이트되었습니다.`
  - **Stop here** — do NOT start a new session
- If `--setup` flag is present **with** a task description:
  - Show preset management UI (Step 1.5d) → save → continue session with selected preset
- Otherwise (no `--setup`, task description is empty):
  - Ask the user: "작업 설명을 입력해주세요" using AskUserQuestion
  - Use the response as the task description

#### 1.5c. Load profile

Read `.claude/deep-work-profile.yaml` if it exists.

**If profile exists AND `--setup` is NOT set:**

1. Parse `version` field:
   - If `version` is `1`: **Auto-migrate to v2** — wrap existing `defaults.*` fields into `presets.default.*`, set `version: 2`, `active: default`. Overwrite the file. Display:
     ```
     프로필을 v2 형식으로 자동 업그레이드했습니다. (default 프리셋으로 변환)
     ```
   - If `version` is `2`: Proceed normally.
   - Otherwise: Display warning and treat as no profile:
     ```
     ⚠️ 프로필 버전이 호환되지 않습니다 (version: [N]). 기존 질문 흐름을 진행합니다.
     ```

2. **Preset selection** (v2 profile):
   - If `--profile=X` flag is set:
     - Look up `presets[X]`. If found, select it.
     - If not found: Display error and fall back to interactive selection:
       ```
       ⚠️ 프리셋 '[X]'을(를) 찾을 수 없습니다. 사용 가능한 프리셋 중에서 선택하세요.
       ```
   - If no `--profile` flag AND only 1 preset exists:
     - Auto-select the only preset.
   - If no `--profile` flag AND 2+ presets exist:
     - Use AskUserQuestion to let the user choose:
       ```
       프리셋을 선택하세요:
         1. dev — Solo / 기존 코드베이스 / Research부터
         2. quick — Solo / 기존 코드베이스 / Plan부터
         3. review — Team / 기존 코드베이스 / Research부터
       ```
       (Each option shows the preset name + key settings summary: team_mode / project_type / start_phase)

3. **Map selected preset fields to internal variables:**
   - `presets.<name>.team_mode` → `TEAM_MODE`
   - `presets.<name>.project_type` → `PROJECT_TYPE`
   - `presets.<name>.start_phase` → `START_PHASE`
   - `presets.<name>.git_branch` → `GIT_BRANCH` (default: `true` in v4.1)
   - `presets.<name>.model_routing.*` → `MODEL_ROUTING_*`
   - `presets.<name>.model_routing.routing_table` → `ROUTING_TABLE` (v4.1: custom S/M/L/XL→model mapping)
   - `presets.<name>.notifications.*` → `NOTIFICATIONS_*`
   - `presets.<name>.cross_model_preference` → `CROSS_MODEL_PREFERENCE` (default: `"ask"`)

4. Apply flag overrides (if any): `--team`, `--zero-base`, `--skip-research`, `--no-branch` take precedence over preset values.

5. Display applied profile and offer per-session override:
   ```
   프리셋 적용: [preset_name]
     작업 모드: [Solo / Team]
     프로젝트: [기존 코드베이스 / 제로베이스]
     시작 단계: [Brainstorm / Research / Plan]
     TDD 모드: [strict / relaxed / coaching / spike]
     모델 라우팅: R=[model] P=main I=[model] T=[model]

   1. ✅ 이대로 진행 (기본)
   2. 이번 세션만 설정 변경
   ```

   If the user chooses option 2:
   - Ask each setting **individually** using AskUserQuestion (one per question):
     a. 작업 모드: Solo / Team
     b. 프로젝트 타입: 기존 / 제로베이스
     c. 시작 단계: Brainstorm / Research / Plan
     d. TDD 모드: strict / relaxed / coaching / spike
     e. 모델 라우팅: 기본값 사용 / 커스텀
   - Override preset values for this session only (don't save to profile)
   - These overrides do NOT modify the saved preset

   If the user chooses option 1: use preset values as-is.

6. Set `PROFILE_LOADED` = true, `SELECTED_PRESET` = preset name
7. **Skip Steps 4, 4-1, 4-2, 5, and 6** — use preset values directly (unless user chose option 2 above, in which case the overridden values are used)

**If profile does NOT exist OR `--setup` IS set:**
1. Set `PROFILE_LOADED` = false
2. Continue to Steps 4~6 as normal (existing behavior)

#### 1.5d. Preset management UI (for `--setup`)

This UI is shown when `--setup` flag is used with an existing v2 profile.

1. Read `.claude/deep-work-profile.yaml` and parse `presets` keys.
2. If version is 1, auto-migrate to v2 first (same as Step 1.5c migration).
3. Display preset list using AskUserQuestion:
   ```
   프리셋 관리

   현재 프리셋:
     1. dev ✏️ — Solo / existing / Research부터
     2. quick ✏️ — Solo / existing / Plan부터
     3. 새 프리셋 만들기

   편집하거나 새로 만들 프리셋을 선택하세요:
   ```

4. **If existing preset selected (edit):**
   - Display current values for each setting
   - Ask each question (Steps 4~6 flow) with current value as default
   - User can press Enter to keep existing value or type a new one
   - Save updated values back to the preset

5. **If "새 프리셋 만들기" selected:**
   - Ask for preset name using AskUserQuestion:
     ```
     프리셋 이름을 입력하세요 (영문, 예: dev, quick, review):
     ```
   - Proceed through Steps 4~6 to collect all settings
   - Save as a new preset under the given name

6. After saving:
   - Display: `프리셋 '[name]'이(가) 저장되었습니다.`
   - Update `active` field to the saved preset name
   - Set `PROFILE_LOADED` = true, `SELECTED_PRESET` = saved preset name

### 2. Create the task-specific output directory

Generate a folder name from the task description:

1. Get a timestamp: `YYYYMMDD-HHMMSS` format (e.g., `20260307-143022`)
2. Generate a slug from `$ARGUMENTS`:
   - Convert to lowercase
   - Replace non-alphanumeric and non-Korean characters with hyphens
   - Collapse consecutive hyphens
   - Remove leading/trailing hyphens
   - Truncate to 30 characters (avoid cutting mid-character)
3. Combine: `TIMESTAMP-SLUG` (e.g., `20260307-143022-jwt-기반-사용자-인증`)

```bash
mkdir -p deep-work
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
# Generate SLUG from task description
TASK_FOLDER="${TIMESTAMP}-${SLUG}"
mkdir -p "deep-work/${TASK_FOLDER}"
```

Set `WORK_DIR` to `deep-work/${TASK_FOLDER}`.

### 2.5. Cross-model tool detection

Detect available cross-model review tools:

```bash
CODEX_PATH=$(which codex 2>/dev/null || true)
GEMINI_PATH=$(which gemini 2>/dev/null || true)

# Verify executability
CODEX_OK=false
GEMINI_OK=false
[ -n "$CODEX_PATH" ] && codex --version >/dev/null 2>&1 && CODEX_OK=true
[ -n "$GEMINI_PATH" ] && gemini --version >/dev/null 2>&1 && GEMINI_OK=true
```

**If both tools unavailable (CODEX_OK=false AND GEMINI_OK=false):**
- Set `cross_model_tools: {codex: {available: false, path: ""}, gemini: {available: false, path: ""}}` in state file
- Set `cross_model_enabled: {codex: false, gemini: false}`
- Do NOT display anything — proceed silently

**If at least one tool available:**

Display detection results:
```
크로스 모델 도구 감지:
   codex: ✅ 설치됨 ([path], v[version]) / ❌ 미설치
   gemini-cli: ✅ 설치됨 ([path], v[version]) / ❌ 미설치
```

**Check profile for saved preference:**

Read `.claude/deep-work-profile.yaml` for `presets.<active>.cross_model_preference`.
- If `"always"`: auto-enable detected tools, display "프로필 설정: 항상 사용"
- If `"never"`: auto-disable, display "프로필 설정: 항상 스킵"
- If `"ask"` or missing: ask user via AskUserQuestion

**AskUserQuestion (if preference is "ask" or missing):**

If both tools available:
```
크로스 모델 리뷰를 활성화할까요?
  Plan 단계에서 codex/gemini가 독립적으로 계획서를 리뷰합니다.
  1. 둘 다 사용 (권장)
  2. codex만 사용
  3. gemini만 사용
  4. 사용 안함
```

If only one tool available:
```
[tool] 크로스 모델 리뷰를 활성화할까요?
  1. 사용 (권장)
  2. 사용 안함
```

Store result in state file: `cross_model_enabled: {codex: true/false, gemini: true/false}`
Store tool info: `cross_model_tools: {codex: {available: bool, path: "..."}, gemini: {available: bool, path: "..."}}`


### 2.6. Assumption health check (v5.0)

Check if session history exists and display assumption health summary on init.

1. **Locate history file**: Look for `$WORK_DIR/../harness-history/harness-sessions.jsonl` (shared across sessions in the `deep-work/` directory). If no history file exists, skip this step silently.

2. **Run assumption engine** (report + detect-model):

```bash
# Get assumption health report
echo '{"action":"report","registryPath":"<PLUGIN_DIR>/assumptions.json","historyPath":"deep-work/harness-history/harness-sessions.jsonl","options":{"splitByModel":true}}' | node <PLUGIN_DIR>/hooks/scripts/assumption-engine.js

# Detect if current model is new
echo '{"action":"detect-model","historyPath":"deep-work/harness-history/harness-sessions.jsonl","model":"<CURRENT_MODEL_ID>"}' | node <PLUGIN_DIR>/hooks/scripts/assumption-engine.js
```

Where `<PLUGIN_DIR>` is the plugin's install path (directory containing `assumptions.json`).
Where `<CURRENT_MODEL_ID>` is the model identifier for this session (e.g., `claude-opus-4-6`).

3. **New model warning**: If `detect-model` returns `isNew: true` and `totalSessions > 0`:

```
⚠️ 새 모델 감지: [model_id]
   이 모델에 대한 세션 기록이 없습니다.
   기존 가정이 이 모델에 적용되지 않을 수 있습니다.
   첫 [minimum_sessions_for_evaluation]회 세션은 기본 enforcement를 사용합니다.
```

4. **Health summary display**: If history has enough sessions (>= minimum for at least one assumption):

```
Assumption Health ([N] sessions)
   phase_guard_blocks_edits:        HIGH (0.82) — KEEP
   tdd_required_before_implement:   MEDIUM (0.56) — CONSIDER loosening
   research_required_before_plan:   HIGH (0.75) — KEEP
   cross_model_review:              INSUFFICIENT (3/5 sessions)
   receipt_collection:              HIGH (0.90) — KEEP

   제안: /deep-assumptions 로 상세 리포트를 확인하세요.
```

If report has proposed changes, add:
```
   ⚡ 제안된 변경: [count]건 — /deep-assumptions 에서 확인
```

5. **No history / insufficient data**: If `totalSessions == 0` or all assumptions show INSUFFICIENT, skip display entirely (no noise on cold start).

### 2-1. Git branch & worktree setup (git repository only)

Check if the project is a git repository:

```bash
git rev-parse --is-inside-work-tree 2>/dev/null
```

If **not** a git repository: set `git_branch` to empty string, `worktree_enabled` to `false`. Skip to Step 3.

If a git repository, determine the isolation mode:

**Determine `GIT_BRANCH` value:**
- If `PROFILE_LOADED` is true: use `presets.<name>.git_branch` (default: `true` in v4.1)
- If flag `--no-branch` is set: `GIT_BRANCH` = `false`
- If `PROFILE_LOADED` is false: use AskUserQuestion (original behavior)

**If `GIT_BRANCH` is `true`:**

1. Generate branch name: `dw/[SLUG]` (e.g., `dw/add-model-routing`)
   - SLUG = task description의 처음 30자를 kebab-case로 변환
   - 특수문자/한글은 제거하고 영문+숫자+하이픈만 유지

2. Create worktree:
   ```bash
   mkdir -p .worktrees 2>/dev/null
   git worktree add -b "dw/${SLUG}" ".worktrees/dw/${SLUG}" HEAD 2>&1
   ```

3. **에러 처리**: `git worktree add` 실패 시 (브랜치 이름 충돌, 커밋 없음, 디스크 부족 등):
   - 경고 표시:
     ```
     ⚠️ Worktree 생성 실패: [error message]
        격리 없이 현재 브랜치에서 진행합니다.
     ```
   - Fallback: `git checkout -b deep-work/[SLUG]` 시도 (기존 v4.0 동작)
   - 그것도 실패하면: 현재 브랜치에서 그대로 진행
   - Set `worktree_enabled: false`

4. **성공 시**: `.gitignore`에 `.worktrees/`가 없으면 추가.

5. Update state (use absolute paths for reliability across CWD changes):
   ```yaml
   worktree_enabled: true
   worktree_path: "<PROJECT_ROOT>/.worktrees/dw/${SLUG}"
   worktree_branch: "dw/${SLUG}"
   worktree_base_branch: "<current branch name before worktree creation>"
   worktree_base_commit: "<HEAD commit hash>"
   ```

6. Display:
   ```
   Worktree 격리 활성화
      Branch: dw/[SLUG]
      Path: .worktrees/dw/[SLUG]
      Base: [short hash]

   이 세션의 모든 작업은 격리된 worktree에서 진행됩니다.
   완료 후 /deep-finish로 merge/PR/유지/삭제를 선택하세요.
   ```

7. **Working directory 설정**: 후속 명령에서 worktree 내에서 작업하도록:
   - 모든 `Bash` tool 호출에 `cd <worktree_absolute_path> &&` prepend
   - `Write`/`Edit` tool의 file path는 worktree 절대 경로 기준
   - "현재 작업 디렉토리는 `<worktree_path>`입니다" 안내

**If `GIT_BRANCH` is `false`:**
- Set `worktree_enabled: false`, `git_branch` to empty string
- 기존 v4.0 동작: 현재 브랜치에서 직접 작업

**If `PROFILE_LOADED` is false** (no preset — ask user):
```
Git 격리 방식을 선택하세요:
   (현재 브랜치: [current branch])

1. Worktree 격리 (권장) — 별도 디렉토리에서 격리 작업
2. 새 브랜치 — 현재 위치에서 새 브랜치 생성
3. ❌ 현재 브랜치 유지
```

Option 1: worktree 생성 (위 플로우)
Option 2: `git checkout -b deep-work/[SLUG]`, `worktree_enabled: false`
Option 3: 현재 브랜치 유지, `worktree_enabled: false`

**Capture last research commit**: If git repository:
```bash
git rev-parse HEAD 2>/dev/null
```
Store as `last_research_commit` in state file.

### 3. Create placeholder files

Create these empty files:
- `$WORK_DIR/research.md` — will be filled during Phase 1
- `$WORK_DIR/plan.md` — will be filled during Phase 2

### 4. Select work mode

Ask the user to choose the work mode using AskUserQuestion:

```
작업 모드를 선택하세요:
  1. Solo — 혼자 진행 (기본)
  2. Team — Agent Team으로 병렬 진행
```

**If the user selects Team:**

1. Check the environment variable:
   ```bash
   echo "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-not_set}"
   ```

2. If the result is `not_set` or empty, display the following and fall back to Solo:
   ```
   ⚠️ Agent Teams 기능이 활성화되지 않았습니다.

   활성화 방법:
     ~/.claude/settings.json 에 다음을 추가하세요:
     {
       "env": {
         "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
       }
     }
     저장 후 Claude Code를 재시작하세요.

   ℹ️ Solo 모드로 전환하여 진행합니다.
   ```
   Set `team_mode` to `solo`.

3. If the variable is set (any non-empty value), set `team_mode` to `team`.

**If the user selects Solo or default:** Set `team_mode` to `solo`.

### 4-1. Configure model routing

Ask the user using AskUserQuestion:

```
모델 라우팅 설정:
  기본값: Research=sonnet, Plan=main (현재 세션), Implement=sonnet, Test=haiku

  1. ✅ 기본값 사용 (권장)
  2. 커스텀 설정
```

If the user chooses option 1 (default):
- Use default model_routing values (already set in state template)

If the user chooses option 2:
- For each non-interactive phase (Research, Implement, Test), ask the user to choose: sonnet, haiku, or opus
- Plan phase always uses main session model (interactive feedback required)
- Store selections in the state file's `model_routing` block

### 4-2. Configure notifications

Check if a previous session's `.claude/deep-work.local.md` has a `notifications:` block with configured channels.

If previous notification settings exist:
```
이전 알림 설정을 유지합니다: [channel types list]
   변경 없이 유지하려면 Enter를 누르세요. 변경하려면 "변경"을 입력하세요.
```
Copy the previous notification settings to the new state file.

If no previous settings exist or user wants to change:
```
알림을 설정할까요?
  1. ❌ 알림 없음 (기본)
  2. 로컬 알림만 (OS 네이티브)
  3. 외부 채널 추가 (Slack / Discord / Telegram / Webhook)
```

If option 2: Set `notifications.enabled: true`, `channels: [{type: "local"}]`
If option 3: Ask for channel type and configuration (webhook URL, bot token, etc.), then set accordingly. Multiple channels can be added.

### 5. Select project type

Ask the user using AskUserQuestion:

```
프로젝트 타입을 선택하세요:
1. 기존 코드베이스 개선 (기본) — 이미 코드가 있는 프로젝트
2. 제로베이스 — 새 프로젝트를 처음부터 시작
```

If the user chooses option 2:
- Set `project_type` to `zero-base`

If the user chooses option 1 (default):
- Set `project_type` to `existing`

### 6. Select starting phase

Ask the user using AskUserQuestion:

```
시작 단계를 선택하세요:
1. Brainstorm부터 (기본) — "왜 만드는가"부터 탐색
2. Research부터 — 코드베이스 분석부터 시작 (brainstorm 생략)
3. Plan부터 — 이미 코드베이스를 잘 아는 경우
```

If `--skip-brainstorm` flag is set: auto-select option 2 (Research).

If the user chooses option 1 (default):
- Set `current_phase` to `brainstorm`
- Proceed as normal

If the user chooses option 2:
- Set `current_phase` to `research`
- Proceed as normal

If the user chooses option 3:
- Set `current_phase` to `plan`
- Set `research_complete` to `true`
- Skip research.md placeholder creation
- The starting phase guidance will tell the user to run `/deep-plan`

### 6-1. Select TDD mode

Ask the user using AskUserQuestion:

```
TDD 모드를 선택하세요:
1. strict (기본) — failing test 없이 production 코드 수정 불가
2. coaching — TDD 가이드 제공 (차단 대신 교육)
3. relaxed — TDD 강제 없음 (자유롭게 코딩)
4. spike — 탐색적 코딩 (merge 불가)
```

If `--tdd=MODE` flag is set: auto-select the specified mode.

- Option 1: Set `tdd_mode` to `strict`
- Option 2: Set `tdd_mode` to `coaching`
- Option 3: Set `tdd_mode` to `relaxed`
- Option 4: Set `tdd_mode` to `spike`

### 7. Create the state file

**Derived state from profile:**
- If `start_phase` is `"brainstorm"` (default): set `current_phase: brainstorm`
- If `start_phase` is `"research"` (from profile or `--skip-brainstorm` flag): set `current_phase: research`
- If `start_phase` is `"plan"` (from profile or `--skip-research` flag): set `current_phase: plan` and `research_complete: true`

Create or overwrite `.claude/deep-work.local.md` with the following content. Use the current timestamp and the determined values.

```markdown
---
current_phase: <brainstorm or research or plan>
task_description: "$ARGUMENTS"
work_dir: "$WORK_DIR"
iteration_count: 0
research_complete: <false or true>
plan_approved: false
team_mode: <solo or team>
preset: "<SELECTED_PRESET or 'default'>"
project_type: <existing or zero-base>
started_at: "<current ISO timestamp>"
git_branch: "<branch name or empty>"
test_retry_count: 0
max_test_retries: 3
test_passed: false
tdd_mode: "<selected tdd_mode or 'strict'>"
active_slice: ""
tdd_state: "PENDING"
debug_mode: false
slice_receipts: {}
brainstorm_started_at: ""
brainstorm_completed_at: ""
research_started_at: ""
research_completed_at: ""
plan_started_at: ""
plan_completed_at: ""
plan_approved_at: ""
implement_started_at: ""
implement_completed_at: ""
test_started_at: ""
test_completed_at: ""
model_routing:
  research: "sonnet"
  plan: "main"
  implement: "sonnet"
  test: "haiku"
last_research_commit: ""
quality_gates_passed: null
notifications:
  enabled: false
  channels: []
review_state: "pending"
cross_model_tools:
  codex: {available: false, path: ""}
  gemini: {available: false, path: ""}
cross_model_enabled:
  codex: false
  gemini: false
review_results:
  brainstorm: {score: 0, iterations: 0, timestamp: ""}
  research: {score: 0, iterations: 0, timestamp: ""}
  plan: {spec_score: 0, model_scores: {}, conflicts: 0, waivers: 0, timestamp: ""}
review_gate_overridden: false
---

# Deep Work Session

## Task
$ARGUMENTS

## Progress Log
- [$(date)] Session initialized
- [$(date)] Phase <0 (Brainstorm) or 1 (Research) or 2 (Plan)> started
```

If `--skip-review` flag was set: use `review_state: "skipped"` instead of `"pending"`.

### 7.5. Save profile

**If `PROFILE_LOADED` is false** (first run or `--setup`):

Save the current session configuration as `.claude/deep-work-profile.yaml`:

```yaml
version: 2
created_at: "<current ISO timestamp>"
updated_at: "<current ISO timestamp>"
active: "default"

presets:
  default:
    team_mode: "<selected team_mode>"
    project_type: "<selected project_type>"
    start_phase: "<brainstorm or research or plan>"
    tdd_mode: "<selected tdd_mode or 'strict'>"
    git_branch: <true if branch was created, false otherwise>
    model_routing:
      research: "<selected>"
      plan: "main"
      implement: "<selected>"
      test: "<selected>"
    notifications:
      enabled: <true/false>
      channels: <copy from state file notifications.channels>
    cross_model_preference: "ask"
```

Display: `프로필이 저장되었습니다 (default 프리셋). 다음 실행부터 이 설정이 자동 적용됩니다.`

**If `PROFILE_LOADED` is true**: Skip this step.

### 8. Confirm and guide

Determine the starting phase and display accordingly:

**If starting from Brainstorm (default):**

```
✅ Deep Work 세션이 시작되었습니다!

작업: $ARGUMENTS
작업 폴더: $WORK_DIR
프리셋: [preset_name]
작업 모드: Solo / Team (Agent Team)
프로젝트 타입: 기존 코드베이스 / 제로베이스
Git 브랜치: [branch name or "없음"]
모델 라우팅: Research=[model], Plan=main (현재 세션), Implement=[model], Test=[model]
알림: [설정 없음 / 로컬 / 로컬 + Slack + ...]
TDD 모드: strict / relaxed / coaching / spike
리뷰: [활성화 (codex + gemini) / 활성화 (codex만) / 비활성화 / 스킵됨]

워크플로우:
  Phase 0: /deep-brainstorm  ← 현재 단계
  Phase 1: /deep-research
  Phase 2: /deep-plan
  Phase 3: /deep-implement (계획 승인 시 자동 실행, TDD 강제)
  Phase 4: /deep-test (구현 완료 시 자동 실행, receipt 검증)

현재 상태: Brainstorm 단계
   - 코드 파일 수정이 차단됩니다
   - "왜 만드는가"를 먼저 탐색합니다

다음 단계: /deep-brainstorm 명령을 실행하여 디자인 탐색을 시작하세요.
```

**If starting from Research:**

```
✅ Deep Work 세션이 시작되었습니다! (Brainstorm 생략)

작업: $ARGUMENTS
작업 폴더: $WORK_DIR
프리셋: [preset_name]
작업 모드: Solo / Team (Agent Team)
프로젝트 타입: 기존 코드베이스 / 제로베이스
Git 브랜치: [branch name or "없음"]
모델 라우팅: Research=[model], Plan=main (현재 세션), Implement=[model], Test=[model]
알림: [설정 없음 / 로컬 / 로컬 + Slack + ...]
TDD 모드: strict / relaxed / coaching / spike
리뷰: [활성화 (codex + gemini) / 활성화 (codex만) / 비활성화 / 스킵됨]

워크플로우:
  Phase 1: /deep-research  ← 현재 단계
  Phase 2: /deep-plan
  Phase 3: /deep-implement (계획 승인 시 자동 실행, TDD 강제)
  Phase 4: /deep-test (구현 완료 시 자동 실행, receipt 검증)

현재 상태: Research 단계
   - 코드 파일 수정이 차단됩니다
   - $WORK_DIR/ 내 문서만 작성 가능합니다

다음 단계: /deep-research 명령을 실행하여 코드베이스 분석을 시작하세요.
```

**If starting from Plan (skip research):**

```
✅ Deep Work 세션이 시작되었습니다! (Research 단계 생략)

작업: $ARGUMENTS
작업 폴더: $WORK_DIR
프리셋: [preset_name]
작업 모드: Solo / Team (Agent Team)
프로젝트 타입: 기존 코드베이스 / 제로베이스
Git 브랜치: [branch name or "없음"]
모델 라우팅: Research=[model], Plan=main (현재 세션), Implement=[model], Test=[model]
알림: [설정 없음 / 로컬 / 로컬 + Slack + ...]
리뷰: [활성화 (codex + gemini) / 활성화 (codex만) / 비활성화 / 스킵됨]

워크플로우:
  Phase 1: /deep-research  ✅ 건너뜀
  Phase 2: /deep-plan      ← 현재 단계
  Phase 3: /deep-implement (계획 승인 시 자동 실행)
  Phase 4: /deep-test (구현 완료 시 자동 실행)

현재 상태: Plan 단계
   - 코드 파일 수정이 차단됩니다

다음 단계: /deep-plan 명령을 실행하여 구현 계획을 작성하세요.
```

If `PROFILE_LOADED` is false, omit the 프리셋 line.

If `team_mode` is `team`, add the following after the mode line:
```
   - /deep-research: 3명의 분석 에이전트가 병렬로 코드베이스 분석
   - /deep-implement: 파일 소유권 기반으로 작업을 에이전트에게 분배
```

**IMPORTANT**: Do NOT start researching or writing code automatically. Wait for the user to explicitly run the next command.
