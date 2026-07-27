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

Never disable the guard globally — set the one matching family override. The
scope omissions (`DELETE FROM` without `WHERE`, `DROP DATABASE`, `curl | zsh`,
`yarn publish`, `dd` / `mkfs` / `fdisk`) are deliberate and are pinned at the
`DANGEROUS_NON_IMPLEMENT_PATTERNS` definition; widening the list is a design pass,
not a bug fix. Deeper coverage ships as the suite's strict-mode example pack.

## Conventions

- **Never `git add -A`** — stage explicit paths so untracked local files cannot
  leak into a commit. One commit per task, HEREDOC message with the
  `Co-Authored-By` trailer.
- **Never edit install caches** — `~/.claude/plugins/`, `~/.codex/plugins/cache/`.
  Push to this repo, then run `/plugin marketplace update`.
- **Version triple-sync** — `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`
  and `package.json` always carry the same version.
- Receipt validation failed? `hooks/scripts/verify-delegated-receipt.sh <path>`
  names the failing item; the checks live in `hooks/scripts/verify-receipt-core.js`.

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
