---
allowed-tools: Read, Write, Glob, Bash
description: "Generate or view the deep work session report"
---

> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.

# Deep Work Session Report

Generate or regenerate a comprehensive report for the current (or most recent) Deep Work session.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Instructions

### 1. Read state file

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `$STATE_FILE`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` to get session metadata.

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
  기존 리포트가 있습니다: $WORK_DIR/report.md

  1. 기존 리포트 표시
  2. 리포트 재생성 (현재 상태 기반)
  ```
  - If the user chooses to view, read and display the report content.
  - If the user chooses to regenerate, proceed to Step 3.

- If it doesn't exist, proceed to Step 3.

### 3. Read session artifacts

Read all available session artifacts:
- `$STATE_FILE` — session state, timestamps, metadata
- `$WORK_DIR/research.md` — research findings (if exists)
- `$WORK_DIR/plan.md` — plan and implementation checklist (if exists)
- `$WORK_DIR/test-results.md` — test results (if exists)
- `$WORK_DIR/quality-gates.md` — quality gate results (if exists)
- `$WORK_DIR/insight-report.md` — insight analysis results (if exists)
- `$WORK_DIR/file-changes.log` — file modification tracking log (if exists)
- `$WORK_DIR/plan-diff.md` — plan diff visualization (if exists)
- `deep-work/harness-history/harness-sessions.jsonl` — assumption engine session history (if exists)

### 4. Calculate phase durations

From the state file, calculate time spent in each phase:
- Brainstorm: `brainstorm_completed_at` - `brainstorm_started_at` (if both exist; "Skipped" if brainstorm was not run)
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
| Evaluator Model | [evaluator_model or "default"] |
| Plan Iterations | [iteration_count] |
| Plan Auto-Loop | [plan_review_retries]/[plan_review_max_retries] |
| Test Auto-Loop | [test_retry_count]/[max_test_retries] |
| Model Routing | Research: [model], Plan: 현재 세션, Implement: [model], Test: [model] |
| Assumption Adjustments | [list of assumption adjustments applied, or "None"] |

## Phase Duration
| Phase | Started | Completed | Duration |
|-------|---------|-----------|----------|
| Brainstorm | [timestamp] | [timestamp] | [duration or "Skipped"] |
| Research | [timestamp] | [timestamp] | [duration] |
| Plan | [timestamp] | [timestamp] | [duration] |
| Implement | [timestamp] | [timestamp] | [duration] |
| Test | [timestamp] | [timestamp] | [duration] |
| **Total** | | | **[total duration]** |

## Brainstorm Summary
[If brainstorm.md exists: chosen approach, key decisions, success criteria]
[If brainstorm was skipped: "Brainstorm phase skipped (--skip-brainstorm)."]

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

### Plan Auto-Loop History
[If plan_review_retries > 0 from state file:]
| Attempt | Score | Issues |
|---------|-------|--------|
| 1 | [score]/10 | [list of issues from that attempt] |
| 2 | [score]/10 | [resolved issues or remaining] |
[Parse from plan review history in state file or plan-review.json]

[If plan_review_retries == 0: "Auto-loop 미사용 (첫 시도 통과)"]

## Implementation Results
| # | Task | File | Status | Notes |
|---|------|------|--------|-------|
| 1 | [description] | [path] | ✅/❌/⬜ | [notes] |
[Parse checklist from plan.md. ✅ = completed, ❌ = issue, ⬜ = not started]

**Contract Compliance**: [N]/[total] contracts verified
[Parse from slice receipts — count slices where all contracts are met vs total contracts defined]

## Files Changed

If `$WORK_DIR/file-changes.log` exists:
- Parse unique file paths from the log
- Cross-reference with `git status` to categorize as Created/Modified/Deleted
- Show modification count per file (how many times each file was edited during implementation)

If `file-changes.log` doesn't exist, fall back to `git diff --name-only`.

### Created
- [list of new files]

### Modified
- [list of modified files] (수정 횟수: N회)

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

## Review Results

### Structural Reviews
| Phase | Score | Iterations | Timestamp |
|-------|-------|------------|-----------|
| Brainstorm | [N]/10 | [N] | [time] |
| Research | [N]/10 | [N] | [time] |
| Plan | [N]/10 | [N] | [time] |

### Adversarial Review (Plan)
- **Models**: [Claude + Codex / Claude + Gemini / Claude only / 미실행]
- **Scores**: Claude [N]/10, [Model] [N]/10
- **Consensus**: [N]건
- **Conflicts**: [N]건 (resolved: [N], waived: [N])
- **Review Gate**: [통과 ✅ / 우회됨 ⚠️ / 미실행 ⬜]

(If review_state is "skipped": `리뷰: 스킵됨 (--skip-review)`)
(If cross_model not available: `크로스 모델: 도구 미설치 (structural review만 실행)`)

## Insight Analysis
[If $WORK_DIR/insight-report.md exists, include the "종합 인사이트 요약" section here]
[If insight-report.md does not exist: "Insight 분석 미실행"]

## Assumption Health (v5.0)

Generate assumption health data by running the assumption engine:

```bash
echo '{"action":"report","registryPath":"<PLUGIN_DIR>/assumptions.json","historyPath":"deep-work/harness-history/harness-sessions.jsonl","options":{"splitByModel":true}}' | node <PLUGIN_DIR>/hooks/scripts/assumption-engine.js
```

Where `<PLUGIN_DIR>` is the plugin's install path (directory containing `assumptions.json`).

[If harness-sessions.jsonl exists and engine returns data:]

| Assumption | Confidence | Category | Verdict | Details |
|-----------|-----------|----------|---------|---------|
| phase_guard_blocks_edits | 0.82 | HIGH | KEEP | [S]S/[W]W/[N]N |
| tdd_required_before_implement | 0.56 | MEDIUM | CONSIDER | [S]S/[W]W/[N]N |
| research_required_before_plan | 0.75 | HIGH | KEEP | [S]S/[W]W/[N]N |
| cross_model_review | — | INSUFFICIENT | — | [N]/[min] sessions |
| receipt_collection | 0.90 | HIGH | KEEP | [S]S/[W]W/[N]N |

**Proposed Changes**: [If any proposed changes from report: list them. Otherwise: "None"]

**This Session's Harness Metadata**:
- Slices with harness_metadata: [N]/[total]
- TDD overrides: [count]
- Bugs caught in RED: [count]
- Research references used: [count]
- Cross-model unique findings: [count]

[Aggregate harness_metadata from $WORK_DIR/receipts/SLICE-*.json for the current session.]

[If harness-sessions.jsonl does not exist: "Assumption 엔진 기록 없음 — 세션 완료 후 자동 수집됩니다."]

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
세션 리포트가 생성되었습니다!

위치: $WORK_DIR/report.md

세션 상태: [current_phase]
작업: [task_description]
총 소요 시간: [total duration]

리포트를 검토하고 필요시 /deep-report 로 재생성할 수 있습니다.
```

### 7. Git commit suggestion (if applicable)

If `git_branch` is set in the state file and `current_phase` is `idle`:

```
변경사항을 커밋할까요?
   브랜치: [git_branch]
   변경 파일: [N]개

제안 커밋 메시지:
  feat: [task_description 기반 자동 생성]
```

If the user agrees, create the commit. If not, skip.
