# Deep Work — Claude Code Plugin

**Stop Claude from coding before it thinks.**

> AI coding tools are powerful but reckless — they skip analysis, ignore existing patterns, and start writing code before understanding the codebase. Deep Work fixes this by enforcing a **Research → Plan → Implement → Test** pipeline where code edits are *physically blocked* until the plan is approved.

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

## How It Works

```
/deep-work "Add JWT authentication"

  📖 Research ──→ 📋 Plan ──→ 🔨 Implement ──→ 🧪 Test
     │               │             │                │
  Analyze code    You review    Follows plan     Auto-verify
  6 areas deep    & approve     exactly          lint/test/types
     │               │             │                │
  🔒 Code edits   🔒 Code edits  ✅ Edits        🔒 Code edits
     BLOCKED         BLOCKED      ALLOWED           BLOCKED
```

**One command to start. One word ("approve") to ship.**

## Key Features

- **Phase Guard** — Code edits physically blocked via PreToolUse hook during non-implementation phases
- **Model Routing** — Assigns optimal models per phase (sonnet for research, haiku for tests) — **30-40% token savings**
- **Quality Gates** — Define required/advisory checks in your plan (coverage thresholds, bundle size limits)
- **Incremental Research** — `--incremental` flag re-analyzes only git-changed areas — **60-80% time savings**
- **Multi-Channel Notifications** — Get notified on Slack, Discord, Telegram, or any webhook when phases complete
- **Solo & Team Modes** — Single agent or parallel agent teams with cross-review
- **Greenfield Support** — Zero-base mode for designing new projects from scratch

## Quick Start

```bash
# Install
claude plugin add claude-deep-work --from github.com/Sungmin-Cho/claude-deep-work

# Start a session
/deep-work "your task description"

# That's it — follow the prompts
```

## Commands

| Command | Phase | What it does |
|---------|-------|-------------|
| `/deep-work <task>` | Init | Start session, configure options |
| `/deep-research` | 1 | Analyze codebase → `research.md` |
| `/deep-plan` | 2 | Create plan → `plan.md` → approve → auto-implement |
| `/deep-test` | 4 | Verify → pass or loop back to fix |
| `/deep-status` | — | Progress, timing, session history |
| `/deep-report` | — | Full session report |

## Documentation

Full documentation with all configuration options:

- **[English Documentation](./plugins/deep-work/README.md)**
- **[한국어 문서](./plugins/deep-work/README.ko.md)**
- [Changelog](./plugins/deep-work/CHANGELOG.md) | [변경 이력](./plugins/deep-work/CHANGELOG.ko.md)

## License

MIT
