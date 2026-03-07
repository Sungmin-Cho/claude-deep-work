---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Phase 2: Deep planning - create a detailed implementation plan"
---

# Phase 2: Deep Planning

You are in the **Planning** phase of a Deep Work session.

## Critical Constraints

🚫 **DO NOT implement anything.**
🚫 **DO NOT modify any source code files.**
🚫 **DO NOT create implementation files.**
✅ **ONLY plan and document the plan in the session's work directory.**

## Instructions

### 1. Verify prerequisites

Read `.claude/deep-work.local.md` and verify:
- `current_phase` is "plan"
- `research_complete` is true

If not, inform the user which prerequisite step is missing.

Extract `work_dir` from the state file. If missing, default to `deep-work` (backward compatibility).
Set `WORK_DIR` to this value.

Also read `$WORK_DIR/research.md` to load the research findings.

### 2. Check for user feedback

Read `$WORK_DIR/plan.md` if it already exists — the user may have added feedback notes in the form of:
- `> [!NOTE]` callouts
- `<!-- HUMAN: ... -->` comments
- Inline comments or strikethroughs

If feedback exists, incorporate it into the updated plan.

### 3. Create the implementation plan

Write `$WORK_DIR/plan.md` with the following structure:

```markdown
# Implementation Plan: [Task Title]

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

## Task Checklist

- [ ] Task 1: [File path] — [What to do] — [Why]
- [ ] Task 2: [File path] — [What to do] — [Why]
- [ ] Task 3: [File path] — [What to do] — [Why]
...

## Open Questions
- Any unresolved decisions for the user to weigh in on
```

### 4. Present for review

Display:

```
📋 구현 계획이 작성되었습니다!

📄 계획서: $WORK_DIR/plan.md

📊 계획 요약:
  - 변경 파일 수: N개
  - 신규 파일: N개
  - 수정 파일: N개
  - 태스크 수: N개
  - 위험도: 낮음/중간/높음

⚠️  아직 구현을 시작하지 않습니다!

👉 다음 단계:
  1. $WORK_DIR/plan.md 를 꼼꼼히 검토하세요
  2. 수정이 필요하면:
     - 파일에 직접 메모를 추가하거나 (> [!NOTE], <!-- HUMAN: -->)
     - 채팅으로 피드백을 주세요
  3. /deep-plan 을 다시 실행하면 피드백을 반영합니다
  4. 계획이 만족스러우면 "승인" 이라고 입력하세요
     → 구현이 자동으로 시작됩니다
```

### 5. Handle approval

When the user says "승인", "approve", "approved", "LGTM", or similar approval words:

#### 5a. Update state

Update `.claude/deep-work.local.md`:
- Set `plan_approved: true`
- Set `current_phase: implement`
- Increment `iteration_count`
- Add a progress log entry

Display:

```
✅ 계획이 승인되었습니다! 구현을 자동으로 시작합니다...
```

#### 5b. Auto-execute implementation

After updating the state file, **immediately proceed to execute the implementation**.

Read the implementation instructions from the `/deep-implement` command file (located at the same directory level as this command) and follow all its steps exactly:

1. Load the plan checklist from `$WORK_DIR/plan.md`
2. Check `team_mode` from state file
3. Execute all tasks following Solo or Team mode implementation process
4. Run verification (type checks, lints, tests)
5. Update state to `idle`
6. Display implementation summary
7. Generate session report at `$WORK_DIR/report.md`

**IMPORTANT**: Do NOT ask the user to run `/deep-implement` manually. The implementation must start automatically after approval.

### 6. Handle iteration

If the user provides feedback instead of approval, update the plan accordingly and re-present for review. Track the iteration count.
