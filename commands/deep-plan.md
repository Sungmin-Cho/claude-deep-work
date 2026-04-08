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

#### 1-0a. Team research partials 로드 (보조 참조)

`team_mode`가 "team"인 경우, 다음 3개 부분 리서치 파일을 **보조 참조**로 읽는다:
- `$WORK_DIR/research-architecture.md` (아키텍처, 구조, 데이터 레이어, API)
- `$WORK_DIR/research-patterns.md` (패턴, 컨벤션, 공유 인프라, 테스팅)
- `$WORK_DIR/research-dependencies.md` (의존성, 리스크, 외부 통합, 보안)

이 파일들은 합성 과정에서 축약되거나 누락된 전문 분석 세부 사항을 포함할 수 있다. `research.md`가 주 참조이며, 부분 파일은 교차 검증 용도로만 사용한다.

파일이 존재하지 않으면 무시한다 (solo 모드이거나 정리된 경우). 에러나 경고를 표시하지 않는다.

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
Why this approach was chosen over alternatives.
**Research 근거:** [RF-NNN], [RA-NNN] 태그로 연결. 근거 없는 결정은 assumption으로 표기.

## Files to Modify

### [File path 1]
- **Action**: Create / Modify / Delete
- **Changes**: Detailed description
- **Code sketch** (completeness tiered by slice size):
  - **S slices**: Annotated pseudocode — describe the change with enough detail that the approach is unambiguous.
  - **M slices**: Key function signatures and type definitions must be actual code. Logic flow can be pseudocode with inline comments.
  - **L slices**: Boundary code (interfaces, public API, type definitions, tests) must be complete, copy-pasteable code. Repetitive internal implementations can use annotated diff/skeleton. For modifications, show before/after diff with line references.
  ```language
  // Example for M slice:
  // ACTUAL — function signature and types
  export async function authenticate(credentials: LoginCredentials): Promise<AuthResult> {
    // PSEUDOCODE — logic flow
    // 1. Validate input (email format, password non-empty)
    // 2. Query user by email from UserRepository
    // 3. Compare password hash using bcrypt
    // 4. If match: generate JWT token, return { token, user }
    // 5. If no match: throw AuthenticationError("invalid_credentials")
  }
  ```
- **Line references** (for Modify actions): Specify as `filename:startLine-endLine` or anchor to a named function/class.
- **Reason**: Why this change is needed
- **Risk**: Low / Medium / High — explanation

### [File path 2]
...

## Boundary: Files NOT to Modify

List files that might seem related but must NOT be changed in this task.

| File | Reason to leave unchanged |
|------|--------------------------|
| [file] | [reason] |

> If you discover during implementation that one of these files must change, STOP and document it as an Open Question. Do not modify without plan amendment.

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
  - expected_output: [what success looks like, e.g., "Tests: 5 passed, 0 failed"]
  - spec_checklist: [requirement 1, requirement 2]
  - contract: [testable criterion 1, testable criterion 2]
  - acceptance_threshold: all
  - size: S/M/L
  - steps: (required for M/L, optional for S)
    1. [Write failing test: test_name in test_file — assert specific_behavior]
    2. [Verify RED: run verification_cmd, expect failure message]
    3. [Implement: create/modify file — specific change with code reference]
    4. [Verify GREEN: run verification_cmd, expect all pass]
    5. [Commit: descriptive message]

- [ ] SLICE-002: [Goal]
  - files: [file1, file2]
  - failing_test: [test file — test description]
  - verification_cmd: [command to verify]
  - expected_output: [성공 시 예상 출력]
  - spec_checklist: [requirement 1, requirement 2]
  - contract: [testable criterion 1, testable criterion 2]
  - acceptance_threshold: all
  - size: S/M/L
  - steps: (required for M/L, optional for S)
    1. ...

...

## Open Questions
- Any unresolved decisions for the user to weigh in on
```

**Slice field guidelines:**

`expected_output`: What the `verification_cmd` should print when passing. Without this, the implementing agent cannot distinguish "tests pass" from "tests pass for the wrong reason."

`steps`: Each step is one action. Steps are execution guidance, NOT receipt/TDD tracking units — the slice remains the atomic unit. Steps are required for M/L slices, optional for S.
- **S slices**: Steps optional. Goal + files + failing_test provide enough direction.
- **M slices**: 3-7 steps recommended. Each step completable in 2-10 minutes.
- **L slices**: 5-12 steps required. Consider splitting into smaller slices if steps exceed 12.

`failing_test` detail by slice size:
- **S**: `failing_test: tests/auth.test.ts — "rejects empty email"` (file + description)
- **M**: Include test function signature and key assertion:
  ```
  failing_test: tests/auth.test.ts — test('rejects empty email', () => {
    expect(submitForm({email: ''})).toHaveProperty('error', 'Email required')
  })
  ```
- **L**: Boundary tests include complete function body; repetitive internal tests use signature + assertion.

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
**Research 근거:** [RF-NNN], [RA-NNN] 태그로 연결. 근거 없는 결정은 assumption으로 표기.

## Project Structure
[전체 디렉토리 구조 트리]

## Files to Create

### [File path]
- **Action**: Create
- **Purpose**: [이 파일의 역할]
- **Code sketch** (completeness tiered by slice size — same rules as existing codebase template):
  - S: annotated pseudocode, M: actual signatures + pseudocode logic, L: boundary code complete
  [코드 스니펫]
- **Dependencies**: [이 파일이 의존하는 다른 파일]

## Boundary: Files NOT to Modify

| File | Reason to leave unchanged |
|------|--------------------------|
| [file] | [reason] |

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
  - expected_output: [성공 시 예상 출력]
  - spec_checklist: [requirement 1]
  - contract: [testable criterion 1, testable criterion 2]
  - acceptance_threshold: all
  - size: S/M/L
  - steps: (required for M/L, optional for S)
    1. ...

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

### 3.3-1. Completeness Policy (v5.8)

The following patterns are **plan failures** — they must never appear in a finalized plan.md:

**Banned patterns:**
- `TBD`, `TODO`, `FIXME`, `PLACEHOLDER`, `implement later`, `fill in details`
- `Add appropriate error handling` / `add validation` / `handle edge cases` (without specifying which cases)
- `Write tests for the above` (without actual test descriptions or code)
- `Similar to SLICE-N` (repeat the relevant details — the implementing agent may execute slices out of order or in isolation)
- Steps that describe *what* to do without showing *how* (code blocks required for any step that changes code, per the Code sketch tiering rules)
- Empty sections or sections containing only headers
- `...` or `[etc.]` as substitutes for actual content
- References to types, functions, or methods not defined elsewhere in the plan or existing codebase

**Enforcement:** The Claude self-review step (Section 3.4.5) scans for these patterns and auto-fixes them before structural review. The structural review dimension `code_completeness` penalizes remaining placeholders. If a placeholder cannot be filled due to insufficient information, move the item to **Open Questions** rather than leaving a banned pattern.

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

### 3.4.5. Claude 자체 재검토 (신규)

plan.md 작성 및 contract negotiation 완료 직후, subagent에게 넘기기 전에 Claude가 직접 점검한다.

**점검 항목:**

1. **Placeholder 스캔**: plan.md에서 Completeness Policy (Section 3.3-1)의 전체 banned pattern 목록을 탐색:
   - `TBD`, `TODO`, `FIXME`, `PLACEHOLDER`, `implement later`, `fill in details`
   - Vague directives: `Add appropriate...`, `handle edge cases`, `Write tests for the above`
   - Cross-references without content: `Similar to SLICE-N`
   - Empty sections, sections with only headers, `...` or `[etc.]`
   - Code steps without code blocks (for M/L slices per Code sketch tiering)
   - References to undefined types/functions
   발견 시 해당 내용을 구체적으로 채운다. 채울 수 없는 경우 (정보 부족), 해당 항목을 Open Questions로 이동하고 사용자에게 알린다.

2. **내부 일관성**: Slice Checklist의 `files` 목록과 "Files to Modify" 섹션의 파일 목록을 비교. 불일치 시 수정. Execution Order와 Slice 순서가 충돌하는지 확인.

3. **Research 정합성**: `$WORK_DIR/research.md`의 Key Findings와 Constraints를 읽고, plan.md의 Architecture Decision과 모순되는지 확인. 모순 시 plan을 research에 맞게 수정.

   **팀 모드 교차 검증** (team_mode: team이고 partial 파일 로드된 경우):
   - `research-architecture.md`의 아키텍처 분석이 plan의 Architecture Decision과 일관되는지 확인
   - `research-patterns.md`의 패턴/컨벤션이 plan의 코드 스케치에 반영되었는지 확인
   - `research-dependencies.md`의 리스크가 plan의 Risk/Rollback에 반영되었는지 확인

   partial에서 `research.md`에 누락된 세부 사항 발견 시, plan.md에 직접 반영. "누락" 카운트에 포함.

4. **범위 점검**: state file의 `task_description`과 plan.md의 전체 scope를 비교. plan이 task_description 범위를 명백히 초과하면 사용자에게 알림.

5. **누락 점검**: `$WORK_DIR/research.md`의 Risk Assessment에서 식별된 리스크가 plan.md의 Rollback Strategy에 반영되었는지 확인. 누락 시 추가.

   **팀 모드 보충** (team_mode: team이고 partial 파일 로드된 경우):
   `research-dependencies.md`의 상세 리스크 목록을 추가 확인. `research.md`에 포함되지 않은 리스크가 있으면 plan.md의 Rollback Strategy 또는 Risk 섹션에 추가.

**자동 수정 원칙:**
- 명백한 결함 (placeholder, 일관성 오류, 누락): 사용자 확인 없이 자동 수정
- 판단이 필요한 항목 (scope 문제, 아키텍처 선택): AskUserQuestion으로 사용자 판단 요청

**표시:**

수정 완료 후:
```
🔍 Plan 자체 재검토 완료:
   수정: [N]건 (placeholder [N]건, 일관성 [N]건, 누락 [N]건)
   미수정: 0건
```

판단 필요 항목이 있을 경우 (AskUserQuestion으로 대기):
```
⚠️ 판단 필요: [항목 설명]

  1. 수정 — plan.md에서 해당 부분을 수정합니다
  2. 유지 — 현재 상태 그대로 진행합니다
```

사용자 응답을 받은 후 다음 단계 (Structural Review)로 진행한다.

### 3.5. Structural Review + Auto-Loop (v5.1)

Read `references/review-gate.md` from the skill directory (located at `skills/deep-work-workflow/references/review-gate.md`).

Read `evaluator_model` from state file (default: "sonnet").

Follow the **Structural Review Protocol** with these settings:
- **Phase**: plan
- **Document**: `$WORK_DIR/plan.md`
- **Dimensions**: architecture_fit, slice_executability, testability, code_completeness, buildability, rollback_completeness, risk_coverage
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
score >= 7? ──YES──→ proceed to Section 3.6 (cross-model) or Section 4
    │
    NO
    ↓
plan_review_retries < plan_review_max_retries?
    ├─ YES:
    │   1. Snapshot: copy plan.md to $WORK_DIR/plan.autofix-v{N}.md
    │   2. Extract failed dimensions and issues from review JSON
    │   3. Auto-fix plan.md — 이슈가 지적한 특정 섹션만 수정 (전체 재작성 금지)
    │      - Append context: "<!-- Auto-fix attempt [N]: [issue summary] -->"
    │   4. Re-run structural review
    │   5. Score 하락 시: revert to plan.autofix-v{N}.md, 사용자 수동 수정 요청
    │   6. Increment plan_review_retries in state file
    │   7. Display: "Plan 자동 수정 (시도 [N]/[max]): [issues fixed]"
    │   8. Re-run structural review (loop back)
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

**Do NOT display individual conflict AskUserQuestion.** Instead, proceed to Step 3.7.

Save results: `$WORK_DIR/plan-cross-review.json`
Update state: `review_results.plan.model_scores`, `review_results.plan.reviewer_status`

### 3.7. Claude 종합 판단 (신규)

Read `references/review-gate.md`의 **종합 판단 + 일괄 확인 프로토콜** (Section 4-1)을 따른다.

**Phase**: plan
**Document**: `$WORK_DIR/plan.md`
**Inputs**: Step 3.5의 structural review 결과 + Step 3.6의 cross-model review 결과 (있을 경우)

Claude가 모든 리뷰 결과를 종합 분석하여 각 이슈에 대해 `accept`/`reject`/`partial` 판단을 생성한다.

### 3.8. 전체 요약 + 사용자 일괄 확인 (신규)

`review-gate.md` Section 4-1의 표시 형식에 따라 종합 판단 결과를 사용자에게 제시한다.

사용자 확인 결과에 따라:
- 옵션 1 (동의): 판단대로 plan.md 수정 → Step 3.9로 이동
- 옵션 2 (항목별 조정): Section 4 (Conflict Resolution UX)의 4지선다로 해당 항목 재질문 → 조정 완료 후 Step 3.9로 이동
- 옵션 3 (전부 스킵): plan.md 그대로 Section 4 (Present for interactive review)로 이동

### 3.9. 확인된 항목만 plan 수정 (변경)

사용자가 동의(옵션 1) 또는 항목별 조정(옵션 2) 완료 후:
1. `accept` 또는 `partial`로 판정된 이슈만 plan.md에 반영
2. 수정 후 변경 규모에 따라 re-review 권장:
   - 3개 이상 섹션 변경: Full re-review (structural + cross-model) 권장
   - 1-2개 섹션 변경: Structural review only 권장
   - 50줄 미만 변경: Skip re-review
3. Max 2회 re-review loop

Update state: `review_results.plan.judgments`, `review_results.plan.conflicts`, `review_results.plan.waivers`, `review_state: completed`

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

#### 5b-1. Sprint Contract 생성 (deep-review 연동)

deep-review 플러그인 설치 확인:
```bash
ls "$HOME/.claude/plugins/cache/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null || \
  ls "$HOME/.claude/plugins/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null
```
설치되지 않은 경우 이 섹션을 건너뜀 (silent skip).

**설치된 경우:**

1. 승인된 `$WORK_DIR/plan.md`의 `## Slice Checklist` 섹션을 파싱
2. 각 `- [ ] SLICE-{NNN}: {title}` 슬라이스에 대해:
   a. `contract:` 필드가 있으면 → criteria로 사용
   b. `contract:` 가 없고 `spec_checklist:` 가 있으면 → criteria로 사용
   c. 둘 다 없으면 → 해당 슬라이스 건너뜀
3. `.deep-review/contracts/` 디렉토리가 없으면 `mkdir -p .deep-review/contracts`
4. 각 슬라이스에 대해 `.deep-review/contracts/SLICE-{NNN}.yaml` 작성:
   ```yaml
   slice: SLICE-{NNN}
   title: "{슬라이스 제목}"
   source_plan: "plan.md#slice-{NNN}"
   created_at: "{현재 ISO 타임스탬프}"
   status: active
   criteria:
     - id: C1
       description: "{contract 또는 spec_checklist의 첫 번째 항목}"
       verification: auto
       prerequisites: []
       status: null
       evidence: null
     - id: C2
       description: "{두 번째 항목}"
       verification: auto
       prerequisites: []
       status: null
       evidence: null
   ```
   - verification 기본값: `auto`. "수동"/"manual"/"확인 필요" 키워드 포함 시 → `manual`
   - 기존 contract 파일이 있으면: `status`와 `evidence` 필드를 보존하고 나머지 업데이트 (멱등성)
5. 완료 후 알림: "📋 Sprint Contract {N}건 생성됨 (.deep-review/contracts/)"

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
