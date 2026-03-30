# deep-work development

## Project structure

```
deep-work/
├── plugins/deep-work/          # Main plugin directory
│   ├── .claude-plugin/         # Plugin manifest
│   │   └── plugin.json
│   ├── commands/               # Slash commands (markdown)
│   │   ├── deep-work.md        # /deep-work — session init + update check
│   │   ├── deep-brainstorm.md  # /deep-brainstorm — Phase 0 (v4.0)
│   │   ├── deep-research.md    # /deep-research — Phase 1
│   │   ├── deep-plan.md        # /deep-plan — Phase 2 (slice format)
│   │   ├── deep-implement.md   # /deep-implement — Phase 3 (TDD enforced)
│   │   ├── deep-test.md        # /deep-test — Phase 4 (receipt gates)
│   │   ├── deep-debug.md       # /deep-debug — systematic debugging (v4.0)
│   │   ├── deep-slice.md       # /deep-slice — slice management (v4.0)
│   │   ├── deep-receipt.md     # /deep-receipt — receipt management (v4.0)
│   │   ├── deep-status.md      # /deep-status — session info
│   │   ├── deep-report.md      # /deep-report — session report
│   │   ├── deep-resume.md      # /deep-resume — resume session
│   │   ├── deep-review.md       # /deep-review — manual review trigger (v4.2)
│   │   ├── deep-assumptions.md # /deep-assumptions — assumption health (v5.0)
│   │   ├── drift-check.md      # /drift-check — plan alignment
│   │   ├── solid-review.md     # /solid-review — SOLID design
│   │   └── deep-insight.md     # /deep-insight — code metrics
│   ├── hooks/
│   │   ├── hooks.json          # Hook configuration
│   │   └── scripts/
│   │       ├── phase-guard.sh      # PreToolUse — bash+Node hybrid
│   │       ├── phase-guard-core.js # Node.js: TDD state machine, Bash detection
│   │       ├── phase-guard-core.test.js # 56 unit tests (node:test)
│   │       ├── assumption-engine.js     # Node.js: Assumption Engine — Wilson Score, per-slice (v5.0)
│   │       ├── assumption-engine.test.js # 42 unit tests (node:test, v5.0)
│   │       ├── file-tracker.sh     # PostToolUse — tracks + receipt collection
│   │       ├── update-check.sh     # SessionStart — git-based version check
│   │       ├── session-end.sh      # Stop — session reminder
│   │       └── notify.sh           # Notification helper
│   ├── skills/
│   │   └── deep-work-workflow/
│   │       ├── SKILL.md
│   │       └── references/
│   │           └── review-gate.md  # Reusable review protocol (v4.2)
│   ├── package.json
│   ├── README.md / README.ko.md
│   └── CHANGELOG.md / CHANGELOG.ko.md
├── .claude-plugin/             # Root plugin manifest (symlinks)
│   ├── plugin.json
│   └── marketplace.json
└── README.md                   # Root landing page
```

## Key concepts

- **Phase enforcement**: PreToolUse hook (`phase-guard.sh`) physically blocks Write/Edit
  during non-implement phases (research, plan, test, brainstorm).
- **Session state**: `.claude/deep-work.local.md` YAML frontmatter stores current_phase,
  work_dir, slice states, TDD mode, review_state, cross_model settings, timestamps.
- **Quality Gates**: 3-tier system — Required (blocks), Advisory (warns), Insight (info).
- **Review Gate** (v4.2): Structural review + adversarial cross-model review on phase documents.
  codex/gemini-cli auto-detected at session init. Results in `{phase}-review.json`.
- **Assumption Engine** (v5.0): Self-evolving harness. Each enforcement rule is a falsifiable
  hypothesis with evidence signals. `assumption-engine.js` computes Wilson Score confidence,
  model-aware splitting, staleness detection. `/deep-assumptions` reports health.
- **Commands are markdown**: Each slash command is a `.md` file with YAML frontmatter.
  Claude reads and follows the instructions.

## Testing

```bash
# 113 unit tests — v4.0 added node:test, v5.0 added assumption engine, v5.1 added autoAdjust
cd plugins/deep-work/hooks/scripts
node --test phase-guard-core.test.js    # Phase guard tests (56 tests)
node --test assumption-engine.test.js   # Assumption engine tests (57 tests, v5.1)
```

## Conventions

- Commands output in the user's language (auto-detected from messages or Claude Code setting)
- Korean is the reference language for templates; auto-translate for other languages
- State file uses YAML frontmatter format
- Hook scripts must exit 0 (allow) or 2 (block with JSON reason)
- Hook timeout: PreToolUse 5s, PostToolUse 3s, Stop 5s
- All file paths must be cross-platform normalized (Windows backslashes → POSIX)

## Version

Current: 5.1.2 (Team Mode Auto-Setup & Runtime Validation)
