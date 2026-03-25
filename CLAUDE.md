# deep-work development

## Project structure

```
deep-work/
├── plugins/deep-work/          # Main plugin directory
│   ├── .claude-plugin/         # Plugin manifest
│   │   └── plugin.json
│   ├── commands/               # Slash commands (markdown)
│   │   ├── deep-work.md        # /deep-work — session init
│   │   ├── deep-research.md    # /deep-research — Phase 1
│   │   ├── deep-plan.md        # /deep-plan — Phase 2
│   │   ├── deep-implement.md   # /deep-implement — Phase 3
│   │   ├── deep-test.md        # /deep-test — Phase 4
│   │   ├── deep-status.md      # /deep-status — session info
│   │   ├── deep-report.md      # /deep-report — session report
│   │   ├── deep-resume.md      # /deep-resume — resume session
│   │   ├── drift-check.md      # /drift-check — plan alignment
│   │   ├── solid-review.md     # /solid-review — SOLID design
│   │   └── deep-insight.md     # /deep-insight — code metrics
│   ├── hooks/
│   │   ├── hooks.json          # Hook configuration
│   │   └── scripts/
│   │       ├── phase-guard.sh      # PreToolUse — blocks edits
│   │       ├── phase-guard-core.js # Node.js complex logic (v4.0)
│   │       ├── file-tracker.sh     # PostToolUse — tracks changes
│   │       ├── session-end.sh      # Stop — session reminder
│   │       └── notify.sh           # Notification helper
│   ├── skills/
│   │   └── deep-work-workflow/
│   │       ├── SKILL.md
│   │       └── references/     # Guide documents
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
  work_dir, slice states, TDD mode, timestamps.
- **Quality Gates**: 3-tier system — Required (blocks), Advisory (warns), Insight (info).
- **Commands are markdown**: Each slash command is a `.md` file with YAML frontmatter.
  Claude reads and follows the instructions.

## Testing

```bash
# No automated test suite yet — v4.0 adds node:test for phase-guard-core.js
cd plugins/deep-work/hooks/scripts
node --test phase-guard-core.test.js    # Unit tests (v4.0)
```

## Conventions

- Commands output in the user's language (auto-detected from messages or Claude Code setting)
- Korean is the reference language for templates; auto-translate for other languages
- State file uses YAML frontmatter format
- Hook scripts must exit 0 (allow) or 2 (block with JSON reason)
- Hook timeout: PreToolUse 5s, PostToolUse 3s, Stop 5s
- All file paths must be cross-platform normalized (Windows backslashes → POSIX)

## Version

Current: 4.0.0 (Evidence-Driven Development Protocol)
