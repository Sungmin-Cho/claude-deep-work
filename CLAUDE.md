# deep-work — Project Guide for Claude

Evidence-Driven Development Protocol. `/deep-work "task"` drives the full Brainstorm → Research → Plan → Implement → Test workflow automatically.

For detailed version history see [`CHANGELOG.md`](CHANGELOG.md) / [`CHANGELOG.ko.md`](CHANGELOG.ko.md). This file is intentionally short — it holds the overview, structure, and drift-resistant conventions only. Version-by-version release notes live in CHANGELOG.

To check the current version: `jq -r .version .claude-plugin/plugin.json`

---

## Project Overview

**deep-work** is a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that wraps an evidence-driven development cycle behind a single slash command. It enforces phase discipline via computational hooks (`phase-guard`), validates implementation receipts, and emits M3 envelope-wrapped artifacts for cross-plugin consumption.

**Three-layer architecture:**
1. **Skill-based phase dispatch** — one Skill per phase (`deep-brainstorm` / `deep-research` / `deep-plan` / `deep-implement` / `deep-test` / `deep-integrate`)
2. **Computational enforcement** — `phase-guard` hook (worktree guard + phase transition injection + non-implement dangerous-command denylist) and TDD enforcement
3. **Receipt validation** — `session-receipt.json` + `receipts/SLICE-*.json` as M3 cross-plugin envelopes with identity-triplet guards

**Marketplace presence**: One of six plugins in the [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) marketplace.

---

## 🚨 CRITICAL — Plugin Update Workflow

**Every deep-work release must be accompanied by the following work. No exceptions.**

### 1. Sync the deep-suite marketplace (required)

Update the following files in `/Users/sungmin/Dev/claude-plugins/deep-suite/`:

- **`.claude-plugin/marketplace.json`** — under the `deep-work` entry: `sha` = full 40-character merge commit hash on the new `main`; description = one-line headline summary.
- **`README.md`** / **`README.ko.md`** — the `deep-work` row in the Plugins table and any narrative sections that reference the version.
- **`guides/integrated-workflow-guide.md`** / **`integrated-workflow-guide.ko.md`** — version-tagged guidance, if any.

After editing:
```bash
cd /Users/sungmin/Dev/claude-plugins/deep-suite
git add .claude-plugin/marketplace.json README.md README.ko.md guides/integrated-workflow-guide*.md
git commit -m "chore: bump deep-work to vX.Y.Z — <one-line summary>"
git push
```

### 2. Update deep-work CHANGELOG (both languages, required)

- Add a new version entry to both `CHANGELOG.md` and `CHANGELOG.ko.md`
- Bump the version in `.claude-plugin/plugin.json` and `package.json`

**Do NOT inline release notes in this CLAUDE.md** — CHANGELOG is the single source of truth.

### 3. Critical — Do Not Touch

- `~/.claude/plugins/marketplaces/claude-deep-suite/` — the Claude Code marketplace cache (holds install state). Never edit directly; push to the working repo and run `/plugin marketplace update`.
- `~/.claude/plugins/cache/claude-deep-suite/` — plugin install cache. Same rule.

---

## Structure

```
deep-work/
├── .claude-plugin/plugin.json    # plugin manifest
├── package.json                   # npm manifest (files field controls distribution scope)
├── commands/                      # slash commands (thin wrappers + utilities)
├── agents/                        # Claude Code subagents
│   └── session-recommender.md    # session-init recommendation sub-agent
├── hooks/
│   ├── hooks.json                # P0 worktree guard + P1 phase transition + non-implement denylist
│   └── scripts/
│       ├── phase-guard.sh                    # entry point — dispatches to phase-guard-core
│       ├── phase-guard-core.js               # denylist regex engine
│       ├── wrap-receipt-envelope.js          # M3 envelope writer (called from agents + commands)
│       ├── verify-delegated-receipt.sh       # post-hoc receipt validation
│       └── verify-receipt-core.js            # 8-item validation module
├── skills/
│   ├── deep-work-orchestrator/   # initialization + auto-flow
│   ├── deep-brainstorm/          # Phase 0
│   ├── deep-research/            # Phase 1
│   ├── deep-plan/                # Phase 2
│   ├── deep-implement/           # Phase 3
│   ├── deep-test/                # Phase 4
│   ├── deep-integrate/           # Phase 5 (cross-plugin, optional)
│   ├── deep-work-workflow/       # workflow overview
│   └── shared/references/        # cross-skill reference guides
├── sensors/                       # linter/type/coverage detection + run
├── health/                        # Health Engine — drift detection + fitness functions
├── templates/                     # CI templates + topology engine
├── tests/                         # regression tests
├── assumptions.json               # assumption baseline (justifies hook enforcement)
├── scripts/                       # plugin-level utilities
│   ├── validate-agents.sh                 # agent frontmatter check
│   ├── validate-envelope-emit.js          # release-lint (mirrors suite envelope schema)
│   ├── migrate-profile-v2-to-v3.js        # profile migration helper
│   ├── load-v3-profile.js                 # v3 schema profile reader
│   ├── parse-deep-work-flags.js           # CLI flag parser
│   ├── recommender-input.js               # session-recommender input sanitization
│   ├── recommender-parser.js              # 5-key validation parser
│   ├── detect-capability.js               # environment capability detection
│   ├── format-ask-options.js              # AskUserQuestion option formatter
│   └── migrate-model-routing.js           # model_routing legacy → "sonnet" atomic migration
├── CHANGELOG.md / CHANGELOG.ko.md
├── README.md / README.ko.md
└── AGENTS.md                      # agent registry + invocation conventions
```

---

## Key Concepts

### Receipt envelope (M3)

Both `session-receipt.json` and `receipts/SLICE-*.json` emit as M3 cross-plugin envelopes:

```
{
  "schema_version": "1.0",
  "envelope": {
    "producer": "deep-work",
    "producer_version": "<from .claude-plugin/plugin.json>",
    "artifact_kind": "session-receipt | slice-receipt",
    "run_id": "<ULID>",
    "session_id": "<dw-session-id>",
    "parent_run_id": "<consumed evolve-insights run_id, optional>",
    "generated_at": "<RFC 3339>",
    "schema": { "name": "<matches artifact_kind>", "version": "1.0" },
    "git": { "head": "<sha>", "branch": "<name>", "dirty": false },
    "provenance": { "source_artifacts": [...], "tool_versions": {...} }
  },
  "payload": { /* legacy receipt body — schema_version: "1.0" preserved */ }
}
```

**Writer**: `hooks/scripts/wrap-receipt-envelope.js` (CLI helper invoked from markdown agent prompts). Used by `agents/implement-slice-worker.md` for slice receipts and `commands/deep-finish.md` §7-Z for session receipts. Reads `producer_version` from `.claude-plugin/plugin.json` via literal-cwd-resolve.

**Readers**: every internal reader (`verify-delegated-receipt-runner.js`, `validate-receipt.sh`, `session-end.sh`, `receipt-migration.js`) plus cross-plugin consumers (`skills/deep-integrate/gather-signals.sh`, `skills/deep-research/SKILL.md`) detect the envelope, verify the identity-triplet (`producer === "deep-work"`, `artifact_kind` matches, `schema.name === artifact_kind`), then unwrap to read legacy fields. Legacy non-envelope receipts pass through unmodified (forward-compat).

**Self-test**: `scripts/validate-envelope-emit.js` mirrors the suite envelope schema as a zero-dep release-lint. `tests/envelope-emit.test.js` + `tests/envelope-chain.test.js` cover identity guards, corrupt-payload defense, ULID Crockford alphabet (rejects I/L/O/U), strict SemVer 2.0.0, and the cross-plugin chain assertion `session-receipt.parent_run_id === consumed evolve-insights.run_id`.

### Phase-guard hook

`hooks/scripts/phase-guard.sh` enforces phase transitions and blocks non-implement dangerous commands. The denylist (managed in `phase-guard-core.js`) covers:

- `curl | sh` pipe-shells
- `rm -rf` on protected paths
- `npm publish`
- `kubectl` destructive verbs
- SQL `DROP` / `DELETE`
- `dd` / `mkfs` / `fdisk`

Each family supports a per-family `CLAUDE_ALLOW_*` override env var for legitimate use. The 8 golden scenarios plus 5 override fall-through scenarios are pinned in `tests/`.

---

## Workflows & Conventions

### Release flow

1. Implementation + tests on a feature branch
2. PR + merge to `main`
3. CHANGELOG entries (both languages) + plugin.json/package.json bump (same PR or a follow-up)
4. **Sync deep-suite per the CRITICAL section above**

### Atomic commit hygiene

Each commit corresponds to exactly one task. Never use `git add -A` (risk of leaking sensitive files). Use HEREDOC commit messages with the Co-Authored-By trailer.

### Receipt schema changes

Any change to the `payload` shape requires a corresponding bump in `schemas/payload-registry/<producer>/<artifact_kind>/v<MAJOR.MINOR>.schema.json` over in deep-suite. Forward-compatible additions are fine; breaking shape changes require a new minor version of the schema.

### Suite-side updates

`marketplace.json` SHA bump, payload-registry placeholder → authoritative, and adoption-ledger T+0 line are batched in deep-suite Phase 3 — NOT in this repo. Plugin PRs touch the plugin repo only.

---

## Quick references

| Question | Answer |
|---|---|
| How do I add a new slash command? | New `.md` under `commands/` — auto-discovered |
| How do I add a new skill? | New directory under `skills/<name>/` with `SKILL.md` + `references/` |
| How do I add a new subagent? | New `agents/<name>.md` (frontmatter + prompt) |
| How do I bypass `phase-guard`? | Set the matching `CLAUDE_ALLOW_<family>` env var (per-family override) — never disable globally |
| Receipt validation failed? | Run `hooks/scripts/verify-delegated-receipt.sh <path>` to see which of the 8 checks failed |
| How do I run the test suite? | `npm test` (Node 20+ required) |

---

## Related repositories

- **deep-suite (marketplace)**: https://github.com/Sungmin-Cho/claude-deep-suite — `/Users/sungmin/Dev/claude-plugins/deep-suite`
- **deep-wiki**: https://github.com/Sungmin-Cho/claude-deep-wiki
- **deep-evolve**: https://github.com/Sungmin-Cho/claude-deep-evolve
- **deep-review**: https://github.com/Sungmin-Cho/claude-deep-review
- **deep-docs**: https://github.com/Sungmin-Cho/claude-deep-docs
- **deep-dashboard**: https://github.com/Sungmin-Cho/claude-deep-dashboard

---

**🔁 Reminder**: This CLAUDE.md is intentionally kept short. For every new release:

1. **Write the details in CHANGELOG** (not here — prevents drift)
2. **Only sync the schema sections** (Receipt envelope, Phase-guard hook) if the schema or denylist itself changed
3. **Sync the deep-suite marketplace** (see the "CRITICAL" section above)
