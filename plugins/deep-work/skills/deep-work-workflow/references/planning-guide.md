# Planning Phase — Detailed Guide

## Purpose

The Planning phase transforms research findings into a concrete, reviewable, approvable implementation plan. The output (`$WORK_DIR/plan.md`) is a contract between the human and AI about exactly what will be implemented.

## Planning Methodology

### Step 1: Define the Approach

Based on research findings, choose an implementation approach:

1. **List viable options**: There's usually more than one way to implement something
2. **Evaluate trade-offs**: Consider complexity, maintainability, performance, consistency with existing patterns
3. **Choose and justify**: Document why the chosen approach is best
4. **Document rejected alternatives**: Help the reviewer understand the decision

### Step 2: Map Changes to Files

For each file that needs to change:

1. **Exact file path**: No ambiguity about which file
2. **Action type**: Create new / Modify existing / Delete
3. **Change description**: What exactly will change
4. **Code sketch**: Pseudocode or actual code showing the change
5. **Rationale**: Why this change is needed
6. **Risk level**: Low / Medium / High with explanation

### Step 3: Define Execution Order

Changes often have dependencies:

1. **Identify dependencies**: Which changes depend on others?
2. **Topological sort**: Order changes so dependencies are satisfied
3. **Group by milestone**: Optional — group related changes
4. **Mark parallelizable items**: Items that could be done in any order

### Step 4: Create the Checklist

Each task should be:
- **Atomic**: One clear action per checkbox
- **Verifiable**: You can tell when it's done
- **Ordered**: Dependencies are respected
- **Specific**: Exact file path and change description

Format:
```markdown
- [ ] Task 1: `path/to/file.ts` — Add UserService class with authenticate() method — Required for JWT auth flow
- [ ] Task 2: `path/to/routes.ts` — Add POST /auth/login route using UserService — Exposes auth endpoint
```

### Step 5: Plan for Failure

- **Rollback strategy**: How to undo changes if something goes wrong
- **Partial completion**: What if only some tasks complete?
- **Known risks**: What could go wrong and how to handle it

## Feedback Loop Protocol

The planning phase supports iterative refinement:

### How the User Provides Feedback

1. **In-file notes**: User edits `$WORK_DIR/plan.md` directly
   - `> [!NOTE] Your note here` — Callout blocks
   - `<!-- HUMAN: Your comment here -->` — HTML comments
   - Strikethrough: ~~Remove this task~~
   - Direct edits to any section

2. **Chat feedback**: User types feedback in the conversation

3. **Re-running**: User runs `/deep-plan` again to incorporate feedback

### How Claude Processes Feedback

1. Read existing `plan.md` looking for user annotations
2. Incorporate all feedback into the updated plan
3. Preserve user-approved sections unless contradicted by new feedback
4. Increment iteration count
5. Re-present for review

### Approval Signals

The plan is approved when the user says any of:
- "승인", "approve", "approved", "LGTM"
- "좋아", "진행해", "go ahead", "looks good"
- Any clear affirmative about the plan

**After approval, implementation starts automatically** — the user does not need to run `/deep-implement` separately.

## Output Format: plan.md

The plan document MUST begin with Plan Summary (pyramid principle: conclusions first). Follow this structure:

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
[Approach description]

## Architecture Decision
[Why this approach, alternatives considered]

## Files to Modify
### [File path]
- Action: Create / Modify / Delete
- Changes: [description]
- Code sketch: [pseudocode or actual code]
- Reason: [why]
- Risk: Low / Medium / High

## Execution Order
1. [step] — because [reason]

## Trade-offs
| Option | Pros | Cons | Chosen? |

## Rollback Strategy
[How to undo if needed]

## Task Checklist
- [ ] Task 1: `path/to/file` — [What to do] — [Why]

## Open Questions
[Unresolved decisions]
```

For plan templates by task type, see [Plan Templates](plan-templates.md).

## Quality Criteria

A good plan:
- Can be executed mechanically without additional decisions
- Has no ambiguous tasks ("improve the code" is bad, "add null check to line 42 of auth.ts" is good)
- Respects the architecture and patterns found during research
- Includes rollback instructions
- Has been reviewed and approved by the user

## Plan Diff (v3.1.0)

Plan 재작성(iteration_count > 0) 시 자동으로 `plan-diff.md`가 생성된다.

비교 항목:
- 태스크 추가/수정/삭제 (파일 경로 기준 매칭)
- 파일 영향 범위 변경
- 아키텍처 결정 변경
- 리스크 수준 변경

사용자에게 diff 요약이 인라인으로 표시된다.
