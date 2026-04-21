---
allowed-tools: Skill, Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Resume an active deep work session — restores context and continues from where you left off"
---

> **Utility (v6.2.4)** — standalone 명령. `/deep-work` init은 stale 세션 감지만 수행하며, active 세션 선택·worktree 컨텍스트 복원·state 마이그레이션·phase cache 정리·phase별 resume dispatch는 이 커맨드가 유일한 경로입니다.
> 향후 기능 이관 후 삭제 예정 (spec §7 follow-up).

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

리포트 확인: `/deep-status --report` · 재생성: `/deep-report`
새 세션 시작: /deep-work <작업 설명>
```

Stop here.

### 1.4. State 스키마 마이그레이션 (v6.0.2)

Resume 시 state 파일에 `phase_review` 필드가 없으면 빈 객체로 자동 초기화:

If `phase_review` field is missing from state YAML frontmatter:
- Add `phase_review: {}` to the state file
- Log: `📋 phase_review 필드 초기화 완료 (v6.0.2 마이그레이션)`

If `review_results` field exists (v5.5 legacy):
- Read `review_results.{phase}` values
- Migrate to `phase_review.{phase}.reviewed: true` for phases that have review data
- Keep `review_results` for backward compatibility (read-only)

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

### 3.5. Phase cache cleanup (v6.1)

Before dispatching to the phase skill, delete any stale phase cache to ensure a clean resume:

```bash
rm -f .claude/.phase-cache-${SESSION_ID} 2>/dev/null
```

Where `${SESSION_ID}` is the resolved session ID from Step 1.

### 4. Auto-continue

Execute the appropriate phase skill based on the current phase. Each skill handles its own resume logic (review state detection, checkpoint restoration, etc.) internally.

#### `brainstorm`

Brainstorm phase는 Orchestrator Exit Gate 재표시(v6.3.1 F1)가 필요합니다.
**Orchestrator를 경유하여 resume합니다:**

```
Skill("deep-work-orchestrator", args="--session={SESSION_ID} --resume-from=brainstorm")
```

- `brainstorm_completed_at`이 있으면 Orchestrator §3-1 Exit Gate 재표시.
- 미완료면 brainstorm skill을 처음부터 재실행.

#### `research`

Research phase는 Orchestrator의 Review + Approval Workflow를 거쳐야 current_phase가 진전합니다.
Phase skill을 직접 호출하면 current_phase가 변경되지 않아 dead-end가 됩니다.
**Orchestrator를 경유하여 resume합니다:**

```
Skill("deep-work-orchestrator", args="--session={SESSION_ID} --resume-from=research")
```

Orchestrator가 research skill 호출 → review → approval → plan 진전까지 처리합니다.

#### `plan`

Plan phase도 Research와 동일하게 Orchestrator의 Review + Approval Workflow가 필요합니다.
**Orchestrator를 경유하여 resume합니다:**

- If `plan_approved` is `true`:
  The session is in an inconsistent state (plan approved but phase is still `plan`). Update `current_phase: implement` in the state file and proceed to implement logic below.

- Otherwise:
  ```
  Skill("deep-work-orchestrator", args="--session={SESSION_ID} --resume-from=plan")
  ```

#### `implement`

Implement phase도 Orchestrator Exit Gate 재표시(v6.3.1 F1)가 필요합니다.
**Orchestrator를 경유하여 resume합니다:**

```
Skill("deep-work-orchestrator", args="--session={SESSION_ID} --resume-from=implement")
```

- `implement_completed_at` + 모든 slice receipt complete이면 Orchestrator §3-4 Exit Gate 재표시.
- 미완료 slice가 있으면 implement skill이 slice-level resume 수행 (기존 Resume Detection 로직).

#### `test`

Test phase도 Orchestrator Exit Gate 재표시(v6.3.1 F1)가 필요합니다.

- If `test_passed: true`:
  All Pass된 세션. Orchestrator §3-5 Exit Gate 재표시:
  ```
  Skill("deep-work-orchestrator", args="--session={SESSION_ID} --resume-from=test")
  ```

- Otherwise (retry 진행 중 또는 exhausted):
  ```
  Skill("deep-work-orchestrator", args="--session={SESSION_ID} --resume-from=test")
  ```
  Orchestrator §3-5가 test skill을 호출하고 retry loop을 이어서 관리합니다.
