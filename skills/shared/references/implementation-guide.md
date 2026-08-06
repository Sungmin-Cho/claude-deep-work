# Implementation Phase — Detailed Guide

## Purpose

The Implementation phase is about **mechanical execution** of the approved plan. The thinking is done. The decisions are made. Now we just build it, exactly as specified.

## Implementation Methodology

### Core Principle: Plan Fidelity Preserves Evidence

The approved plan defines the behavior that the acceptance contract and slice receipts
verify. Implementing against that plan keeps the evidence attached to the change that was
actually approved. When implementation reveals a worthwhile improvement outside those
boundaries, preserve the idea in `Issues Encountered` for a later plan cycle instead of
silently changing the target of verification.

### Step-by-Step Execution

For each slice in the checklist:

#### 1. Announce
Tell the user what you're about to do:
```
SLICE-003: path/to/file.ts — Adding UserService class
```

#### 2. Read First
Always read the target file before modifying it. Things may have changed since the research phase.

#### 3. Implement
Treat names and public shapes specified by the plan as contract terms. If the plan says
"add a method called `authenticate`", keep that name because acceptance checks and receipt
evidence are bound to the approved interface. If repository facts make the term invalid or
unsafe, classify the mismatch by contract impact below rather than silently substituting a
different interface.

#### 4. Verify
Run applicable checks:
- Type checking (if the project uses TypeScript, Python type hints, etc.)
- Linting (if configured)
- Related tests

#### 5. Mark Complete
Update the checklist in `$WORK_DIR/plan.md`:
```diff
- - [ ] SLICE-003: Add UserService class
+ - [x] SLICE-003: Add UserService class
```

#### 6. Report
Brief status update:
```
SLICE-003 완료: UserService 클래스 추가됨
```

## Handling Plan/Reality Mismatches

### Decide by Contract Impact

When something does not work as planned, first decide whether the response changes the
acceptance contract, public interface, scope, or verification evidence.

- A local mismatch that **does not change those approved boundaries** may be adapted in
  place. Record the observed difference and the adaptation in `$WORK_DIR/plan.md`, run the
  applicable checks, and continue. Typical examples are a repository-local import path,
  formatting needed to match nearby code, or a private-name collision whose resolution
  leaves the approved behavior and evidence unchanged.
- A mismatch that **does change an approved boundary** requires a new decision. Stop the
  affected slice, document the issue, explain the impact to the user, and wait for approval
  or a replan before changing the contract.

Use this issue format for either path:

   ```markdown
   ## Issues Encountered

   ### Issue 1: [Description]
   - **Slice**: SLICE-003
   - **Expected**: [what was supposed to happen]
   - **Actual**: [what actually happened]
   - **Possible causes**: [analysis]
   - **Suggested fix**: [if obvious]
   ```

Some findings remain mechanism-bound regardless of how local they look:

- You notice a bug in unrelated code → **Note it in Issues, don't fix it**
- A dependency is missing → **Report it, don't install it without asking**
- Tests are failing → **Report the failures, don't modify tests without plan approval**

Improvement ideas are not discarded: record them in Issues and route them through the next
plan cycle so their scope and evidence can be approved deliberately.

## Rollback Procedures

### If a single task goes wrong:
```bash
git checkout -- path/to/affected/file
```

### If multiple tasks need rollback:
```bash
git stash   # save current changes
# or
git reset HEAD~N  # undo last N commits
```

### If the whole implementation needs to be abandoned:
```bash
git stash  # or git reset to the commit before implementation started
```

Always prefer `git stash` over destructive operations to preserve work.

## Completion Protocol

When all tasks are done:

1. Update the session state file (`$STATE_FILE`):
   - `implement_completed_at`: current ISO timestamp
   - `phase_review.implement`: `{reviewed, reviewers, self_issues, external_issues, resolved}`
   - `review_state: completed`
   - **DO NOT set `current_phase: test`.** Orchestrator가 Exit Gate "진행" 선택 시에만 `current_phase`를 전환한다. Phase skill은 완료-marker만 기록하고 제어를 반환한다.
2. Present a summary showing:
   - Tasks completed vs total
   - Files modified/created
   - Any issues encountered
3. **Return control to Orchestrator Exit Gate (§3-4)** — Orchestrator가 AskUserQuestion으로 "다음 phase로 진행 / 재실행 / 일시정지"를 사용자에게 묻는다. "진행" 선택 시 Orchestrator가 `current_phase: test`로 전환하고 Test phase를 호출한다.
4. Test phase가 자동 verification (type check, lint, test) 및 implement-test retry loop을 처리한다. Session report는 All Pass 이후 생성된다.

For testing phase details, see [Testing Guide](testing-guide.md).

## Quality Criteria

A good implementation:
- Matches the approved plan at contract boundaries; local adaptations are documented and verified
- Each task is verified before moving to the next
- Issues are documented, not silently worked around
- The user is kept informed throughout
- The final result matches what was approved in the plan
- A comprehensive session report is generated upon completion

## Agent Delegation Pattern (v3.1.0)

모델 라우팅 활성화 시, Solo 모드의 비대화형 Phase는 Agent를 스폰하여 실행된다.

### 동작 방식
1. Read(`${CLAUDE_PLUGIN_ROOT}/skills/shared/references/model-routing-guide.md#model-routing-state-decode-v612`)의 scalar-first 규칙으로
   `decodedRouting.implement`를 읽기 (decode 실패 기본값: sonnet)
2. Agent 스폰: 지정 모델로 전체 구현 지시를 위임
3. Agent 완료 후 메인 세션에서 상태 업데이트

### Team 모드
기존 Agent에 `model` 파라미터만 추가. 아키텍처 변경 없음.
