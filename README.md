# Deep Work — Claude Code Plugin

**Stop Claude from coding before it thinks.**

> AI coding tools are powerful but reckless — they skip analysis, ignore existing patterns, and start writing code before understanding the codebase. Deep Work fixes this with an **Evidence-Driven Development Protocol** — a single `/deep-work` command that automatically flows through **Brainstorm → Research → Plan → Implement → Test**, with plan approval as the only required interaction.

[English](./plugins/deep-work/README.md) | [한국어](./plugins/deep-work/README.ko.md)

---

## Why Deep Work?

Without structure, Claude Code will:

| Problem | What happens | Deep Work's fix |
|---------|-------------|-----------------|
| **Skips analysis** | Jumps into coding without understanding the codebase | Phase Guard **blocks code edits** during Research & Plan |
| **Ignores patterns** | Introduces new patterns instead of following existing ones | Exhaustive 6-area codebase analysis first |
| **Duplicates code** | Reimplements utilities that already exist | Documents all shared infrastructure before planning |
| **Over-engineers** | Adds unrequested "improvements" that cause bugs | Plan must be **approved by you** before any code is written |
| **No verification** | Marks work as done without testing | Auto-runs tests, lint, type-check — loops back on failure |

## How It Works (v5.2 Auto-Flow)

```
/deep-work "Add JWT authentication"

  → Brainstorm (auto) → Research (auto) → Plan (you approve) → Implement (auto) → Test (auto) → Finish

  One command. One approval. Everything else is automatic.
```

## Quick Start

```bash
# Install
claude plugin add claude-deep-work --from github.com/Sungmin-Cho/claude-deep-work

# Start a session — auto-flow handles the rest
/deep-work "your task description"

# Check status anytime
/deep-status
/deep-status --receipts    # receipt dashboard
/deep-status --history     # cross-session trends
/deep-status --report      # session report
/deep-status --assumptions # assumption health
```

## Commands

### Primary Commands (7)

| Command | What it does |
|---------|-------------|
| `/deep-work <task>` | Start session + **auto-flow orchestration** (brainstorm → research → plan → implement → test → finish) |
| `/deep-research` | Manual override: re-run research |
| `/deep-plan` | Manual override: re-run planning |
| `/deep-implement` | Manual override: re-run implementation |
| `/deep-test` | Manual override: re-run testing |
| `/deep-status` | Unified view: state, receipts, history, report, assumptions |
| `/deep-debug` | Systematic debugging during implementation |

### Deprecated Commands (13)

These run automatically in the auto-flow. Manual invocation still works.

| Command | Absorbed into |
|---------|--------------|
| `/deep-brainstorm` | `/deep-work` auto-flow first step |
| `/deep-review` | `/deep-plan` auto-execution |
| `/deep-receipt` | `/deep-status --receipts` |
| `/deep-slice` | `/deep-implement` internal |
| `/deep-insight` | `/deep-test` advisory gate |
| `/deep-finish` | `/deep-work` auto-flow last step |
| `/deep-cleanup` | `/deep-work` init auto-detect |
| `/deep-history` | `/deep-status --history` |
| `/deep-assumptions` | `/deep-status --assumptions` |
| `/deep-resume` | `/deep-work` session detection |
| `/deep-report` | `/deep-status --report` |
| `/drift-check` | `/deep-test` required gate |
| `/solid-review` | `/deep-test` advisory gate |

## Key Features

- **Auto-Flow Orchestration** — `/deep-work` chains all phases automatically; plan approval is the only gate
- **Evidence-Driven Protocol** — Every code change carries a JSON receipt: failing test, passing test, git diff, spec compliance, code review
- **TDD Enforcement** — Hook-enforced state machine (strict/relaxed/coaching/spike modes)
- **Phase Guard** — Code edits physically blocked during non-implementation phases
- **Unified Status** — `/deep-status` with `--receipts`, `--history`, `--report`, `--assumptions` flags
- **Auto-Run Test Gates** — Drift check, SOLID review, insight analysis run automatically
- **Slice-Based Execution** — Plan tasks are "slices" with per-slice TDD cycles and receipts
- **Model Auto-Routing** — Optimal models per phase and per slice complexity
- **Worktree Isolation** — Sessions run in isolated git worktrees by default
- **Solo & Team Modes** — Single agent or parallel agent teams with cross-review

## Documentation

Full documentation with all configuration options:

- **[English Documentation](./plugins/deep-work/README.md)**
- **[한국어 문서](./plugins/deep-work/README.ko.md)**
- [Changelog](./plugins/deep-work/CHANGELOG.md) | [변경 이력](./plugins/deep-work/CHANGELOG.ko.md)

## License

MIT
