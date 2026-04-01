---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Phase 2: Deep planning - create a detailed implementation plan"
---

# Phase 2: Deep Planning

You are in the **Planning** phase of a Deep Work session.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Critical Constraints

🚫 **DO NOT implement anything.**
🚫 **DO NOT modify any source code files.**
🚫 **DO NOT create implementation files.**
✅ **ONLY plan and document the plan in the session's work directory.**

## Instructions

### 1. Verify prerequisites

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `$STATE_FILE`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` and verify:
- `current_phase` is "plan"
- `research_complete` is true

If not, inform the user which prerequisite step is missing.

Extract `work_dir`, `project_type`, and `team_mode` from the state file. If missing, default to `deep-work`, `existing`, and `solo` respectively (backward compatibility).
Set `WORK_DIR` to this value.

**Record start time**: Update `plan_started_at` in the state file with the current ISO timestamp.

Also read `$WORK_DIR/research.md` to load the research findings (if it exists — it may not exist if research was skipped via A-1 phase skip).

### 1-1. Backup previous plan (if iteration_count > 0)

If a previous `$WORK_DIR/plan.md` exists and `iteration_count` > 0:
1. Copy the existing plan.md to `$WORK_DIR/plan.v{iteration_count}.md` (e.g., plan.v1.md, plan.v2.md)
2. Proceed to create the new plan.md

### 1-2. Plan Diff visualization (if iteration_count > 0)

**This section executes AFTER the new plan.md is written (Section 3) but BEFORE the review presentation (Section 4).**

If `iteration_count` > 0 and a previous `$WORK_DIR/plan.v{iteration_count}.md` exists:

1. Read the previous plan version (`plan.v{iteration_count}.md`)
2. Read the new plan.md
3. Compare structurally:
   - **Slice Checklist**: Match tasks by file path to detect added/modified/deleted
   - **Files to Modify**: Compare file lists (new files added, files removed)
   - **Architecture Decision**: Text comparison for key changes
   - **Risk Level**: Compare Plan Summary risk levels

4. Write `$WORK_DIR/plan-diff.md`:

```markdown
# Plan Diff: v{N} → v{N+1}

## 변경 사유
[Summarize user's feedback that led to the re-write]

## 태스크 변경

### ➕ 추가된 태스크
- Task [N]: [file path] — [description]
  - 사유: [reason]

### ✏️ 수정된 태스크
- Task [N]: [file path]
  - 변경: [old approach] → [new approach]
  - 사유: [reason]

### ➖ 삭제된 태스크
- ~~Task [N]: [file path] — [description]~~
  - 사유: [reason]

## 파일 영향 변경
| 파일 | v{N} | v{N+1} | 변경 |
|------|------|--------|------|
| [path] | [action] | [action] | [change description] |

## 아키텍처 결정 변경
- [Key architecture decision changes]

## 리스크 수준 변경
- v{N}: [level] → v{N+1}: [level] ([reason])
```

5. Display summary during the review presentation (add to Section 4 display):
```
Plan Diff (v{N} → v{N+1}):
  ➕ 추가: [N]개 태스크
  ✏️ 수정: [N]개 태스크
  ➖ 삭제: [N]개 태스크
  상세: $WORK_DIR/plan-diff.md
```

If `iteration_count` is 0, skip this section entirely.

### 1-3. Template suggestion (optional)

Read `references/plan-templates.md` from the skill directory to check for matching templates.

Analyze the task description and research.md to identify the most appropriate template:

```
적합한 Plan 템플릿이 있습니다: [Template Name]
   템플릿을 활용할까요? (y/n)
```

If the user agrees, use the template structure as the skeleton for plan.md.
If declined, proceed with the standard structure.

### 2. Check for user feedback

Read `$WORK_DIR/plan.md` if it already exists — the user may have added feedback notes in the form of:
- `> [!NOTE]` callouts
- `<!-- HUMAN: ... -->` comments
- Inline comments or strikethroughs

If feedback exists, incorporate it into the updated plan. After incorporating, apply the Document Refinement Protocol:
1. **Deduplicate** — Remove duplicate content across sections.
2. **Prune** — Remove invalidated content and empty sections.
3. Append refinement log: `<!-- v[N]: [feedback source] — deduped: [N], pruned: [M] -->`

### 3. Create the implementation plan

Write `$WORK_DIR/plan.md` with the following structure. The document MUST begin with Plan Summary (pyramid principle: conclusions first).

**v4.0 Slice Format**: Each task in the plan is a "slice" — a self-contained unit of work with its own TDD cycle. Every slice MUST have:
- `files`: list of files this slice modifies
- `failing_test`: the test that should fail before implementation
- `verification_cmd`: command to verify the slice works
- `spec_checklist`: specific requirements this slice must satisfy
- `size`: S (< 30 min) / M (30-60 min) / L (1+ hour)

The slice format replaces the previous `- [ ] Task N:` checklist format.

**For existing codebases (`project_type: existing`):**

```markdown
# Implementation Plan: [Task Title]

## Plan Summary
<!-- 3-5줄 핵심 요약: 어떤 접근법을 선택했고, 몇 개 파일을 수정하며,
     예상 리스크 수준은 어떤지. -->
- **접근법**: [선택한 아키텍처/접근법 한 줄 설명]
- **변경 범위**: [N]개 파일 수정, [M]개 파일 생성
- **리스크 수준**: Low / Medium / High
- **핵심 결정**: [가장 중요한 아키텍처 결정 한 줄]

---

## Overview
Brief description of what will be implemented and the approach chosen.

## Architecture Decision
Why this approach was chosen over alternatives. Reference research findings.

## Files to Modify

### [File path 1]
- **Action**: Create / Modify / Delete
- **Changes**: Detailed description
- **Code sketch**:
  ```language
  // Pseudocode or actual code snippet showing the change
  ```
- **Reason**: Why this change is needed
- **Risk**: Low / Medium / High — explanation

### [File path 2]
...

## Execution Order
1. First: [file/change] — because [reason]
2. Then: [file/change] — depends on step 1
3. ...

## Dependency Analysis
- [Change A] must happen before [Change B] because...
- [Change C] is independent and can happen anytime

## Trade-offs
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| Option A | ... | ... | ✅ |
| Option B | ... | ... | ❌ |

## Rollback Strategy
If something goes wrong:
1. `git stash` or `git reset` to [commit]
2. Specific rollback steps...

## Slice Checklist

Each slice is a self-contained unit of work with its own TDD cycle and receipt.

- [ ] SLICE-001: [Goal]
  - files: [file1, file2]
  - failing_test: [test file — test description]
  - verification_cmd: [command to verify]
  - spec_checklist: [requirement 1, requirement 2]
  - contract: [testable criterion 1, testable criterion 2]
  - acceptance_threshold: all
  - size: S/M/L

- [ ] SLICE-002: [Goal]
  - files: [file1, file2]
  - failing_test: [test file — test description]
  - verification_cmd: [command to verify]
  - spec_checklist: [requirement 1, requirement 2]
  - contract: [testable criterion 1, testable criterion 2]
  - acceptance_threshold: all
  - size: S/M/L

...

## Open Questions
- Any unresolved decisions for the user to weigh in on
```

**For zero-base projects (`project_type: zero-base`):**

```markdown
# Implementation Plan: [Task Title] (Zero-Base)

## Plan Summary
- **접근법**: [선택한 기술 스택과 아키텍처 한 줄 설명]
- **생성 범위**: [N]개 파일 생성
- **리스크 수준**: Low / Medium / High
- **핵심 결정**: [가장 중요한 기술 스택 결정 한 줄]

---

## Overview
[Approach description]

## Architecture Decision
[Why this stack and architecture]

## Project Structure
[전체 디렉토리 구조 트리]

## Files to Create

### [File path]
- **Action**: Create
- **Purpose**: [이 파일의 역할]
- **Code sketch**: [코드 스니펫]
- **Dependencies**: [이 파일이 의존하는 다른 파일]

## Setup Instructions
[프로젝트 초기화 명령어 목록]
- `mkdir -p ...`
- `npm init ...` / `python -m venv ...`
- 의존성 설치 명령어

## Slice Checklist

- [ ] SLICE-001: [Goal]
  - files: [file1, file2]
  - failing_test: [test file — test description]
  - verification_cmd: [command to verify]
  - spec_checklist: [requirement 1]
  - contract: [testable criterion 1, testable criterion 2]
  - acceptance_threshold: all
  - size: S/M/L

...

## Open Questions
- [Unresolved items]
```

**If previous versions exist, add a Change Log:**

```markdown
---
## Change Log

### v{N} → v{N+1} (현재)
- **변경 사유**: [사용자 피드백 요약]
- **주요 변경**:
  - [변경 1]
  - [변경 2]
- **이전 버전**: plan.v{N}.md
```

**Contract guidelines** (v5.1):
- `contract`: Testable input→output pairs defining "done" precisely. Each item should be verifiable (e.g., "POST /login → 200 + { token: string }"). Required for M/L/XL slices. Optional for S-size slices.
- `acceptance_threshold`: `all` (every contract item must pass, default) or `majority` (for exploratory work).
- `spec_checklist` remains for high-level requirements. `contract` supplements it with precise verification criteria.

### 3.4. Contract Negotiation (v5.1)

After writing plan.md with slice definitions (including contracts), validate each slice's contract:

1. For each M/L/XL slice, check if `contract` field exists and is non-empty. If missing, add a reminder comment to plan.md:
   ```
   <!-- CONTRACT MISSING: SLICE-NNN is size [M/L/XL] — add testable contract items -->
   ```

2. Read `evaluator_model` from state file (default: "sonnet"). Spawn an Agent (contract-validator) with:
   - **Input**: The plan.md Slice Checklist section
   - **Prompt**: "For each slice with a contract, evaluate:
     a) Are any items ambiguous? ('works correctly' is bad, 'returns 200 with token' is good)
     b) Can each item be expressed as input→output?
     c) Are obvious edge cases missing?
     Return JSON: { slices: [{ slice_id, issues: [{ type: 'ambiguous'|'untestable'|'missing_edge_case', item, suggestion }] }] }"
   - **Model**: evaluator_model from state (default: "sonnet")

3. If the evaluator returns any issues:
   - Auto-fix each issue in plan.md (rewrite the contract items)
   - Display: `Contract 검증: [N]개 항목 수정됨`
   - Re-run the evaluator (max 2 iterations)

4. If no issues after fix or on first pass:
   - Display: `Contract 검증: ✅ 통과`
   - Proceed to Structural Review (Section 3.5)

This step is integrated into the Plan Auto-Loop — contract negotiation failures count toward `plan_review_retries`.

### 3.5. Structural Review + Auto-Loop (v5.1)

Read `references/review-gate.md` from the skill directory (located at `skills/deep-work-workflow/references/review-gate.md`).

Read `evaluator_model` from state file (default: "sonnet").

Follow the **Structural Review Protocol** with these settings:
- **Phase**: plan
- **Document**: `$WORK_DIR/plan.md`
- **Dimensions**: architecture_fit, slice_executability, testability, rollback_completeness, risk_coverage
- **Output**: `$WORK_DIR/plan-review.json` + `$WORK_DIR/plan-review.md`
- **Model**: evaluator_model from state (default: "sonnet")
- **Max iterations**: 2

If `--skip-review` flag was set (check state file `review_state: skipped`), skip sections 3.5 and 3.6 entirely and proceed to Section 4.

Update state file when starting review:
- `review_state: in_progress`

**Auto-Loop (v5.1)**:

Read `plan_review_retries` from state file (default: 0). Read `plan_review_max_retries` (default: 3).

```
plan.md + structural review
    ↓
score >= 5? ──YES──→ proceed to Section 3.6 (cross-model) or Section 4
    │
    NO
    ↓
plan_review_retries < plan_review_max_retries?
    ├─ YES:
    │   1. Extract failed dimensions and issues from review JSON
    │   2. Auto-fix plan.md based on feedback:
    │      - For each issue, apply the suggested fix
    │      - Append context: "<!-- Auto-fix attempt [N]: [issue summary] -->"
    │   3. Increment plan_review_retries in state file
    │   4. Display: "Plan 자동 수정 (시도 [N]/[max]): [issues fixed]"
    │   5. Re-run structural review (loop back)
    │
    └─ NO:
        1. Display:
           "⛔ Plan 자동 수정 실패 (3회 시도).
            남은 문제: [issue list]
            수동으로 plan.md를 수정한 후 /deep-review를 실행하세요."
        2. Set review_state: "auto_loop_failed"
        3. Proceed to Section 4 (user can manually fix and approve)
```

After structural review completes (whether by auto-loop or direct pass):
- Update `review_results.plan.spec_score` in state file
- If score < 5 and auto-loop exhausted: display warning but allow manual override at approval
- Display: `Plan Structural Review: [score]/10 ([retries] auto-fix, [iterations] review iterations)`

### 3.6. Adversarial Cross-Model Review

**Prerequisites**: Structural review (Section 3.5) must have completed.

Read state file `cross_model_enabled` field.
- If `{codex: false, gemini: false}` or field missing: skip this section entirely.
- If at least one model enabled: proceed.

Read `references/review-gate.md` and follow the **Adversarial Review Protocol**.

**Progress display during execution:**
```
크로스 모델 리뷰 진행 중...
   ⏳ [Model] 리뷰 중... (예상 30-60초)
```

Each model completion:
```
   ✅ [Model] 리뷰 완료 ([N]초)
```

After all models complete, Claude synthesizes results following the protocol's synthesis rules.

**Display conflict resolution UX** per the protocol. Each conflict gets its own AskUserQuestion.

**After conflict resolution**, check if plan.md was modified:
- If modified (user accepted external model's opinion or made manual edits):
  - Count modified sections (markdown ## headings)
  - Display re-review recommendation:
    ```
    plan.md가 수정되었습니다.

    크로스 리뷰를 한번 더 진행할까요?
      1. ✅ 네, 수정 사항 검증 (추천 — [N]개+ 섹션 수정됨)
      2. ❌ 아니요, 이대로 진행
      3. Structural review만 다시 실행 (빠름)
    ```
  - Max 2 re-review loops

Save results: `$WORK_DIR/plan-cross-review.json`
Update state: `review_results.plan.model_scores`, `review_results.plan.conflicts`, `review_results.plan.waivers`, `review_state: completed`

### 4. Present for interactive review

Display:

```
구현 계획이 작성되었습니다!

계획서: $WORK_DIR/plan.md

계획 요약:
  - 변경 파일 수: N개
  - 신규 파일: N개
  - 수정 파일: N개
  - 태스크 수: N개
  - 위험도: 낮음/중간/높음

⚠️ 아직 구현을 시작하지 않습니다!

계획이 준비되었습니다. 리뷰해주세요.

피드백 방법:
  • 채팅으로 수정 요청 (예: "3번 항목을 B 접근법으로 변경해줘")
  • plan.md 파일 직접 편집 (> [!NOTE] 또는 <!-- HUMAN: --> 사용)
  • "승인" / "approve" / "LGTM" 입력으로 다음 단계 진행
```

### 4-1. Interactive feedback loop

When the user provides chat-based feedback instead of approval:

**0. Scope Check** — Before applying feedback, evaluate whether it falls within the current session scope:

Read `task_description` from `$STATE_FILE`. Compare the user's feedback against:
- The `task_description` — is the feedback semantically related to this task?
- The files/modules listed in plan.md — does the feedback reference files or modules already in scope?
- The nature of the change — is this a modification to existing requirements, or an entirely new requirement?

If the feedback introduces a clearly unrelated requirement (e.g., current task is "Add JWT auth" and feedback is "Also fix the sidebar CSS layout"), use AskUserQuestion:

```
💡 이 피드백은 현재 세션("[task_description]")의 범위 밖으로 보입니다.

1. 현재 세션에 포함 — plan에 추가
2. 새 세션으로 분리 — 현재 세션 완료 후 진행
3. 백로그에 저장 — deep-work/backlog.md에 기록
```

- If option 1: proceed with applying feedback as normal.
- If option 2: inform user the current session continues unchanged, suggest finishing this session first.
- If option 3: append the feedback to `deep-work/backlog.md` with timestamp and source session ID. Continue current session unchanged.

If the feedback is clearly related to the current task, skip the AskUserQuestion and proceed directly to applying it.

1. Read the current `$WORK_DIR/plan.md`
2. Apply the user's feedback to modify plan.md
3. **Refine the document** (Document Refinement Protocol):
   a. **Deduplicate** — Scan plan.md for duplicate or near-duplicate content across sections (e.g., same file mentioned in multiple tasks with identical changes, overlapping design decisions). Keep each piece of information in one canonical location only.
   b. **Prune** — Remove content invalidated by the feedback (e.g., tasks that are no longer relevant, outdated estimates, superseded design decisions). Delete empty sections.
   c. Append a refinement log at the end of the document:
      ```
      <!-- Refinement Log -->
      <!-- v[N]: [feedback summary] — deduped: [N] items, pruned: [M] sections -->
      ```
4. **Re-present the updated plan**: After applying feedback, display the full updated plan to the user so they can review all changes in context:
   ```
   📝 plan.md가 수정되었습니다:
     - [변경된 부분 요약 1]
     - [변경된 부분 요약 2]

   --- 수정된 Plan 전체 ---
   [Display the full content of the updated $WORK_DIR/plan.md]
   --- End ---

   계속 피드백을 주시거나, "승인"을 입력하여 다음 단계로 진행하세요.
   ```
5. Wait for the next feedback or approval

Repeat this loop until the user approves. **IMPORTANT**: Always re-display the full plan after each modification so the user can review the complete document before approving.

### 5. Handle approval

When the user says "승인", "approve", "approved", "LGTM", or similar approval words:

#### 5a-pre. Review Gate Check

Before approving, check review results:

1. Read `review_results.plan.spec_score` from state file
2. Read `$WORK_DIR/plan-cross-review.json` if it exists — check for unresolved critical consensus issues

**If spec_score < 5 OR unresolved critical consensus exists:**
```
⚠️ Review Gate: 구현 자동 전환이 차단되었습니다.

사유:
  - Structural Review 점수: [N]/10 (최소 5 필요)
  - 미해결 Critical Consensus: [N]건

해결 방법:
  1. plan.md를 수정하고 /deep-review 실행
  2. 또는 "강제 승인"을 입력하여 리뷰 게이트 우회
```

Use AskUserQuestion:
- A) plan.md 수정 후 재리뷰
- B) 강제 승인 (리뷰 게이트 우회)

If B: proceed with approval but add `review_gate_overridden: true` to state file.
If A: loop back to Section 4-1 (interactive feedback).

**If reviews pass or were skipped:** proceed to existing 5a (mode re-evaluation) and 5b (state update).

#### Team Mode Pre-check

If `team_mode` is "team", validate that Agent Teams is still available before mode re-evaluation:

```bash
echo "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-not_set}"
```

If the result is `not_set` or empty:
```
⚠️ Agent Teams 환경변수가 비활성화되었습니다. Solo 모드로 자동 전환합니다.
```
- Update `team_mode: solo` in `$STATE_FILE`
- Skip the Team → Solo re-evaluation below (already switched)
- Proceed directly to 5b (state update)

#### 5a. Mode re-evaluation (Team → Solo)

**If `team_mode` is "team"**: Analyze the plan.md Slice Checklist:
- Count the number of tasks
- Count the number of unique file paths
- Check if all tasks target the same file

If any of these conditions are met, suggest switching to Solo:
- Task count ≤ 3
- Unique files ≤ 2
- All tasks target the same file

```
모드 전환 제안

계획을 분석한 결과, 이 작업은 Solo 모드가 더 효율적일 수 있습니다:
- 태스크 수: [N]개 (≤3)
- 수정 파일: [M]개

Team 모드의 병렬 실행과 Cross-review 대신,
Solo 모드의 순차 실행이 오버헤드 없이 빠를 수 있습니다.

Solo 모드로 전환할까요? (y/n)
```

If user approves: update `team_mode: solo` in state file.
If user declines: keep Team mode.

#### 5a-2. Mode re-evaluation (Solo → Team)

**If `team_mode` is "solo"**: Analyze the plan.md Slice Checklist:

If ALL of these conditions are met, suggest switching to Team:
- Task count ≥ 6
- Unique files ≥ 4
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set

```
모드 전환 제안

계획을 분석한 결과, 이 작업은 Team 모드가 더 효율적일 수 있습니다:
- 태스크 수: [N]개 (≥6)
- 수정 파일: [M]개 (≥4)

Team 모드의 병렬 실행과 Cross-review가 도움이 될 수 있습니다.

Team 모드로 전환할까요? (y/n)
```

If user approves: update `team_mode: team` in state file.
If user declines: keep Solo mode.

#### 5b. Update state

Update `$STATE_FILE`:
- Set `plan_approved: true`
- Set `current_phase: implement`
- Set `plan_completed_at` to the current ISO timestamp
- Increment `iteration_count`
- Add a progress log entry

**Send notification**:
```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$STATE_FILE" "plan" "approved" "✅ Plan 승인됨 — Implement 시작" 2>/dev/null || true
```

Display:

```
✅ 계획이 승인되었습니다! 구현을 자동으로 시작합니다...
```

#### 5c. Auto-execute implementation

After updating the state file, **immediately proceed to execute the implementation**.

Read the implementation instructions from the `/deep-implement` command file (located at the same directory level as this command) and follow all its steps exactly:

1. Load the plan checklist from `$WORK_DIR/plan.md`
2. Check `team_mode` from state file
3. Execute all tasks following Solo or Team mode implementation process
4. After all tasks complete, transition to Test phase
5. Run comprehensive tests
6. Update state based on test results
7. Generate session report if all tests pass

**IMPORTANT**: Do NOT ask the user to run `/deep-implement` manually. The implementation must start automatically after approval.

### 6. Handle iteration

If the user provides feedback instead of approval, update the plan accordingly and re-present for review. Track the iteration count.
