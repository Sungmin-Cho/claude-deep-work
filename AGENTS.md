# deep-work — Agent Guide

Evidence-Driven Development Protocol. `$deep-work:deep-work "task"` drives the
Brainstorm → Research → Spec → Plan → Implement → Test → Integrate workflow.
Claude Code and Codex share this file — it is the single source for both.

Read the version, never hardcode it: `jq -r .version .claude-plugin/plugin.json`.
Release history lives in `CHANGELOG.md` / `CHANGELOG.ko.md`; README owns what the
plugin is and how to use it.

> 📄 Documentation in this repo follows `docs/DOCS_RULE.md` (local maintainer guide).

## Runtime surfaces

Manifests `.claude-plugin/plugin.json` + `.codex-plugin/plugin.json` · skills
`skills/*/SKILL.md` with cross-skill guides under `skills/shared/references/` ·
hooks `hooks/hooks.json` + `hooks/scripts/` · agents `agents/*.md`. Node ≥ 22
(`package.json` `engines`). Verify a change with:

```bash
node -e "JSON.parse(require('fs').readFileSync('.codex-plugin/plugin.json','utf8'))"
npm test
```

## Host differences — subagent dispatch

`agents/*.md` are Claude Code subagents, discovered from the `agents/` directory by
convention — **neither** `plugin.json` declares an `agents` key, so manifest contents
do not tell the two hosts apart. Claude Code provides the `Agent` tool; Codex does
not.

**Decide on tool availability, not on the manifest.** This rule applies to *every*
`Agent(...)` dispatch in this plugin, currently five sites: `deep-research`
§모드 분기 (research workers) · `deep-implement` §2.1/§2.2 (slice workers) ·
`deep-work-orchestrator` §1-4-2 (session-recommender) · `deep-integrate` §3-2
(general-purpose recommendation call) · `deep-plan` §Contract Negotiation
(contract validation).

- The `Agent` tool is available → dispatch as written.
- It is not → **run that worker's own protocol inline in the calling skill**,
  reading `agents/<worker>.md` for the contract it would have received. Keep the
  same inputs, output paths and receipt obligations; only the execution site
  changes. Where the dispatch is a plain reasoning call with no `agents/` file
  (deep-integrate §3-2, deep-plan §Contract Negotiation), perform the reasoning
  inline against the same prompt and schema.

`detectRuntime()` in `scripts/detect-runtime.js` returns `claude` | `codex` |
`unknown` from `CLAUDECODE` / `CODEX_HOME` markers if a programmatic signal is
needed, but an agent can answer directly by checking whether it has the tool.
Never emit a dispatch the host cannot execute, and never silently skip the work
the worker would have done.

## Receipt envelope (M3)

`session-receipt.json` and `receipts/SLICE-*.json` are emitted as M3 cross-plugin
envelopes:

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

Sole writer: `hooks/scripts/wrap-receipt-envelope.js`, invoked from
`agents/implement-slice-worker.md` and `skills/deep-finish/SKILL.md` §7-Z.

**Identity-triplet guard.** Before unwrapping `payload`, every reader verifies
`producer` equals the expected producer, `artifact_kind` equals the expected kind,
and `schema.name === artifact_kind`. A mismatch is skipped with a warning, never
partially consumed. Legacy non-envelope files pass through unmodified
(forward-compat). The same triplet applies when deep-work reads another plugin's
envelope — deep-dashboard's harnessability report, deep-evolve's insights.

Changing the `payload` shape requires a matching bump of
`schemas/payload-registry/deep-work/<artifact_kind>/v<MAJOR.MINOR>.schema.json`
in deep-suite. Additive changes are forward-compatible; a shape break needs a new
schema minor.

## Phase-guard denylist

`hooks/scripts/phase-guard-core.js` blocks five catastrophic-blast-radius command
families outside the Implement phase, each with its own opt-out env var:

| Family | Matches | Override |
|---|---|---|
| `rm-rf` | any `rm` with `-r` / `-R` / `--recursive` | `CLAUDE_ALLOW_RM_RF` |
| `npm-publish` | `npm publish` | `CLAUDE_ALLOW_NPM_PUBLISH` |
| `kubectl-destructive` | `kubectl delete … --all`, `kubectl drain` | `CLAUDE_ALLOW_KUBECTL_DESTRUCTIVE` |
| `sql-destructive` | `DROP TABLE`, `TRUNCATE [TABLE] <name>` | `CLAUDE_ALLOW_SQL_DESTRUCTIVE` |
| `curl-pipe-shell` | `curl` / `wget` piped into `sh` / `bash` | `CLAUDE_ALLOW_CURL_PIPE_SHELL` |

Never disable the guard globally — set the one matching family override.

These families are **not** matched by the denylist: `DELETE FROM` without `WHERE`,
`DROP DATABASE`, `curl | zsh` and process substitution, `yarn`/`pnpm`/`lerna`
publish, and `dd` / `mkfs` / `fdisk`. `DANGEROUS_NON_IMPLEMENT_PATTERNS` records
each omission with the reason it was left out. The suite's strict-mode example
pack covers more families at the hook level.

## Conventions

- **Never `git add -A`** — stage explicit paths so untracked local files cannot
  leak into a commit. One commit per task, HEREDOC message with the
  `Co-Authored-By` trailer.
- **Never edit install caches** — `~/.claude/plugins/`, `~/.codex/plugins/cache/`.
  Push to this repo, then run `/plugin marketplace update`.
- **Version triple-sync** — `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`
  and `package.json` always carry the same version.
- Receipt validation failed? The script takes three required positionals:
  `hooks/scripts/verify-delegated-receipt.sh [--skip-items=N,M] [--only-completed]
  <state_file> <receipts_dir> <plan_md_path>`. It names the failing item; the checks
  live in `hooks/scripts/verify-receipt-core.js`. `/deep-receipt validate` wraps it.

## Release

A plugin PR touches this repo only: CHANGELOG in both languages plus the version
triple-sync. The marketplace pin, payload-registry promotion and adoption-ledger
line are batched on the suite side afterwards, once the merge lands on `main`:

```bash
cd /Users/sungmin/Dev/claude-plugins/deep-suite
npm run release:bump -- deep-work <sha40>   # writes .claude-plugin/marketplace.json
npm run preflight
```

`release:bump` does **not** touch `.agents/plugins/marketplace.json` — sync that
file by hand in the same commit.
