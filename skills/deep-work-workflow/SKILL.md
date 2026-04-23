---
name: deep-work-workflow
description: |
  Evidence-driven development protocol with auto-flow orchestration.
  Use when: "deep work", "plan before code", "TDD", "evidence-driven",
  "분석 후 구현", "structured workflow", or complex multi-file tasks
  that benefit from structured planning before implementation.
---

# Deep Work Workflow: Brainstorm → Research → Plan → Implement → Test → Integrate

## v5.6.0 Session Fork

**v5.6.0 신규 기능:**

### `/deep-fork [session-id] [--from-phase=PHASE]`

현재 세션을 fork하여 다른 접근법을 탐색합니다. 원래 세션은 보존됩니다.

- **Git 환경**: worktree 기반 전체 복제. implement/test까지 진행 가능.
  - Dirty 상태 검증: clean/commit/stash 중 선택
  - Session ID 기반 branch suffix (race condition 방지)
  - Worktree 컨텍스트 자동 전환 (`FORK_PROJECT_ROOT`)
- **Non-git 환경**: 산출물만 복제. plan phase까지만 진행 가능.
  - Phase guard가 implement/test 진입 차단
- **Fork 관계 추적**:
  - `fork_info`: fork된 세션의 상태 파일에 부모 관계 기록
  - `fork_children`: 부모 세션의 상태 파일에 자식 목록 기록
  - `fork-snapshot.yaml`: fork 시점 상태 스냅샷 (비교 기준점)
- **비교 & 시각화**:
  - `/deep-status --tree`: fork 관계 트리 시각화
  - `/deep-status --compare`: fork 관계 자동 감지 비교
- **Edge cases**: 최대 3세대 fork (경고), idle 세션 fork 금지, stale 부모 검증

## v5.5.2 Robust Detection & Signal Processing

**v5.5.2 신규 기능:**
- **확장된 bash 파일 쓰기 감지**: perl, node -e, python -c, ruby -e, swift, awk, git destructive ops 등 20+ 패턴 추가
- **보안: file-write-first 감지 순서**: FILE_WRITE 패턴을 SAFE 패턴보다 먼저 검사하여 우회 방지
- **확장된 언어 지원**: Dart, Elixir, Lua, Vue 테스트 패턴 + fixtures/mocks 디렉토리 인식
- **TDD exempt 확장**: .toml, .ini, .cfg, .lock, .editorconfig, 이미지 파일 면제
- **splitCommands 개선**: backtick, $() subshell 깊이 추적으로 중첩 표현식 내부 잘못된 분할 방지
- **TDD state 검증**: 알 수 없는 상태값 차단 + 안내 메시지
- **에러 로깅**: /dev/null → `.claude/deep-work-guard-errors.log` 파일 기록
- **Node.js 25 호환**: file-tracker.sh argv 인덱싱 수정 (receipt 생성 무음 실패 해결)
- **Assumption Engine 수정**: CLI 버그, threshold 전달, dedup 순서 (keep-latest), 입력 가드

## v6.0.2 Phase Review Gate & Folder Rename

**v6.0.2 신규 기능:**
- **Phase Review Gate**: 모든 Phase(0~3) 종료 시 통합 리뷰 게이트 자동 실행. 셀프 리뷰 + 외부 리뷰(deep-review/codex/gemini/Opus) 후 사용자 확인
- **Phase별 Fallback 체인**: Phase 0~2(문서)는 Structural+Adversarial, Phase 3(코드)는 deep-review 우선
- **사용자 확인 UX**: 요약 → 선택지(자동 수정/현재 진행/상세 보기)
- **Degraded Mode**: 외부 리뷰어 실패 시 자동 fallback
- **세션 폴더 이름 변경**: `deep-work/` → `.deep-work/` (숨김 폴더). 마이그레이션 자동 처리
- **State 스키마 확장**: `phase_review` 필드 추가 (기존 `review_results` 하위 호환)

## v5.5 Review Flow Enhancement

**v5.5 신규 기능:**
- **Research Cross-Model Review**: research 단계에도 codex/gemini 크로스 리뷰 적용
- **Claude 자체 재검토**: plan 작성 직후 자동 품질 점검 (placeholder, 일관성, 누락)
- **종합 판단 프로토콜**: cross-review 후 Claude 판단 + 사용자 일괄 확인 (개별 conflict 질문 대체)
- **Structural Review 강화**: auto-fix 기준 score < 5 → score < 7, 스냅샷 기반 rollback
- **Degraded Mode**: cross-model 리뷰어 실패 시 명시적 상태 표시 + graceful fallback
- **State 스키마 마이그레이션**: 신규 필드 자동 초기화, resume 시 문서-판단 시각 검증

## v5.3 Precision + Evidence

`/deep-work "task"` 하나로 전체 워크플로우가 자동 진행됩니다.
Plan 승인이 유일한 필수 인터랙션입니다.

**v5.3 신규 기능:**
- **Document Intelligence**: 피드백 적용 시 중복/불필요 내용 자동 정리 (Apply → Deduplicate → Prune)
- **Session Relevance Detection**: 현재 세션 범위 밖 피드백 감지 → 새 세션 분리 제안
- **Plan Fidelity Score**: 구현 vs 플랜 충실도 0-100 점수 산출
- **Session Quality Score**: 세션 종료 시 품질 점수 자동 계산 — 5-component system: Test Pass Rate (25%), Rework Cycles (20%), Plan Fidelity (25%), Sensor Clean Rate (15%), Mutation Score (15%). Sensor/Mutation components excluded proportionally when not_applicable.
- **Cross-Session Quality Trend**: `/deep-status --history`에서 세션 간 품질 추이 시각화
- **Assumption Engine Quality Integration**: 품질 점수 기반 규칙 자가 최적화 (cohort 분석, 3세션 minimum gate)
- **Quality Badge**: `/deep-status --badge`로 shields.io 뱃지 생성

**Primary workflow (7):** `/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement`, `/deep-test`, `/deep-status`, `/deep-debug`

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
- Phase Exit Gates (v6.3.1): user-confirmed transitions between phases via AskUserQuestion — "진행 / 재실행 / 일시정지" per phase. current_phase 전환은 Orchestrator Exit Gate "진행" 선택 시에만 발생. Phase 5 Integrate는 제외 (interactive loop 자체가 게이트 역할).

## Why This Workflow Exists

When AI coding tools work on complex tasks without structure, common failure modes emerge:

1. **Architecture Ignorance**: AI generates code that doesn't follow existing patterns
2. **Duplicate Implementation**: AI creates new utilities when equivalent ones already exist
3. **Premature Coding**: AI starts writing code before understanding the full picture
4. **Scope Creep**: AI adds "improvements" not requested, introducing bugs
5. **Inconsistency**: AI uses different conventions than the rest of the codebase

The Deep Work workflow prevents these by **strictly separating brainstorming, analysis, planning, coding, testing, and integration** into six distinct phases — the first five with enforced gates, plus Phase 5 Integrate as an optional post-test recommendation loop.

## The Six Phases

### Phase 0: Brainstorm (`/deep-brainstorm`) — Optional

**Goal**: Explore "why before how" — define the problem, compare approaches, establish success criteria.

**What happens**:
- Structured design conversation with the user
- 2-3 approach comparison with pros/cons
- Spec-reviewer subagent validates the brainstorm document
- Documentation in `$WORK_DIR/brainstorm.md`
- **Phase Review Gate**: Phase 완료 시 셀프 리뷰 + 외부 리뷰 자동 실행, 사용자 확인 후 전환

**What's blocked**: All code file modifications (enforced by hook)
**Skip**: Use `--skip-brainstorm` to start directly at Research.

### Phase 1: Research (`/deep-research`)

**Goal**: Build a complete mental model of the relevant codebase before making any decisions.

**What happens**:
- Exhaustive analysis of architecture, patterns, and conventions
- Identification of all relevant files, dependencies, and risk areas
- Documentation of everything in `$WORK_DIR/research.md`
- **Output begins with Executive Summary and Key Findings** (pyramid principle)
- **Phase Review Gate**: Phase 완료 시 셀프 리뷰 + 외부 리뷰 자동 실행, 사용자 확인 후 전환

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "You cannot plan what you don't understand, and you cannot understand what you haven't read."

**Features**:
- **Zero-base mode**: For new projects, researches technology stacks, architecture patterns, and scaffolding instead of existing code
- **Partial re-run**: `/deep-research --scope=api,data` re-analyzes specific areas only
- **Research caching**: Reuses previous session's research as baseline, updating only changed areas
- **Team mode**: 3 specialist agents (arch-analyst, pattern-analyst, risk-analyst) analyze in parallel with progress notifications
- **Structural Review 강화**: score < 7 auto-fix, 스냅샷 기반 rollback
- **Cross-Model Review**: codex/gemini가 research.md를 독립 평가 (plan과 동일 패턴)
- **종합 판단**: Claude가 모든 리뷰 결과를 분석, 사용자 일괄 확인 후 수정

For detailed guidance, see [Research Guide](../shared/references/research-guide.md) or [Zero-Base Guide](../shared/references/zero-base-guide.md).

### Phase 2: Plan (`/deep-plan`)

**Goal**: Create a detailed, reviewable, approvable implementation plan.

**What happens**:
- Transform research findings into a concrete action plan
- **Plan Summary at the top** with approach, scope, risk level, and key decisions
- Define exact files to modify, code snippets, execution order
- **Code completeness tiered by slice size**: S=pseudocode OK, M=signatures+types actual code, L=boundary code complete (interfaces, APIs, tests)
- **No placeholders**: Plan must pass the Completeness Policy — no TBD, TODO, or vague directives
- **Research traceability**: Architecture decisions reference tagged research findings [RF-NNN], [RA-NNN]
- Create a checklist-style task list in `$WORK_DIR/plan.md`
- **Phase Review Gate**: Phase 완료 시 셀프 리뷰 + 외부 리뷰 자동 실행, 사용자 확인 후 전환

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "The plan is the contract between human and AI. No implementation without approval."

**Features**:
- **Interactive review**: Chat-based feedback loop — say "3번 항목 변경해줘" and plan.md updates automatically
- **Plan templates**: Auto-suggests templates for common task types (API endpoint, UI component, DB migration, etc.)
- **Version history**: Previous plans backed up as `plan.v1.md`, `plan.v2.md` with change logs
- **Mode re-evaluation**: Suggests Team↔Solo switching based on plan complexity
- **Exit Gate to Implement (v6.3.1)**: 문서 최종 승인 후 Orchestrator Phase Exit Gate가 "진행 / 재실행 / 일시정지"를 묻는다. "진행" 선택 시 Implement phase 자동 호출 (수동 `/deep-implement` 불필요).
- **Claude 자체 재검토**: plan 작성 직후 placeholder/일관성/누락 자동 점검 및 수정
- **Structural Review 강화**: score < 7 auto-fix, 스냅샷 기반 rollback
- **종합 판단**: cross-review 후 Claude 판단 + 사용자 일괄 확인 (개별 conflict 질문 대체)
- **Team research 교차 검증** (v5.5.1): team_mode: team일 때 부분 리서치 파일(research-architecture/patterns/dependencies.md)을 보조 참조로 로드하여 합성 누락 세부 사항 교차 확인

**Note**: Plan phase does not use Team mode — planning requires a single coherent document produced by one agent.

For detailed guidance, see [Planning Guide](../shared/references/planning-guide.md).

### Phase 3: Implement (`/deep-implement`)

**Goal**: Mechanically execute the approved plan, task by task.

**What happens**:
- Follow the plan checklist exactly
- Implement one task at a time, marking each complete
- Document any issues encountered — never improvise
- **Exit Gate to Test phase (v6.3.1)**: 모든 slice 완료 시 Orchestrator가 Phase Exit Gate를 표시. "진행" 선택 시 Test phase 호출. Implement skill 자체는 `implement_completed_at`만 기록하고 current_phase 전환은 Orchestrator가 담당.
- **Computational sensors**: After each slice reaches GREEN, computational sensors (linter, type checker) run automatically. Failures trigger a self-correction loop (SENSOR_FIX state) where the AI attempts to fix sensor errors before moving to the next slice. Results are stored in receipt `sensor_results` fields.
- **Slice Review**: After sensors pass, independent 2-stage review per slice — spec compliance (required) and code quality (advisory). Issues caught immediately, not deferred to Phase 4.
- **Pre-flight Check**: Before each slice's TDD cycle, verify prerequisites (files exist, commands work). Problems surface immediately via AskUserQuestion.
- **Status Reporting**: Each slice records `slice_confidence` (done/done_with_concerns) and specific concerns in the receipt.
- **Red Flags**: Rationalization prevention tables in implement and test phases. Complements hook-based hard gates with soft behavioral guidance.
- **Phase Review Gate**: Phase 완료 시 셀프 리뷰 + 외부 리뷰 자동 실행, 사용자 확인 후 전환

**What's allowed**: All tools — code modification is now permitted

**Key principle**: "The best implementation is a boring implementation. No creativity, no surprises, just faithful execution."

**Features**:
- **Checkpoint support**: If interrupted, resumes from the last incomplete task
- **Team mode**: Tasks clustered by file ownership, distributed to parallel agents with cross-review and progress notifications
- **Exit Gate handoff to Test (v6.3.1)**: slice 완료 후 Implement는 완료-marker만 기록하고 Orchestrator Exit Gate로 제어 반환. 사용자 "진행" 선택 시 Test phase 호출 (수동 `/deep-test` 불필요).
- **TDD state 업데이트 필수화** (v5.5.1): B-1/B-2 완료 후 state file 업데이트를 필수로 명시, 미수행 시 phase guard 차단 경고
- **Slice Review**: Per-slice 2-stage independent review (spec compliance → code quality) after sensors pass. Solo mode only; delegation mode uses self-review recorded as `slice_review.mode: "self"`

For detailed guidance, see [Implementation Guide](../shared/references/implementation-guide.md).

### Phase 4: Test (`/deep-test`)

**Goal**: Verify the implementation through comprehensive automated testing.

**What happens**:
- Auto-detects verification commands (test, lint, typecheck) from project config
- Runs all checks sequentially, records results
- **Sensor Clean gate**: Reads `sensor_results` from receipts (no re-execution) to verify all slices passed computational sensors
- **Mutation testing**: Verifies AI-generated test quality by running mutation analysis (stryker/mutmut). Survived mutants trigger automatic test improvement via return to the implement phase — `/deep-mutation-test` handles this transition internally
- **Cross-slice consistency + backfill review**: Phase 4 now verifies inter-slice compatibility instead of per-slice compliance (done in Phase 3). Slices that skipped Phase 3 review get backfill (보완) review here.
- **Pass**: Session completes, report generated
- **Fail**: Returns to implement phase for fixes (up to 3 retries)

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "Trust but verify. The test phase catches what implementation missed."

**Features**:
- **Auto-detection**: Scans package.json, pyproject.toml, Makefile, Cargo.toml, go.mod
- **Implement-test loop**: Automatic retry cycle with detailed failure reports
- **Cumulative results**: All attempts recorded in `$WORK_DIR/test-results.md`
- **Git integration**: Suggests commit after all tests pass

For detailed guidance, see [Testing Guide](../shared/references/testing-guide.md).

### Phase 5: Integrate (v6.3.0, skippable)

Phase 4 Test 완료 후 옵션으로 호출되는 "다음 단계 추천 루프". 설치된 `deep-review`/`deep-docs`/`deep-wiki`/`deep-dashboard`/`deep-evolve` 플러그인의 아티팩트를 읽어 AI가 최대 3개의 다음 단계를 추천하면, 사용자가 선택·실행하거나 skip·finish한다. `--skip-integrate`로 건너뛸 수 있고, `/deep-integrate`로 명시적 재진입도 가능하다. 자세한 UX/데이터 계약은 `docs/superpowers/specs/2026-04-18-phase5-integrate-design.md` 참조.

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
- **Stop** (`session-end.sh`): On CLI session end — if a deep-work session is active, outputs a reminder message and sends notification via configured channels.

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
