**English** | [한국어](./README.md)

# Deep Work Plugin

A Claude Code plugin that enforces **strict separation of planning and coding** through a 4-phase workflow.

## The Problem

Common pitfalls when AI coding tools tackle complex tasks:
- Introducing new patterns while ignoring the existing architecture
- Reimplementing utilities that already exist
- Jumping into implementation before understanding the codebase
- Adding unrequested "improvements" that cause bugs
- Marking work as done without verification

## The Solution

The **Research → Plan → Implement → Test** workflow enforces strict separation of analysis, planning, implementation, and verification.

- **Phase 1 (Research)**: Deep analysis and documentation of the codebase
- **Phase 2 (Plan)**: Detailed implementation plan based on research, requiring user approval
- **Phase 3 (Implement)**: Mechanical execution of the approved plan (starts automatically on approval)
- **Phase 4 (Test)**: Automated tests, linting, and type-checking; falls back to implementation on failure

Code file modifications are **physically blocked** during Phases 1, 2, and 4 (via PreToolUse hook).

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
| `/deep-work <task>` | Initialize session, create task folder, select options |
| `/deep-research` | Phase 1: Codebase analysis → `research.md` |
| `/deep-plan` | Phase 2: Implementation plan → `plan.md`, auto-implement on approval |
| `/deep-implement` | Phase 3: Execute the plan (can also be run manually) |
| `/deep-test` | Phase 4: Run integration tests, return to implement on failure |
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
| `plan-diff.md` | Plan rewrite | Structural change comparison between plan versions |

## Session State

Stored as YAML frontmatter in `.claude/deep-work.local.md`:

| Field | Description |
|-------|-------------|
| `current_phase` | Current phase (research / plan / implement / test / idle) |
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
- Falls back to existing auto-detection when not defined

## Phase Guard

`hooks/scripts/phase-guard.sh` monitors Write/Edit tool calls:

| Phase | Code Changes | Doc Changes | Blocked Message |
|-------|-------------|-------------|-----------------|
| Research | ❌ Blocked | ✅ Allowed | "→ Run /deep-plan or /deep-research" |
| Plan | ❌ Blocked | ✅ Allowed | "→ Approve plan or re-run /deep-plan" |
| Implement | ✅ Allowed | ✅ Allowed | — |
| Test | ❌ Blocked | ✅ Allowed | "→ Handled automatically on pass/fail" |
| Idle | ✅ Allowed | ✅ Allowed | — |

## Session Options

Options selected when running `/deep-work`:

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

## Installation

### Option 1: GitHub Marketplace (recommended)

```bash
# Install from marketplace
claude plugin add sseocho --from github.com/Sungmin-Cho/sseocho-plugins
```

### Option 2: npm

```bash
npm install @sseocho/claude-deep-work
```

### Option 3: Local (development)

Clone this repository to `~/.claude/plugins/deep-work/`.
Claude Code will automatically detect the plugin.

## License

MIT
