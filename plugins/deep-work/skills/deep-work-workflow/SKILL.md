---
name: deep-work-workflow
version: "5.3.0"
description: |
  Evidence-driven development protocol with auto-flow orchestration.
  Use when: "deep work", "plan before code", "TDD", "evidence-driven",
  "분석 후 구현", "structured workflow", or complex multi-file tasks
  that benefit from structured planning before implementation.
---

# Deep Work Workflow: Brainstorm → Research → Plan → Implement → Test

## v5.3 Precision + Evidence

`/deep-work "task"` 하나로 전체 워크플로우가 자동 진행됩니다.
Plan 승인이 유일한 필수 인터랙션입니다.

**v5.3 신규 기능:**
- **Document Intelligence**: 피드백 적용 시 중복/불필요 내용 자동 정리 (Apply → Deduplicate → Prune)
- **Session Relevance Detection**: 현재 세션 범위 밖 피드백 감지 → 새 세션 분리 제안
- **Plan Fidelity Score**: 구현 vs 플랜 충실도 0-100 점수 산출
- **Session Quality Score**: 세션 종료 시 품질 점수 자동 계산 (Test Pass Rate, Rework Cycles, Plan Fidelity)
- **Cross-Session Quality Trend**: `/deep-status --history`에서 세션 간 품질 추이 시각화
- **Assumption Engine Quality Integration**: 품질 점수 기반 규칙 자가 최적화 (cohort 분석, 3세션 minimum gate)
- **Quality Badge**: `/deep-status --badge`로 shields.io 뱃지 생성

**Primary commands (7):** `/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement`, `/deep-test`, `/deep-status`, `/deep-debug`

**Deprecated commands (13):** 자동 흐름에 흡수됨. 수동 호출 가능하지만 불필요.
- brainstorm, review, receipt, slice, insight, finish, cleanup, history, assumptions, resume, report, drift-check, solid-review

**Core mechanisms:**
- Phase Guard (hook-enforced code blocking)
- TDD Enforcement (state machine: PENDING → RED → GREEN → REFACTOR)
- Slice-based Execution with Receipt Collection
- Profile/Preset System (zero-question restart)
- Auto-transition between phases

## Why This Workflow Exists

When AI coding tools work on complex tasks without structure, common failure modes emerge:

1. **Architecture Ignorance**: AI generates code that doesn't follow existing patterns
2. **Duplicate Implementation**: AI creates new utilities when equivalent ones already exist
3. **Premature Coding**: AI starts writing code before understanding the full picture
4. **Scope Creep**: AI adds "improvements" not requested, introducing bugs
5. **Inconsistency**: AI uses different conventions than the rest of the codebase

The Deep Work workflow prevents these by **strictly separating brainstorming, analysis, planning, coding, and testing** into five distinct phases with enforced gates between them.

## The Five Phases

### Phase 0: Brainstorm (`/deep-brainstorm`) — Optional

**Goal**: Explore "why before how" — define the problem, compare approaches, establish success criteria.

**What happens**:
- Structured design conversation with the user
- 2-3 approach comparison with pros/cons
- Spec-reviewer subagent validates the brainstorm document
- Documentation in `$WORK_DIR/brainstorm.md`

**What's blocked**: All code file modifications (enforced by hook)
**Skip**: Use `--skip-brainstorm` to start directly at Research.

### Phase 1: Research (`/deep-research`)

**Goal**: Build a complete mental model of the relevant codebase before making any decisions.

**What happens**:
- Exhaustive analysis of architecture, patterns, and conventions
- Identification of all relevant files, dependencies, and risk areas
- Documentation of everything in `$WORK_DIR/research.md`
- **Output begins with Executive Summary and Key Findings** (pyramid principle)

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "You cannot plan what you don't understand, and you cannot understand what you haven't read."

**Features**:
- **Zero-base mode**: For new projects, researches technology stacks, architecture patterns, and scaffolding instead of existing code
- **Partial re-run**: `/deep-research --scope=api,data` re-analyzes specific areas only
- **Research caching**: Reuses previous session's research as baseline, updating only changed areas
- **Team mode**: 3 specialist agents (arch-analyst, pattern-analyst, risk-analyst) analyze in parallel with progress notifications

For detailed guidance, see [Research Guide](references/research-guide.md) or [Zero-Base Guide](references/zero-base-guide.md).

### Phase 2: Plan (`/deep-plan`)

**Goal**: Create a detailed, reviewable, approvable implementation plan.

**What happens**:
- Transform research findings into a concrete action plan
- **Plan Summary at the top** with approach, scope, risk level, and key decisions
- Define exact files to modify, code snippets, execution order
- Create a checklist-style task list in `$WORK_DIR/plan.md`

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "The plan is the contract between human and AI. No implementation without approval."

**Features**:
- **Interactive review**: Chat-based feedback loop — say "3번 항목 변경해줘" and plan.md updates automatically
- **Plan templates**: Auto-suggests templates for common task types (API endpoint, UI component, DB migration, etc.)
- **Version history**: Previous plans backed up as `plan.v1.md`, `plan.v2.md` with change logs
- **Mode re-evaluation**: Suggests Team↔Solo switching based on plan complexity
- **Auto-implementation**: When approved ("승인"), implementation starts automatically

**Note**: Plan phase does not use Team mode — planning requires a single coherent document produced by one agent.

For detailed guidance, see [Planning Guide](references/planning-guide.md).

### Phase 3: Implement (`/deep-implement`)

**Goal**: Mechanically execute the approved plan, task by task.

**What happens**:
- Follow the plan checklist exactly
- Implement one task at a time, marking each complete
- Document any issues encountered — never improvise
- **Automatically transition to Test phase** upon completion

**What's allowed**: All tools — code modification is now permitted

**Key principle**: "The best implementation is a boring implementation. No creativity, no surprises, just faithful execution."

**Features**:
- **Checkpoint support**: If interrupted, resumes from the last incomplete task
- **Team mode**: Tasks clustered by file ownership, distributed to parallel agents with cross-review and progress notifications
- **Auto-test**: After all tasks complete, transitions to Test phase automatically

For detailed guidance, see [Implementation Guide](references/implementation-guide.md).

### Phase 4: Test (`/deep-test`)

**Goal**: Verify the implementation through comprehensive automated testing.

**What happens**:
- Auto-detects verification commands (test, lint, typecheck) from project config
- Runs all checks sequentially, records results
- **Pass**: Session completes, report generated
- **Fail**: Returns to implement phase for fixes (up to 3 retries)

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "Trust but verify. The test phase catches what implementation missed."

**Features**:
- **Auto-detection**: Scans package.json, pyproject.toml, Makefile, Cargo.toml, go.mod
- **Implement-test loop**: Automatic retry cycle with detailed failure reports
- **Cumulative results**: All attempts recorded in `$WORK_DIR/test-results.md`
- **Git integration**: Suggests commit after all tests pass

For detailed guidance, see [Testing Guide](references/testing-guide.md).

## Quality Gates & Utilities

### Plan Alignment Check (/drift-check) — *deprecated, auto-runs in /deep-test*

Compares plan.md items with actual git diff. Reports implemented, missing, out-of-scope, and design drift.
Standalone mode available: `/drift-check [plan-file]`.

### SOLID Design Review (/solid-review) — *deprecated, auto-runs in /deep-test*

Evaluates code against the 5 SOLID design principles with a per-principle scorecard.
Standalone mode available: `/solid-review [target]`. See [SOLID Guide](references/solid-guide.md).

### Code Insight Analysis (/deep-insight) — *deprecated, auto-runs in /deep-test*

Measures file metrics, complexity indicators, and dependency graphs. Never blocks workflow.
Standalone mode available: `/deep-insight [target]`. See [Insight Guide](references/insight-guide.md).

### Session Report (/deep-report) — *deprecated, use /deep-status --report*

Generates a comprehensive session report (research, plan, implementation, test outcomes, phase durations).
Auto-generated after all tests pass. Manual: `/deep-report` or `/deep-status --report`.

## Phase Enforcement

Hooks enforce phase boundaries and track activity:

- **PreToolUse** (`phase-guard.sh`): During Research, Plan, and Test phases — Write/Edit tools are blocked for all files except `$WORK_DIR/` documents and the state file. During Implement — all tools available. No session — no restrictions.
- **PostToolUse** (`file-tracker.sh`): During Implement phase — automatically logs modified file paths to `$WORK_DIR/file-changes.log` with timestamps. Used by `/deep-report` and `/deep-insight`.
- **Stop** (`session-end.sh`): On CLI session end — if a deep-work session is active, outputs a reminder message and sends notification via configured channels.

This is not a suggestion — it's a hard gate. The AI literally cannot modify code files until the plan is approved, and cannot modify code during testing.

## Quick Start

```
/deep-work "Add user authentication with JWT tokens"
# → Brainstorm (자동) → Research (자동) → Plan (승인 대기)
# → 승인하면 → Implement (자동) → Test (자동) → Finish (선택)

# 수동 오버라이드가 필요할 때:
/deep-research                  # 리서치 다시 실행
/deep-plan                      # 플랜 수정
/deep-implement                 # 구현 재실행
/deep-test                      # 테스트 재실행
/deep-status                    # 상태 확인 (--receipts, --history, --report, --assumptions)
/deep-debug                     # 디버깅 모드
```

### Session Options

During `/deep-work` initialization:
- **Solo / Team** mode selection
- **Existing / Zero-Base** project type
- **Research / Plan** starting phase (skip research if you know the codebase)
- **Git branch** creation (optional)

## Session History

Each session creates a unique task folder under `deep-work/`:
```
deep-work/
├── 20260307-143022-jwt-기반-인증/
│   ├── research.md
│   ├── plan.md
│   ├── test-results.md
│   └── report.md
├── 20260306-091500-api-리팩토링/
│   ├── research.md
│   ├── plan.md
│   ├── plan.v1.md        ← plan version history
│   ├── test-results.md
│   └── report.md
```

Previous sessions are preserved when starting new ones. Use `/deep-status` to view history or `/deep-status --compare` to compare sessions.

## Profile System

First run saves setup answers to `.claude/deep-work-profile.yaml` as `default` preset. Subsequent runs skip all questions. Multi-preset support: `dev`, `quick`, `review` etc.

**Flags**: `--profile=quick`, `--team`, `--zero-base`, `--skip-research`, `--no-branch`, `--setup`

## Session Resume — *deprecated, auto-detected in /deep-work*

`/deep-work` 실행 시 기존 활성 세션이 감지되면 자동으로 resume 옵션을 제시합니다.
`/deep-resume`는 여전히 수동으로 호출 가능합니다.

## State Management

Session state is stored in `.claude/deep-work.local.md` with YAML frontmatter tracking:
- Current phase (research / plan / implement / test / idle)
- Task description
- Work directory
- Research/plan completion status
- Team mode and project type
- Git branch
- Test retry count and pass status
- Phase timestamps (started_at, completed_at for each phase)

Use `/deep-status` at any time to see the current state, progress, phase durations, and next recommended action.

## When to Use Deep Work

**Use it when**:
- The task touches multiple files or modules
- You're working in an unfamiliar codebase
- The change has architectural implications
- Previous AI attempts have gone wrong
- You want to review the approach before any code is written
- You're starting a brand new project from scratch (zero-base mode)

**Consider Team mode when**:
- The codebase is large and research would benefit from parallel analysis
- The implementation plan has many independent tasks across different files
- Complex refactoring that touches many modules simultaneously
- You want built-in cross-review of implementation quality

**Skip it when**:
- Simple one-file bug fixes
- Trivial text or config changes
- You already know exactly what to do

**Lightweight mode** (skip to /deep-plan directly):
- Touches 2-4 files in a well-understood area
- Follows established patterns with minor extensions
- Start with `/deep-work` then select "Plan부터" to skip research

## Complementary Usage with Built-in Plan Mode

Use built-in plan mode for quick task decomposition, Deep Work for complex subtasks needing thorough research and strict phase gates. They combine well: plan mode for initial design, Deep Work for implementation.

## Internationalization

All commands auto-detect the user's language and output in that language. Korean is the reference format; Claude translates naturally while preserving structure.
