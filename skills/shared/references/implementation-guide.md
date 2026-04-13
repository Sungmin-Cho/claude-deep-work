# Implementation Phase — Detailed Guide

## Purpose

The Implementation phase is about **mechanical execution** of the approved plan. The thinking is done. The decisions are made. Now we just build it, exactly as specified.

## Implementation Methodology

### Core Principle: Boring is Good

The best implementation phase is a boring one. No surprises, no creativity, no "while I'm here" improvements. Just faithful execution of the plan.

### Step-by-Step Execution

For each task in the checklist:

#### 1. Announce
Tell the user what you're about to do:
```
Task 3/8: path/to/file.ts — Adding UserService class
```

#### 2. Read First
Always read the target file before modifying it. Things may have changed since the research phase.

#### 3. Implement
Make the change exactly as described in the plan. If the plan says "add a method called `authenticate`", add exactly that — don't rename it to `verifyCredentials` because you think it's better.

#### 4. Verify
Run applicable checks:
- Type checking (if the project uses TypeScript, Python type hints, etc.)
- Linting (if configured)
- Related tests

#### 5. Mark Complete
Update the checklist in `$WORK_DIR/plan.md`:
```diff
- - [ ] Task 3: `path/to/file.ts` — Add UserService class
+ - [x] Task 3: `path/to/file.ts` — Add UserService class
```

#### 6. Report
Brief status update:
```
✅ Task 3/8 완료: UserService 클래스 추가됨
```

## Error Handling Protocol

### When Something Doesn't Work as Planned

1. **Stop immediately** — don't try to hack around it
2. **Document the issue** in `$WORK_DIR/plan.md`:
   ```markdown
   ## Issues Encountered

   ### Issue 1: [Description]
   - **Task**: Task 3
   - **Expected**: [what was supposed to happen]
   - **Actual**: [what actually happened]
   - **Possible causes**: [analysis]
   - **Suggested fix**: [if obvious]
   ```
3. **Inform the user** — explain what happened and ask for guidance
4. **Wait** — do not proceed until the user decides how to handle it

### When NOT to Improvise

- The planned approach doesn't work → **Ask the user**
- You notice a bug in unrelated code → **Note it in Issues, don't fix it**
- You think of a better way to do something → **Note it in Issues, follow the plan**
- A dependency is missing → **Report it, don't install it without asking**
- Tests are failing → **Report the failures, don't modify tests without plan approval**

### When It's OK to Adapt

- Minor syntax adjustments (import paths slightly different)
- Whitespace/formatting to match file conventions
- Variable names adjusted to avoid conflicts with existing code (document the change)

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

1. Update the session state file (`$STATE_FILE`) to `current_phase: test`
2. Present a summary showing:
   - Tasks completed vs total
   - Files modified/created
   - Any issues encountered
3. **Automatically transition to Test phase** — the Test phase runs comprehensive verification (type check, lint, test) and handles the implement-test retry loop
4. Session report is generated after all tests pass

For testing phase details, see [Testing Guide](testing-guide.md).

## Quality Criteria

A good implementation:
- Follows the plan exactly — no additions, no omissions
- Each task is verified before moving to the next
- Issues are documented, not silently worked around
- The user is kept informed throughout
- The final result matches what was approved in the plan
- A comprehensive session report is generated upon completion

## Agent Delegation Pattern (v3.1.0)

모델 라우팅 활성화 시, Solo 모드의 비대화형 Phase는 Agent를 스폰하여 실행된다.

### 동작 방식
1. state 파일에서 `model_routing.implement` 읽기 (기본값: sonnet)
2. Agent 스폰: 지정 모델로 전체 구현 지시를 위임
3. Agent 완료 후 메인 세션에서 상태 업데이트

### Team 모드
기존 Agent에 `model` 파라미터만 추가. 아키텍처 변경 없음.
