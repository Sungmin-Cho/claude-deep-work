---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Resume an active deep work session — restores context and continues from where you left off"
---

# Deep Work Session Resume

You are resuming an active **Deep Work** session — restoring context from previous artifacts and continuing from the current phase.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure. Do NOT mix languages within a single message.

## Instructions

### 1. Detect active session & extract WORK_DIR

Read `.claude/deep-work.local.md`. Extract `current_phase`, `work_dir`, `task_description`, `started_at`, `team_mode`, `plan_approved`, `test_retry_count`, `max_test_retries`, and `preset` from the YAML frontmatter.

Set `$WORK_DIR` to the value of `work_dir` (used in all subsequent steps).

**If the file doesn't exist:**

```
ℹ️ 활성 세션이 없습니다.

새 세션을 시작하려면: /deep-work <작업 설명>
```

Stop here.

**If `current_phase` is `idle` or empty:**

```
ℹ️ 완료된 세션입니다.

📄 리포트 확인: /deep-report
🆕 새 세션 시작: /deep-work <작업 설명>
```

Stop here.

### 2. Restore context

Based on the current phase, load the relevant artifacts to restore AI context:

#### Phase: `research`

- Read `$WORK_DIR/research.md` if it exists
  - If it has content: display "이전 리서치 일부 발견" and read the content to understand what was already analyzed
  - If it doesn't exist or is empty: note "리서치 산출물 없음"
- Set `phase_context` to "분석 중"

#### Phase: `plan`

- Read `$WORK_DIR/research.md` if it exists — **only the Executive Summary and Key Findings sections** (stop reading after `---` separator or the next `##` heading after Key Findings). This provides research context without consuming excessive tokens.
  - If it doesn't exist: display warning "⚠️ research.md를 찾을 수 없습니다"
- Read `$WORK_DIR/plan.md` if it exists (for review continuation)
- Set `phase_context` to "리뷰 대기" if plan.md exists, "작성 대기" if not

#### Phase: `implement`

- Read `$WORK_DIR/research.md` if it exists — **only Executive Summary** (1 paragraph)
- Read `$WORK_DIR/plan.md` in full — this is the implementation guide
  - Parse the Task Checklist: count `- [x]` (completed) and `- [ ]` (incomplete)
  - Identify the **last completed task** and the **next incomplete task**
  - Calculate progress: `completed / total * 100`
  - If plan.md doesn't exist: "⚠️ plan.md를 찾을 수 없습니다. /deep-plan을 먼저 실행하세요." → Stop
- Set `phase_context` to "N/M 완료"

#### Phase: `test`

- Read `$WORK_DIR/plan.md` — **only Plan Summary section** (approach, scope, risk)
- Read `$WORK_DIR/test-results.md` if it exists — focus on the most recent attempt's Failures section
- Read `test_retry_count` and `max_test_retries` from the state file
- Set `phase_context` to "시도 N/M"

**File resilience:** If any file fails to read (missing, corrupted), display a warning but continue with available data. Only stop if a critical dependency is missing (e.g., plan.md missing during implement phase).

### 3. Display resume status

```
🔄 Deep Work 세션을 재개합니다

📋 작업: [task_description]
📍 현재 단계: [Phase 이름] ([phase_context])
📂 작업 폴더: [work_dir]
🎯 프리셋: [preset]
⏱️ 시작: [started_at]

📥 컨텍스트 복원:
  [✅/⬜] research.md [요약 로드 / 없음]
  [✅/⬜] plan.md [전문 로드 / 요약 로드 / 없음]
  [✅/⬜] 체크리스트 진행률: N/M (XX%)    ← implement만
  [✅/⬜] 테스트 결과 (시도 N/M)           ← test만

▶️ [다음 행동]
```

Omit lines that don't apply to the current phase (e.g., don't show 체크리스트 for research phase). (If `preset` is empty or not set, omit the 🎯 프리셋 line.)

### 4. Auto-continue

Execute the appropriate action based on the current phase:

#### `research`

Read the `/deep-research` command file (located at the same directory level as this command) and follow all its steps. If research.md already has partial content, the research command's cache/incremental logic will handle it.

#### `plan`

- If `$WORK_DIR/plan.md` does **not** exist:
  Read the `/deep-plan` command file and follow all its steps.

- If `$WORK_DIR/plan.md` **exists** and `plan_approved` is `false`:
  Read the plan.md content and present it for review:
  ```
  📋 이전에 작성된 계획서가 있습니다.

  [plan.md의 Plan Summary 섹션 표시]

  피드백을 주시거나, "승인" / "approve"를 입력하여 다음 단계로 진행하세요.
  ```
  Wait for user input using AskUserQuestion.
  - If the user provides feedback: apply it to plan.md (same as deep-plan.md Section 4-1 interactive loop)
  - If the user approves: follow deep-plan.md Section 5 (handle approval → auto-implement)

- If `plan_approved` is `true`:
  The session is in an inconsistent state (plan approved but phase is still `plan`). Update `current_phase: implement` in the state file and proceed to implement logic below.

#### `implement`

Read the `/deep-implement` command file and follow its steps. **Important**: Always enter through Section 0 (Resume detection / checkpoint support), NOT through Section 0-pre (Model Routing). This ensures checkpoint-based resume regardless of `model_routing` settings. The resume detection in Section 0 will identify completed `[x]` tasks and start from the first incomplete task.

#### `test`

Read the `/deep-test` command file and follow all its steps.
