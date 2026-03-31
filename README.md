# Deep Work — Claude Code Plugin

**Stop Claude from coding before it thinks.**

<!-- Badges (populated after sessions) -->
<!-- ![Deep Work Quality](https://img.shields.io/badge/deep--work-quality-lightgrey) -->
<!-- ![Sessions](https://img.shields.io/badge/sessions-0-blue) -->

## Quick Start

```bash
# Install
claude plugin add claude-deep-work --from github.com/Sungmin-Cho/claude-deep-work

# Start — one command, one approval, everything else is automatic
/deep-work "Add JWT authentication"
```

## The Problem

AI coding tools are powerful but reckless:

| Without structure | With Deep Work |
|---|---|
| Jumps into coding without reading the codebase | Phase Guard **blocks code edits** until research + plan are done |
| Introduces patterns that clash with existing code | Exhaustive 6-area codebase analysis first |
| Reimplements utilities that already exist | Documents all shared infrastructure before planning |
| Adds unrequested "improvements" that cause bugs | Plan must be **approved by you** before any code |
| Marks work done without proper testing | Auto-runs tests, lint, type-check — loops back on failure |

## How It Works

```
/deep-work "your task"

→ Brainstorm (auto) → Research (auto) → Plan (you approve) → Implement (auto) → Test (auto)

One command. One approval. Everything else is automatic.
```

## What Makes Deep Work Different

- **Hook-enforced gates** — Not prompt suggestions. Physical code-edit blocking via PreToolUse hooks.
- **Self-evolving rules** — The Assumption Engine tracks whether each rule actually improves your outcomes, and suggests adjustments based on evidence.
- **Quality measurement** — Every session produces a quality score (test pass rate, rework cycles, plan fidelity). Track your trend over time.
- **Evidence trail** — JSON receipts for every code change. Full audit trail from requirement to test.

## Commands

| Command | What it does |
|---|---|
| `/deep-work <task>` | Start session — auto-flow handles everything |
| `/deep-status` | Current state, quality trends (`--history`), badges (`--badge`) |
| `/deep-research` | Manual override: re-run research |
| `/deep-plan` | Manual override: re-run planning |
| `/deep-implement` | Manual override: re-run implementation |
| `/deep-test` | Manual override: re-run testing |
| `/deep-debug` | Systematic debugging during implementation |

## Documentation

- **[English](./plugins/deep-work/README.md)** | **[한국어](./plugins/deep-work/README.ko.md)**
- [Changelog](./plugins/deep-work/CHANGELOG.md)

## License

MIT
