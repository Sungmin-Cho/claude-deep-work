---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Resume an active deep work session — restores context and continues from where you left off"
---

> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.

# Deep Work Session Resume

You are resuming an active **Deep Work** session — restoring context from previous artifacts and continuing from the current phase.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure. Do NOT mix languages within a single message.

## Instructions

### 1. Detect active session & extract WORK_DIR (multi-session aware)

Resolve the session to resume using the following priority:

#### 1a. Direct session ID (env var)

If `DEEP_WORK_SESSION_ID` environment variable is set:
- Read `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md` directly
- If the file exists and `current_phase` is not `idle`: proceed to Step 1.5 with this session
- If the file doesn't exist or phase is `idle`: fall through to 1b

#### 1b. Registry-based session discovery

Read the registry (`.claude/deep-work-sessions.json`). Filter to sessions where `current_phase` is NOT `idle`.

**If no active sessions in registry:**
- Check for legacy fallback: read `.claude/deep-work.local.md`
  - If exists and `current_phase` is NOT `idle` and NOT empty: use this file as the state file. Display:
    ```
    ℹ️ 레거시 세션을 감지했습니다. 이 세션을 재개합니다.
    ```
    Proceed to Step 1.5.
  - Otherwise:
    ```
    ℹ️ 활성 세션이 없습니다.

    새 세션을 시작하려면: /deep-work <작업 설명>
    ```
    Stop here.

**If exactly 1 active session in registry:**
- Auto-select this session
- Update the pointer file: `write_session_pointer SESSION_ID`
- Read `.claude/deep-work.${SESSION_ID}.md`
- Proceed to Step 1.5

**If 2+ active sessions in registry:**
- Present selection UI using AskUserQuestion:

```
재개할 세션을 선택하세요:

  1. [SESSION_ID] [task_description] ([current_phase], [last_activity])
  2. [SESSION_ID] [task_description] ([current_phase], [last_activity])
  ...
```

- After user selects a session:
  - Update the pointer file: `write_session_pointer SELECTED_SESSION_ID`
  - Read `.claude/deep-work.${SELECTED_SESSION_ID}.md`
  - Proceed to Step 1.5

#### 1c. Extract state

From the resolved state file, extract `current_phase`, `work_dir`, `task_description`, `started_at`, `team_mode`, `plan_approved`, `test_retry_count`, `max_test_retries`, `preset`, `evaluator_model`, `assumption_adjustments`, `skipped_phases`, `plan_review_retries`, and `auto_loop_enabled` from the YAML frontmatter.

Set `$WORK_DIR` to the value of `work_dir` (used in all subsequent steps).

**If `current_phase` is `idle` or empty:**

```
ℹ️ 완료된 세션입니다.

리포트 확인: /deep-report
새 세션 시작: /deep-work <작업 설명>
```

Stop here.

### 1.5. Worktree restoration (v4.1)

If `worktree_enabled` is `true` in the state file:

1. Read `worktree_path` from state file
2. Check if the worktree still exists on disk:
   ```bash
   [ -d "[worktree_path]" ] && echo "exists" || echo "missing"
   ```
3. **If exists**: Set working directory context to the worktree path.
   - All subsequent Bash calls should prepend `cd [absolute_worktree_path] &&`
   - Display:
     ```
     Worktree 복원: [worktree_branch]
        Path: [worktree_path]
     ```

4. **If missing** (user manually deleted the worktree):
   - Display warning:
     ```
     ⚠️ Worktree가 삭제되었습니다: [worktree_path]
        현재 브랜치에서 계속 진행합니다.
        Worktree 재생성은 지원하지 않습니다 — /deep-finish로 세션을 정리하세요.
     ```
   - Update state: `worktree_enabled: false`
   - Continue with current directory as working directory

### 2. Restore context

Based on the current phase, load the relevant artifacts to restore AI context:

#### Phase: `brainstorm`

- Read `$WORK_DIR/brainstorm.md` if it exists
  - If it has content: display "이전 브레인스톰 결과 발견" and read the content for context
  - If it doesn't exist or is empty: note "브레인스톰 산출물 없음"
- Set `phase_context` to "탐색 중"

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
- Read `review_state` from state file
  - If `"in_progress"`: note "리뷰 진행 중이었음"
    - If `review_results.plan.judgments_timestamp` exists: note "종합 판단 완료, 사용자 확인 대기"
    - Otherwise: note "리뷰 진행 중"
  - If `"completed"`: note "리뷰 완료됨"
  - Read `$WORK_DIR/plan-review.json` and `$WORK_DIR/plan-cross-review.json` if they exist

#### Phase: `implement`

- Read `$WORK_DIR/research.md` if it exists — **only Executive Summary** (1 paragraph)
- Read `$WORK_DIR/plan.md` in full — this is the implementation guide
  - Parse the Slice Checklist: count `- [x]` (completed) and `- [ ]` (incomplete)
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
Deep Work 세션을 재개합니다

작업: [task_description]
현재 단계: [Phase 이름] ([phase_context])
작업 폴더: [work_dir]
프리셋: [preset]
평가자 모델: [evaluator_model]
시작: [started_at]
Assumption 조정: [N]건 또는 없음
건너뛴 단계: [list] 또는 없음

컨텍스트 복원:
  [✅/⬜] research.md [요약 로드 / 없음]
  [✅/⬜] plan.md [전문 로드 / 요약 로드 / 없음]
  [✅/⬜] 체크리스트 진행률: N/M (XX%)    ← implement만
  [✅/⬜] 테스트 결과 (시도 N/M)           ← test만
  [✅/⬜] 리뷰 상태: [완료 (8/10) / 진행중 / 대기 / 스킵]  ← plan만

▶️ [다음 행동]
```

Omit lines that don't apply to the current phase (e.g., don't show 체크리스트 for research phase). (If `preset` is empty or not set, omit the 프리셋 line.) If `evaluator_model` is empty or not set, omit the 평가자 모델 line. If `assumption_adjustments` is empty or not set, show "없음". If `skipped_phases` is empty or not set, show "없음".

### 4. Auto-continue

Execute the appropriate action based on the current phase:

#### `research`

- If `review_state` is `"in_progress"`:
  Resume using the review-aware flow below, then return to normal research flow.

  1. Check if `review_results.research.judgments_timestamp` exists in state file
  2. **If exists**: Compare with `$WORK_DIR/research.md` file modification time
     - If `research.md` was modified **after** `judgments_timestamp` → judgments are invalidated. Clear `review_results.research.judgments` and `judgments_timestamp`. Read the `/deep-research` command file and resume from its review flow start (Step 4.5).
     - If `research.md` was **not** modified after timestamp → existing judgments are valid. Read the `/deep-research` command file and resume from user confirmation step (Step 4.7).
  3. **If not exists**: No prior judgments. Read the `/deep-research` command file and resume from its review flow start (Step 4.5).

  **IMPORTANT**: Route to `/deep-research`'s review flow, NOT to `/deep-review`.

- Otherwise:
  Read the `/deep-research` command file (located at the same directory level as this command) and follow all its steps. If research.md already has partial content, the research command's cache/incremental logic will handle it.

#### `plan`

- If `review_state` is `"in_progress"`:
  Resume using the review-aware flow below, then return to normal plan flow.

  1. Check if `review_results.plan.judgments_timestamp` exists in state file
  2. **If exists**: Compare with `$WORK_DIR/plan.md` file modification time
     - If `plan.md` was modified **after** `judgments_timestamp` → judgments are invalidated. Clear `review_results.plan.judgments` and `judgments_timestamp`. Read the `/deep-plan` command file and resume from its review flow start (Step 3.5).
     - If `plan.md` was **not** modified after timestamp → existing judgments are valid. Read the `/deep-plan` command file and resume from user confirmation step (Step 3.8).
  3. **If not exists**: No prior judgments. Read the `/deep-plan` command file and resume from its review flow start (Step 3.5).

  **IMPORTANT**: Route to `/deep-plan`'s review flow, NOT to `/deep-review`.

- If `$WORK_DIR/plan.md` does **not** exist:
  Read the `/deep-plan` command file and follow all its steps.

- If `$WORK_DIR/plan.md` **exists** and `plan_approved` is `false`:
  Read the plan.md content and present it for review:
  ```
  이전에 작성된 계획서가 있습니다.

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
