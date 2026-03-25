# Deep Work — Claude Code Plugin

**Stop Claude from coding before it thinks.**

> AI coding tools are powerful but reckless — they skip analysis, ignore existing patterns, and start writing code before understanding the codebase. Deep Work fixes this with an **Evidence-Driven Development Protocol** — a **Brainstorm → Research → Plan → Implement → Test** pipeline where every code change must carry proof: failing test, passing test, spec compliance check, and code review receipt.

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

  🧠 Brainstorm ─→ 📖 Research ─→ 📋 Plan ─→ 🔨 Implement ─→ 🧪 Test
     │                │              │            │                │
  Why before       Analyze code   You review   TDD enforced     Receipt +
  how (skip-able)  6 areas deep   & approve    per slice        2-stage review
     │                │              │            │                │
  🔒 Edits         🔒 Edits       🔒 Edits    ✅ Edits         🔒 Edits
     BLOCKED          BLOCKED        BLOCKED    (with receipt)     BLOCKED
```

**One command to start. Evidence-driven all the way through.**

## Key Features

- **Evidence-Driven Protocol** — Every code change carries a JSON receipt: failing test, passing test, git diff, spec compliance, code review
- **TDD Enforcement** — Hook-enforced state machine blocks production code edits until a failing test exists (strict/relaxed/coaching/spike modes)
- **Bash Monitoring** — PreToolUse hook also intercepts `echo >`, `sed -i`, `cp`, `tee` — no file-write bypass via shell
- **Slice-Based Execution** — Plan tasks are "slices" with per-slice TDD cycles, spec checklists, and receipts
- **2-Stage Code Review** — Spec Compliance (required) + Code Quality (advisory) via subagents
- **Systematic Debugging** — 4-phase root-cause investigation, auto-triggers on unexpected failures (`/deep-debug`)
- **Phase 0 Brainstorm** — Optional "why before how" design exploration (`/deep-brainstorm`, skip-able)
- **Phase Guard** — Code edits physically blocked via PreToolUse hook during non-implementation phases
- **3-Tier Quality Gates** — Required (blocking), Advisory (warning), Insight (informational)
- **Receipt Dashboard** — ASCII progress visualization per slice (`/deep-slice`, `/deep-receipt`)
- **Auto-Update Check** — Git-based update detection on session start with auto-upgrade option
- **Model Auto-Routing** — Assigns optimal models per phase **and per slice** (S→haiku, M→sonnet, L→sonnet, XL→opus) — **30-40% token savings**
- **Worktree Isolation** — Sessions run in isolated git worktrees by default — main branch stays clean
- **Session Lifecycle** — `/deep-finish` with 4 completion options (merge/PR/keep/discard) + `session-receipt.json`
- **CI/CD Receipt Validation** — `validate-receipt.sh` + GitHub Actions template for automated receipt chain checks
- **Session History** — `/deep-history` cross-session trends: model usage, TDD compliance, cost tracking
- **Solo & Team Modes** — Single agent or parallel agent teams with cross-review
- **Adversarial Multi-Model Review** — codex/gemini independently review plan documents; conflicts shown transparently (`/deep-review`)
- **Structural Review** — All phase documents reviewed by haiku subagent with phase-specific dimensions
- **Review Gate** — Low review scores or critical consensus issues block auto-implement

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
| `/deep-work <task>` | Init | Start session, configure options, update check |
| `/deep-brainstorm` | 0 | Design exploration: problem → approaches → spec (skip-able) |
| `/deep-research` | 1 | Analyze codebase → `research.md` |
| `/deep-plan` | 2 | Create slice-based plan → `plan.md` → approve → auto-implement |
| `/deep-test` | 4 | Verify → receipt check → spec review → quality gates |
| `/deep-debug` | 3* | Systematic debugging: investigate → analyze → hypothesize → fix |
| `/deep-slice` | 3* | Slice dashboard, activation, spike mode |
| `/deep-receipt` | — | Receipt dashboard, view, export (JSON/MD/CI) |
| `/deep-finish` | End | Finish session: merge, PR, keep, or discard (v4.1) |
| `/deep-history` | — | Cross-session trends: models, TDD, cost (v4.1) |
| `/deep-cleanup` | — | Clean up stale worktrees (v4.1) |
| `/deep-review` | — | Manual structural/adversarial review trigger (v4.2) |
| `/deep-resume` | — | Resume active session with worktree restore |
| `/drift-check` | — | Plan-vs-implementation alignment check |
| `/solid-review` | — | SOLID design principles review |
| `/deep-status` | — | Progress, timing, session history |
| `/deep-report` | — | Full session report |

## Documentation

Full documentation with all configuration options:

- **[English Documentation](./plugins/deep-work/README.md)**
- **[한국어 문서](./plugins/deep-work/README.ko.md)**
- [Changelog](./plugins/deep-work/CHANGELOG.md) | [변경 이력](./plugins/deep-work/CHANGELOG.ko.md)

## License

MIT
