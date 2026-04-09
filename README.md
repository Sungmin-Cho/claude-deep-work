**English** | [한국어](./README.ko.md)

# Deep Work Plugin

<!-- Badges (populated after sessions) -->
<!-- ![Deep Work Quality](https://img.shields.io/badge/deep--work-quality-lightgrey) -->
<!-- ![Sessions](https://img.shields.io/badge/sessions-0-blue) -->

A Claude Code plugin that implements an **Evidence-Driven Development Protocol** — a single-command auto-flow orchestration (Brainstorm → Research → Plan → Implement → Test) with TDD enforcement, receipt-based evidence collection, and strict separation of planning and coding.

## The Problem

Common pitfalls when AI coding tools tackle complex tasks:
- Introducing new patterns while ignoring the existing architecture
- Reimplementing utilities that already exist
- Jumping into implementation before understanding the codebase
- Adding unrequested "improvements" that cause bugs
- Marking work as done without verification

## The Solution

The **Brainstorm → Research → Plan → Implement → Test** workflow enforces evidence-driven development:

- **Phase 0 (Brainstorm)**: Optional design exploration — "why before how" (skip with `--skip-brainstorm`)
- **Phase 1 (Research)**: Deep analysis and documentation of the codebase
- **Phase 2 (Plan)**: Slice-based implementation plan with per-slice TDD fields, requiring user approval
- **Phase 3 (Implement)**: TDD-enforced slice execution — failing test → production code → receipt collection
- **Phase 4 (Test)**: Receipt completeness, spec compliance review, code quality review, verification evidence

Code file modifications are **physically blocked** during Phases 0, 1, 2, and 4 (via PreToolUse hook). **Bash file-writing commands** (`echo >`, `sed -i`, `cp`) are also intercepted. File changes and receipt data are **automatically collected** during Phase 3 (via PostToolUse hook).

## Usage (v5.5 Auto-Flow)

```bash
# Just one command — the entire workflow runs automatically
/deep-work "Implement JWT-based user authentication"

# The auto-flow orchestrates: Brainstorm → Research → Plan → [user approves] → Implement → Test → Report
# Plan approval is the ONLY required interaction

# Check unified status (replaces /deep-report, /deep-receipt, /deep-history, /deep-assumptions)
/deep-status              # current progress
/deep-status --report     # session report
/deep-status --receipts   # receipt dashboard
/deep-status --history    # cross-session trends
/deep-status --assumptions # assumption health
/deep-status --all        # everything at once

# Compare two sessions
/deep-status --compare
```

## Commands

### Primary Commands (7)

| Command | Description |
|---------|-------------|
| `/deep-work <task>` | **Auto-flow orchestration** — runs the entire Brainstorm → Research → Plan → Implement → Test pipeline automatically. Plan approval is the only required interaction. |
| `/deep-research` | Manual override for Phase 1 (Research) — deep codebase analysis |
| `/deep-plan` | Manual override for Phase 2 (Plan) — slice-based implementation planning |
| `/deep-implement` | Manual override for Phase 3 (Implement) — TDD-enforced slice execution |
| `/deep-test` | Phase 4: Receipt check → spec compliance → code quality → quality gates. Now auto-runs drift-check, SOLID review, and insight analysis. |
| `/deep-status` | **Unified view** — current progress, report, receipts, history, assumptions. Flags: `--report`, `--receipts`, `--history`, `--assumptions`, `--all`, `--compare` |
| `/deep-debug` | Systematic debugging: investigate → analyze → hypothesize → fix (auto-triggers on failures) |

### Deprecated Commands (13)

These commands still work but are now absorbed into the auto-flow. You no longer need to call them manually.

| Command | Absorbed into |
|---------|---------------|
| `/deep-brainstorm` | `/deep-work` auto-flow (Phase 0) |
| `/deep-phase-review` | Phase 문서 전용 리뷰 (독립 커맨드) |
| `/deep-receipt` | `/deep-status --receipts` |
| `/deep-slice` | `/deep-implement` (auto-managed internally) |
| `/deep-insight` | `/deep-test` (auto-runs as advisory gate) |
| `/deep-finish` | `/deep-work` (final stage of auto-flow) |
| `/deep-cleanup` | `/deep-work` init (auto-runs at session start) |
| `/deep-history` | `/deep-status --history` |
| `/deep-assumptions` | `/deep-status --assumptions` |
| `/deep-resume` | `/deep-work` (auto-detects active session) |
| `/deep-report` | `/deep-status --report` |
| `/drift-check` | `/deep-test` (auto-runs as required gate) |
| `/solid-review` | `/deep-test` (auto-runs as advisory gate) |

## Output Files

All session artifacts are stored in `deep-work/<task-folder>/`:

| File | Created | Description |
|------|---------|-------------|
| `research.md` | Phase 1 complete | Codebase analysis results (Executive Summary first) |
| `plan.md` | Phase 2 complete | Detailed implementation plan (Plan Summary first, per-slice contract + acceptance_threshold fields) |
| `plan.v{N}.md` | Plan rewrite | Previous plan version backup |
| `test-results.md` | Phase 4 complete | Verification results (cumulative per attempt) |
| `report.md` | Session complete | Full session report (includes phase durations) |
| `quality-gates.md` | Phase 4 complete | Quality Gate results detail (required/advisory) |
| `drift-report.md` | Phase 4 complete | Plan alignment verification results |
| `solid-review.md` | Phase 4 complete | SOLID design review scorecard and suggestions |
| `insight-report.md` | Phase 4 complete | Code metrics, complexity, dependency analysis |
| `file-changes.log` | Phase 3 ongoing | Auto-tracked file modifications with slice mapping (PostToolUse hook) |
| `plan-diff.md` | Plan rewrite | Structural change comparison between plan versions |
| `brainstorm.md` | Phase 0 complete | Design spec: problem definition, approach comparison, success criteria |
| `receipts/SLICE-NNN.json` | Phase 3 ongoing | Per-slice evidence: TDD output, git diff, spec check, review, model used (v4.1) |
| `session-receipt.json` | Session finish | Cross-slice session summary — derived cache from slice receipts (v4.1) |
| `debug-log/RC-NNN.md` | Phase 3 (debug) | Root cause analysis notes from systematic debugging |
| `harness-history/harness-sessions.jsonl` | Session end | Per-session assumption engine data — per-slice evidence, model, confidence signals (v5.0) |

## Session State

Stored as YAML frontmatter in `.claude/deep-work.local.md`:

| Field | Description |
|-------|-------------|
| `current_phase` | Current phase (idle / brainstorm / research / plan / implement / test) |
| `work_dir` | Task folder path |
| `task_description` | Task description |
| `team_mode` | Work mode (solo / team) |
| `project_type` | Project type (existing / zero-base) |
| `git_branch` | Created Git branch name |
| `test_retry_count` | Test retry count |
| `test_passed` | Final test pass status |
| `*_started_at`, `*_completed_at` | Per-phase start/completion timestamps |
| `model_routing` | Per-phase model configuration (research/plan/implement/test) |
| `notifications` | Notification settings (channel list, enabled status) |
| `last_research_commit` | Git commit hash at the time of last research |
| `quality_gates_passed` | Whether all Quality Gates passed |
| `preset` | Active preset name (v3.3.3) |
| `plan_approved_at` | Timestamp when plan was approved (used by Drift Detection) |
| `tdd_mode` | TDD enforcement mode (strict / relaxed / coaching / spike) |
| `active_slice` | Currently active slice ID (e.g., SLICE-001) |
| `tdd_state` | Current TDD state (PENDING / RED / RED_VERIFIED / GREEN_ELIGIBLE / GREEN / REFACTOR / SPIKE) |
| `tdd_override` | Slice-level TDD override — set to active slice ID when user bypasses TDD via AskUserQuestion |
| `debug_mode` | Whether systematic debugging is active |
| `brainstorm_started_at`, `brainstorm_completed_at` | Phase 0 timestamps |
| `worktree_enabled` | Whether worktree isolation is active (v4.1) |
| `worktree_path` | Absolute path to the worktree directory (v4.1) |
| `worktree_branch` | Branch name inside the worktree (v4.1) |
| `worktree_base_branch` | Original branch before worktree creation (v4.1) |
| `worktree_base_commit` | Commit hash at the time of worktree creation (v4.1) |
| `evaluator_model` | Default evaluator model for subagents — `"sonnet"` (v5.1) |
| `plan_review_retries` | Auto-loop retry count for plan review — `0` (v5.1) |
| `plan_review_max_retries` | Max retries for plan auto-loop — `3` (v5.1) |
| `auto_loop_enabled` | Whether auto-loop evaluation is active — `true` (v5.1) |
| `skipped_phases` | Phases skipped via `--skip-to-implement` — `[]` (v5.1) |
| `assumption_adjustments` | Active adjustments from Assumption Engine — `[]` (v5.1) |
| `fitness_baseline` | Phase 1 fitness violation snapshot for Phase 4 delta comparison (v5.9) |
| `unresolved_required_issues` | Phase 1 required failures propagated to Phase 4 (v5.9) |
| `health_report` | Latest Health Check results — drift + fitness (v5.9) |

## Workflow Details

### Phase 1: Research

Systematically analyzes the codebase across 6 areas:

1. **Architecture & Structure** — Project structure, architecture patterns, module boundaries
2. **Code Patterns & Conventions** — Naming conventions, error handling, testing patterns
3. **Data Layer** — ORM/DB schema, migrations, caching strategies
4. **API & Integration** — API structure, authentication/authorization, external service integration
5. **Shared Infrastructure** — Common utilities, configuration management, build system
6. **Dependencies & Risks** — Dependency conflicts, compatibility, security risks

**v3.0 features:**
- **Executive Summary first** — Pyramid principle: conclusion → evidence → details
- **Greenfield mode** — Tech stack selection, scaffolding design for new projects
- **Partial re-run** — Re-analyze specific areas with `/deep-research --scope=api,data`
- **Research caching** — Use previous session's research as baseline, re-analyze only changed areas
- **Team mode progress** — Agent completion notifications: `[2/3] pattern-analyst done ✅`

**v3.1 features:**
- **Incremental research** — Re-analyze only changed areas based on git diff with `/deep-research --incremental` (60-80% time savings)
- **Model routing** — Delegate Research Phase to a sonnet model Agent for token savings

**v5.5 features:**
- **Cross-Model Review** — codex/gemini independently review research findings with dedicated rubric
- **Consolidated Judgment** — Claude synthesizes all review results; user confirms in bulk before proceeding

**v5.9 features:**
- **Health Check** — Automatic drift detection (dead-export, stale-config, dependency-vuln, coverage-trend) + fitness.json validation at Phase 1 start
- **fitness.json auto-generation** — Ecosystem-aware architecture rule proposal with user approval
- **dep-cruiser install suggestion** — Explains the tool and offers installation for dependency rules

### Phase 2: Plan

Creates a concrete implementation plan based on research results:

- Plan Summary (approach, scope of changes, risks, key decisions) presented first
- List of files to change with specific modifications for each
- Code sketches, execution order, trade-off analysis, rollback strategy
- Task checklist

**v3.0 features:**
- **Interactive plan review** — Chat "change item 3" → plan.md auto-updates
- **Plan templates** — 6 types including API endpoint, UI component, DB migration
- **Plan version history** — Backed up as `plan.v{N}.md` on rewrite, Change Log added
- **Mode switch suggestions** — Team/Solo switch recommended based on plan analysis
- **Typing "approve" automatically starts implementation.**

**v3.1 features:**
- **Plan Diff visualization** — Automatically compares task/file/architecture/risk changes in `plan-diff.md` when a plan is rewritten

**v5.5 features:**
- **Claude Self-Review** — Automatic quality check before structural review — placeholders, consistency, research alignment
- **Consolidated Judgment** — Cross-review results synthesized with Claude's assessment; user confirms before plan modification

**v5.5.1 features:**
- **Team research cross-verification** — When `team_mode: team`, plan phase loads partial research files (`research-architecture.md`, `research-patterns.md`, `research-dependencies.md`) as supplementary references for cross-checking against synthesized `research.md`

**v5.5.2 features:**
- **Extended bash file-write detection** — 20+ new patterns: perl in-place, node -e `fs.writeFileSync`, python -c, ruby -e, awk, swift, git destructive ops, curl/wget output, ln, tar/unzip/cpio, rsync
- **File-write-first detection order** — FILE_WRITE patterns now checked before SAFE_COMMAND patterns, preventing safe patterns from masking file writes
- **Extended test file patterns** — Dart, Elixir, Lua, Vue, `fixtures/`, `__mocks__/`, `spec/` directories
- **Extended TDD exempt patterns** — `.toml`, `.ini`, `.cfg`, `.lock`, `.editorconfig`, image files (`.svg`, `.png`, `.jpg`, `.gif`)
- **TDD state validation** — Unknown TDD states blocked with actionable error message
- **Backtick/subshell handling** — `splitCommands` correctly handles backtick quoting and `$()` depth tracking
- **Error logging** — Hook errors logged to `.claude/deep-work-guard-errors.log` instead of suppressed

### Phase 3: Implement (v4.0 Evidence-Driven)

Slice-based TDD-enforced execution:

- Per-slice TDD cycle: RED (failing test) → GREEN (minimal code) → REFACTOR
- **TDD State Machine** hook enforcement — production code edits blocked until failing test output exists
- Each slice produces a **receipt JSON** (test output, git diff, spec checklist)
- Unexpected test failures trigger **debug mode** (`/deep-debug`)
- **Spike mode**: Exploratory coding, auto git stash + TDD restart on exit
- **Coaching mode**: Educational TDD guidance instead of hard blocks
- **TDD Override**: When TDD blocks a production edit, Claude asks the user whether to write a test first or skip TDD for this slice (merge-eligible with warning in receipt)
- Block messages include escape hatch guidance (`/deep-slice spike`, `/deep-slice reset`)
- **Mandatory TDD state updates** (v5.5.1) — B-1 (RED_VERIFIED) and B-2 (GREEN) state file updates are explicitly marked as mandatory with phase guard blocking warnings
- **Automatically enters Test phase after implementation completes**

**v3.0 features:**
- **Checkpoints (resume support)** — Skips completed tasks when restarted after interruption
- **Team mode progress** — Real-time per-agent completion status

### Phase 4: Test

Automatically verifies implementation results:

- Auto-detects test/lint/type-check commands from project configuration files
- Runs sequentially and records results (`test-results.md`)
- **All pass**: Session complete → report auto-generated
- **On failure**: Returns to implement phase → fix → re-test (up to 3 times)
- Breaks out of the loop after max retries, requesting manual intervention

```
implement → test → (pass) → idle + report
                 → (fail) → implement → test → ...
```

**v3.1 features:**
- **Quality Gate system** — Define gates in plan.md (required ✅ / advisory ⚠️), outputs `quality-gates.md`
- **Model routing** — Delegate Test Phase to a haiku model Agent for minimum cost

**v3.2 features:**
- **3-Tier Quality Gate system** — Required (blocking) / Advisory (warning) / Insight (informational)
- **Plan Alignment (Drift Detection)** — Built-in Required gate that automatically verifies implementation matches the approved plan. Detects unimplemented items, out-of-scope changes, and design decision drift. Outputs `drift-report.md`.
- **SOLID Design Review** — Advisory gate for evaluating code against SRP, OCP, LSP, ISP, DIP. Per-file scorecard, top-5 refactoring suggestions. Outputs `solid-review.md`.

**v3.3 features:**
- **Insight Tier Quality Gate** — `/deep-insight` command and built-in Insight gate. Measures file metrics, complexity indicators, dependency graph, and change summary. Outputs `insight-report.md`. Never blocks workflow.
- **PostToolUse File Tracking** — Automatically logs file modifications during Implement phase to `file-changes.log`. Feeds into `/deep-report` and `/deep-insight`.
- **Stop Hook** — Sends reminder and notification when CLI session ends with an active deep-work session.

**v5.9 features:**
- **Fitness Delta Gate** (Advisory) — Compares Phase 1 fitness baseline vs current violations. New violations get flagged but don't block.
- **Health Required Gate** (Required) — Propagates Phase 1 required failures (critical vulnerabilities, required_missing tools) to Phase 4. User must acknowledge to proceed.
- **Phase 4 Baseline Refresh** — Automatically updates health-baseline.json after quality gates pass, creating the comparison baseline for the next session.

**v3.3.3 features:**
- **Multi-Preset Profile System** — Create named presets (`dev`, `quick`, `review`) for different work styles. Interactive selection when multiple presets exist. Auto-migration from v1 single profile to v2 multi-preset format.

### Session Report

Automatically generated report after session completion:

- **Session Overview** — Task name, mode, project type, Git branch
- **Phase Duration** — Time spent per phase
- **Research/Plan Summary** — Key analysis results, approach
- **Implementation Results** — Per-task execution results
- **Verification Results** — Test/lint/type-check results
- **Test Retry History** — Results history per attempt

### Model Routing (v3.1 → v4.1)

Assigns the optimal model per phase, reducing token costs by 30-40%.

**v4.1: Auto-routing by slice complexity** — In implement phase, the model is automatically selected based on each slice's size:

| Slice Size | Default Model | Rationale |
|-----------|--------------|-----------|
| S (Small) | haiku | Simple config, 1-2 files, boilerplate |
| M (Medium) | sonnet | Standard feature, 3-5 files |
| L (Large) | sonnet | Complex feature, 5+ files |
| XL (Extra-Large) | opus | Architecture change, 10+ files |

Override per-slice: `/deep-slice model SLICE-NNN opus`. Customize the routing table in your preset's `routing_table` field.

**Per-phase defaults:**

| Phase | Default Model | Method | Rationale |
|-------|--------------|--------|-----------|
| Research | sonnet | Agent delegation | Sufficient for exploration/analysis |
| Plan | Main session | Direct execution | Requires interactive feedback |
| Implement | **auto** (v4.1) | Size-based selection | Cost-optimized per slice |
| Test | haiku | Agent delegation | Only runs tests |

### Worktree Isolation (v4.1)

Sessions now run in an isolated git worktree by default. This prevents accidental changes to the main branch during development.

- `/deep-work` creates a worktree at `.worktrees/dw/<slug>/` with a dedicated branch
- All work happens inside the worktree — main branch stays clean
- `/deep-finish` offers 4 completion options: merge, PR, keep branch, or discard
- `/deep-cleanup` removes stale worktrees (7+ days old, no active session)
- `/deep-resume` automatically detects and restores worktree context
- Opt-out with `--no-branch` flag or `git_branch: false` in preset

### Session Lifecycle (v4.1)

Complete session lifecycle management:

```
/deep-work (start) → worktree created → phases run → /deep-finish (end)
                                                        ├── merge
                                                        ├── PR
                                                        ├── keep
                                                        └── discard
```

### Receipt Validation (v4.1)

- Receipt schema v1.0 with `schema_version`, `model_used`, `git_before`/`git_after`, `estimated_cost`
- `receipt-migration.js` auto-converts pre-v4.1 receipts
- `validate-receipt.sh` validates receipt chain integrity
- `templates/deep-work-ci.yml` — GitHub Actions workflow for CI/CD receipt validation
- `/deep-receipt export --format=ci` for CI-friendly bundle export

### Session History (v4.1)

`/deep-history` shows cross-session trends:
- Past session list with model usage, TDD compliance, completion rate
- Aggregate statistics and trend indicators
- Model cost tracking (`estimated_cost` per slice and session)

### Multi-Channel Notifications (v3.1)

Sends notifications on phase completion:

| Channel | Method | Configuration |
|---------|--------|---------------|
| Local | OS native (macOS/Linux/Windows) | Default |
| Slack | Incoming Webhook | URL input |
| Discord | Webhook | URL input |
| Telegram | Bot API | Token + Chat ID |
| Custom Webhook | HTTP POST/GET/PUT | URL + Headers + Body Template |

The custom Webhook `body_template` supports variable substitution: `{{phase}}`, `{{status}}`, `{{message}}`, `{{timestamp}}`, `{{task}}`.

### Quality Gates (v3.1)

Define Quality Gates in plan.md and they will be automatically executed during the Test Phase:

```markdown
## Quality Gates

| Gate | Command | Required | Threshold |
|------|---------|----------|-----------|
| Type Check | `npx tsc --noEmit` | ✅ | — |
| Coverage | `npm test -- --coverage` | ⚠️ | ≥80% |
```

- **✅ Required**: Returns to implement on failure
- **⚠️ Advisory**: Warning logged only, does not block
- **ℹ️ Insight**: Results recorded for information only (v3.3)
- Falls back to existing auto-detection when not defined

## Internationalization (v3.2.2)

All commands automatically detect the user's language and output messages accordingly. Supported through Claude's native multilingual capability — no configuration needed.

- **Korean**: Default reference templates
- **English**: Automatically translated
- **Other languages**: Japanese, Chinese, and any language Claude supports

The plugin detects language from user messages or the Claude Code `language` setting.

## Hooks

Three hooks manage the session lifecycle:

| Hook | Script | Trigger | Purpose |
|------|--------|---------|---------|
| SessionStart | `update-check.sh` | startup/resume/clear/compact | Git-based version update check (v4.0) |
| PreToolUse | `phase-guard.sh` | Write/Edit/MultiEdit/Bash | Blocks code edits during research/plan/test phases; Bash file-write detection (v4.0) |
| PostToolUse | `file-tracker.sh` | Write/Edit/MultiEdit/Bash | Tracks file modifications during implement phase, updates receipts |
| Stop | `session-end.sh` | CLI session end | Reminds about active sessions, shows worktree info, sends notifications |

### Phase Guard

| Phase | Code Changes | Doc Changes | File Tracking |
|-------|-------------|-------------|---------------|
| Research | ❌ Blocked | ✅ Allowed | — |
| Plan | ❌ Blocked | ✅ Allowed | — |
| Implement | ✅ Allowed | ✅ Allowed | ✅ Tracked |
| Test | ❌ Blocked | ✅ Allowed | — |
| Idle | ✅ Allowed | ✅ Allowed | — |

## Profile System (v3.3.3)

On first run, setup questions are asked and saved as the `default` preset. On subsequent runs, the preset is auto-applied — you only provide the task description.

**Multi-preset support:** Create named presets for different work styles. When multiple presets exist, you choose one at session start.

```bash
# Use a specific preset
/deep-work --profile=quick "Fix the login bug"

# Manage presets (create, edit)
/deep-work --setup

# Override preset values for one session
/deep-work --team "Large refactoring task"
```

| Flag | Effect |
|------|--------|
| `--profile=X` | Use preset X directly |
| `--setup` | Manage presets (create/edit) |
| `--team` | Override to Team mode |
| `--zero-base` | Override to greenfield |
| `--skip-research` | Start from Plan phase |
| `--skip-to-implement` | Skip to implement phase (inline slice required) |
| `--no-branch` | Skip git branch creation |

## Session Options

Options selected when running `/deep-work` (or saved in a preset):

| Option | Choices | Description |
|--------|---------|-------------|
| Work mode | Solo / Team | Whether to run agents in parallel |
| Project type | Existing / Greenfield | Whether this is a new project |
| Starting phase | Research / Plan | Skip Research if you know the code well |
| Git branch | Create / Skip | Auto-create a session branch |
| Model routing | Default / Custom | Per-phase model assignment |
| Notifications | None / Local / External | Notify on phase completion |

## Solo vs Team Mode

| Aspect | Solo | Team |
|--------|------|------|
| Research | Single agent analysis | 3 parallel agents (arch/pattern/risk) |
| Plan | Single agent | Single agent (same) |
| Implement | Sequential execution | File-ownership-based parallel execution + cross-review |
| Test | Same | Same |
| Requirement | None | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |

Enabling Team mode:
```json
// ~/.claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## Complexity Guide

| Complexity | Recommended Workflow | Criteria |
|------------|---------------------|----------|
| High | Research → Plan → Implement → Test | 5+ files, architecture changes, unfamiliar codebase |
| Medium | Plan → Implement → Test (skip Research) | 2-4 files, extending a familiar area |
| Low | No workflow needed | Single file edit, config changes |

## Multi-Model Verification (v4.2)

deep-work v4.2 adds adversarial multi-model review to catch design flaws before implementation.

### How it works
1. **Structural Review** — Every phase document (brainstorm, research, plan) is reviewed by a Claude haiku subagent on phase-specific dimensions
2. **Adversarial Review** (plan only) — codex and/or gemini-cli independently review your plan. Conflicts are shown transparently for you to resolve
3. **Review Gate** — Low structural scores or critical consensus issues block auto-implement

### Setup
Cross-model review requires [codex](https://github.com/openai/codex) and/or [gemini-cli](https://github.com/google/gemini-cli) to be installed. deep-work auto-detects them at session init.

```bash
# Install codex (optional)
npm install -g @openai/codex

# Install gemini-cli (optional)
npm install -g @google/gemini-cli
```

If neither tool is installed, deep-work works normally with structural review only.

### Flags
- `--skip-review` — Skip all reviews (useful for spike/experimental work)

### Commands
- `/deep-phase-review` — Manually trigger review on current phase document
- `/deep-phase-review --adversarial` — Run only adversarial cross-model review

## Auto-Loop Evaluation & Contract Negotiation (v5.1)

deep-work v5.1 adds self-correcting evaluation loops and contract-driven slice negotiation.

### Auto-Loop Evaluation
- **Plan review auto-loop** — After plan creation, a subagent evaluator automatically reviews the plan. If the review score is below threshold, the plan is revised and re-reviewed (up to `plan_review_max_retries` times) without user intervention.
- **Test phase auto-retry** — When tests fail, the implement→test cycle re-executes automatically with evaluator feedback, reducing manual back-and-forth.
- Toggle with `auto_loop_enabled` in session state (default: `true`).

### Contract Negotiation
Each slice in `plan.md` can now include `contract` and `acceptance_threshold` fields:
- **`contract`** — Defines the expected inputs, outputs, and invariants for a slice
- **`acceptance_threshold`** — Numeric threshold (0.0–1.0) that the evaluator must meet for the slice to pass

The evaluator checks each slice against its contract during the test phase. Slices below threshold are flagged for revision.

### Assumption Engine Auto-Apply
At session start, the Assumption Engine automatically applies adjustments based on historical evidence. Previously manual `/deep-assumptions` adjustments are now proactively suggested and applied when confidence is high enough.

### Adaptive Evaluator Model
- Default evaluator model: **sonnet** (configurable via `evaluator_model` in session state)
- The engine can auto-adjust the evaluator model based on task complexity and historical accuracy signals.

### Phase Skip Flexibility
- **`--skip-to-implement`** flag on `/deep-work` — Skips brainstorm, research, and plan phases, jumping directly to implement. Requires an inline slice definition in the task description.
- Skipped phases are recorded in `skipped_phases` for traceability in reports and receipts.

## Auto-Flow Orchestration (v5.2)

deep-work v5.2 consolidates the entire workflow into a single `/deep-work` command. Instead of manually invoking each phase, the auto-flow orchestrates the full pipeline automatically.

### How it works
1. `/deep-work "task description"` starts the session and begins the auto-flow
2. Brainstorm → Research → Plan executes automatically
3. **Plan approval is the only required user interaction** — review the plan, give feedback, and type "approve"
4. After approval, Implement → Test → Report runs automatically
5. `/deep-test` now auto-runs drift-check, SOLID review, and insight analysis as built-in gates
6. `/deep-status` is the unified dashboard for all session information

### What changed
- **SKILL.md reduced**: 461 lines → 280 lines (clearer, less redundant)
- **13 commands deprecated**: Still functional but absorbed into the auto-flow
- **`/deep-status` expanded**: Replaces `/deep-report`, `/deep-receipt`, `/deep-history`, `/deep-assumptions` with flags
- **`/deep-test` expanded**: Auto-runs drift-check, SOLID review, and insight analysis

### Migration from v5.1
No action needed. Your existing presets and session state are fully compatible. Deprecated commands still work — they just invoke the same logic that the auto-flow would.

## Health Engine + Architecture Fitness (v5.9)

Phase 1 Research now includes an automatic **Health Check** that detects codebase drift and validates architecture fitness rules.

### Drift Sensors (Phase 1, automatic)

| Sensor | What it detects | Scope |
|--------|----------------|-------|
| dead-export | Unused exports never imported elsewhere | JS/TS |
| stale-config | Broken paths in tsconfig, package.json, .eslintrc | JS/TS |
| dependency-vuln | Known high/critical vulnerabilities via `npm audit` | JS/TS (Required gate) |
| coverage-trend | Coverage degradation vs. previous session baseline | Universal |

Drift sensors run in parallel (Promise.allSettled) with per-sensor timeouts. Results are injected into the research context so the agent considers codebase health during design.

### Architecture Fitness Functions (fitness.json)

Declare computational architecture rules in `.deep-review/fitness.json`:

```json
{
  "version": 1,
  "rules": [
    { "id": "no-circular-deps", "type": "dependency", "check": "circular", "severity": "required" },
    { "id": "max-file-lines", "type": "file-metric", "check": "line-count", "max": 500, "include": "src/**/*.{ts,js}", "severity": "advisory" },
    { "id": "no-console-in-prod", "type": "forbidden-pattern", "pattern": "console\\.(log|debug)", "include": "src/**/*.{ts,js}", "exclude": "**/*.test.*", "severity": "advisory" }
  ]
}
```

- **Auto-generation**: If fitness.json doesn't exist, Phase 1 analyzes the project and proposes rules (ecosystem-aware — dependency rules only for JS/TS)
- **Rule types**: `dependency` (dep-cruiser), `file-metric`, `forbidden-pattern`, `structure` (no `custom` in v1)
- **Phase 4 gates**: Fitness Delta (Advisory) detects new violations; Health Required (Required) propagates unresolved critical issues
- **Baseline management**: commit/branch-scoped with automatic invalidation on branch switch or rebase

### deep-review Integration

When deep-review is installed:
- fitness.json rules are injected into the review agent's prompt for architecture-aware review
- Health report from the receipt is used as additional review context (with scan_commit-based staleness check)

## Topology Templates (v5.9)

Phase 1 Research now auto-detects the service topology and loads a matching template that provides topology-specific guides, sensor configuration, and fitness defaults.

### Topology Detection

`topology-detector.js` runs on top of the existing ecosystem detection. It evaluates 6 built-in topologies in priority order and returns the first match:

| Topology | Detected by |
|----------|-------------|
| `nextjs-app` | `next` dependency in package.json |
| `react-spa` | `react` + no `next`/`express` |
| `express-api` | `express` dependency |
| `python-web` | `fastapi` / `django` / `flask` in requirements |
| `python-lib` | Python project with no web framework |
| `generic` | Fallback for all other projects |

Detection results are stored in session state and used throughout the workflow.

### Template Structure

Each topology template (`templates/topologies/<name>.json`) contains:

```json
{
  "topology": "nextjs-app",
  "guides": ["...topology-specific implementation guidance..."],
  "sensors": { "dead-export": true, "stale-config": true },
  "fitness_defaults": [
    { "id": "no-circular-deps", "type": "dependency", "severity": "required" }
  ],
  "harnessability_hints": ["...notes for the review agent..."]
}
```

- **`guides`** — injected into Phase 1 research context and Phase 3 implementation prompts
- **`sensors`** — topology-aware sensor enable/disable hints
- **`fitness_defaults`** — merged into auto-generated `fitness.json` when no existing rules conflict
- **`harnessability_hints`** — hints passed to deep-review for topology-aware code review

### Custom Topology Override

Place a file at `.deep-work/custom/<name>.json` using the same schema. The template loader performs a **deep merge** (custom values win), so you can override any field without rewriting the entire template.

```bash
# Example: override fitness_defaults for your nextjs-app project
.deep-work/custom/nextjs-app.json
```

### Phase Integration

- **Phase 1/3**: topology guides are injected into research and implementation context
- **Fitness generator**: `fitness_defaults` from the matched template seed the auto-generated `fitness.json` (topology-appropriate rules only)
- **deep-review**: `harnessability_hints` are forwarded to the review agent prompt

## Self-Correction Loop (v5.9)

A new `review-check` sensor runs automatically after lint and typecheck, providing two layers of correction before Phase 4.

### review-check Sensor

`sensors/review-check.js` operates in two independent layers:

| Layer | Trigger | What it checks |
|-------|---------|----------------|
| **Always-on** | Every session | Topology guides compliance — ensures implementation follows topology-specific patterns |
| **Fitness** | When `fitness.json` exists | Fitness rule violations introduced by the current implementation |

The sensor is added to the standard pipeline:

```
lint → typecheck → review-check
```

### Per-Sensor Correction Limit

Each sensor (including `review-check`) has an independent 3-round correction limit. If a sensor still fails after 3 rounds of self-correction, the session escalates to manual intervention rather than looping indefinitely.

```
round 1: sensor fails → self-correct
round 2: sensor fails → self-correct
round 3: sensor fails → self-correct
round 4: sensor fails → escalate (manual intervention required)
```

The limits are independent per sensor — a `review-check` failure does not consume lint or typecheck correction rounds.

### Disabling review-check

Add to `.deep-work/config.json`:

```json
{
  "review_check": false
}
```

This disables both the always-on and fitness layers entirely. Individual layers cannot be disabled separately in v1.

### v1 Scope

- Computational checks only (pattern matching, fitness rule evaluation)
- Full-project fitness checks (not incremental diff-only)
- Receipt schema extended with `review_check` field recording layer results and correction rounds used

## Quality Measurement (v5.3)

Every session produces a **Session Quality Score** (0-100) based on five outcome metrics:

| Metric | Weight | What it measures |
|--------|--------|-----------------|
| Test Pass Rate | 25% | How often tests pass on the first try |
| Rework Cycles | 20% | How many implement→test loops were needed |
| Plan Fidelity | 25% | How closely the implementation matches the approved plan |
| Sensor Clean Rate | 15% | Lint/typecheck sensor pass rate (not_applicable excluded) |
| Mutation Score | 15% | Mutation testing effectiveness (not_applicable excluded) |

Health Check results are **not** included in the quality score — they reflect codebase state, not session work quality. They are reported separately in the receipt.

Additional diagnostic metrics (Code Efficiency, Phase Balance) are tracked for informational purposes.

### Quality Trend
Use `/deep-status --history` to see your quality score trend across sessions. The trend helps identify whether your workflow is improving over time.

### Quality Badge
Use `/deep-status --badge` to generate a shield badge reflecting your recent quality trend (last 5 sessions). Badge levels: Excellent (90+), Good (75-89), Improving (60-74), Developing (<60).

## Self-Evolving Rules (v5.3)

The **Assumption Engine** tracks whether each enforcement rule (phase guard, TDD, research requirement, etc.) actually improves your outcomes. At each session start, it captures an **assumption snapshot** — the enforcement level of every rule. At session end, the quality score is recorded alongside the snapshot.

Over time, the engine compares quality scores between sessions where a rule was active vs. inactive. If the evidence shows a rule isn't helping (or is hurting), it suggests relaxing or removing it. If a rule consistently correlates with higher quality, it suggests strengthening enforcement.

This creates a feedback loop: rules that prove their value survive; rules that don't get adjusted. Your workflow evolves based on evidence, not dogma.

## Installation

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and configured

### Via Deep Suite marketplace (recommended)

```bash
# 1. Add the marketplace
/plugin marketplace add Sungmin-Cho/claude-deep-suite

# 2. Install the plugin
/plugin install deep-work@Sungmin-Cho-claude-deep-suite
```

### Standalone

```bash
# 1. Add this repo as a marketplace
/plugin marketplace add Sungmin-Cho/claude-deep-work

# 2. Install
/plugin install deep-work@Sungmin-Cho-claude-deep-work
```

## Plugin Integration

deep-work integrates with other Claude Deep Suite plugins when they are installed:

### deep-review
- **Sprint Contract** (Phase 2): After plan approval, automatically generates `.deep-review/contracts/` from slice criteria
- **Slice Review** (Phase 3): Suggests `/deep-review --contract SLICE-NNN` after each slice reaches GREEN
- **Full Review** (Phase 4): Suggests `/deep-review` for comprehensive review before quality gates
- **Fitness-Aware Review** (v5.9): deep-review reads `.deep-review/fitness.json` to evaluate architecture intent, and `health_report` from the receipt for drift context

### deep-wiki
- **Knowledge Capture** (Phase 4): After session completion, suggests `/wiki-ingest report.md` to archive research and design decisions

All integrations are optional — they only activate when the respective plugin is detected, and always require user confirmation before execution.

## License

MIT
