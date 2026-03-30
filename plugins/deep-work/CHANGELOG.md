**English** | [한국어](./CHANGELOG.ko.md)

# Changelog

All notable changes to the Deep Work plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] - 2026-03-30

### Added
- **Self-Evolving Harness (Assumption Engine)**: Every enforcement rule is now a falsifiable hypothesis with machine-readable evidence signals. deep-work studies its own assumptions using session data.
- **`assumptions.json`**: Registry of 5 core assumptions (phase_guard, tdd, research, cross_model_review, receipt_collection) with evidence signals, adjustable enforcement levels, and minimum session thresholds.
- **`assumption-engine.js`**: Core analysis module with Wilson Score confidence, model-aware splitting, staleness detection, new model detection, per-slice signal evaluation, report generation, ASCII timeline, and shields.io badge export. 42 unit tests.
- **`/deep-assumptions` command**: Report (default + --verbose), history (ASCII timeline), export (--format=badge), and --rebuild (regenerate JSONL from receipts).
- **`harness_metadata` in receipts**: Per-slice metadata (model_id, assumption_overrides, rework_count, tests_passed_first_try, bugs_caught_in_red_phase, review_defects_found, research_references_used, cross_model_unique_findings). Backward-compatible.
- **Session history JSONL**: `harness-sessions.jsonl` appended at session termination via Stop hook. Per-slice data, session dedupe, cross-platform date math. Disk error handling (stderr log, never blocks).
- **Health summary on session init**: `/deep-work` shows assumption health if sufficient history exists. New model detection with cold start warning.
- **Assumption Health in reports**: `/deep-report` includes assumption confidence table and per-session harness metadata aggregation.

## [4.2.1] - 2026-03-26

### Added
- **TDD Override**: When TDD blocks a production file edit during implementation, Claude now detects the block, explains the reason to the user, and offers an interactive choice — write the test first (recommended), or skip TDD for this slice with a recorded reason (config change, untestable code, urgent fix). Override is slice-scoped and auto-clears on slice transition.
- **Escape hatch guidance in block messages**: Both strict and coaching TDD block messages now show `/deep-slice spike` and `/deep-slice reset` as alternatives, so users know how to bypass TDD when needed.
- **`tdd_override` state field**: New state file field tracks which slice has an active TDD override. Hook reads this field for fast-path allow decisions.
- **Override in receipts**: Overridden slices are recorded with `tdd_override: true` and `tdd_override_reason` in receipt JSON. Receipt dashboard shows `override` status distinct from `spike` (merge-eligible with warning).
- 9 new unit tests for TDD override (total: 56 tests)

### Changed
- `phase-guard-core.js`: `checkTddEnforcement` accepts new `tddOverride` parameter; `processHook` passes `state.tdd_override`
- `phase-guard.sh`: Reads `tdd_override` from state file; adds fast-path for override matching active slice; passes override to Node.js
- `deep-implement.md`: New "TDD Override" section with AskUserQuestion flow (main model routing only)
- `deep-receipt.md`: Override icon, count, and JSON schema updated
- `deep-finish.md`: `tdd_compliance` includes `override` count
- `deep-history.md`: `tdd_compliance` and TDD compliance display include `override`

## [4.2.0] - 2026-03-25

### Added
- **Structural Review**: All phase documents (brainstorm, research, plan) now undergo structural review via Claude haiku subagent with phase-specific dimensions
- **Adversarial Cross-Model Review**: Plan documents are independently reviewed by codex and/or gemini-cli for architecture, assumptions, and risk coverage
- **Conflict Resolution UX**: When models disagree, conflicts are transparently shown to users who decide the resolution (accept, waiver, or manual edit)
- **Review Gate**: Structural review score <5 or critical consensus issues block auto-implement transition
- **`/deep-review` command**: Manually trigger structural or adversarial review at any time
- **`--skip-review` flag**: Skip all reviews for spike/experimental sessions
- **Cross-model tool auto-detection**: Automatically detects codex/gemini-cli at session init
- **Profile `cross_model_preference`**: Save cross-model preference (always/never/ask) in presets
- **Review state in resume/status**: `/deep-resume` recognizes review state; `/deep-status` displays review results
- **JSON Schema normalization**: All review results stored as structured JSON (`{phase}-review.json`)

### Changed
- `deep-brainstorm.md`: Spec review replaced with review-gate protocol reference
- `deep-research.md`: Added structural review after research completion
- `deep-plan.md`: Added structural + adversarial review before approval
- `phase-guard-core.js`: Added codex/gemini/mktemp to SAFE_COMMAND_PATTERNS
- State file: Added `review_state`, `cross_model_tools`, `cross_model_enabled`, `review_results` fields
- Profile: Added `cross_model_preference` to preset schema

### Fixed
- `.gitignore`: Added `deep-work-workflow-workspace/` to prevent venv from being tracked

## [4.1.0] - 2026-03-25

### Added
- **Worktree isolation**: Sessions now run in isolated git worktrees by default. `/deep-work` creates a worktree at `.worktrees/dw/<slug>/`, keeping main branch clean. Opt-out with `--no-branch` or `git_branch: false` in preset.
- **Model auto-routing by slice complexity**: Implement phase automatically selects the optimal model (haiku/sonnet/opus) based on each slice's size (S/M/L/XL). Override per-slice with `/deep-slice model SLICE-NNN <model>`. Customizable routing table in presets.
- **Session completion workflow** (`/deep-finish`): 4 explicit options at session end — merge to base branch, create PR, keep branch for later, or discard. Generates `session-receipt.json` with full session summary.
- **CI/CD receipt validation**: `validate-receipt.sh` validates receipt chain integrity. `templates/deep-work-ci.yml` provides a GitHub Actions workflow template. `/deep-receipt export --format=ci` for CI-friendly bundle export.
- **Session history dashboard** (`/deep-history`): Cross-session trends showing model usage, TDD compliance rates, completion rates, and cost tracking.
- **Worktree cleanup** (`/deep-cleanup`): Scans for stale deep-work worktrees (7+ days, no active session) and offers batch or individual cleanup.
- **Receipt schema v1.0**: New fields — `schema_version`, `model_used`, `model_auto_selected`, `worktree_branch`, `git_before`, `git_after`, `estimated_cost`. Session receipt is a derived cache; slice receipts are the canonical source of truth.
- **Receipt migration helper** (`receipt-migration.js`): Auto-converts pre-v4.1 receipts to schema v1.0 with atomic writes and corrupted file backup.
- **Worktree-aware resume** (`/deep-resume`): Detects worktree path on session resume and restores working directory context. Handles deleted worktrees gracefully.
- **Model cost tracking**: `estimated_cost` field in slice and session receipts for per-session AI model spending visibility.
- **Shell utilities extraction** (`utils.sh`): Shared functions (`find_project_root`, `normalize_path`, `read_frontmatter_field`, `init_deep_work_state`) extracted from 3 hook scripts into a single source file, eliminating code duplication.
- **Model routing tests**: 11 new unit tests for routing table lookup, model name validation, and custom table overrides (total: 48 tests across 2 test files).

### Changed
- Default `model_routing.implement` changed from `"sonnet"` to `"auto"` (size-based routing)
- Default `git_branch` in presets changed to `true` (worktree isolation enabled by default)
- `session-end.sh` now shows worktree branch info and suggests `/deep-finish` for cleanup
- `validate-receipt.sh` uses `set -eo pipefail` instead of `set -euo pipefail` for macOS Bash 3.2 compatibility

## [4.0.1] - 2026-03-25

### Added
- **Git-based auto-update check**: SessionStart hook checks GitHub for newer versions on every session start. Supports auto-update, snooze (escalating backoff: 24h→48h→1w), and opt-out. Modeled after gstack's update-check pattern.
- **Shell injection prevention**: phase-guard.sh and file-tracker.sh now pass values via `process.argv` instead of string interpolation, preventing injection from file paths containing special characters.

### Fixed
- macOS compatibility: removed `timeout` command usage (not available on macOS)
- Version consistency: CLAUDE.md and TODOS.md now reflect correct v4.0 version

## [4.0.0] - 2026-03-25

### BREAKING — Evidence-Driven Development Protocol

deep-work is now an **evidence-driven development protocol**. Every code change carries proof: failing test output, passing test output, git diff, spec compliance check, and code review — all collected as JSON receipts.

### Added
- **Phase 0: Brainstorm** (`/deep-brainstorm`): Explore "why" before "how" — problem definition, approach comparison, spec-reviewer validation. Skip with `--skip-brainstorm`.
- **Slice-based execution**: Plan tasks are now "slices" — self-contained units with TDD cycles, file scope, verification commands, and spec checklists.
- **TDD enforcement**: Hook-enforced state machine (PENDING→RED→RED_VERIFIED→GREEN_ELIGIBLE→GREEN→REFACTOR). Production code edits blocked until failing test exists. Modes: `strict`, `relaxed`, `coaching`, `spike`.
- **Receipt system**: JSON evidence per slice in `receipts/SLICE-NNN.json` — test output, git diff, lint results, spec checklist, code review.
- **Bash tool monitoring**: PreToolUse hook now intercepts Bash commands, blocking file-writing patterns (`echo >`, `sed -i`, `cp`, `tee`) during non-implement phases. Closes the bypass gap where AI could use shell redirects instead of Write/Edit.
- **Systematic debugging** (`/deep-debug`): 4-phase root-cause investigation (investigate→analyze→hypothesize→fix). Auto-triggers on unexpected test failures. Escalates after 3 failed hypotheses.
- **Slice management** (`/deep-slice`): Dashboard with ASCII progress visualization, manual activation, spike mode entry, slice reset with git stash.
- **Receipt management** (`/deep-receipt`): Dashboard view, per-slice detail, export as JSON (CI/CD) or markdown (PR descriptions).
- **2-stage code review**: Spec Compliance Review (required gate) + Code Quality Review (advisory gate) via subagents in test phase.
- **Receipt Completeness Gate**: Required gate — blocks test phase if any slice lacks a receipt.
- **Verification Evidence Gate**: Required gate — ensures actual test execution output exists.
- **TDD Coaching mode**: Guides beginners through TDD with educational messages instead of hard blocks.
- **Spike Mode Guard**: Auto-stashes spike code and resets slice on mode exit.
- **29 unit tests**: Node.js test suite for phase-guard-core.js (TDD state machine, Bash detection, slice scope, receipt validation).

### Changed
- Hook architecture: bash+Node.js hybrid — fast path in bash (~50ms), complex logic in Node.js subprocess (~200ms).
- Plan format: Task Checklist → Slice Checklist with per-slice metadata.
- `hooks.json`: Added `Bash` to PreToolUse and PostToolUse matchers.
- `phase-guard.sh`: Full rewrite as bash+Node hybrid.
- `file-tracker.sh`: Extended for receipt collection and active slice mapping.
- `deep-implement.md`: Full rewrite — slice-unit TDD execution.
- `deep-test.md`: 4 new quality gates (Receipt, Spec, Quality, Evidence).
- `deep-plan.md`: Slice format with TDD fields.
- `deep-work.md`: Phase 0 option, `--tdd=MODE` flag, `--skip-brainstorm` flag.
- `package.json`: Version 4.0.0.

## [3.3.3] - 2026-03-24

### Added
- **Multi-Preset Profile System**: Named presets for different work styles (e.g., `dev`, `quick`, `review`).
  - Profile v2 format with `presets:` key (single YAML file, multiple named presets)
  - Auto-migration from v1 to v2 (existing single profile → `default` preset)
  - `/deep-work --setup` now opens preset management UI (create, edit presets)
  - `/deep-work --profile=X "task"` for direct preset selection (skip interactive)
  - Interactive preset selection via AskUserQuestion when multiple presets exist
  - Single preset auto-applied without prompting
- **Trigger Evaluation Optimization**: Expanded trigger-eval.json and refined SKILL.md description.
  - trigger-eval.json expanded from 20 to 31 queries (16 true + 15 false)
  - Added coverage for v3.3.2 features: profile, preset, resume, checkpoint keywords
  - Added false-positive guards for ambiguous terms (profile picture, resume template, deep copy, etc.)
  - SKILL.md description optimized: removed generic keywords, added preset/프리셋

### Changed
- `deep-work.md` Step 1.5 rewritten for v2 profile: version check (v1 auto-migrate, v2 proceed, other reject), preset selection logic, field-to-variable mapping
- `deep-work.md` Step 1.5a flag table: added `--profile=X`
- `deep-work.md` Step 1.5b: `--setup` now shows preset management UI (with or without task)
- `deep-work.md` Step 1.5d: New preset management UI section (edit existing, create new)
- `deep-work.md` Step 7: State file template includes `preset` field
- `deep-work.md` Step 7.5: Profile save format changed from v1 (`defaults.*`) to v2 (`presets.default.*`)
- `deep-work.md` Step 8: Confirmation message shows preset name (🎯 프리셋: [name])
- `deep-resume.md` Step 1: Extracts `preset` field from state file
- `deep-resume.md` Step 3: Resume status display shows preset name
- SKILL.md Profile System section updated with multi-preset documentation
- SKILL.md v3.3.3 Features section added

## [3.3.2] - 2026-03-22

### Added
- **Profile System**: Automatic profile save/load for zero-question session initialization.
  - First `/deep-work` run saves setup answers to `.claude/deep-work-profile.yaml`
  - Subsequent runs skip all setup questions, apply saved profile instantly
  - Override flags for single-session changes: `--team`, `--zero-base`, `--skip-research`, `--no-branch`
  - Profile re-setup: `/deep-work --setup`
  - Profile version field (`version: 1`) for future migration support
- **Session Resume (`/deep-resume`)**: Resume interrupted sessions with full context restoration.
  - Auto-detects active session from `.claude/deep-work.local.md`
  - Restores AI context from artifacts: research.md (summary), plan.md (full), test-results.md (failures)
  - Auto-continues from current phase: research → plan review → implement checkpoint → test
  - Implement phase always uses checkpoint-based resume (bypasses model routing re-delegation for safety)
- **Checkpoint Verification**: Post-agent implementation integrity check.
  - Uses `git diff --name-only` as primary verification source
  - Auto-corrects plan.md `[x]` markers when git changes exist but task was unmarked
  - Falls back gracefully when `file-changes.log` is unavailable (agent delegation mode)

### Changed
- `deep-work.md` restructured with Step 1.5 (profile load/flag parse) and Step 7.5 (profile save)
- `deep-work.md` Step 2-1 (git branch) now auto-creates/skips based on profile setting
- `deep-implement.md` Section 0-pre agent prompt includes checkpoint mandate
- `deep-implement.md` Section 0-pre adds post-agent checkpoint verification step
- SKILL.md description extended with resume/profile trigger keywords
- SKILL.md updated with Profile System, Session Resume, and v3.3.2 Features sections

## [3.3.0] - 2026-03-22

### Added
- **Insight Tier Quality Gate**: Third and final tier of the 3-tier Quality Gate system. Provides informational code metrics and analysis without blocking workflow.
  - `/deep-insight` command with standalone/workflow dual mode
  - Built-in analyses: file metrics, complexity indicators, dependency graph, change summary
  - Custom ℹ️ gates in plan.md Quality Gates table
  - Produces `insight-report.md` artifact
  - Automatically runs during `/deep-test` after Required and Advisory gates
- **PostToolUse File Tracking**: `file-tracker.sh` hook automatically logs file modifications during Implement phase to `$WORK_DIR/file-changes.log` with timestamps. Used by `/deep-report` and `/deep-insight`.
- **Stop Hook — Session End Handler**: `session-end.sh` hook fires on CLI session close. If a deep-work session is active, outputs a reminder message and sends notification via configured channels.
- **insight-guide.md**: Reference guide for Insight tier — analysis interpretation, custom gate definition, limitations

### Changed
- `hooks.json` expanded from PreToolUse-only to PreToolUse + PostToolUse + Stop events
- `/deep-test` Section 2-1 now parses ℹ️ (insight) markers in Quality Gates table alongside ✅ (required) and ⚠️ (advisory)
- `/deep-test` Section 4 adds new "4-2. Built-in Insight Analysis" step after Required/Advisory gates
- `quality-gates.md` output format includes new "Insight Gates" section and insight count in verdict
- `/deep-report` reads `insight-report.md` and `file-changes.log` for enriched reports
- `/deep-status` artifact checklist includes `insight-report.md` and `file-changes.log`
- `/deep-implement` notes PostToolUse file tracking in Solo Mode instructions
- SKILL.md Phase Enforcement section updated to document all three hook types
- SKILL.md description extended with insight/metrics/tracking trigger keywords

## [3.2.2] - 2026-03-21

### Added
- **Internationalization (i18n)**: All 9 command files now detect the user's language from their messages or Claude Code's `language` setting, and output all user-facing messages in the detected language. Korean templates are preserved as the reference format; Claude translates naturally to the user's language while preserving emoji, formatting, and structure. This enables English, Japanese, Chinese, and any other language users to use the plugin without modification.
- Internationalization section added to SKILL.md documentation.

## [3.2.1] - 2026-03-21

### Fixed
- **SKILL.md description trimmed**: Reduced from ~1,500 chars to ~450 chars (3x over budget). Removes sub-feature trigger phrases that diluted matching precision and wasted prompt budget on every conversation.
- **SKILL.md changelog bloat removed**: Removed v3.1.0/v3.2.0 Features sections (~400 words) that duplicated content already covered in the body. Moved `compatibility` frontmatter (non-standard field) into body section.
- **deep-research.md section numbering**: Renumbered steps 0, 0-1, 0-2 to 1-1, 1-2, 1-3 to match logical execution order.
- **deep-test.md allowed-tools**: Removed `Edit` from allowed-tools — code modifications are blocked during Test phase by Phase Guard.
- **Command description language consistency**: Standardized `drift-check.md` and `solid-review.md` descriptions to English (matching the other 7 commands).
- **notify.sh JSON safety**: Added `MESSAGE` variable escaping (double quotes and backslashes) before JSON interpolation to prevent malformed payloads.
- **Phase Guard path reference**: Added explicit `hooks/scripts/phase-guard.sh` path in SKILL.md for discoverability.

### Added
- `.gitignore` file mirroring `.npmignore` patterns to prevent accidental commits of state files and session artifacts.

## [3.2.0] - 2026-03-18

### Added
- **3-Tier Quality Gate System**: Quality Gates now support three tiers — Required (blocking), Advisory (warning), and Insight (informational, planned for v3.3).
- **Plan Alignment / Drift Detection**: `/drift-check` command and built-in Required gate in `/deep-test`. Automatically compares plan.md items against actual git diff to detect unimplemented items, out-of-scope changes, and design decision drift. Produces `drift-report.md`.
- **SOLID Design Review**: `/solid-review` command and Advisory Quality Gate. Evaluates code against 5 SOLID principles (SRP, OCP, LSP, ISP, DIP) with per-file scorecards, overall verdict, and top-5 refactoring suggestions. Produces `solid-review.md`.
- **solid-guide.md**: Framework-agnostic SOLID review checklist with severity levels and KISS balance criteria
- **solid-prompt-guide.md**: Guide for requesting SOLID-compliant code from AI tools and verifying AI output

### Changed
- `/deep-test` now automatically runs Plan Alignment check before other Quality Gates when plan.md exists (no configuration needed)
- SKILL.md restructured: moved Plan Alignment, SOLID Review, and Session Report under new "Quality Gates & Utilities" section (previously misplaced under "The Four Phases")
- SKILL.md description optimized: consolidated ~40 granular trigger keywords into ~10 representative phrases for better signal-to-noise ratio
- v3.2.0 Features section added to SKILL.md with English-consistent language
- `plan_approved_at` field added to state schema (optional, used by Drift Detection baseline)

## [3.1.0] - 2026-03-17

### Breaking Changes
- **Repository structure overhaul**: Migrated from root-level plugin to `plugins/deep-work/` subdirectory pattern. Existing users must reinstall.

### Added
- **Model Routing (F1)**: Optimal model assignment per phase (Research=sonnet, Plan=main, Implement=sonnet, Test=haiku). Agent delegation pattern reduces tokens by 30-40%.
- **Multi-channel Notifications (F2)**: OS native + Slack/Discord/Telegram/custom Webhook notifications on phase completion. Fire-and-forget pattern.
- **Incremental Research (F3)**: `/deep-research --incremental` — re-analyzes only changed areas based on git diff. Saves 60-80% of research time.
- **Quality Gate System (F4)**: Define Quality Gates in plan.md, then execute required/advisory gates. Produces `quality-gates.md` artifact.
- **Plan Diff Visualization (F5)**: Automatically visualizes structural changes when a plan is rewritten. Produces `plan-diff.md` artifact.
- **model-routing-guide.md**: Model routing configuration guide
- **notification-guide.md**: Notification channel setup guide

### Changed
- Added model routing/notification configuration options to `/deep-work` initialization
- Added model routing, notification, and Quality Gate status display to `/deep-status`
- Added Quality Gate results and Plan Diff summary sections to `/deep-report`
- Added `model_routing`, `notifications`, `last_research_commit`, `quality_gates_passed` fields to state schema
- Changed marketplace.json source path from `"./"` to `"./plugins/deep-work"`

## [3.0.0] - 2026-03-13

### Added

#### Phase 4: Test (`/deep-test`)
- **P-1**: New Test phase added (`implement → test → idle`)
- Auto-detects test/lint/type-check commands from project config files (package.json, pyproject.toml, Makefile, Cargo.toml, go.mod)
- On test failure, automatically returns to implement phase; fix-and-retest loop (up to 3 retries)
- Cumulative per-attempt verification results recorded in `test-results.md`
- Code modifications blocked during Test phase (Phase Guard)

#### Zero-Base Mode
- **P-3**: Zero-Base mode for designing new projects from scratch
- Research covers 6 areas: tech stack selection, coding conventions, data models, API design, scaffolding, dependency evaluation
- Plan provides "Files to Create" + "Project Structure" + "Setup Instructions"
- New `references/zero-base-guide.md` guide added

#### Interactive Plan Review
- **A-7**: Provide feedback via chat and plan.md is automatically updated (no need to edit the file directly)
- Changes are highlighted, then awaits re-review

#### Plan Enhancements
- **A-6**: Previous plan versions backed up as `plan.v{N}.md` on rewrite, with Change Log section added
- **A-11**: 6 plan templates by task type (API endpoint, UI component, DB migration, refactoring, bug fix, Full Stack feature)
- **P-2**: Automatic Team/Solo mode switch suggestion on plan approval (based on task count and file count)

#### Research Enhancements
- **A-8**: Partial research re-run — `/deep-research --scope=api,data` to re-analyze specific areas only
- **A-9**: Research caching — uses previous session's research.md as baseline, re-analyzes only changed areas based on git diff

#### Git Integration
- **A-10**: Suggests creating a `deep-work/[slug]` branch at session start
- Auto-generates commit message and suggests commit on session completion (tests passed)

#### Phase Skip
- **A-1**: Option to skip Research and start from Plan during session initialization
- Eliminates unnecessary Research for familiar codebases

#### Implement Checkpoints
- **A-4**: On resume after interruption during implementation, automatically skips completed tasks and resumes from unfinished ones

#### Time Tracking
- **A-12**: Records start/completion timestamps for all phases
- Adds per-phase elapsed time table to session report

#### Team Mode Progress Notifications
- **A-13**: In Team mode, progress notifications on agent task completion in the format `[2/3] pattern-analyst completed`

#### Session Comparison
- **A-14**: `/deep-status --compare` to compare approaches, modified files, and verification results between two sessions

#### New Files
- `commands/deep-test.md` — Test Phase command
- `references/testing-guide.md` — Test Phase detailed guide
- `references/plan-templates.md` — Plan template collection
- `references/zero-base-guide.md` — Zero-Base Research guide
- `CHANGELOG.md` — Changelog file

### Changed

#### Output Format Improvements
- **P-5**: Placed Executive Summary, Key Findings, and Risk & Blockers at the top of research.md (pyramid principle)
- **P-5**: Placed Plan Summary (approach, scope of changes, risks, key decisions) at the top of plan.md

#### Phase Guard Message Improvements
- **A-2**: Added phase-specific "next step" guidance to block messages
- Research: "→ Run /deep-plan or /deep-research"
- Plan: "→ Approve the plan or re-run /deep-plan"
- Test: "→ Handled automatically on test pass/fail, see test-results.md"

#### Phase Flow Changes
- `research → plan → implement → idle` → `research → plan → implement → test ⟲ → idle`
- Auto-transitions to test phase after implement completion instead of idle
- Retry loop returning to implement on test failure

#### State File Schema Extensions
- New fields: `project_type`, `git_branch`, `test_retry_count`, `max_test_retries`, `test_passed`
- New timestamps: `research_started_at/completed_at`, `plan_started_at/completed_at`, `implement_started_at/completed_at`, `test_started_at/completed_at`

#### Version Unification
- **A-3**: Unified `plugin.json` and `package.json` versions to 3.0.0

#### SKILL.md Updates
- Reflects 4-phase workflow
- Added Zero-Base mode trigger keywords ("new project", "zero-base", "from scratch")
- Added descriptions for new features (Research caching, partial re-run, Plan templates, interactive review, etc.)

#### Reference Guide Updates
- `research-guide.md` — Added Executive Summary/Key Findings output format, link to Zero-Base guide
- `planning-guide.md` — Added Plan Summary output format, link to templates guide
- `implementation-guide.md` — Updated Completion Protocol to transition to Test phase

## [2.0.0] - 2026-03-07

### Added
- Per-task folder history (`deep-work/YYYYMMDD-HHMMSS-slug/`)
- Auto-starts implementation on plan approval
- Auto-generates session report (`report.md`)
- `/deep-report` command (view/regenerate report)
- `/deep-status` command (status, progress, session history)
- Solo/Team mode selection
- Team mode: 3-agent parallel Research, file-ownership-based parallel Implement, cross-review

### Changed
- Added `work_dir`, `team_mode`, `started_at` fields to state file
- Phase Guard now allows document edits within `deep-work/` directory

## [1.1.0] - 2026-03-01

### Added
- Phase Guard (PreToolUse hook) — Blocks code file modifications during Research/Plan phases
- State-file-based phase management

### Changed
- Migrated from simple prompt-based approach to hook-based enforcement

## [1.0.0] - 2026-02-15

### Added
- Initial release
- 3-phase workflow: Research → Plan → Implement
- `/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement` commands
- `research.md` and `plan.md` artifact generation
- Iterative Plan review support
