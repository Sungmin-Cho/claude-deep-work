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

Read `.claude/deep-work.local.md` and verify:
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
   - **Task Checklist**: Match tasks by file path to detect added/modified/deleted
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
📊 Plan Diff (v{N} → v{N+1}):
  ➕ 추가: [N]개 태스크
  ✏️ 수정: [N]개 태스크
  ➖ 삭제: [N]개 태스크
  📄 상세: $WORK_DIR/plan-diff.md
```

If `iteration_count` is 0, skip this section entirely.

### 1-3. Template suggestion (optional)

Read `references/plan-templates.md` from the skill directory to check for matching templates.

Analyze the task description and research.md to identify the most appropriate template:

```
📋 적합한 Plan 템플릿이 있습니다: [Template Name]
   템플릿을 활용할까요? (y/n)
```

If the user agrees, use the template structure as the skeleton for plan.md.
If declined, proceed with the standard structure.

### 2. Check for user feedback

Read `$WORK_DIR/plan.md` if it already exists — the user may have added feedback notes in the form of:
- `> [!NOTE]` callouts
- `<!-- HUMAN: ... -->` comments
- Inline comments or strikethroughs

If feedback exists, incorporate it into the updated plan.

### 3. Create the implementation plan

Write `$WORK_DIR/plan.md` with the following structure. The document MUST begin with Plan Summary (pyramid principle: conclusions first).

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

## Task Checklist

- [ ] Task 1: [File path] — [What to do] — [Why]
- [ ] Task 2: [File path] — [What to do] — [Why]
- [ ] Task 3: [File path] — [What to do] — [Why]
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

## Task Checklist
- [ ] Task 1: [File path] — [What to do] — [Why]
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

### 4. Present for interactive review

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

⚠️ 아직 구현을 시작하지 않습니다!

📋 계획이 준비되었습니다. 리뷰해주세요.

피드백 방법:
  • 채팅으로 수정 요청 (예: "3번 항목을 B 접근법으로 변경해줘")
  • plan.md 파일 직접 편집 (> [!NOTE] 또는 <!-- HUMAN: --> 사용)
  • "승인" / "approve" / "LGTM" 입력으로 다음 단계 진행
```

### 4-1. Interactive feedback loop

When the user provides chat-based feedback instead of approval:

1. Read the current `$WORK_DIR/plan.md`
2. Apply the user's feedback to modify plan.md
3. Highlight what was changed:
   ```
   📝 plan.md가 수정되었습니다:
     - [변경된 부분 요약 1]
     - [변경된 부분 요약 2]

   계속 피드백을 주시거나, "승인"을 입력하여 다음 단계로 진행하세요.
   ```
4. Wait for the next feedback or approval

Repeat this loop until the user approves.

### 5. Handle approval

When the user says "승인", "approve", "approved", "LGTM", or similar approval words:

#### 5a. Mode re-evaluation (Team → Solo)

**If `team_mode` is "team"**: Analyze the plan.md Task Checklist:
- Count the number of tasks
- Count the number of unique file paths
- Check if all tasks target the same file

If any of these conditions are met, suggest switching to Solo:
- Task count ≤ 3
- Unique files ≤ 2
- All tasks target the same file

```
💡 모드 전환 제안

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

**If `team_mode` is "solo"**: Analyze the plan.md Task Checklist:

If ALL of these conditions are met, suggest switching to Team:
- Task count ≥ 6
- Unique files ≥ 4
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is set

```
💡 모드 전환 제안

계획을 분석한 결과, 이 작업은 Team 모드가 더 효율적일 수 있습니다:
- 태스크 수: [N]개 (≥6)
- 수정 파일: [M]개 (≥4)

Team 모드의 병렬 실행과 Cross-review가 도움이 될 수 있습니다.

Team 모드로 전환할까요? (y/n)
```

If user approves: update `team_mode: team` in state file.
If user declines: keep Solo mode.

#### 5b. Update state

Update `.claude/deep-work.local.md`:
- Set `plan_approved: true`
- Set `current_phase: implement`
- Set `plan_completed_at` to the current ISO timestamp
- Increment `iteration_count`
- Add a progress log entry

**Send notification**:
```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$PROJECT_ROOT/.claude/deep-work.local.md" "plan" "approved" "✅ Plan 승인됨 — Implement 시작" 2>/dev/null || true
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
