---
name: deep-work-workflow
description: "This skill provides a high-level overview of the deep-work workflow (Brainstorm → Research → Spec → Plan → Implement → Test → Integrate, with M3 envelope receipt emit and Exit Gates between phases). Use when the user asks how deep-work works, requests a workflow overview, asks 'which phase should I start from', or needs to understand the phase-to-phase contracts. For executing an actual phase, prefer the phase-specific skills (deep-brainstorm, deep-research, deep-spec, deep-plan, deep-implement, deep-test, deep-integrate). Triggers: 'deep-work overview', 'workflow 개요', 'how does deep-work work', 'phase 구조 설명'."
---

# Deep Work Workflow: Brainstorm → Research → Spec → Plan → Implement → Test → Integrate

`/deep-work "task"` 하나로 전체 워크플로우가 자동 진행됩니다.
Plan 승인이 유일한 필수 인터랙션입니다.

**Primary workflow (8):** `/deep-work`, `/deep-research`, `/deep-spec`, `/deep-plan`, `/deep-implement`, `/deep-test`, `/deep-status`, `/deep-debug`

**Special utility (4):** `/deep-fork`, `/deep-mutation-test`, `/deep-phase-review`, `/deep-sensor-scan`

**Quality Gate (3):** `/drift-check`, `/solid-review`, `/deep-insight` — `/deep-test`가 자동 실행; standalone 호출 가능.

**Internal (6):** `/deep-brainstorm`, `/deep-finish`, `/deep-report`, `/deep-receipt`, `/deep-history`, `/deep-assumptions` — orchestrator 또는 `/deep-status`가 내부 참조. 수동 호출도 공식 경로.

**Escape hatch (1):** `/deep-slice` — `phase-guard`가 TDD 블록 시 안내 (`spike`, `reset`).

**Utility (2):** `/deep-cleanup`, `/deep-resume` — standalone 기능. 향후 이관 후 삭제 예정.

**Core mechanisms:**
- Phase Guard (hook-enforced code blocking)
- TDD Enforcement (state machine: PENDING → RED → GREEN → REFACTOR)
- Slice-based Execution with Receipt Collection
- Profile/Preset System (zero-question restart)
- Phase Exit Gates: user-confirmed transitions between phases via AskUserQuestion — "진행 / 재실행 / 일시정지" per phase. current_phase 전환은 Orchestrator Exit Gate "진행" 선택 시에만 발생. Phase 6 Integrate는 제외 (interactive loop 자체가 게이트 역할).

## Why This Workflow Exists

When AI coding tools work on complex tasks without structure, common failure modes emerge:

1. **Architecture Ignorance**: AI generates code that doesn't follow existing patterns
2. **Duplicate Implementation**: AI creates new utilities when equivalent ones already exist
3. **Premature Coding**: AI starts writing code before understanding the full picture
4. **Scope Creep**: AI adds "improvements" not requested, introducing bugs
5. **Inconsistency**: AI uses different conventions than the rest of the codebase

The Deep Work workflow prevents these by **strictly separating brainstorming, analysis, executable specification, planning, coding, testing, and integration** into seven distinct phases — the first six with enforced gates, plus Integrate as an optional post-test recommendation loop.

## The Seven Phases

| Phase | Skill | Produces | Gate before the next phase |
|---|---|---|---|
| Brainstorm | `deep-brainstorm` | `brainstorm.md` | Exit Gate (phase itself is skippable) |
| Research | `deep-research` | `research.md` | review + approval, then Exit Gate |
| Spec | `deep-spec` | `spec.md` | spec-contract validation, then Exit Gate |
| Plan | `deep-plan` | `plan.md` with the SLICE DAG | review + approval, then Exit Gate |
| Implement | `deep-implement` | `receipts/SLICE-*.json` | verify-receipt, then Exit Gate |
| Test | `deep-test` | `test_passed` marker | verification gates, then Exit Gate |
| Integrate | `deep-integrate` | `integrate-loop.json` | none — the loop is its own gate |

Phase numbering differs between this overview (Brainstorm = 0 … Integrate = 6)
and the individual skill `description` fields, which still use the pre-Spec
numbering. Refer to phases by name, not number.

Per-phase inputs, outputs, gates and entry commands are in
`${CLAUDE_PLUGIN_ROOT}/skills/deep-work-workflow/references/phase-contracts.md`.
Read it when the user asks what a specific phase does, what artifact it produces,
or which phase to start from.

## Quality Gates & Utilities

### Plan Alignment Check (/drift-check) — *Quality Gate — auto-runs in /deep-test; standalone: /drift-check [plan-file]*

Compares plan.md items with actual git diff. Reports implemented, missing, out-of-scope, and design drift.
Standalone mode available: `/drift-check [plan-file]`.

### SOLID Design Review (/solid-review) — *Quality Gate — auto-runs in /deep-test; standalone: /solid-review [target]*

Evaluates code against the 5 SOLID design principles with a per-principle scorecard.
Standalone mode available: `/solid-review [target]`. See [SOLID Guide](../shared/references/solid-guide.md).

### Code Insight Analysis (/deep-insight) — *Quality Gate — auto-runs in /deep-test; standalone: /deep-insight [target]*

Measures file metrics, complexity indicators, and dependency graphs. Never blocks workflow.
Standalone mode available: `/deep-insight [target]`. See [Insight Guide](../shared/references/insight-guide.md).

### Session Report (/deep-report) — *Internal — auto-generated after test pass; manual: /deep-report or /deep-status --report*

Generates a comprehensive session report (research, plan, implementation, test outcomes, phase durations).
Auto-generated after all tests pass. Manual: `/deep-report` or `/deep-status --report`.

## Phase Enforcement

Hooks enforce phase boundaries and track activity:

- **PreToolUse** (`phase-guard.sh`): During Research, Plan, and Test phases — Write/Edit tools are blocked for all files except `$WORK_DIR/` documents and the state file. During Implement — all tools available. No session — no restrictions.
- **PostToolUse** (`file-tracker.sh`): During Implement phase — automatically logs modified file paths to `$WORK_DIR/file-changes.log` with timestamps. Used by `/deep-report` and `/deep-insight`.
- **Stop** (`session-end.sh`): On CLI session end — if a deep-work session is active, outputs a reminder message.

This is not a suggestion — it's a hard gate. The AI literally cannot modify code files until the plan is approved, and cannot modify code during testing.

## Quick Start

```
/deep-work "Add user authentication with JWT tokens"
# v6.3.1 Phase Exit Gates — 각 phase 완료 시 사용자 확인 (진행/재실행/일시정지)
# → Brainstorm → [Exit Gate] → Research → [review+approval + Exit Gate]
# → Plan → [review+approval + Exit Gate] → Implement → [Exit Gate]
# → Test → [Exit Gate: Integrate 또는 Finish] → Finish

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

Each session creates a unique task folder under `.deep-work/`:
```
.deep-work/
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

## Session Resume (/deep-resume)

`/deep-work` 진입 시 stale 세션은 자동 감지되지만, active 세션 선택·worktree 컨텍스트 복원·phase별 resume dispatch는 `/deep-resume`을 통해서만 가능합니다.

## State Management

Session state is stored in `.claude/deep-work.{SESSION_ID}.md` (e.g., `.claude/deep-work.s-a3f7b2c1.md`) with YAML frontmatter tracking. Legacy single-session path `.claude/deep-work.local.md` is auto-migrated on first use.
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
