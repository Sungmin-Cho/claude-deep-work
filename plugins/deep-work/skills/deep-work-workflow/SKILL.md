---
name: deep-work-workflow
version: "4.0.0"
description: |
  This skill should be used when the user wants to follow an evidence-driven development
  protocol with TDD enforcement, slice-based execution, and receipt-based evidence collection.
  It applies when users say things like "deep work", "plan before code", "기획과 코딩 분리",
  "분석 후 구현", "TDD", "test-driven", "evidence-driven", "receipt", "영수증",
  "slice", "brainstorm", "브레인스톰", "제로베이스", "from scratch", "quality gate",
  "SOLID review", "drift check", "deep-insight", "코드 메트릭", "preset", "프리셋",
  "resume session", "세션 재개", "이어서", "프로필", "빠른 시작", "debug mode",
  "systematic debugging", "코드 리뷰", "spec compliance",
  or when the user describes a complex, multi-file task that would benefit from
  structured planning before implementation.
---

# Deep Work Workflow: Brainstorm → Research → Plan → Implement → Test

## v4.0 Evidence-Driven Development Protocol

v4.0 introduces the **Evidence-Driven Protocol** — every code change must carry proof:
- **Slice-based execution**: Plan tasks are "slices" with TDD cycles and spec checklists
- **TDD enforcement**: Failing test required before production code (hook-enforced)
- **Receipt system**: JSON evidence collected per slice (test output, git diff, spec check)
- **Bash monitoring**: File-writing shell commands are also blocked during non-implement phases
- **2-stage code review**: Spec compliance + code quality review in test phase
- **Systematic debugging**: Root-cause investigation before fixes (/deep-debug)
- **Phase 0 Brainstorm**: Optional design exploration before research (/deep-brainstorm)

## Why This Workflow Exists

When AI coding tools work on complex tasks without structure, common failure modes emerge:

1. **Architecture Ignorance**: AI generates code that doesn't follow existing patterns
2. **Duplicate Implementation**: AI creates new utilities when equivalent ones already exist
3. **Premature Coding**: AI starts writing code before understanding the full picture
4. **Scope Creep**: AI adds "improvements" not requested, introducing bugs
5. **Inconsistency**: AI uses different conventions than the rest of the codebase

The Deep Work workflow prevents these by **strictly separating analysis, planning, coding, and testing** into four distinct phases with enforced gates between them.

## The Four Phases

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

### Plan Alignment Check (`/drift-check`)

**Goal**: Verify implementation matches the approved plan.

**What happens**:
- Compares plan.md items with actual git diff
- Reports: implemented, missing, out-of-scope, design drift
- Saves results to `$WORK_DIR/drift-report.md`

**Built-in behavior**: Automatically runs as a Required gate during `/deep-test` when plan.md exists. No need to add to Quality Gates table.

**Dual mode**:
- **Standalone**: `/drift-check [plan-file]` — works without an active deep-work session
- **Workflow**: Built-in Required gate in the Test phase (auto-runs before other gates)

**Key principle**: "When the plan becomes the verification standard, you write plans more carefully."

### SOLID Design Review (`/solid-review`)

**Goal**: Evaluate code against the 5 SOLID design principles.

**What happens**:
- Analyzes target code for SRP, OCP, LSP, ISP, DIP compliance
- Generates a scorecard with per-principle status
- Provides concrete refactoring suggestions
- Saves results to `$WORK_DIR/solid-review.md` (workflow mode) or outputs to terminal (standalone)

**Dual mode**:
- **Standalone**: `/solid-review [target]` — works without an active deep-work session
- **Workflow**: Integrates as an Advisory Quality Gate in the Test phase

**Key principle**: "Working code is not enough. Well-designed code is what survives change."

For detailed guidance, see [SOLID Guide](references/solid-guide.md) or [SOLID Prompt Guide](references/solid-prompt-guide.md).

### Code Insight Analysis (`/deep-insight`)

**Goal**: Provide informational code metrics without blocking workflow.

**What happens**:
- Measures file metrics (lines, functions, exports)
- Analyzes complexity indicators (nesting depth, long functions, large files)
- Builds dependency graph (circular references, hub files, import depth)
- Records change summary from PostToolUse file tracking
- Saves results to `$WORK_DIR/insight-report.md`

**Built-in behavior**: Automatically runs as an Insight gate during `/deep-test` after Required and Advisory gates. Never blocks workflow.

**Dual mode**:
- **Standalone**: `/deep-insight [target]` — works without an active deep-work session
- **Workflow**: Built-in Insight gate in the Test phase (auto-runs after other gates)

**Key principle**: "Numbers don't judge. They illuminate what words might miss."

For detailed guidance, see [Insight Guide](references/insight-guide.md).

### Session Report (`/deep-report`)

**Goal**: Generate or view a comprehensive report of the entire session.

**What happens**:
- Summarizes research findings, planning decisions, implementation results, and test outcomes
- Documents files changed, verification results, and issues encountered
- **Includes phase duration tracking** — time spent in each phase
- Saved as `$WORK_DIR/report.md`

**When it runs**:
- Automatically after all tests pass
- Manually via `/deep-report` at any time (can regenerate with current state)

## Phase Enforcement

Hooks enforce phase boundaries and track activity:

- **PreToolUse** (`phase-guard.sh`): During Research, Plan, and Test phases — Write/Edit tools are blocked for all files except `$WORK_DIR/` documents and the state file. During Implement — all tools available. No session — no restrictions.
- **PostToolUse** (`file-tracker.sh`): During Implement phase — automatically logs modified file paths to `$WORK_DIR/file-changes.log` with timestamps. Used by `/deep-report` and `/deep-insight`.
- **Stop** (`session-end.sh`): On CLI session end — if a deep-work session is active, outputs a reminder message and sends notification via configured channels.

This is not a suggestion — it's a hard gate. The AI literally cannot modify code files until the plan is approved, and cannot modify code during testing.

## Quick Start

```
/deep-work "Add user authentication with JWT tokens"   # Initialize session
/deep-research                                          # Phase 1: Analyze codebase
# Review $WORK_DIR/research.md
/deep-plan                                              # Phase 2: Create plan
# Review plan, give chat feedback, iterate
# Type "승인" when satisfied → Implementation starts automatically
# → Phase 3 runs automatically
# → Phase 4 (Test) runs automatically
# → Report generated on success
/deep-report                                            # View or regenerate report
/deep-status                                            # Check status and history
/deep-status --compare                                  # Compare two sessions
/deep-resume                                            # Resume interrupted session
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

On the first `/deep-work` run, you answer setup questions (mode, model routing, notifications, etc.) as usual. Your answers are automatically saved to `.claude/deep-work-profile.yaml` as the `default` preset. On subsequent runs, the profile is loaded and **all setup questions are skipped** — you only provide the task description.

**Multi-preset support (v3.3.3)**: Create named presets for different work styles (e.g., `dev`, `quick`, `review`). When multiple presets exist, you'll be asked to choose one at session start. All presets are stored in a single YAML file.

**Flags** override profile values for a single session:
- `/deep-work --profile=quick "task"` — use a specific preset
- `/deep-work --team "task"` — use Team mode this time
- `/deep-work --zero-base "task"` — zero-base project this time
- `/deep-work --skip-research "task"` — skip to Plan phase
- `/deep-work --no-branch "task"` — no git branch this time
- `/deep-work --setup` — manage presets (create, edit)

## Session Resume (`/deep-resume`)

Resume an interrupted deep-work session. Detects the active session, restores AI context from artifacts (research.md, plan.md, test-results.md), and auto-continues from the current phase.

**What it restores**:
- Phase state and progress (which tasks are done, which remain)
- Research findings (Executive Summary only — keeps token usage low)
- Plan content (full plan.md for implement phase)
- Test failure details (for retry attempts)

**Usage**: Simply run `/deep-resume` in a new CLI session. No arguments needed.

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

Deep Work and Claude's built-in plan mode serve different purposes and can work together:

- **Built-in plan mode**: Lightweight, good for quick task decomposition and initial design review
- **Deep Work**: Heavyweight, enforces strict phase gates with documentation artifacts, automated testing, and session persistence

**Combined usage pattern**: Use built-in plan mode for initial task decomposition, then Deep Work for complex subtasks that need thorough research and planning before implementation.

## Internationalization

All commands detect the user's language from their messages or Claude Code's `language` setting, and output messages in that language. Command templates use Korean as the reference format; Claude translates naturally to the user's language while preserving emoji, formatting, and structure.

## v3.3.0 Features

### Insight Tier Quality Gate
Third and final tier of the 3-tier Quality Gate system. Provides code metrics and analysis without blocking workflow.
- `/deep-insight` command with standalone/workflow dual mode
- Built-in: file metrics, complexity indicators, dependency graph, change summary
- Custom: user-defined ℹ️ gates in plan.md Quality Gates table
- Results saved to `$WORK_DIR/insight-report.md`

### PostToolUse File Tracking
Automatic tracking of file modifications during Implement phase.
- PostToolUse hook logs every Write/Edit/MultiEdit to `$WORK_DIR/file-changes.log`
- Used by `/deep-report` for accurate file change counts
- Used by `/deep-insight` for change summary analysis

### Stop Hook — Session End Handler
Automatic session status check and notification on CLI session end.
- Reminds about active sessions when closing CLI
- Sends notification via configured channels (Slack, Discord, Telegram, etc.)
- Non-blocking — never prevents session close

## v3.3.2 Features

### Profile System
Automatic profile save/load for zero-question session initialization.
- First run saves setup answers to `.claude/deep-work-profile.yaml`
- Subsequent runs skip all questions, apply profile instantly
- Override flags: `--team`, `--zero-base`, `--skip-research`, `--no-branch`
- Re-setup: `/deep-work --setup`

### Session Resume
`/deep-resume` command for interrupted session continuation.
- Auto-detects active session and current phase
- Restores AI context from artifacts (research.md, plan.md, test-results.md)
- Auto-continues from current phase with full checkpoint support
- Implement phase uses checkpoint-based resume (bypasses model routing re-delegation)

### Checkpoint Verification
Post-agent implementation verification using `git diff` cross-reference.
- Detects unmarked completed tasks and auto-corrects plan.md
- Primary verification via `git diff`, secondary via `file-changes.log` when available

## v3.3.3 Features

### Multi-Preset Profile System
Named presets for different work styles — quick setup, review-focused, etc.
- Profile v2 format with `presets:` key (single YAML file)
- Auto-migration from v1 (existing single profile → `default` preset)
- `/deep-work --setup` for preset management (create, edit)
- `/deep-work --profile=X "task"` for direct preset selection
- Interactive preset selection via AskUserQuestion when multiple presets exist

### Trigger Evaluation Optimization
Expanded test cases and refined description for better trigger accuracy.
- trigger-eval.json expanded from 20 to 31+ queries
- Description keywords optimized (reduced false positives)
- Coverage for v3.3.2 features (profile, resume, checkpoint, preset)

## Compatibility & Requirements

- **Solo mode**: Works with standard Claude Code installation
- **Team mode**: Requires Agent Teams feature (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)
- **Phase enforcement**: Requires PreToolUse hook support
- **File tracking**: Requires PostToolUse hook support
- **Session end handler**: Requires Stop hook support

For previous version features (v3.1 Model Routing, Notifications, Incremental Research, Quality Gates, Plan Diff; v3.2 3-Tier Quality Gates, Drift Detection, SOLID Review), see the [CHANGELOG](../../CHANGELOG.md).
