---
allowed-tools: Bash, Read, Write, Glob, AskUserQuestion
description: "Start a deep work session with 4-phase workflow (Research → Plan → Implement → Test)"
argument-hint: task description
---

# Deep Work Session Initialization

You are initializing a **Deep Work** session — a structured 4-phase workflow that enforces strict separation between planning and coding.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure. Do NOT mix languages within a single message.

## Your Task

The user wants to work on: **$ARGUMENTS**

## Instructions

Follow these steps exactly:

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
| `--no-branch` | Override `git_branch` to `false` for this session only |

After removing flags, trim whitespace. The remainder is the task description.

#### 1.5b. Validate task description

If the task description is empty after flag removal:
- If `--setup` flag is present **without** a task description:
  - Proceed to Steps 4~6 to ask all questions
  - Save answers as profile (Step 7.5)
  - Display: `💾 프로필이 업데이트되었습니다.`
  - **Stop here** — do NOT start a new session
- Otherwise:
  - Ask the user: "작업 설명을 입력해주세요" using AskUserQuestion
  - Use the response as the task description

#### 1.5c. Load profile

Read `.claude/deep-work-profile.yaml` if it exists.

**If profile exists AND `--setup` is NOT set:**
1. Parse YAML fields: `defaults.team_mode`, `defaults.project_type`, `defaults.start_phase`, `defaults.git_branch`, `defaults.model_routing.*`, `defaults.notifications.*`
2. Check `version` field. If not `1`, display warning and treat as no profile:
   ```
   ⚠️ 프로필 버전이 호환되지 않습니다 (version: [N]). 기존 질문 흐름을 진행합니다.
   ```
3. Apply flag overrides (if any): flags take precedence over profile values
4. Display applied profile:
   ```
   ⚡ 프로필 적용: [team_mode] / [project_type] / [start_phase]부터 / [research]-[plan]-[implement]-[test]
   ```
5. Set `PROFILE_LOADED` = true
6. **Skip Steps 4, 4-1, 4-2, 5, and 6** — use profile values directly

**If profile does NOT exist OR `--setup` IS set:**
1. Set `PROFILE_LOADED` = false
2. Continue to Steps 4~6 as normal (existing behavior)

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

### 2-1. Git branch suggestion (git repository only)

Check if the project is a git repository:

```bash
git rev-parse --is-inside-work-tree 2>/dev/null
```

If the project is a git repository:

**If `PROFILE_LOADED` is true:**
- If profile `git_branch` is `true`: automatically run `git checkout -b deep-work/[SLUG]` without asking. Set `git_branch` in state file.
- If profile `git_branch` is `false`: skip branch creation. Set `git_branch` to empty string.
- Do NOT ask the user — use the profile value directly.

**If `PROFILE_LOADED` is false** (original behavior):

```
🌿 Git 브랜치를 생성할까요?
   브랜치명: deep-work/[SLUG]
   (현재 브랜치: [current branch])

1. ✅ 네 — 새 브랜치 생성
2. ❌ 아니오 — 현재 브랜치 유지
```

If the user agrees:
- Run `git checkout -b deep-work/[SLUG]`
- Set `git_branch` to `deep-work/[SLUG]` in the state file

If the user declines or not a git repo:
- Set `git_branch` to empty string

**Capture last research commit**: If the project is a git repository, run:
```bash
git rev-parse HEAD 2>/dev/null
```
Store the result as `last_research_commit` in the state file. This will be used by incremental research (`--incremental`) to detect changes since the last research.

### 3. Create placeholder files

Create these empty files:
- `$WORK_DIR/research.md` — will be filled during Phase 1
- `$WORK_DIR/plan.md` — will be filled during Phase 2

### 4. Select work mode

Ask the user to choose the work mode using AskUserQuestion:

```
🤝 작업 모드를 선택하세요:
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
🧠 모델 라우팅 설정:
  기본값: Research=sonnet, Plan=main (현재 세션), Implement=sonnet, Test=haiku

  1. ✅ 기본값 사용 (권장)
  2. ⚙️ 커스텀 설정
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
📋 이전 알림 설정을 유지합니다: [channel types list]
   변경 없이 유지하려면 Enter를 누르세요. 변경하려면 "변경"을 입력하세요.
```
Copy the previous notification settings to the new state file.

If no previous settings exist or user wants to change:
```
🔔 알림을 설정할까요?
  1. ❌ 알림 없음 (기본)
  2. 🖥️ 로컬 알림만 (OS 네이티브)
  3. 📱 외부 채널 추가 (Slack / Discord / Telegram / Webhook)
```

If option 2: Set `notifications.enabled: true`, `channels: [{type: "local"}]`
If option 3: Ask for channel type and configuration (webhook URL, bot token, etc.), then set accordingly. Multiple channels can be added.

### 5. Select project type

Ask the user using AskUserQuestion:

```
프로젝트 타입을 선택하세요:
1. 🔧 기존 코드베이스 개선 (기본) — 이미 코드가 있는 프로젝트
2. 🆕 제로베이스 — 새 프로젝트를 처음부터 시작
```

If the user chooses option 2:
- Set `project_type` to `zero-base`

If the user chooses option 1 (default):
- Set `project_type` to `existing`

### 6. Select starting phase

Ask the user using AskUserQuestion:

```
시작 단계를 선택하세요:
1. 🔍 Research부터 (기본) — 코드베이스 분석부터 시작
2. 📋 Plan부터 — 이미 코드베이스를 잘 아는 경우
```

If the user chooses option 2:
- Set `current_phase` to `plan`
- Set `research_complete` to `true`
- Skip research.md placeholder creation
- The starting phase guidance will tell the user to run `/deep-plan`

If the user chooses option 1 (default):
- Set `current_phase` to `research`
- Proceed as normal

### 7. Create the state file

**Derived state from profile:** If `start_phase` is `"plan"` (from profile or `--skip-research` flag), set `current_phase: plan` and `research_complete: true` in the state file below. This matches the existing Step 6 behavior when "Plan부터" is selected.

Create or overwrite `.claude/deep-work.local.md` with the following content. Use the current timestamp and the determined values.

```markdown
---
current_phase: <research or plan>
task_description: "$ARGUMENTS"
work_dir: "$WORK_DIR"
iteration_count: 0
research_complete: <false or true>
plan_approved: false
team_mode: <solo or team>
project_type: <existing or zero-base>
started_at: "<current ISO timestamp>"
git_branch: "<branch name or empty>"
test_retry_count: 0
max_test_retries: 3
test_passed: false
research_started_at: ""
research_completed_at: ""
plan_started_at: ""
plan_completed_at: ""
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
---

# Deep Work Session

## Task
$ARGUMENTS

## Progress Log
- [$(date)] Session initialized
- [$(date)] Phase <1 (Research) or 2 (Plan)> started
```

### 7.5. Save profile

**If `PROFILE_LOADED` is false** (first run or `--setup`):

Save the current session configuration as `.claude/deep-work-profile.yaml`:

```yaml
version: 1
created_at: "<current ISO timestamp>"
updated_at: "<current ISO timestamp>"

defaults:
  team_mode: "<selected team_mode>"
  project_type: "<selected project_type>"
  start_phase: "<selected start_phase>"
  git_branch: <true if branch was created, false otherwise>
  model_routing:
    research: "<selected>"
    plan: "main"
    implement: "<selected>"
    test: "<selected>"
  notifications:
    enabled: <true/false>
    channels: <copy from state file notifications.channels>
```

Display: `💾 프로필이 저장되었습니다. 다음 실행부터 이 설정이 자동 적용됩니다.`

**If `PROFILE_LOADED` is true**: Skip this step.

### 8. Confirm and guide

Determine the starting phase and display accordingly:

**If starting from Research:**

```
✅ Deep Work 세션이 시작되었습니다!

📋 작업: $ARGUMENTS
📂 작업 폴더: $WORK_DIR
🤝 작업 모드: Solo / Team (Agent Team)
🏗️ 프로젝트 타입: 기존 코드베이스 / 제로베이스
🌿 Git 브랜치: [branch name or "없음"]
🧠 모델 라우팅: Research=[model], Plan=main (현재 세션), Implement=[model], Test=[model]
🔔 알림: [설정 없음 / 로컬 / 로컬 + Slack + ...]

🔄 워크플로우:
  Phase 1: /deep-research  ← 현재 단계
  Phase 2: /deep-plan
  Phase 3: /deep-implement (계획 승인 시 자동 실행)
  Phase 4: /deep-test (구현 완료 시 자동 실행)

⚡ 현재 상태: Research 단계
   - 코드 파일 수정이 차단됩니다
   - $WORK_DIR/ 내 문서만 작성 가능합니다

👉 다음 단계: /deep-research 명령을 실행하여 코드베이스 분석을 시작하세요.
```

**If starting from Plan (skip research):**

```
✅ Deep Work 세션이 시작되었습니다! (Research 단계 생략)

📋 작업: $ARGUMENTS
📂 작업 폴더: $WORK_DIR
🤝 작업 모드: Solo / Team (Agent Team)
🏗️ 프로젝트 타입: 기존 코드베이스 / 제로베이스
🌿 Git 브랜치: [branch name or "없음"]
🧠 모델 라우팅: Research=[model], Plan=main (현재 세션), Implement=[model], Test=[model]
🔔 알림: [설정 없음 / 로컬 / 로컬 + Slack + ...]

🔄 워크플로우:
  Phase 1: /deep-research  ✅ 건너뜀
  Phase 2: /deep-plan      ← 현재 단계
  Phase 3: /deep-implement (계획 승인 시 자동 실행)
  Phase 4: /deep-test (구현 완료 시 자동 실행)

⚡ 현재 상태: Plan 단계
   - 코드 파일 수정이 차단됩니다

👉 다음 단계: /deep-plan 명령을 실행하여 구현 계획을 작성하세요.
```

If `team_mode` is `team`, add the following after the mode line:
```
   - /deep-research: 3명의 분석 에이전트가 병렬로 코드베이스 분석
   - /deep-implement: 파일 소유권 기반으로 작업을 에이전트에게 분배
```

**IMPORTANT**: Do NOT start researching or writing code automatically. Wait for the user to explicitly run the next command.
