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
| `/deep-work <task>` | Initialize session, select preset, configure TDD mode, update check |
| `/deep-brainstorm` | Phase 0: Design exploration — problem definition, approach comparison (skip-able) |
| `/deep-research` | Phase 1: Codebase analysis → `research.md` |
| `/deep-plan` | Phase 2: Slice-based implementation plan → `plan.md`, auto-implement on approval |
| `/deep-implement` | Phase 3: TDD-enforced slice execution with receipt collection |
| `/deep-test` | Phase 4: Receipt check → spec compliance → code quality → quality gates |
| `/deep-debug` | Systematic debugging: investigate → analyze → hypothesize → fix (auto-triggers on failures) |
| `/deep-slice` | Slice dashboard, manual activation, spike mode, reset |
| `/deep-receipt` | Receipt dashboard, per-slice view, export (JSON/Markdown) |
| `/drift-check` | Verify implementation matches the approved plan (standalone or built-in gate) |
| `/solid-review` | SOLID design principles review (standalone or advisory gate) |
| `/deep-insight` | Code metrics, complexity, dependency analysis (standalone or insight gate) |
| `/deep-report` | Generate or view session report |
| `/deep-status` | Current status, progress, phase durations, session history |

## Output Files

All session artifacts are stored in `deep-work/<task-folder>/`:

| File | Created | Description |
|------|---------|-------------|
| `research.md` | Phase 1 complete | Codebase analysis results (Executive Summary first) |
| `plan.md` | Phase 2 complete | Detailed implementation plan (Plan Summary first) |
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
| `receipts/SLICE-NNN.json` | Phase 3 ongoing | Per-slice evidence: TDD output, git diff, spec check, review |
| `debug-log/RC-NNN.md` | Phase 3 (debug) | Root cause analysis notes from systematic debugging |

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
| `debug_mode` | Whether systematic debugging is active |
| `brainstorm_started_at`, `brainstorm_completed_at` | Phase 0 timestamps |

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

### Phase 3: Implement

Mechanically executes the approved plan:

- Executes checklist tasks one by one in order
- Marks each task complete (`- [x]`) after execution
- Stops immediately on issues and documents them (no ad-hoc fixes)
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

### Model Routing (v3.1)

Assigns the optimal model per phase, reducing token costs by 30-40%:

| Phase | Default Model | Method | Rationale |
|-------|--------------|--------|-----------|
| Research | sonnet | Agent delegation | Sufficient for exploration/analysis |
| Plan | Main session | Direct execution | Requires interactive feedback |
| Implement | sonnet | Agent delegation | Sufficient for code writing |
| Test | haiku | Agent delegation | Only runs tests |

Customizable during `/deep-work` initialization (choose from sonnet, haiku, opus).

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
| PreToolUse | `phase-guard.sh` | Write/Edit/MultiEdit | Blocks code edits during research/plan/test phases |
| PostToolUse | `file-tracker.sh` | Write/Edit/MultiEdit | Tracks file modifications during implement phase |
| Stop | `session-end.sh` | CLI session end | Reminds about active sessions, sends notifications |

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
