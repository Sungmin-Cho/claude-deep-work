**English** | [한국어](./README.ko.md)

# Deep Work Plugin

A Claude Code plugin that implements an **Evidence-Driven Development Protocol** — a 5-phase workflow (Brainstorm → Research → Plan → Implement → Test) with TDD enforcement, receipt-based evidence collection, and strict separation of planning and coding.

<p align="center">
  <img src="./demo-en.gif" alt="Deep Work Plugin Demo — 4-Phase Workflow with 3-Tier Quality Gates" width="800">
</p>

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

## Usage

```bash
# 1. Start a session (Solo/Team, existing/greenfield, Research/Plan starting point)
/deep-work "Implement JWT-based user authentication"

# 2. Analyze the codebase
/deep-research

# 3. Review research results and create a plan
/deep-plan

# 4. Review the plan → give feedback via chat → plan.md auto-updates → repeat
#    When satisfied, type "approve" → implementation starts automatically
#    → tests run automatically → report is generated

# Partial research re-run (specific areas only)
/deep-research --scope=api,data

# Incremental research (re-analyze only changed parts)
/deep-research --incremental

# View or regenerate the report
/deep-report

# Check status and session history
/deep-status

# Compare two sessions
/deep-status --compare
```

## Commands

| Command | Description |
|---------|-------------|
| `/deep-work <task>` | Initialize session, select preset, configure TDD mode, update check (`--skip-to-implement` flag) |
| `/deep-brainstorm` | Phase 0: Design exploration — problem definition, approach comparison (skip-able) |
| `/deep-research` | Phase 1: Codebase analysis → `research.md` |
| `/deep-plan` | Phase 2: Slice-based implementation plan → `plan.md`, auto-loop review, auto-implement on approval |
| `/deep-implement` | Phase 3: TDD-enforced slice execution with receipt collection |
| `/deep-test` | Phase 4: Receipt check → spec compliance → code quality → quality gates (auto-loop re-execution) |
| `/deep-debug` | Systematic debugging: investigate → analyze → hypothesize → fix (auto-triggers on failures) |
| `/deep-slice` | Slice dashboard, manual activation, spike mode, reset |
| `/deep-receipt` | Receipt dashboard, per-slice view, export (JSON/Markdown) |
| `/drift-check` | Verify implementation matches the approved plan (standalone or built-in gate) |
| `/solid-review` | SOLID design principles review (standalone or advisory gate) |
| `/deep-insight` | Code metrics, complexity, dependency analysis (standalone or insight gate) |
| `/deep-report` | Generate or view session report |
| `/deep-status` | Current status, progress, phase durations, session history |
| `/deep-resume` | Resume an active session — restores context and continues from current phase |
| `/deep-finish` | Finish a session — merge, PR, keep, or discard the branch (v4.1) |
| `/deep-assumptions` | Assumption health report, history timeline, badge export, JSONL rebuild (v5.0) |
| `/deep-history` | View cross-session trends — model usage, TDD compliance, cost tracking (v4.1) |
| `/deep-cleanup` | Clean up stale deep-work worktrees (v4.1) |

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
- `/deep-review` — Manually trigger review on current phase document
- `/deep-review --adversarial` — Run only adversarial cross-model review

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

## Installation (v3.3.3)

Add the marketplace to your Claude Code settings:

```json
// ~/.claude/settings.json
{
  "extraKnownMarketplaces": {
    "claude-deep-work": {
      "source": {
        "source": "git",
        "url": "https://github.com/Sungmin-Cho/claude-deep-work.git"
      }
    }
  }
}
```

Then install:

```bash
claude plugin install deep-work
```

### Other Installation Methods

#### npm

```bash
npm install @claude-deep-work/deep-work
```

#### Local (development)

Clone this repository to `~/.claude/plugins/deep-work/`.
Claude Code will automatically detect the plugin.

## License

MIT
