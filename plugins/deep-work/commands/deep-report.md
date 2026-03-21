---
allowed-tools: Read, Write, Glob, Bash
description: "Generate or view the deep work session report"
---

# Deep Work Session Report

Generate or regenerate a comprehensive report for the current (or most recent) Deep Work session.

## Instructions

### 1. Read state file

Read `.claude/deep-work.local.md` to get session metadata.

If the file doesn't exist, inform the user:
```
ℹ️ 활성화된 Deep Work 세션이 없습니다.

새 세션을 시작하려면: /deep-work <작업 설명>
```

Extract `work_dir` from the state file. If missing, default to `deep-work` (backward compatibility).
Set `WORK_DIR` to this value.

### 2. Check if report already exists

Check if `$WORK_DIR/report.md` exists.

- If it exists, ask the user:
  ```
  📄 기존 리포트가 있습니다: $WORK_DIR/report.md

  1. 기존 리포트 표시
  2. 리포트 재생성 (현재 상태 기반)
  ```
  - If the user chooses to view, read and display the report content.
  - If the user chooses to regenerate, proceed to Step 3.

- If it doesn't exist, proceed to Step 3.

### 3. Read session artifacts

Read all available session artifacts:
- `.claude/deep-work.local.md` — session state, timestamps, metadata
- `$WORK_DIR/research.md` — research findings (if exists)
- `$WORK_DIR/plan.md` — plan and implementation checklist (if exists)
- `$WORK_DIR/test-results.md` — test results (if exists)
- `$WORK_DIR/quality-gates.md` — quality gate results (if exists)
- `$WORK_DIR/plan-diff.md` — plan diff visualization (if exists)

### 4. Calculate phase durations

From the state file, calculate time spent in each phase:
- Research: `research_completed_at` - `research_started_at`
- Plan: `plan_completed_at` - `plan_started_at`
- Implement: `implement_completed_at` - `implement_started_at`
- Test: `test_completed_at` - `test_started_at`
- Total: `test_completed_at` (or current time) - `started_at`

If timestamps are empty, show "N/A" for that phase.

### 5. Generate report

Write `$WORK_DIR/report.md` with the following structure:

```markdown
# Deep Work Session Report

## Session Overview
| Field | Value |
|-------|-------|
| Task | [task_description] |
| Work Directory | [work_dir] |
| Mode | Solo / Team |
| Project Type | Existing / Zero-Base |
| Git Branch | [git_branch or "N/A"] |
| Started | [started_at] |
| Completed | [current timestamp or "In Progress"] |
| Current Phase | [current_phase] |
| Plan Iterations | [iteration_count] |
| Model Routing | Research: [model], Plan: 현재 세션, Implement: [model], Test: [model] |

## Phase Duration
| Phase | Started | Completed | Duration |
|-------|---------|-----------|----------|
| Research | [timestamp] | [timestamp] | [duration] |
| Plan | [timestamp] | [timestamp] | [duration] |
| Implement | [timestamp] | [timestamp] | [duration] |
| Test | [timestamp] | [timestamp] | [duration] |
| **Total** | | | **[total duration]** |

## Research Summary
[3-5 bullet points summarizing the key findings from research.md]
[If research.md doesn't exist: "Research phase not yet completed (or skipped)."]

## Plan Summary
[Approach chosen, key architectural decisions, alternatives considered]
[If plan.md doesn't exist: "Planning phase not yet completed."]

## Plan Iterations
[If plan-diff.md exists in $WORK_DIR:
| Version | 주요 변경 | 리스크 변경 |
|---------|----------|------------|
[Parse from plan-diff.md]
]
[If plan-diff.md does not exist: "단일 반복 (재작성 없음)"]

## Implementation Results
| # | Task | File | Status | Notes |
|---|------|------|--------|-------|
| 1 | [description] | [path] | ✅/❌/⬜ | [notes] |
[Parse checklist from plan.md. ✅ = completed, ❌ = issue, ⬜ = not started]

## Files Changed
### Created
- [list of new files]

### Modified
- [list of modified files]

### Deleted
- [list of deleted files, if any]

## Verification Results
| Check | Result |
|-------|--------|
| Type Check | ✅ Pass / ❌ Fail / ⬜ N/A |
| Lint | ✅ Pass / ❌ Fail / ⬜ N/A |
| Tests | ✅ Pass / ❌ Fail / ⬜ N/A |
| Build | ✅ Pass / ❌ Fail / ⬜ N/A |
[If test-results.md exists, use its data. Otherwise show ⬜ N/A for all]

## Quality Gate Results
[If $WORK_DIR/quality-gates.md exists, read and include its latest attempt table here]
[If quality-gates.md does not exist: "Quality Gates 미정의 — 기본 자동 감지 사용"]

## Test Retry History
[If test_retry_count > 0, summarize each attempt from test-results.md]
| Attempt | Result | Failed Items |
|---------|--------|-------------|
| 1 | ❌ | [summary] |
| 2 | ✅ | All passed |

## Issues & Notes
[From plan.md ## Issues Encountered section, if any. "None" if no issues.]

## Team Mode Details (if applicable)
| Item | Value |
|------|-------|
| Agents | N |
| Cross-review Rounds | N |
| Issues Found/Fixed | N |
```

### 6. Display confirmation

```
📄 세션 리포트가 생성되었습니다!

📂 위치: $WORK_DIR/report.md

📊 세션 상태: [current_phase]
📋 작업: [task_description]
⏱️ 총 소요 시간: [total duration]

리포트를 검토하고 필요시 /deep-report 로 재생성할 수 있습니다.
```

### 7. Git commit suggestion (if applicable)

If `git_branch` is set in the state file and `current_phase` is `idle`:

```
📝 변경사항을 커밋할까요?
   브랜치: [git_branch]
   변경 파일: [N]개

제안 커밋 메시지:
  feat: [task_description 기반 자동 생성]
```

If the user agrees, create the commit. If not, skip.
