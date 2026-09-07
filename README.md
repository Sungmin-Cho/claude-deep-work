**English** | [한국어](./README.ko.md)

# deep-work

[![version](https://img.shields.io/github/package-json/v/Sungmin-Cho/deep-work?label=version)](https://github.com/Sungmin-Cho/deep-work)
[![license](https://img.shields.io/github/license/Sungmin-Cho/deep-work)](./LICENSE)
[![part of deep-suite](https://img.shields.io/badge/part%20of-deep--suite-5b8def)](https://github.com/Sungmin-Cho/deep-suite)

An evidence-driven workflow for Claude Code and Codex that keeps the goal, accepted changes, verification and completion durable across interruptions. The current model works inline by default; explicit model, effort and methodology choices are preserved.

Fresh adaptive plans choose strict TDD or outcome verification per slice. Documentation/configuration and other suitable work can use positive checks plus meaningful counterexamples. Strict-required work retains genuine RED/proof/GREEN. The agent continues reasoning and can adapt local details within the approved contract; material changes trigger an evidence-bound replan.

## Install

Via the `claude-deep-suite` marketplace (recommended):

```bash
/plugin marketplace add Sungmin-Cho/deep-suite
/plugin install deep-work@claude-deep-suite
```

Standalone, from this repository:

```bash
/plugin marketplace add Sungmin-Cho/deep-work
/plugin install deep-work@Sungmin-Cho-deep-work
```

deep-work runs in both the Claude Code and Codex plugin runtimes — each reads its native manifest, and skill callers use the same skill-native invocation model.

> **Windows**: hook scripts require `bash` in PATH (Git for Windows or WSL).

## Usage

Start with one skill invocation. Existing authorization carries across internal phases; request `--interactive-gates` when you want phase conversations. `--autonomous` is an internal continuation preference, not permission for external actions.

```bash
# Run the full auto-flow: Brainstorm → Research → Spec → Plan → Implement → Test → Integrate → Report
$deep-work:deep-work "Implement JWT-based user authentication"

# Unified status — flags route to the same implementations as the standalone skills
$deep-work:deep-status              # current progress
$deep-work:deep-status --report     # session report
$deep-work:deep-status --receipts   # receipt dashboard
$deep-work:deep-status --history    # cross-session trends
$deep-work:deep-status --assumptions # assumption health
$deep-work:deep-status --all        # everything at once
$deep-work:deep-status --compare    # compare two sessions
```

In Claude Code the same surfaces are also available as slash commands (e.g. typing the command name); in Codex and other hosts use the `$deep-work:<verb>` skill form.

## Skills

deep-work exposes 27 command-equivalent skills. The most-used are:

| Skill | Description |
|---|---|
| `$deep-work:deep-work <task>` | Auto-flow orchestration — runs the entire pipeline; continues authorized internal work across phases |
| `$deep-work:deep-research` | Phase 1 (Research) — deep codebase analysis |
| `$deep-work:deep-spec` | Phase 2 (Spec) — executable requirements, failure modes, and evidence gates |
| `$deep-work:deep-plan` | Phase 3 (Plan) — slice-based implementation planning |
| `$deep-work:deep-implement` | Phase 4 (Implement) — strict or outcome slice execution |
| `$deep-work:deep-test` | Phase 5 (Test) — receipt + spec + quality gates; auto-runs drift-check, SOLID review, insight |
| `$deep-work:deep-integrate` | Phase 6 (Integrate) — cross-plugin next-step recommendation loop |
| `$deep-work:deep-status` | Unified view (`--report` / `--receipts` / `--history` / `--assumptions` / `--all` / `--compare`) |
| `$deep-work:deep-finish` | Close a session — merge, PR, keep, or discard the worktree |
| `$deep-work:deep-debug` | Systematic debugging: investigate → analyze → hypothesize → fix |

Other skills cover quality gates (`drift-check`, `solid-review`, `deep-insight`), session utilities (`deep-fork`, `deep-resume`, `deep-cleanup`, `deep-slice`), and toolchain helpers (`deep-mutation-test`, `deep-sensor-scan`, `deep-phase-review`), plus the read-only status sub-skills (`deep-report`, `deep-receipt`, `deep-history`, `deep-assumptions`). All can be invoked manually; many also run automatically inside the auto-flow.

## The workflow

| Phase | Role |
|---|---|
| **0 — Brainstorm** | Optional design exploration, "why before how" (skip with `--skip-brainstorm`) |
| **1 — Research** | Deep codebase analysis across architecture, patterns, data, API, infra, and risks; output `research.md` |
| **2 — Spec** | Executable requirements, invariants, failure modes, compatibility, and evidence gates; output `spec.md` |
| **3 — Plan** | Slice-based plan with per-slice execution basis and acceptance contracts; output `plan.md` |
| **4 — Implement** | strict or outcome slice execution: failing test → production code → receipt |
| **5 — Test** | Receipt completeness, spec compliance, code quality, and verification evidence, with up to 3 implement→test retries |
| **6 — Integrate** | Skippable loop that reads deep-suite plugin artifacts and proposes up to 3 next steps (skip with `--skip-integrate`) |

The runtime owns phase transitions, approvals, scoped writes and receipts. Low-risk work can use a compact Spec without a separate approval conversation. Draft Spec and Plan together for one exact independent source review; the compiler derives mechanical bindings, and the same qualifying approval can be consumed by both phases. Required checks and reviews remain evidence-bound. Hook enforcement restricts writes to the active slice; one session has one active write window.

## Output Files

All session artifacts live in `.deep-work/<session-id>/`:

| File | Created | Description |
|---|---|---|
| `research.md` | Phase 1 | Codebase analysis (Executive Summary first) |
| `spec.md` | Phase 2 | Executable requirements, failure modes, and evidence-gate contract |
| `plan.md` | Phase 3 | Implementation plan (per-slice contract + acceptance fields) |
| `plan.v{N}.md` / `plan-diff.md` | Plan rewrite | Previous plan backup / structural change comparison |
| `brainstorm.md` | Phase 0 | Problem definition, approach comparison, success criteria |
| `receipts/SLICE-NNN.json` | Phase 3 | Per-slice evidence: TDD output, git diff, spec check, review, model |
| `file-changes.log` | Phase 3 | Auto-tracked file modifications with slice mapping |
| `test-results.md` | Phase 4 | Verification results (cumulative per attempt) |
| `quality-gates.md` / `drift-report.md` / `solid-review.md` / `insight-report.md` | Phase 4 | Quality gate, plan-alignment, SOLID, and metrics reports |
| `report.md` | Session complete | Full session report incl. phase durations |
| `session-receipt.json` | Session finish | Cross-slice session summary (M3 envelope) |
| `debug-log/RC-NNN.md` | Phase 3 (debug) | Root-cause analysis notes |
| `harness-history/harness-sessions.jsonl` | Session end | Per-session assumption-engine data |

Session state is stored as YAML frontmatter in `.claude/deep-work.<session-id>.md` (current phase, work dir, TDD state, model routing, worktree info, quality gates, health report, and more).

## Hooks

Hooks manage the session lifecycle and computational enforcement.

| Hook | Trigger | Purpose |
|---|---|---|
| SessionStart (`update-check.sh`) | startup/resume | Git-based version update check |
| PreToolUse (`phase-guard.sh`) | Write/Edit/MultiEdit/Bash | Phase-based edit blocking + P0 Worktree Path Guard + non-implement dangerous-command denylist |
| PostToolUse (`file-tracker.sh`) | Write/Edit/MultiEdit/Bash | Observational tracking; governed receipts remain runtime-owned |
| PostToolUse (`sensor-trigger.js`) | Write/Edit/MultiEdit/Bash | Triggers the computational sensor pipeline (lint, typecheck, review-check) |
| PostToolUse (`phase-transition.sh`) | Write/Edit/MultiEdit | P1 Phase Transition Injector — injects worktree/team/cross-model context on phase change |
| Stop (`session-end.sh`) | CLI session end | Active-session reminder, worktree info, phase-cache cleanup |

The denylist covers recursive rm, npm publish, selected destructive kubectl/SQL commands and curl/wget piped to sh/bash. Its documented omissions and per-family overrides are in [AGENTS.md](AGENTS.md). It is not a general shell sandbox.

## Verification and compatibility

- Strict TAP policy supports exact Node patches 22.23.2, 24.20.0, 26.0.0 and 26.8.1. Historical policy identities remain unchanged. An unsupported runtime is explicit, never a fabricated pass.
- Outcome program checks support a bounded registered Node/Python grammar and closed non-secret environment. Trusted verifier code is not a malware sandbox; arbitrary runners/lifecycle recipes remain unsupported.
- New raw receipts live in `runtime-receipts/`; public M3 views in `receipts/`. New payload registry version1.1 uses envelope format1.0. Historical1.0/V2 records keep their compatibility path. A release aggregate has its own completion basis and authenticates every child.
- Finish records effects and recovers missing verification/publication without repeating PR/merge/discard. Park/restore/downgrade-check preserves incompatible artifacts without calling a parked task complete.
- Metric version2 measures test results and machine trace (35% each), sensors and mutation (15% each). Unknown applicable evidence yields null; goal acceptance is separate. Comparative claims require matched task/model/environment/metric evidence.

## Evaluation and integrations

The [harness evaluation bank](evals/harness/README.md) defines deterministic runtime cases and a frozen12-attempt live smoke protocol. Reliability tests and a small smoke pilot do not establish general efficacy or a model ranking.

Sibling deep-review, deep-wiki and deep-memory capabilities may be used when relevant and authorized. Optional suggestions do not interrupt an already requested Finish chain or grant external/memory-write permission. Existing M3 identity guards and provenance apply to imported data.

## Links

- [CHANGELOG](CHANGELOG.md) — release history
- [deep-suite](https://github.com/Sungmin-Cho/deep-suite) — the marketplace and sibling plugins
- [CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md)

## License

MIT
