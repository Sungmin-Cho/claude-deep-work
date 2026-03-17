**English** | [한국어](./CHANGELOG.md)

# Changelog

All notable changes to the Deep Work plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
