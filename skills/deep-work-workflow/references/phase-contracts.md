# Seven-phase contracts

> Reference for `${CLAUDE_PLUGIN_ROOT}/skills/deep-work-workflow/SKILL.md`. Per-phase inputs, outputs, gates and entry commands. Read when the user asks what a specific phase does, what it produces, or which phase to start from.

---

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
- **Team mode**: 3 specialist agents (arch-analyst, pattern-analyst, risk-analyst) analyze in parallel
- **Structural Review 강화**: score < 7 auto-fix, 스냅샷 기반 rollback
- **Cross-Model Review**: codex/gemini가 research.md를 독립 평가 (plan과 동일 패턴)
- **종합 판단**: Claude가 모든 리뷰 결과를 분석, 사용자 일괄 확인 후 수정

For detailed guidance, see [Research Guide](../../shared/references/research-guide.md) or [Zero-Base Guide](../../shared/references/zero-base-guide.md).

### Phase 2: Spec (`/deep-spec`)

**Goal**: Compile reviewed research and risk into an executable, digest-bound
contract before implementation planning.

**What happens**:
- Requirements, invariants, failure modes, compatibility, and evidence gates are
  recorded in `$WORK_DIR/spec.md`
- The production dispatcher records canonical `current_phase: spec` and binds the
  approved artifact digest
- Legacy `current_phase: research` plus `subphase: spec` remains read-compatible

**What's blocked**: All code file modifications (enforced by hook)

### Phase 3: Plan (`/deep-plan`)

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
- **Exit Gate to Implement**: 문서 최종 승인 후 Orchestrator Phase Exit Gate가 "진행 / 재실행 / 일시정지"를 묻는다. "진행" 선택 시 Implement phase 자동 호출 (수동 `/deep-implement` 불필요).
- **Claude 자체 재검토**: plan 작성 직후 placeholder/일관성/누락 자동 점검 및 수정
- **Structural Review 강화**: score < 7 auto-fix, 스냅샷 기반 rollback
- **종합 판단**: cross-review 후 Claude 판단 + 사용자 일괄 확인 (개별 conflict 질문 대체)
- **Team research 교차 검증**: team_mode: team일 때 부분 리서치 파일(research-architecture/patterns/dependencies.md)을 보조 참조로 로드하여 합성 누락 세부 사항 교차 확인

**Note**: Plan phase does not use Team mode — planning requires a single coherent document produced by one agent.

For detailed guidance, see [Planning Guide](../../shared/references/planning-guide.md).

### Phase 4: Implement (`/deep-implement`)

**Goal**: Mechanically execute the approved plan, task by task.

**What happens**:
- Follow the plan checklist exactly
- Implement one task at a time, marking each complete
- Document any issues encountered — never improvise
- **Exit Gate to Test phase**: 모든 slice 완료 시 Orchestrator가 Phase Exit Gate를 표시. "진행" 선택 시 Test phase 호출. Implement skill 자체는 `implement_completed_at`만 기록하고 current_phase 전환은 Orchestrator가 담당.
- **Computational sensors**: After each slice reaches GREEN, computational sensors (linter, type checker) run automatically. Failures trigger a self-correction loop (SENSOR_FIX state) where the AI attempts to fix sensor errors before moving to the next slice. Results are stored in receipt `sensor_results` fields.
- **Slice Review**: After sensors pass, independent 2-stage review per slice — spec compliance (required) and code quality (advisory). Issues caught immediately, not deferred to Phase 5.
- **Pre-flight Check**: Before each slice's TDD cycle, verify prerequisites (files exist, commands work). Problems surface immediately via AskUserQuestion.
- **Status Reporting**: Each slice records `slice_confidence` (done/done_with_concerns) and specific concerns in the receipt.
- **Red Flags**: Rationalization prevention tables in implement and test phases. Complements hook-based hard gates with soft behavioral guidance.
- **Phase Review Gate**: Phase 완료 시 셀프 리뷰 + 외부 리뷰 자동 실행, 사용자 확인 후 전환

**What's allowed**: All tools — code modification is now permitted

**Key principle**: "The best implementation is a boring implementation. No creativity, no surprises, just faithful execution."

**Features**:
- **Checkpoint support**: If interrupted, resumes from the last incomplete task
- **Team mode**: Tasks clustered by file ownership, distributed to parallel agents with cross-review
- **Exit Gate handoff to Test**: slice 완료 후 Implement는 완료-marker만 기록하고 Orchestrator Exit Gate로 제어 반환. 사용자 "진행" 선택 시 Test phase 호출 (수동 `/deep-test` 불필요).
- **TDD state 업데이트 필수화**: B-1/B-2 완료 후 state file 업데이트를 필수로 명시, 미수행 시 phase guard 차단 경고
- **Slice Review**: Per-slice 2-stage independent review (spec compliance → code quality) after sensors pass. Solo mode only; delegation mode uses self-review recorded as `slice_review.mode: "self"`

For detailed guidance, see [Implementation Guide](../../shared/references/implementation-guide.md).

### Phase 5: Test (`/deep-test`)

**Goal**: Verify the implementation through comprehensive automated testing.

**What happens**:
- Auto-detects verification commands (test, lint, typecheck) from project config
- Runs all checks sequentially, records results
- **Sensor Clean gate**: Reads `sensor_results` from receipts (no re-execution) to verify all slices passed computational sensors
- **Mutation testing**: Verifies AI-generated test quality by running mutation analysis (stryker/mutmut). Survived mutants trigger automatic test improvement via return to the implement phase — `/deep-mutation-test` handles this transition internally
- **Cross-slice consistency + backfill review**: Phase 5 verifies inter-slice compatibility instead of per-slice compliance (done in Phase 4). Slices that skipped Phase 4 review get backfill (보완) review here.
- **Pass**: Session completes, report generated
- **Fail**: Returns to implement phase for fixes (up to 3 retries)

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "Trust but verify. The test phase catches what implementation missed."

**Features**:
- **Auto-detection**: Scans package.json, pyproject.toml, Makefile, Cargo.toml, go.mod
- **Implement-test loop**: Automatic retry cycle with detailed failure reports
- **Cumulative results**: All attempts recorded in `$WORK_DIR/test-results.md`
- **Git integration**: Suggests commit after all tests pass

For detailed guidance, see [Testing Guide](../../shared/references/testing-guide.md).

### Phase 6: Integrate (skippable)

Phase 5 Test 완료 후 옵션으로 호출되는 "다음 단계 추천 루프". 설치된 `deep-review`/`deep-docs`/`deep-wiki`/`deep-dashboard`/`deep-evolve` 플러그인의 아티팩트를 읽어 AI가 최대 3개의 다음 단계를 추천하면, 사용자가 선택·실행하거나 skip·finish한다. `--skip-integrate`로 건너뛸 수 있고, `/deep-integrate`로 명시적 재진입도 가능하다. 자세한 UX/데이터 계약은참조.

