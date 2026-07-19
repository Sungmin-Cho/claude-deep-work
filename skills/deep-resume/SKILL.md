---
name: deep-resume
description: "Use when the user wants to resume an active deep-work session — restoring context from previous artifacts and continuing from the current phase. Triggers on `/deep-resume`, \"resume session\", \"deep-work 이어서\", \"세션 재개\", \"이전 작업 계속\", or when interrupted mid-phase. Detects active session via env var → pointer file → legacy fallback, restores worktree context, migrates state if version-bumped, clears phase cache, and dispatches to the per-phase resume skill. Supports `--session=<id>`, `--resume-from=<phase>`, `--worktree=<path>`."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-resume [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-resume", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) | Auto-detect active session + 현재 phase resume |
| `--session=<id>` | 명시 세션 ID resume |
| `--resume-from=<phase>` | `brainstorm|research|plan|implement|test` 강제 |
| `--worktree=<path>` | worktree 경로 명시 |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


> **Utility (v6.2.4)** — standalone 명령. `/deep-work` init은 stale 세션 감지만 수행하며, active 세션 선택·worktree 컨텍스트 복원·state 마이그레이션·phase cache 정리·phase별 resume dispatch는 이 커맨드가 유일한 경로입니다.
> 향후 기능 이관 후 삭제 예정 (spec §7 follow-up).
>
> **v6.4.2**: `parse-deep-work-flags` 파서가 `--session=<id>`, `--resume-from=brainstorm` (및 `research|plan|implement|test`), `--worktree=<path>` 플래그를 지원합니다.

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

- `execution_override: inline | delegate | null` (v6.4.0 — sets decide_execution_mode override for inline escape hatches)
- `active_cluster_takeover: "<cluster_id>" | null` (v6.4.0 — debug takeover 중 세션 중단 시, resume 하면 해당 cluster를 inline으로 이어 실행)
- `delegation_snapshot: "<git hash>" | null` (v6.4.0 C-1.1 — delegate 진입 직전 capture된 commit hash. verify-receipt pass 시 null로 clear. resume 시 non-null이면 "verify-receipt fail 후 interrupt" 신호로 해석되어 Rollback Protocol AskUserQuestion을 재표시한다.)

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

> **모델 라우팅 재해석 (v6.10.0)**: state에 `model_routing_meta`가 있고 `meta.runtime`이 현재 감지 런타임(`node "${CLAUDE_PLUGIN_ROOT}/scripts/detect-runtime.js"` 기준 — CLI 없으므로 `node -e 'const{detectRuntime}=require(...);console.log(detectRuntime())'`)과 다르면, `meta.tiers`를 현재 런타임 카탈로그로 재해석해 `model_routing` 블록을 갱신하고 `meta.runtime`을 갱신한 뒤 1회 안내한다. meta 부재(구세션) → skip.

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

Plan phase도 Orchestrator Exit Gate 재표시(v6.3.1 F1)가 필요합니다.
**Orchestrator를 경유하여 resume합니다:**

```
Skill("deep-work-orchestrator", args="--session={SESSION_ID} --resume-from=plan")
```

- `plan_completed_at` + `plan_approved: true`이면 Orchestrator §3-3 Exit Gate 재표시 (paused-after-approval 복귀 경로). current_phase를 implement로 강제 전환하지 않음 — Option A F1에서 이 상태는 정당한 일시정지 상태임.
- `plan_approved: false`이면 Orchestrator §3-3이 review+approval 단계 재개.

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
