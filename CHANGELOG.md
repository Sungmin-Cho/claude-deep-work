**English** | [한국어](./CHANGELOG.ko.md)

# Changelog

All notable changes to the Deep Work plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [6.8.0] — 2026-05-19 (Plan-quality contract enforcement + CI hardening + receipt-tracker robustness)

### Added

- **`tests/plan-quality-contract.test.js`** — pins the executable `deep-plan` slice contract, rejects legacy `Task N:` rows in planning/implementation references, and (new 4th block) pins `skills/shared/references/review-gate.md` to the v6.7 mandatory slice contract so the review gate cannot silently drift away from the test.
- **`tests/ci-workflow-contract.test.js`** — pins the GitHub Actions advisory `shellcheck` step shape (name, `continue-on-error: true`, target, severity, ordering after `npm test`, missing-binary graceful skip).
- **`hooks/scripts/file-tracker-lock-timeout.test.js`** — end-to-end regression test for the receipt-tracker stale-lock recovery contract: Phase 1 (lock held) asserts canonical receipt + pending sidecar state; Phase 2 (lock released, second invocation) asserts the drained file and the new file both land in canonical `changes.files_modified`.

### Changed

- **Plan slice format (v6.7 executable steps)** — `steps` are now required for S/M/L slices (`S: 2-4`, `M: 3-7`, `L: 5-12`), and every code-changing step must include exact file paths plus code sketch or function signature detail.
- **Planning references and templates** — `planning-guide.md`, `implementation-guide.md`, `plan-templates.md`, `plan-template-existing.md`, and `plan-template-zerobase.md` now use `SLICE-NNN` slice checklists with `depends_on`, `code_sketch`, `failing_test`, `verification_cmd`, and `expected_output`.
- **Completeness Policy** — expanded to reject vague `Write tests for the above`, missing `failing_test` red signal, and missing exact `expected_output` fragment.
- **Contract validation scope** — updated from the stale M/L/XL wording to all S/M/L slices.
- **Plan review-gate aligned with v6.7 mandatory slice contract** — `skills/shared/references/review-gate.md` no longer marks `expected_output` as "recommended" and no longer applies a v5.8 backward-compat fallback that absolved missing `steps`/`expected_output` from the `testability`/`buildability`/`code_completeness` rubric. The wording now requires all five mandatory slice fields (`failing_test`, `verification_cmd`, `expected_output`, `code_sketch`, `steps`) for every non-inline S/M/L slice, with narrow exceptions for inline plans and legacy/resume inputs.
- **Advisory shellcheck CI step** — runs `shellcheck --severity=warning --external-sources` against `hooks/scripts/**/*.sh`, non-blocking (`continue-on-error: true`). No gate change.
- **`npm test` discovery widened to 6 explicit subtree globs** — replace the explicit-6-file list with `node --test --test-concurrency=1 hooks/**/*.test.js tests/**/*.test.js skills/**/*.test.js sensors/**/*.test.js templates/**/*.test.js scripts/**/*.test.js`. Runs serially to keep timing-sensitive tests stable on slower CI runners. CI Node version bumped from 20 to 22 (LTS) to support the glob form (glob support in `--test` positional args landed in Node 21.0.0 and was never back-ported to 20.x). `health/**/*.test.js` is covered by a separate `npm run test:health` script that runs cleanly in isolation but exposes a pre-existing event-loop leak in `health/health-check.test.js:236` ("overall timeout enforcement") when interleaved with other suites on GitHub-hosted runners — that leak is tracked as a follow-up. Discovered tests remain POSIX-only (use `bash` directly + `/tmp` hardcodes), so this does not enable Windows execution; it only ensures the bulk of the suite runs in the ubuntu+macos CI matrix.
- **Receipt-tracker lock-timeout hardening** — restore the unconditional pre-lock receipt init in `hooks/scripts/file-tracker.sh` with `O_CREAT | O_EXCL` (`fs.writeFileSync` `flag: 'wx'`) so concurrent writers race safely. Single-write slices retain a canonical `SLICE-NNN.json` even when the in-lock update path times out on a stale lock. Pending-changes sidecar drains on the next successful lock-acquire in `file-tracker.sh` (session-end does not currently sweep pending-changes — tracked as a future improvement).
- Version bumped 6.7.1 → 6.8.0 across package and plugin manifests for a minor release.

### Verification

- `npm test`: 901 / 901 pass (150 suites). Three contract suites pin the new surfaces (`plan-quality-contract`, `ci-workflow-contract`, `file-tracker-lock-timeout`).
- 3-way deep-review (Claude Opus + Codex review + Codex adversarial) ran three iterative rounds; the round-3 fix commit closed every round-2 finding and round 3 converged with APPROVE for the round-3 fix scope; the O1 alignment commit closed the one out-of-scope finding raised in round 3.

## [6.7.1] — 2026-05-18 (Codex-native plugin manifest and AGENTS guide)

### Added

- **`.codex-plugin/plugin.json`** — Codex-native plugin manifest pointing at the same skill and hook surfaces as the Claude Code manifest while preserving the existing `claude-deep-*` repository identity.
- **`AGENTS.md`** — Codex project guide covering runtime surfaces, verification commands, and the downstream suite marketplace update requirement.
- **`skills/deep-work/SKILL.md`** — restored the primary `deep-work` skill entry alias so Claude, Codex, and other skill callers can invoke `$deep-work:deep-work "task"` instead of knowing the internal `deep-work-orchestrator` name. The alias forwards all arguments to `deep-work-orchestrator`.
- **`tests/skill-entry-alias.test.js`** — pins the skill-only entrypoint contract: no `commands/deep-work.md` wrapper is required, and the `deep-work` skill delegates to `deep-work-orchestrator` with `$ARGUMENTS` preserved.

### Changed

- Version bumped 6.7.0 → 6.7.1 across package and plugin manifests for a patch release.
- README documentation now calls out Codex compatibility alongside the existing Claude Code surface.
- Codex plugin default prompt now uses `$deep-work:deep-work "build this feature"` as the first-run entrypoint.
- Manifest/package descriptions now describe the entry alias as skill-native for Claude and Codex, not Codex-only.

### Verification

- Repository validation was run before release; see the PR checklist for the exact command output.

## [6.7.0] - 2026-05-18 (24 commands → user-invocable skills: cross-platform — suite-wide migration completion)

### Changed — 24 command-equivalent surfaces promoted to `user-invocable: true` skills

- **Category A (7)**: thin `Skill()` wrappers under `commands/` deleted; the matching skill bodies gain `user-invocable: true` in frontmatter (no body changes). Targets: `deep-brainstorm`, `deep-research`, `deep-plan`, `deep-implement`, `deep-test`, `deep-integrate`, `deep-work-orchestrator`. Skill invocation now flows directly to the skill bodies instead of through a wrapper command — orchestrator's 5-phase dispatch unchanged.
- **Category B (17)**: new `skills/<verb>/SKILL.md` files created with `user-invocable: true` frontmatter + new `## Invocation` / `## Inputs (skill args)` / `## Prerequisites` head sections; bodies preserved byte-for-byte except internal cross-reference path retargeting. Old `commands/<verb>.md` files deleted. Targets: `deep-assumptions`, `deep-cleanup`, `deep-debug`, `deep-finish` (660 lines — single largest in the suite), `deep-fork`, `deep-history`, `deep-insight`, `deep-mutation-test`, `deep-phase-review`, `deep-receipt`, `deep-report`, `deep-resume`, `deep-sensor-scan`, `deep-slice`, `deep-status` (hub of receipt/history/report/assumptions sub-pages), `drift-check`, `solid-review`.
- **`commands/` directory removed**. `package.json` `files` field updated to drop `commands/`.
- **deep-status hub sub-page retargeting**: §6/§7/§8/§9 lines that previously read "Read the `/deep-X` command file and follow its logic inline" now read "Read `skills/deep-X/SKILL.md` and follow its logic inline" — preserving the inline-dispatch hub-spoke pattern. The 4 sub-skill files (`deep-receipt` / `deep-history` / `deep-report` / `deep-assumptions`) also have their `참조처:` lines retargeted to `skills/deep-status/SKILL.md` §X.
- **CLAUDE.md:133** retargeted: `commands/deep-finish.md §7-Z` → `skills/deep-finish/SKILL.md §7-Z` (caller-naming for `wrap-receipt-envelope.js`).
- **`hooks/scripts/wrap-receipt-envelope.js`** JSDoc updated: caller naming `deep-finish.md, agents/implement-slice-worker.md` → `skills/deep-finish/SKILL.md §7-Z, agents/implement-slice-worker.md`.
- **`skills/deep-work-orchestrator/SKILL.md`** internal references retargeted: `Read \`/deep-finish\`` → `Read \`skills/deep-finish/SKILL.md\``; `\`deep-resume.md\`가 사용` → `\`skills/deep-resume/SKILL.md\`가 사용`. `Skill("deep-X", args=...)` dispatches (already in orchestrator) now resolve to skill bodies via `user-invocable: true` enrollment.

### Rationale — cross-platform parity completes the suite-wide migration

- Slash commands are Claude Code-exclusive; user-invocable skills work in **Codex / Copilot CLI / Gemini CLI / Agent SDK** via `Skill({ skill: "deep-work:<verb>", args: "..." })`.
- This is the **4th and final installment** of the suite-wide command→skill migration: deep-docs v1.3.0 (pilot, 1 command) → deep-evolve v3.4.0 (2nd, 1 command + `$ARGUMENTS`) → deep-wiki v1.6.0 (3rd, 5 commands) → **deep-work v6.7.0 (4th, 24 commands)**. All four installments share the same mechanical pattern (frontmatter `user-invocable: true`, `## Invocation` + `## Inputs (skill args)` + `## Prerequisites` head sections, body byte-preservation, cross-ref sed retargeting), proven across 3 prior PRs.
- 24 atomic conversion (not partial) is required because `deep-status` is a hub that dispatches to 4 sub-skills via inline body Read; partial conversion would break the hub-spoke graph. Half of the 24 (Category A, 7) are 1-line frontmatter changes + wrapper deletion, so the real new-skill authoring volume is 17.

### Migration — for callers

- **Claude Code / cross-platform skill callers**: invoke via `Skill({ skill: "deep-work:<verb>", args: "..." })` or the host's equivalent skill invocation syntax. All 24 surfaces respond uniformly. Example: `Skill({ skill: "deep-work:deep-finish", args: "--skip-integrate --handoff-to=deep-wiki" })`.
- **`$ARGUMENTS` preservation**: bodies that branch on `$ARGUMENTS` (notably `deep-finish` flags, `deep-fork` session-id + `--from-phase`, `deep-status` flag matrix, `deep-insight` / `drift-check` / `solid-review` target args, `deep-assumptions` subcommands) are preserved byte-for-byte — `args` field of `Skill()` is mapped to `$ARGUMENTS` identically to slash invocation.
- **`phase-guard.sh` untouched** — already hardcodes `skills/deep-integrate/` for Phase 5 enforcement (since v6.5). Phase 5 dispatch unchanged.
- **`BUG_REVIEW_REPORT.md` left as-is** — historical audit artifact pinned to v6.5.x line numbers; preserving historical accuracy.

### Tests

- All 177 existing `node:test` assertions continue to pass: `envelope-emit`, `envelope-chain`, `handoff-roundtrip`, `phase-guard-denylist`, `phase-guard-golden`. None of the 5 test files reference `commands/*` paths (verified pre-conversion), so no test updates were required.
- `grep -rn 'commands/deep-\|commands/drift\|commands/solid'` across the entire plugin (excluding CHANGELOG / BUG_REVIEW_REPORT / docs/ / node_modules / .git) yields **0 hits** post-conversion.

## [6.6.3] - 2026-05-12

### Added — M5.5 #3 hook golden test + M5.5.X (§9) phase-guard hardening rollup

- **`tests/phase-guard-golden.test.js`** — fixture-driven golden test (M5.5 #3). Loads `tests/fixtures/golden/<name>.input.json` + `<name>.expected.json` pairs and asserts exit code + decision + reason regex against `phase-guard.sh`. Initial corpus: 8 scenarios covering idle allow, implement slice scope (in/out), four non-implement denylist families (rm-rf, npm-publish, curl-pipe-shell, sql-destructive), and override pass-through. Driver fails loud on half-commits (missing `.input` or `.expected`).
- **`hooks/scripts/test-helpers/run-phase-guard.js`** — shared `scrubHostEnv()` + `runPhaseGuard()` + `parseGuardOutput()` helpers (§9.2 W-R2.2). Consolidates the host-env scrub (`DEEP_WORK_SESSION_ID` / `DEEP_WORK_ROOT` / `CLAUDE_PROJECT_DIR`) that `tests/phase-guard-denylist.test.js` introduced inline, so sibling hook tests get host-env isolation without duplicating an incomplete deletion list per file.
- **`tests/phase-guard-denylist.test.js` §9.3 additions** — 7 new assertions:
  - Pre-flight assertion that `NON_IMPLEMENT_DANGEROUS` corpus covers every `family:` entry in `phase-guard-core.js` `DANGEROUS_NON_IMPLEMENT_PATTERNS`.
  - Per-family override loop (5 families × research phase) — exercises every `CLAUDE_ALLOW_<FAMILY>=1` env var end-to-end so a typo in any override field gets caught at CI.
  - Override fall-through composition test (`CLAUDE_ALLOW_RM_RF=1 + 'rm -rf foo && cp x.txt /etc/host.conf'`) — pins the contract that override env suppresses ONLY the denylist branch and falls through to the file-write gate.

### Changed

- **`hooks/scripts/phase-guard-core.js`** — §9.1 comment block extended at the non-implement branch entry to document (a) gate order, (b) load-bearing ordering rationale, (c) override-env semantics (suppresses denylist only, file-write still applies), (d) Phase 5 cross-coverage from `phase-guard.sh`.
- **`hooks/scripts/phase-guard-core.js`** — §9.3 I-R3.1 `DANGEROUS_NON_IMPLEMENT_PATTERNS` docblock extended with intentional scope omissions (`DELETE FROM`, `DROP DATABASE`, alternate shell pipes, `yarn publish`, disk-level commands).
- **`hooks/scripts/{phase-guard-hardening,phase5-guard,worktree-guard,multi-session,input-parsing-e2e}.test.js`** — §9.2 migration: replaced inline `{ ...process.env, ... }` spreads with `scrubHostEnv()` from the shared helper.

### Notes

- This PR is the M5.5 #3 (deep-work side) + M5.5.X (§9.1 + §9.2 + §9.3) rollup spec'd in `claude-deep-suite/docs/superpowers/plans/2026-05-12-m5.5-remaining-tests-handoff.md` §9 "Suggested rollup PR". M5.5 #3 for deep-evolve / deep-wiki and #5 for deep-review / deep-wiki / deep-evolve are tracked in separate PRs.
- Test count: **162 → 177** (+15: 8 golden + 7 §9.3 = 15 new). npm test runtime ~29s on macOS bash 3.2.

## [6.6.2] - 2026-05-12

### Added — M5.5 #7 non-implement dangerous-command denylist (PR #28, 3 review rounds)

- **`tests/phase-guard-denylist.test.js`** — 162-assertion phase-guard contract test covering Phase 5 read-mostly allowlist (7 spec families) + non-implement denylist (5 families × 4 phases + controls + regression guards).
- **`hooks/scripts/phase-guard-core.js`** — `DANGEROUS_NON_IMPLEMENT_PATTERNS` (5 families: rm-rf, npm-publish, kubectl-destructive, sql-destructive, curl-pipe-shell) + `matchDangerousNonImplement()` + denylist gate at research/plan/test/brainstorm Bash entry. Each family has a `CLAUDE_ALLOW_<FAMILY>=1` env override.
- **R3 regex fixes**: W-R3.1 (SQL TRUNCATE single-char bug) + W-R3.2 (kubectl `--all-namespaces` false-positive).

## [6.6.1] - 2026-05-12

### Added — M5.5 #4 cross-platform CI matrix (PR #27)

- **`.github/workflows/tests.yml`** — `os: [ubuntu-latest, macos-latest]` × `node-version: '20'` matrix running `npm test` + 3 bash regression scripts.
- **`hooks/scripts/test/test-v6.4.2-regression.sh` §2** — cross-platform `stat` fallback (`stat -c '%a' || stat -f '%A'`) caught by the new ubuntu leg on first run.

## [6.6.0] - 2026-05-12

### Added — M5.7.A plugin-side adoption of cross-plugin handoff + dashboard compaction telemetry

- **`hooks/scripts/emit-handoff.js`** — CLI helper that wraps a handoff payload in the M3 envelope (`artifact_kind = "handoff"`, `schema.name = "handoff"`, `schema.version = "1.0"`) and writes it under `.deep-work/handoffs/` (or per-session). Flags: `--payload-file`, `--output`, `--source-session-receipt` (auto-chains `parent_run_id`), `--source-review-report`, `--parent-run-id`, `--session-id`. Payload required fields enforced before write: `schema_version`, `handoff_kind`, `from{producer,completed_at}`, `to{producer,intent}`, `summary`, `next_action_brief` — matches `claude-deep-suite/schemas/handoff.schema.json` + dashboard's `PAYLOAD_REQUIRED_FIELDS["deep-work/handoff"]`.
- **`hooks/scripts/emit-compaction-state.js`** — CLI helper that wraps a compaction-state payload in the M3 envelope (`artifact_kind = "compaction-state"`, `schema.name = "compaction-state"`). Two input modes: build payload from CLI flags (`--trigger`, `--preserved`, `--discarded`, `--strategy`, `--pre-tokens`, `--post-tokens`) for hook-driven emit, OR `--payload-file` for skill-composed emit. Trigger enum validated against suite schema (`phase-transition`, `slice-green`, `loop-epoch-end`, `window-threshold`, `manual`, `session-stop`). Strategy enum validated. Powers dashboard metrics `suite.compaction.frequency` + `suite.compaction.preserved_artifact_ratio`.
- **`commands/deep-finish.md` §7-Z-A** — new section after envelope wrap that emits a cross-plugin handoff when `--handoff-to=<plugin>` is supplied (or user opts-in interactively). Chains `parent_run_id` to the session-receipt envelope automatically. Writes to `.deep-work/handoffs/<UTC-ts>-<session_id>.json` matching dashboard's flat-dir `SOURCE_SPECS`.
- **`hooks/scripts/session-end.sh`** Stop hook — best-effort `compaction-state.json` emit on session close (`trigger: session-stop`, `strategy: receipt-only` when session-receipt exists, otherwise preserves the state file). Wrapped in subshell + `|| true` to preserve the Stop hook's "must not block session close" contract.
- **`hooks/scripts/phase-transition.sh`** PostToolUse hook — emits `compaction-state.json` on each Phase boundary (`trigger: phase-transition`, `strategy: key-artifacts-only`). Preserved set chosen per Phase: research→research.md, plan→research+plan, implement→plan, test→plan+receipts, idle→session-receipt.
- **`tests/handoff-roundtrip.test.js`** — 16 assertions covering M5.5 #8 (deep-work half): payload-required-field contract identical to dashboard, CLI roundtrip producing envelopes that satisfy a mirrored `unwrapStrict`, cross-plugin chain (`parent_run_id === session-receipt.envelope.run_id`), trigger enum coverage (all 6 values), failure paths (missing required field → exit 1, unknown trigger → exit 1).

### Changed

- **`hooks/scripts/envelope.js`** — `ALLOWED_ARTIFACT_KINDS` extended from `{session-receipt, slice-receipt}` to include `handoff` and `compaction-state`. The set is consumed by both `wrapEnvelope` (output guard) and `unwrapEnvelope` (input guard); existing identity-triplet semantics preserved for session-receipt / slice-receipt callers.
- **`scripts/validate-envelope-emit.js`** — `ALLOWED_KINDS` extended symmetrically so the CI validator accepts the two new envelope kinds. Payload `schema_version === "1.0"` enforcement carries through unchanged.

### Notes

- This release is **producer-only** for the new artifact kinds. deep-work does not consume `handoff.json` or `compaction-state.json` from other plugins; the dashboard does. Cross-plugin contract is enforced by `claude-deep-dashboard/lib/suite-collector.js unwrapStrict`.
- See `claude-deep-suite/docs/superpowers/plans/2026-05-11-m5.7-plugin-adoption-handoff.md` §M5.7.A for the M5 acceptance criteria this milestone closes.

## [6.5.0] - 2026-05-07

### Added
- **M3 cross-plugin envelope adoption** for `session-receipt.json` and `receipts/SLICE-*.json` (claude-deep-suite Phase 2 priority #3; cf. `claude-deep-suite/docs/envelope-migration.md` §1). Both artifacts now ship as `{ schema_version: "1.0", envelope: { producer, producer_version, artifact_kind, run_id, generated_at, schema, git, provenance, [parent_run_id], [session_id] }, payload: { ... legacy receipt body ... } }`.
- **`hooks/scripts/envelope.js`** — shared zero-dep envelope library: MSB-first ULID generator (Crockford Base32, 26-char), `detectGit()` head/branch/dirty trio with safe `0000000` fallback, `loadProducerVersion()` resolved relative to module path (handoff §4 literal-cwd-resolve), `wrapEnvelope()` builder, `unwrapEnvelope()` reader with full identity guards (producer / artifact_kind / schema.name) and corrupt-payload defense.
- **`hooks/scripts/wrap-receipt-envelope.js`** — CLI helper invoked by markdown agent prompts (`agents/implement-slice-worker.md`, `commands/deep-finish.md`) to wrap a payload temp file. Supports `--source-evolve-insights`, `--source-harnessability`, `--source-artifacts-glob` for cross-plugin / intra-plugin chain extraction (writes `parent_run_id` from evolve-insights envelope and aggregates slice receipt + harnessability `run_id` into `provenance.source_artifacts[]`).
- **`scripts/validate-envelope-emit.js`** — zero-dep self-test validator mirroring suite envelope schema. Enforces `additionalProperties: false` on root / envelope / git / schema / provenance / source_artifacts items, ULID Crockford alphabet (rejects I/L/O/U), SemVer 2.0.0 strict, RFC 3339, kebab-case, `schema.name === artifact_kind` identity, payload non-null/non-array object with `schema_version: "1.0"` preserved.
- **`tests/envelope-emit.test.js`** + **`tests/envelope-chain.test.js`** + **fixtures (`sample-session-receipt.json`, `sample-slice-receipt.json`)** — 50+ assertions covering ULID/SemVer/RFC3339 patterns, identity guards, corrupt-payload defense, `parent_run_id` cross-plugin chain (session-receipt.envelope.parent_run_id === consumed evolve-insights.envelope.run_id), and intra-plugin chain (session-receipt's `provenance.source_artifacts[]` aggregates all SLICE-*.json `run_id`s).

### Changed
- **`agents/implement-slice-worker.md`** — slice receipt emission protocol now writes the legacy body to `$WORK_DIR/receipts/.SLICE-NNN.payload.json` first, then invokes `node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/wrap-receipt-envelope.js --artifact-kind slice-receipt ...` to produce the final envelope-wrapped `SLICE-NNN.json`. Payload `schema_version` must be the literal string `"1.0"`.
- **`commands/deep-finish.md`** — Section 2 now writes the session-receipt body to `$WORK_DIR/.session-receipt.payload.json`. Sections 2-1 (quality fields) and 7 (outcome/outcome_ref) update the same temp file. New Section 7-Z performs the envelope wrap exactly once, after the outcome is decided, so `envelope.run_id` is generated only once per session. Cross-plugin chain is auto-detected from `.deep-evolve/<session>/evolve-insights.json` and `.deep-dashboard/harnessability-report.json`.
- **`hooks/scripts/verify-delegated-receipt-runner.js`** — slice receipt loader invokes `unwrapEnvelope()` so verify-receipt-core sees the legacy body whether the file is envelope-wrapped or legacy. Identity-mismatched envelopes throw with a descriptive error.
- **`hooks/scripts/validate-receipt.sh`** — `json_field` helper detects M3 envelope and reads from `.payload`, with full identity guard before unwrap. Falls through to top-level read for legacy receipts.
- **`hooks/scripts/session-end.sh`** — slice receipt aggregation loop skips foreign envelopes (producer/artifact_kind/schema.name mismatch) before counting toward `slices_total`.
- **`hooks/scripts/receipt-migration.js`** — envelope-wrapped receipts are recognized as already-migrated (no-op); the legacy v0 → v1.0 lift only applies to top-level legacy receipts.
- **`skills/deep-integrate/gather-signals.sh`** — `read_json_safe` accepts optional `expected_producer` / `expected_artifact_kind` arguments and returns `.payload` for matching envelopes, `null` for foreign envelopes (defense-in-depth, handoff §4 round-4 lesson). Applied to deep-work session-receipt, deep-docs last-scan, deep-dashboard harnessability-report, deep-evolve evolve-insights, deep-wiki index. Forward-compat for deep-review/deep-evolve/deep-wiki Phase 2 priority #4–#6.
- **`skills/deep-research/SKILL.md`** — Cross-Plugin Context section (Harnessability + Evolve Insights) documents envelope detection + identity guard procedure, with legacy fallback for forward-compat.
- **`commands/deep-receipt.md`** / **`commands/deep-status.md`** / **`commands/deep-report.md`** — receipt read instructions document the envelope-aware unwrap rule (identity guard + payload extraction; legacy pass-through preserved).

### Notes
- Suite-side updates (claude-deep-suite `marketplace.json` SHA bump, `payload-registry/deep-work/{session,slice}-receipt/v1.0.schema.json` placeholder → authoritative shape, adoption ledger update) are out of scope for this PR per claude-deep-suite handoff §1: M3 Phase 2 plugin PRs touch the plugin repo only; suite-side updates are batched in Phase 3.

## [6.4.2] — 2026-04-29

### Added
- **Profile schema v3** — `interactive_each_session` array lets each user customize which items are asked every session. `defaults.*` separates values that are applied automatically.
- **session-recommender sub-agent** — sonnet by default; receives task description + workspace meta + capability and returns fenced JSON recommendations. Allowlist `^(haiku|sonnet|opus)$`.
- **`--no-ask` flag** — skips ask + recommender entirely (fastest path). `--profile=X --no-ask` is the v6.4.x "proceed as-is" equivalent.
- **`--recommender=MODEL` / `--no-recommender` flags** — override the recommender model or skip the recommender step entirely.
- **State file `recommendations` field** — optional; has no effect on phase-guard enforcement.
- **State file permissions 600** — README guidance added for multi-user environments.
- **`scripts/load-v3-profile.js`** — v3 schema profile loader (orchestrator §1-3-3).
- **`scripts/parse-deep-work-flags.js`** — CLI flag parser with allowlists (PROFILE_NAME / RECOMMENDER / EXEC / TDD / RESUME_FROM).
- **`scripts/detect-capability.js`** + **`scripts/format-ask-options.js`** — environment capability detection + AskUserQuestion option formatter.
- **`scripts/migrate-profile-v2-to-v3.js`** — profile v2→v3 migration helper: atomic write + `flock` + idempotent + `.v2-backup` + rollback procedure.
- **`scripts/recommender-input.js`** + **`scripts/recommender-parser.js`** — session-recommender input sanitization and output parser (5-key validation).
- **`agents/session-recommender.md`** — session-init recommendation sub-agent (sonnet by default).

### Changed
- **`--profile=X` semantics preserved** — proceeds through the ask step as in v6.4.x (prevents silent regression). Users who relied on the fast path need to add `--no-ask`.
- **Profile v2 → v3 auto-migration** — atomic write + `flock` + idempotent + `.v2-backup` backup + rollback procedure in README.
- **Orchestrator §1-3 unified** — single confirm replaced by per-item ask N times + LLM recommendation. ask/recommender results are in-memory only; atomically serialized at §1-9 state-creation time.
- **Assumption auto-adjust → recommender order** — auto-adjust result is reflected in recommender input `current_defaults`.

### Fixed
- **Shell injection in flag parser**: `parse-deep-work-flags` now accepts quoted single-string `$ARGUMENTS` — shell metacharacters are no longer evaluated before the allowlist check (orchestrator §1-3-1 invocation pattern).
- **v6.4.1 `git_branch` profile compat**: `migrate-profile-v2-to-v3` translates `git_branch: <bool>` (v6.4.1 schema) to `defaults.git.use_branch` instead of rejecting it as an unsupported schema.
- **Capability detection false negatives**: orchestrator §1-4-2 now uses `git rev-parse --is-inside-work-tree` + `git worktree list` instead of the `IS_GIT` env var — fixes false non-git detection in normal git repos.
- **`--profile=X` not forwarded to loader**: `--profile=X` is now passed to `load-v3-profile.js` via `DEEP_WORK_INITIAL_PRESET` env (parity with migrate-profile call).
- **Preset-level settings silently dropped**: `loadV3Profile` now returns `project_type`, `cross_model_preference`, and `auto_update` (previously these were dropped, silently losing zero-base / cross-model / auto-update settings).

### Removed
- **Notification system removed entirely** — `hooks/scripts/notify.sh` (195 lines), `hooks/scripts/notify-parse.test.js` (125 lines), `skills/shared/references/notification-guide.md` (59 lines) deleted. Notify.sh guards cleaned from 5 phase skills + `multi-session.test.js`. **Note**: the `notification` variable in `assumption-engine.{js,test.js}` is an assumption auto-adjust result message (internal vocabulary) unrelated to external notifications — preserved.

### Breaking Changes (patch bump, but explicit notice required)

- **Notification webhook users**: notify.sh + Slack/Discord/Telegram/webhook integrations are severed by this release. The patch bump was a user decision, but any active external webhook integration must be manually forked/backported before upgrading.
- **Automated scripts using only `--profile=X`**: from v6.4.2, `--profile=X` proceeds through the ask step (to avoid silent regression). Add `--profile=X --no-ask` to preserve the old behavior.
- **Profile schema v2 → v3 auto-migration**: no preserved data is lost, but `notifications.url` and similar fields are unrecoverable. `.v2-backup` is retained (rollback is possible).

### Migration

- v6.4.x → v6.4.2: auto-migration runs on first call + one-time notice. External webhook integrations are severed by this release.
- Rollback: `mv .claude/deep-work-profile.yaml.v2-backup .claude/deep-work-profile.yaml` (project-local).

### Spec & Plan

- Design: `docs/superpowers/specs/2026-04-29-deep-work-flexible-init-design.md`
- Plan: `docs/superpowers/plans/2026-04-29-deep-work-flexible-init.md`

## [6.4.1] - 2026-04-26

### Changed
- **Harness Engineering hardening**: SessionStart sensor detection now avoids slow `npx --no-install` probes and uses local `node_modules/.bin` plus fast PATH lookup so missing-tool environments complete well inside hook timeout.
- **Phase 1 Health Engine wiring**: `deep-research` now documents the parent-owned topology, fitness proposal, health report, baseline, and unresolved required issue flow. `health-check` CLI auto-loads `.deep-review/fitness.json` by default and supports explicit `--fitness` / `--no-fitness`.
- **Health report schema alignment**: `/deep-status` and `/deep-receipt` now read the actual producer paths under `health_report.drift.*` and `health_report.fitness.*`.

### Fixed
- **`multi-session.test.js:507` lint guard false-positive**. The exclusion regex only exempted `multi-session.test.js` itself, so legitimate test fixtures in `phase5-guard.test.js` (8 intentional `deep-work.local.md` references required to exercise the legacy-path code path) were flagged as "hardcoded legacy path in active code". Regex broadened from `multi-session\.test\.js` → `\.test\.js` so all test files are exempt — test files legitimately need these paths to verify legacy behavior. `node --test hooks/scripts/*.test.js` now reports 428/428 pass (previously 427/428 with this known failure documented in v6.3.1 Excluded notes).
- **Receipt sensor validation compatibility**: Parent receipt verification now rejects empty/arbitrary sensor results, `fail`, `timeout`, and unsupported `not_applicable`, while still accepting documented metadata such as `sensor_results.ecosystem` and legacy delegated `skipped` statuses.
- **Health Check CLI root parsing**: `--fitness <file>` and `--fitness=<file>` option values are no longer mistaken for the positional project root.

## [6.4.0] - 2026-04-23

### Changed — Breaking
- **`model_routing.{research, implement, test}="main"` removed**. Existing state files are auto-migrated to `"sonnet"` on load. `model_routing.plan="main"` is preserved (Plan phase keeps conversational main-session execution).
- **`team_mode` semantics unified** to concurrency only (solo=1, team=N). Main-session inline execution is now an explicit escape hatch, not a hidden default.

### Added
- 3 Claude Code subagents under `agents/`:
  - `research-codebase-worker` — existing-codebase research (read-only tool allowlist)
  - `research-zerobase-worker` — new-project research with web access (WebSearch/WebFetch/Context7 MCP)
  - `implement-slice-worker` — TDD-enforced slice cluster implementation
- `hooks/scripts/verify-delegated-receipt.sh` + `verify-receipt-core.js` — 8-item post-hoc receipt validation (scope, baseline chain, TDD hard-fail, recorded verification output advisory)
- §5.6a Rollback Protocol: `git reset --hard <delegation_snapshot>` on verify-receipt failure
- §5.5a inline escape hatches: auto-routing (spike, trivial inline plan) + `--exec=<inline|delegate>` CLI override + debug takeover via `active_cluster_takeover` state field
- `scripts/validate-agents.sh` — static sanity check for agents/*.md

### Fixed
- Silent fallback from `team_mode=team` to solo when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` was missing (original bug)
- Single `git_before` baseline reused across multi-slice receipts → per-slice `git_before_slice`/`git_after_slice` (F1)
- Path-filtered diff hiding out-of-scope edits → unfiltered union-scope check (F2)
- Zero-base subagent inheriting Write/Edit/Bash + web access → explicit read-only tool allowlist (F3 security)

### Migration
See `docs/migrations/v6.4.0.md`.

## v6.3.1 — 2026-04-21

### Fixed

- **Phase skill body echo 버그** — `Skill("deep-*")` 호출 시 SKILL.md 본문의 markdown 템플릿이 사용자에게 노출된 뒤 phase 작업(예: brainstorm의 명확화 질문)이 수행되지 않고 대화가 종료되는 현상. 브레인스톰의 명확화 질문 누락 및 리서치/플랜의 분석 단계 누락을 모두 해결.
- **Exit Gate pause/resume 회귀** (F1) — phase skill이 완료 시 current_phase를 다음 phase로 미리 전환하던 기존 동작이 Exit Gate "일시정지" 선택 시 `/deep-resume` 재개 경로에서 Exit Gate를 건너뛰고 다음 phase로 자동 진입하는 문제를 야기. current_phase 변경 주체를 Orchestrator로 일원화하여 해결.

### Added

- **4계층 echo 방어** (5개 phase skill 공통):
  1. `> [!IMPORTANT]` admonition 블록 — skill body echo 금지 + Pre-checks 예외 허용
  2. 템플릿 외부 분리 — `skills/shared/templates/{brainstorm,research}-template.md` + `plan-template-{existing,zerobase}.md` (2-mode 분기)
  3. First Action 서브섹션 — phase 진입 시 즉시 수행할 가시 첫 동작 명시
  4. Section 3 실행 순서 안전장치
- **Phase Exit Gate × 5** — 각 phase 완료 시 AskUserQuestion으로 "진행 / 재실행 / 일시정지" 선택. "진행" 선택 시 즉시 다음 skill 호출.
- **완료-Marker 감지 분기** — 모든 5개 phase skill Section 1에서 `*_completed_at` 필드 감지 시 Orchestrator로 제어 반환 (Exit Gate 재표시).

### Changed

- **current_phase 변경 주체 일원화**: Brainstorm/Implement phase skill이 Section 3에서 직접 변경하던 동작 제거. 모든 phase의 current_phase 변경을 Orchestrator Exit Gate "진행" 분기로 이관.
- Orchestrator §1-11 문구: "자동 흐름을 시작합니다..." → "각 phase 완료 시 진행 확인을 받으며 순차 실행합니다..."
- `review-approval-workflow.md`: Exit Gate와의 관계 명시.

### Excluded

- Phase 5 Integrate는 이미 interactive loop이므로 Exit Gate 적용 대상에서 제외.
- Hook 스크립트 로직 변경 없음. `node --test hooks/scripts/*.test.js` 결과: 397/398 pass. 1 pre-existing failure (`multi-session.test.js:507` - phase5-guard.test.js fixture와의 lint 충돌)는 main 브랜치에도 존재하며 v6.3.1과 무관.

### Added (v6.3.1 NW5 integrity check + NO3 data preservation)

- **Approval integrity hash** — Research/Plan approval 시점의 `sha256(research.md/plan.md)`를 `research_approved_hash` / `plan_approved_hash`로 state에 기록. `/deep-resume` Resume fast-path가 현재 파일 hash와 비교하여 out-of-band 편집(일시정지 중 외부 편집기 수정 등)을 자동 감지 — 불일치 시 **data preservation + in-place review** 경로 발동 (NO3): 편집된 문서를 `$WORK_DIR/{research,plan}.v{N}-edit.md`로 백업 + approval state invalidate + Skill 재호출 스킵하고 Review+Approval workflow 직접 진입. 편집 내용이 보존된 채 재검토되어 사용자 편집이 유실되지 않음. 필드 부재 시(pre-v6.3.1 세션 또는 재실행 후 재승인 전)는 Skill 재실행이 safer default.
- **Backup filename collision 방지 (NP3)**: orchestrator가 생성하는 hash mismatch backup은 `-edit` 접미사를 사용하여 deep-plan/deep-research skill의 자체 backup(`v{N}.md`)과 파일명 충돌 방지.

### Known Limitations (v6.3.2 예정)

- **Hash mismatch recovery의 plan-specific validation 부재**: NO3 data preservation 경로는 generic Review+Approval workflow를 실행하나, `deep-plan` 고유 validation(Completeness Policy, Contract Negotiation, Phase Review Gate)는 스킵됨. Out-of-band 편집이 `TBD` 같은 placeholder를 추가한 뒤 승인되는 경로는 현재 가드 불충분. Workaround: Exit Gate option 2 "재실행/수정"을 사용하면 skill 재실행으로 모든 validation 적용됨. v6.3.2에서 in-place review에도 phase-specific validation hook 추가 예정.
- **Backup write-failure fail-safe 부재**: NO3 backup 복사 실패 시(권한/디스크 full 등) state 변경을 중단하는 가드 없음. 희귀 edge case이며 data는 여전히 원본 research.md/plan.md에 남아있음. v6.3.2에서 backup 실패 시 state 변경 중단 + 사용자 알림 가드 추가 예정.

## [6.3.0] — 2026-04-18

### Added
- **Phase 5 "Integrate"** — new skippable phase after Test that reads deep-suite plugin artifacts (`deep-review`, `deep-docs`, `deep-wiki`, `deep-dashboard`, `deep-evolve`) and lets an AI recommend top-3 next steps which the user can choose to execute. Interactive loop (max 5 rounds) with recommendation + rationale + signals. Design spec: `docs/superpowers/specs/2026-04-18-phase5-integrate-design.md`.
- `/deep-integrate` command for manual re-entry after skipping Phase 5.
- `--skip-integrate` flag to skip Phase 5 and go directly to `/deep-finish`.
- `skills/deep-integrate/` — new skill with helper scripts (`detect-plugins.sh`, `gather-signals.sh`, `phase5-finalize.sh`, `phase5-record-error.sh`), JSON schemas, and L6 snapshot fixtures.
- `phase5_work_dir_snapshot` state field — immutable boundary snapshot recorded at Phase 5 entry, used by phase-guard as enforcement reference so that runtime tampering with `work_dir` cannot widen the write boundary.
- `phase5-finalize.sh` helper — atomically records `phase5_completed_at` in the session state file. Validates the state file matches the current session and is the only sanctioned path for writing to state during Phase 5.
- `phase5-record-error.sh` helper — used by `/deep-finish --skip-integrate` to record `terminated_by: "error"` in `integrate-loop.json` when Phase 5 failed. Belt-and-suspenders alongside the Stop-hook `terminated_by: "interrupted"` marker.
- Stop-hook: record `terminated_by: "interrupted"` in `integrate-loop.json` on session interruption.

### Changed
- `deep-work-orchestrator` dispatches Phase 5 between Phase 4 (Test) and `/deep-finish`. On Phase 5 error, passes `--skip-integrate` to `/deep-finish` so state-machine can close.
- `/deep-finish` hints `/deep-integrate` when no `integrate-loop.json` exists. `--skip-integrate` now bypasses the Phase 5-interrupted prompt and runs `phase5-record-error.sh` defensively.
- **`phase-guard.sh` — new Phase 5 mode** (supersedes the prior "no changes required" plan in earlier drafts). When `current_phase=idle + phase5_entered_at + !phase5_completed_at` the guard enforces:
  - `Write/Edit/MultiEdit/NotebookEdit`: target path must be under snapshot `$WORK_DIR`; state file direct modification is blocked — only `phase5-finalize.sh` may mutate it.
  - `Bash`: **allowlist-only (default-deny)**. The first command token (after env-var prefixes) must be in the Phase 5 read-mostly allowlist: filesystem read (`cat`/`head`/`tail`/`wc`/`ls`/`pwd`/`file`/`stat`/`realpath`/`readlink`/`dirname`/`basename`), search/filter (`grep`/`sort`/`uniq`/`diff`/`cut`/`paste`/`column`/`tr`/`find`), JSON/YAML read (`jq`/`yq` without `-i`), shell builtins (`echo`/`printf`/`date`/`env`/`true`/`false`/`test`/`which`/`type`/`command`/`xxd`/checksums), `git` with read-only subcommand (`status`/`diff`/`log`/`show`/`blame`/`grep`/`rev-parse`/`rev-list`/`merge-base`/`symbolic-ref`/`ls-files`/`ls-tree`/`branch`/`tag`/`config`/`describe`/`cat-file`/`fsck`/`shortlog`/`reflog`/`name-rev`/`for-each-ref`/`count-objects`/`verify-pack`/`check-ignore`/`check-attr`/`var`/`help`/`version`), interpreters (`bash`/`sh`/`python`/`perl`/`ruby`/`node`/`awk`/`sed`/`php`/`osascript`/`tsx`/`deno`/`bun`) with canonical script path check, or filesystem ops (`mv`/`cp`/`mkdir`/`rm`/`rmdir`/`chmod`/`chown`/`truncate`/`touch`/`ln`/`install`) with target-in-`$WORK_DIR` verification. Unknown commands are rejected outright. Additional constraints: destructive variants (`/bin/rm`, `\rm`, `command/exec/builtin rm`) normalized; `git` global flags (`-C <path>`, `--git-dir [=]<path>`, `--work-tree [=]<path>`, `-c <k=v>`, `-p`/`--no-pager`/`--bare`/...) stripped via fixed-point iteration; `git` mutating subcommands (`add|commit|stash|checkout|merge|reset|rebase|cherry-pick|revert|apply|mv|rm|tag|push|fetch|pull|clean|am|format-patch|worktree|branch|submodule|notes|update-ref|write-tree|hash-object|bisect|replace|gc|prune|repack|reflog|remote|restore|switch|filter-branch|filter-repo`) blocked after normalization; `find -delete/-exec/-ok/...` blocked; `jq/sed/perl/ruby -i` in-place flags blocked; interpreter `-c/-e` flags blocked; compound operators (`;`, `&&`, `||`, `|`, `&`) rejected; shell metacharacters in helper paths (`$`, `` ` ``, `(`, `)`, `<`, `>`, newline, CR) rejected. `mv`/`cp` checks both SRC and DEST. **Interpreter + script invocations** (e.g. `python foo.py`, `sh foo.sh`) require the script path's canonical `realpath` to exactly match `${PROJECT_ROOT}/skills/deep-integrate/<helper>.sh` or `${HOME}/.claude/plugins/cache/claude-deep-suite/deep-work/*/skills/deep-integrate/<helper>.sh`; fake helpers under `$WORK_DIR` and other cached plugins are rejected. All other tools (`Read`, `Glob`, `Grep`, `Agent`, `AskUserQuestion`, `Skill`) pass through.
- `/deep-integrate` tool allowlist narrowed to `Skill, Read, Bash, Glob, Grep, Agent, AskUserQuestion` (removed `Write, Edit`).

### Upgrade notes
- Sessions that entered Phase 5 under v6.2.x without `phase5_work_dir_snapshot` will fall back to reading `work_dir` from the state file. Phase-guard preserves backward compatibility via this fallback, but such sessions are more exposed to state-tampering attacks. Re-entering Phase 5 on v6.3.0 records the snapshot automatically.
- `phase5-finalize.sh` rejects any state-file path whose basename does not match `deep-work.<sid>.md` in a `.claude/` directory. Callers that previously wrote to state via direct redirect must migrate to this helper.
- **Dependencies**: `phase5-record-error.sh`, `gather-signals.sh`, and the Stop-hook `terminated_by` marker require `jq` on `PATH` (helpers exit with an explicit error when missing). `phase5-finalize.sh` uses only `awk` (no `jq` dependency).

### Known limitations
- **Interpreter coverage**: `Rscript`/`julia`/`lua`/`groovy`/`tclsh` are not yet in the interpreter allowlist — if these become part of a legitimate Phase 5 workflow they must be added explicitly. Track in v6.3.1.
- **`awk -f script.awk`**: the `-f` flag form is not covered by the interpreter-with-script canonical check (only `awk -e/-c` is blocked via the `-c/-e` rule). Practical risk is low because the Phase 5 Bash allowlist rejects unknown forms and legitimate workflow does not use `awk -f`.
- **Legacy session upgrade**: sessions that started Phase 5 under v6.2.x without the `phase5_work_dir_snapshot` field fall back to the mutable `work_dir`; re-entering Phase 5 in v6.3.0 populates the snapshot.
- **`phase5-record-error.sh` / `phase5-finalize.sh` unit tests**: currently covered indirectly via `phase5-guard.test.js`. Dedicated unit test file planned for v6.3.1.
- **Allowlist command abuse**: commands in the read-mostly allowlist are permitted in their standard read-only form but remain theoretically abusable in niche invocations (e.g. `find` minus mutating flags blocked; `jq` without `-i`; `mv`/`cp`/`mkdir` with target checks; other entries assumed safe). Deeper per-command invocation audit (esp. `curl` is not allowed; data-exfil mitigation on other networked helpers) tracked in v6.4.0.
- **Non-Bash tools (`Agent`/`Skill`)**: pass through the Phase 5 guard. Subagents dispatched via `Agent` carry their own tool set; Phase 5 enforcement applies only to the invoking session's Bash/Write/Edit. Treated as out-of-scope trust boundary for v6.3.0.

## [6.2.4] — 2026-04-17

Bug fix release addressing 15 hook-layer bugs + 7 documentation drift items identified by an internal audit (`BUG_REVIEW_REPORT.md`). Plan reviewed independently before execution; 5 additional critical issues found during review were also addressed.

### Fixed

**Hooks — portability & parsing**
- `file-tracker.sh`: Replace BSD-only `sed -i ''` with a Node.js inline script. The previous code failed silently on Linux (`sed -i`'s GNU syntax differs), leaving `sensor_cache_valid` stale after marker-file changes. The insert-when-missing path also mis-handled the second `---` delimiter even on macOS — now fixed.
- `update-check.sh`: Pass the plugin path via `process.argv[1]` instead of shell interpolation. An install path containing an apostrophe (e.g. `/Users/O'Brien/...`) caused a JS syntax error and silently skipped the update check.
- `phase-guard.sh` / `file-tracker.sh` / `phase-transition.sh`: Replace regex-based `file_path` extraction with `extract_file_path_from_json` (JSON parser). Paths containing escaped quotes (`a \"b\" c.txt`) were truncated, causing spurious blocks and receipt corruption.
- `phase-transition.sh`: Extract the innermost `deep-work.XXXX` segment for `SESSION_ID`. Fork worktree paths like `.deep-work/sessions/deep-work.s-parent/sub/.claude/deep-work.s-child.md` now resolve to `s-child` instead of a multi-line mess that broke the cache file path.

**Hooks — race conditions**
- `file-tracker.sh` receipt updates: Wrap read-modify-write with a mkdir-based spinlock (40 retries × 50ms). On timeout, queue the pending entry to `<receipt>.pending-changes.jsonl`; the next lock holder drains it crash-safely (rename-to-`.draining.<pid>` → merge → canonical rename → unlink `.draining`). A crash anywhere mid-drain leaves recoverable state; the next invocation sweeps stray `.draining.*` files. Previously, 5+ concurrent PostToolUse invocations could drop `files_modified` entries, and the first-pass lock-timeout path could silently orphan queued entries if no later write drained them.
- `sensor-trigger.js` + `file-tracker.sh` state YAML updates: Both now acquire the same `<state>.lock` before read-modify-write — including the marker-file `sensor_cache_valid` flip in `file-tracker.sh` (which initially missed the lock in v6.2.4 and was flagged by post-review). Previously, `current_phase` / `active_slice` / `sensor_pending` / `sensor_cache_valid` could race and lose one of the writes.
- `utils.sh` `write_registry`: Fail-closed on lock timeout (no force-remove of another process's lock directory). The old force-remove behaviour silently corrupted the session registry under contention. Callers (`register_session`, `update_last_activity`, `register_file_ownership`, `update_registry_phase`, `unregister_session`, `register_fork_session`) now use `_try_write_registry` which logs failures to `.claude/deep-work-guard-errors.log` instead of silently swallowing them.
- `session-end.sh` JSONL append: Lock timeout queues to `<jsonl>.pending-append.jsonl`. Drain on the next append uses the same rename-first crash-safe pattern as the receipt path. Retries bumped 10 → 20.

**Hooks — validation hardening**
- `phase-guard-core.js`: Internal errors (malformed input, runtime exceptions) now `process.exit(3)` with a JSON block message pointing at the guard error log. Intentional blocks continue to exit 0 with `decision=block`. Previously, both paths exited 2 — indistinguishable in user-facing output.
- `phase-guard.sh`: Translate Node exit 3 to hook exit 2 with the debug-oriented block message. Empty `decision` on stdout now fail-closes with a distinct message instead of silently allowing.
- `phase-guard.sh`: Read `slice_files` / `strict_scope` / `exempt_patterns` from state frontmatter (via the new `read_frontmatter_list` helper) and pass them into the Node input. Previously, these fields were never populated, so `checkSliceScope` received `undefined` and returned `inScope=true` unconditionally — the slice-scope contract in `deep-implement/SKILL.md` was silently unenforced.
- `phase-guard.sh` block messages: All 4 heredocs now JSON-escape interpolated fields (file path, worktree path, phase label, next-step). Messages with literal quotes or newlines previously produced invalid JSON.

**Hooks — phase-transition injector (C-1)**
- `file-tracker.sh` caches stdin to `$PROJECT_ROOT/.claude/.hook-tool-input.<ppid>` **before** any phase-based early return, and writes atomically via `.tmp.$$` + `mv`. `phase-transition.sh` falls back to this cache when `CLAUDE_TOOL_USE_INPUT` / `CLAUDE_TOOL_INPUT` are unset — which is the actual Claude Code production behaviour (these env vars are not part of the hook protocol). Previously (even after the initial v6.2.4 fix), the cache was only written inside the `implement`-phase branch, so research→plan, plan→implement, and test→idle transitions never refreshed the cache; `phase-transition.sh` would fall back to a stale implement-phase payload or no-op. Post-review fix moves the cache write to the top of the hook.
- `session-end.sh` now cleans up its own `.hook-tool-input.$PPID` and reaps `.hook-tool-input.*` files older than 60 minutes — the cache is transient per-tool-call and should not accumulate across sessions.

**Notifications**
- `notify.sh`: YAML-aware `notifications.enabled` parser. Previously, `grep -q "^  enabled: false"` false-positive-matched an unrelated `team_mode:\n  enabled: false`, silently suppressing all channels.
- `notify.sh`: `_osascript_escape` helper applied to macOS `osascript` calls. A double-quote in the message (e.g. `phase "done"`) previously caused a silent syntax error.
- `notify.sh`: `_xml_escape` helper applied to Windows PowerShell toast XML. `<`, `&`, `"` in the message would have broken the XML document and the notification would never appear.
- `notify.sh`: Drop `pipefail` from `set -euo pipefail`. This is a best-effort script; many `grep` pipelines legitimately return non-zero when a channel isn't configured, and `pipefail` turned those no-ops into script aborts.

**Documentation**
- 21 broken `skills/shared/references/` → `../shared/references/` link fixes across 7 `SKILL.md` files (`deep-work-workflow`, `deep-test`, `deep-implement`, `deep-plan`, `deep-research`, `deep-brainstorm`, `deep-work-orchestrator`).
- 13 `(v6.2.1)` labels in `commands/*.md` refreshed to `(v6.2.4)`.
- `commands/deep-finish.md` example: `"deep_work_version": "5.3.0"` → `"6.2.4"` (was frozen across two minor releases).
- `hooks/hooks.json` description: `(v5.6.0 Session Fork)` → `(v6.2.4)`.
- `skills/deep-work-orchestrator/SKILL.md`: Corrected Test row in the phase ownership table — it is Orchestrator (not the Phase Skill) that transitions Test → idle after `/deep-finish`.
- `skills/deep-work-orchestrator/SKILL.md`: Documented `--resume-from=<phase>` flag that `deep-resume.md` was already passing, but was undocumented in Orchestrator.
- `CLAUDE.md`: Added previously-omitted directories and files to the structure listing (`sensors/`, `health/`, `templates/topologies/`, `assumptions.json`, `package.json`).

### Internal

- New `hooks/scripts/utils.sh` helpers consumed across the hook layer:
  - `_acquire_lock` / `_release_lock`: mkdir-based advisory spinlock, fail-closed on timeout (logs to `.claude/deep-work-guard-errors.log`).
  - `extract_file_path_from_json`: JSON-parser-based file_path extraction; handles escaped quotes correctly.
  - `json_escape`: JSON-string escape for safe interpolation into block messages. Argument required — no stdin fallback (prevents hook hangs).
  - `read_frontmatter_list`: reads YAML list fields (inline `[a, b]` or block `- a`) from frontmatter; emits JSON array.
- `hooks/scripts/utils.sh` `write_registry`: refactored to use `_acquire_lock` with fail-closed behavior.
- Test suite: 329 tests (from 294 in 6.2.3), across 91 suites. Net +35 tests covering: portability (3), input parsing e2e (5), notify YAML/escape (4), receipt race (1, 80 parallel writes — now validates canonical completeness + empty pending sidecar + no leftover `.draining.*` files), phase-guard hardening (6), phase-transition cache (2), utils helpers (19), post-review robustness (7: cache-before-phase-check × 4 phases, marker-flip lock behaviour × 2, atomic cache write × 1).
- Independent review (3-way: Opus + Codex review + Codex adversarial) identified 3 critical + 3 warning issues on the initial v6.2.4 branch; all were addressed before merge. Report: `.deep-review/reports/2026-04-17-implementation-review.md`.

### Known limitations

- Cross-platform CI matrix is not yet in place. All new fixes are unit-tested against Node `node --test`, but Linux/Windows coverage relies on the new portability logic rather than CI enforcement. Tracked for a future release.

## [6.2.3] — 2026-04-16

### Changed
- **trigger-eval.json v6.2 update**: Benchmark test set expanded from 31 to 54 samples (true 21 + false 33). Added 10 true samples for v6.2 features (Session Fork, Mutation Test, Brainstorm, Team Mode, Assumption Engine, Worktree, English queries, semantic-only trigger, Debug). Added 13 false samples (homophone disambiguation, meta-queries, English hard negatives, standalone command invocations). Reclassified 5 existing true samples to false (SOLID review, drift check, deep-status, quality gate config, preset setup) — standalone commands should not trigger full workflow sessions.

## [6.2.2] — 2026-04-16

### Fixed
- **Cross-platform hooks compatibility**: Removed POSIX inline env var assignments (`FOO=bar command`) from all 5 hook commands in `hooks.json`. Windows `cmd.exe` cannot parse this syntax, causing all hooks to fail silently. Scripts now read Claude Code's native env vars (`CLAUDE_TOOL_USE_TOOL_NAME`, `CLAUDE_TOOL_USE_INPUT`) directly with backwards-compatible fallback.

### Changed
- `hooks/scripts/phase-guard.sh`: reads `CLAUDE_TOOL_USE_TOOL_NAME` with `CLAUDE_TOOL_NAME` fallback
- `hooks/scripts/file-tracker.sh`: reads `CLAUDE_TOOL_USE_TOOL_NAME` with `CLAUDE_TOOL_NAME` fallback
- `hooks/scripts/phase-transition.sh`: reads `CLAUDE_TOOL_USE_INPUT` with `CLAUDE_TOOL_INPUT` fallback

## [6.2.1] — 2026-04-15

### Changed
- **Command classification cleanup**: 11 commands previously labeled `Deprecated in v5.2` and 2 more (`deep-brainstorm`, `deep-phase-review`) in the same table are now reclassified into five accurate categories: Quality Gate (3), Internal (6), Escape hatch (1), Utility (2), and Special utility (`/deep-phase-review` moved out).
- **`/deep-finish` framing**: now described as "auto-call is primary, manual invocation remains a first-class path after test pass" rather than deprecated.
- **Hook/skill user-facing guidance** now routes to `/deep-status` flags:
  - `hooks/scripts/assumption-engine.js`: `/deep-assumptions` → `/deep-status --assumptions`
  - `hooks/scripts/session-end.sh`: `/deep-report` → `/deep-status --report`
  - `skills/deep-test/SKILL.md`: same alignment
- **Session Report manual policy**: both `/deep-report` and `/deep-status --report` remain supported manual entry points. Wording is unified across `skills/deep-work-workflow/SKILL.md` heading + body, `commands/deep-report.md` body, and `commands/deep-resume.md` body.
- **README** (en/ko): "Deprecated Commands (13)" single table replaced by five category tables; "What changed" bullets updated to reflect reclassification (not deprecation); body references to `/deep-cleanup`/`/deep-resume` in the Worktree Isolation section reframed as standalone utilities.
- **`skills/deep-work-workflow/SKILL.md`** classification section rewritten into 6 categories (Primary / Special / Quality Gate / Internal / Escape hatch / Utility).

### Not changed
- **No commands removed.** `/deep-cleanup` and `/deep-resume` continue to be the sole path for worktree scan/fork cleanup and for active-session selection/worktree restore/phase dispatch respectively. Their feature migration is tracked as a follow-up.
- **No functional behavior changed.** Existing slash commands continue to work exactly as before; only labels, wordings, and version numbers changed.
- Historical `v5.2` deprecated notes in earlier sections are preserved as-is.

## [6.2.0] — 2026-04-14

### Added
- **Cross-Plugin Context**: Phase 1 Research에서 harnessability-report.json(deep-dashboard)과 evolve-insights.json(deep-evolve)을 참조하여 research context 강화.

## v6.1.0

### 3-Layer Architecture + Computational Guard

Resolves inferential enforcement failures from 2026-04-12 session (worktree isolation bypass, team mode bypass, codex bypass).

#### Added
- **P0 Worktree Path Guard** — PreToolUse hook that hard-blocks Write/Edit/Bash outside the active worktree path. Meta directories (`.claude/`, `.deep-work/`) are exempt, anchored to PROJECT_ROOT to prevent external path bypass. Works across all phases, independent of session ID.
- **P1 Phase Transition Injector** — PostToolUse hook that injects worktree_path, team_mode, cross_model_enabled, and tdd_mode into LLM context when `current_phase` changes. Uses cache file for transition detection, `CLAUDE_TOOL_INPUT` env var for stdin safety.
- **6 Phase Skills** — Independent SKILL.md for each phase (brainstorm 120L, research 183L, plan 165L, implement 187L, test 147L, orchestrator 230L). Context load reduced 45-81% from original commands.
- **Review + Approval Workflow** — 6-step protocol for Research and Plan: auto review → main agent judgment → user approval → modification → final confirmation. Orchestrator manages `current_phase` for these phases.
- **`review-approval-workflow.md`** reference — Shared protocol document for Research/Plan review gates.

#### Changed
- **Command → Thin Wrapper** — 6 core phase commands reduced to single `Skill()` dispatch calls. `Skill` added to `allowed-tools` in all wrappers.
- **References relocated** — `skills/deep-work-workflow/references/` → `skills/shared/references/` (14 files). All command/skill paths updated.
- **`deep-resume` updated** — Research/Plan resume routed through orchestrator (prevents dead-end). Test-passed resume routes to `/deep-finish`.
- **`deep-test` phase transition** — No longer sets `current_phase: idle` on success. Orchestrator/finish handles idle transition.
- **Receipt contract** — `status: "complete"` field explicitly required in implement receipts (deep-test gate dependency).
- **Drift gate fallback** — `plan_approved_at` fallback chain: timestamp → plan.md mtime → 24h commit window.
- **`cross_model_enabled` parsing** — Nested YAML mapping support via `grep -A3` fallback in phase-transition.sh.
- **`session-end.sh`** — Phase cache cleanup on session end (stale P1 injection prevention).

#### Architecture
```
Layer 1: Commands (thin wrappers) → Skill dispatch
Layer 2: Skills (execution logic) → 100-230 line SKILL.md + shared references
Layer 3: Hooks (enforcement) → P0 hard block + P1 context injection
```

## v6.0.2

### Phase Review Gate
- **Unified Review Gate** — Every phase (0-3) now runs self-review + external review before transitioning. User confirms results before proceeding.
- **Phase-specific Fallback Chain** — Phase 0-2 (documents): Structural + Adversarial + Opus subagent. Phase 3 (code): deep-review plugin → codex/gemini + Opus → self + Opus.
- **User Confirmation UX** — Summary view with 3 options: auto-fix, proceed as-is, show details. Detail view allows per-issue fix/skip.
- **Degraded Mode** — Graceful fallback when external reviewers fail.
- **`/deep-phase-review` unified** — Manual review now uses the same Fallback chain as automatic gates.

### Work Folder Rename
- **Session folder renamed** — `deep-work/` → `.deep-work/` (hidden directory). Matches `.claude/`, `.git/` conventions.
- **Auto-migration** — Existing `deep-work/` folders are automatically migrated on next session start. Worktree safety check included.
- **Metadata update** — State files, JSONL history, and fork metadata paths are updated during migration.
- **Selective .gitignore** — Only session folders (`.deep-work/20*/`) and history are excluded, not config files.

## [6.0.1] - 2026-04-10

### Added — Superpowers Integration (Slice Review, Red Flags, Escalation)

- **Slice Review (Step C-2)**: Per-slice 2-stage independent review after sensor pipeline. Stage 1 (Spec Compliance, required) + Stage 2 (Code Quality, advisory). Subagent failure fallback with graceful degradation.
- **Red Flags tables**: Rationalization prevention in implement (10 entries) and test (6 entries) phases. Complements hook-based hard gates with soft behavioral guidance.
- **Pre-flight Check (Step A-2)**: Prerequisite verification before TDD cycle. Uses `command -v` for safe executability check. 2 options: continue (done_with_concerns) or plan revision.
- **Status Reporting**: `slice_confidence` (done/done_with_concerns) and `concerns` array per slice receipt. Automatic judgment based on review/sensor/pre-flight history.
- **Agent delegation prompt extended**: Rules 7-10 for self-review, receipt recording, pre-flight, and confidence judgment in delegated agents.
- **Phase 4 cross-slice + backfill review**: Section 4-2/4-3 rewritten with full control flow (prompt, parser, judgment, storage, display). Slices with Phase 3 FAIL are mandatory backfill targets.
- **Scope creep detection**: `git diff --name-only` against all changed files, not just slice files.
- **Per-slice working tree diff**: `git diff $git_before` (not `..HEAD`) for accurate uncommitted change capture.
- **deep-finish.md concerns summary**: Slice confidence tally and concerns list in session report.

### Changed

- Phase 4 Spec Compliance (4-2) and Code Quality (4-3) gates now focus on cross-slice consistency instead of per-slice validation (already done in Phase 3).
- `changes.git_diff` in receipts now uses per-slice baseline (`git diff $git_before -- [files]`).
- `AskUserQuestion` added to deep-implement.md `allowed-tools`.
- Version references updated to 6.0.1 across CLAUDE.md, SKILL.md, package.json, plugin.json.

## [6.0.0] - 2026-04-09

### Added
- **Computational Sensor Pipeline (#2)** — Registry-driven sensor orchestration integrated into the TDD workflow:
  - `sensors/registry.json`: Ecosystem definitions for JS, TS, Python, C#, C++ with detect rules, lint/typecheck/mutation commands, and coverage flags
  - `sensors/detect.js`: Automatic ecosystem detection from project marker files (package.json, tsconfig.json, pyproject.toml, etc.)
  - 8 output parsers: eslint, tsc, ruff, generic-line, generic-json, stryker, dotnet, clang-tidy
  - TDD state machine extension: SENSOR_RUN → SENSOR_FIX → SENSOR_CLEAN states after GREEN
  - Self-correction loop: automatic sensor execution after GREEN, up to 3 fix rounds per sensor
  - `sensor-trigger.js`: Config/marker file changes trigger ecosystem-wide sensor re-scan
  - `/deep-sensor-scan`: Standalone computational sensor scan command
  - Detection result caching (`.sensor-detection-cache.json`)
  - Fail-closed policy: non-zero exit + 0 diagnostics = explicit failure
- **Mutation Testing (#1)** — AI-generated test quality verification:
  - Stryker (JS/TS), stryker-net (C#), mutmut (Python) integration via registry.json
  - `/deep-mutation-test`: git diff-based scope, automatic test regeneration loop (up to 3 rounds)
  - Implement phase return pattern: Phase 4 mutation failure → Phase 3 TDD loop for test hardening
  - Mutation Score Quality Gate (Advisory) + Session Quality Score integration (15% weight)
  - `stryker-parser.js`: possibly_equivalent tagging for NoCoverage + logging mutations
  - Receipt `mutation_testing` field: score, survived_details, auto_fix_rounds
- **Health Engine (#3A)** — Automatic Health Check during Phase 1 Research with 4 drift sensors running in parallel:
  - `dead-export`: Detects unused JS/TS exports via grep-based cross-referencing (entry point/library/barrel exclusion, health-ignore.json support)
  - `stale-config`: Detects broken path references in tsconfig.json, package.json, .eslintrc
  - `dependency-vuln`: Runs `npm audit --json` for known high/critical vulnerabilities (Required gate)
  - `coverage-trend`: Compares current coverage against previous session baseline (5%p threshold)
- **Architecture Fitness Functions (#4)** — Declarative architecture rules in `.deep-review/fitness.json`:
  - 4 rule checkers: `file-metric` (line count), `forbidden-pattern` (regex), `structure` (colocated tests), `dependency` (circular deps via dep-cruiser)
  - `fitness-validator.js`: JSON schema validation + rule execution engine with `required_missing` status
  - `fitness-generator.js`: Ecosystem-aware auto-generation (dependency rules excluded for non-JS/TS projects)
  - dep-cruiser install suggestion with explanation when dependency rules are present but tool is missing
- **Health Check Orchestrator** (`health-check.js`) — Parallel drift scan (Promise.allSettled) + sequential fitness validation with per-sensor timeouts (180s total)
- **Baseline Management** — `health-baseline.json` with commit/branch scoping, automatic invalidation on branch switch, rebase (git merge-base --is-ancestor), or 7-day expiry
- **Phase 4 Quality Gates**:
  - Fitness Delta Gate (Advisory) — Detects new fitness violations added during implementation
  - Health Required Gate (Required) — Propagates Phase 1 required failures with user acknowledge flow
  - Phase 4 Baseline Refresh — Updates health-baseline.json after gates pass
- **Receipt Schema Extension** — `health_report` field with `scan_commit` for deep-review stale detection
- **deep-review Integration** — fitness.json injected into review agent prompt + receipt health_report consumed with commit-based staleness check
- **Harness Templates (#5)**: Topology detection layer with 6 built-in topologies (nextjs-app, react-spa, express-api, python-web, python-lib, generic). Template loader with deep merge and custom/ override support. Phase 1/3 integration with topology-specific guides. Fitness generator extended with template fitness_defaults.
- **Self-Correction Loop (#6)**: review-check sensor with always-on layer (topology guides) and fitness layer (fitness.json rules). Per-sensor 3-round independent correction limit. Config disable support. Receipt schema extension.

### Changed
- Session Quality Score now uses 5 weights (Test Pass Rate 25%, Rework Cycles 20%, Plan Fidelity 25%, Sensor Clean Rate 15%, Mutation Score 15%). Health Check is excluded from scoring.
- `sensors/registry.json` — Added `audit` field to javascript/typescript ecosystems

## [5.8.1] - 2026-04-08

### Changed
- **Breaking**: `/deep-review` → `/deep-phase-review` renamed to resolve naming conflict with deep-review plugin (deep-suite). Phase document review is now `/deep-phase-review`; code diff review uses the deep-review plugin.
- Updated references in `deep-plan.md`, `deep-resume.md`, `README.md`, `README.ko.md`
- deep-review plugin integration (Sprint Contract, slice review, full review) unchanged

## [5.8.0] - 2026-04-08

### Added
- **Completeness Policy** (Section 3.3-1) — explicit banned patterns for plan.md (TBD, TODO, vague directives, cross-references without content). Enforced via Claude self-review + structural review `code_completeness` dimension.
- **Code sketch tiering** — S: annotated pseudocode, M: actual function signatures + type definitions, L: complete boundary code (interfaces, APIs, tests). Replaces "pseudocode or actual code" with proportional standard.
- **Slice fields: `expected_output`, `steps`** — `expected_output` defines what `verification_cmd` should print on success. `steps` provides execution guidance within M/L slices (3-12 numbered actions). Both optional for backward compatibility.
- **`failing_test` detail tiers** — S: file + description, M: function signature + key assertion, L: complete test body for boundary tests.
- **"Boundary: Files NOT to Modify"** section in plan templates — prevents scope creep during implementation.
- **Research traceability tags** — `[RF-NNN]` for Key Findings, `[RA-NNN]` for interfaces/signatures. Tags enable plan Architecture Decision to reference specific research evidence.
- **Research Tag Lifecycle Rules** — monotonic numbering, incremental preservation, deletion warnings for plan-referenced tags.
- **Research `Testing Patterns` section** — documents existing test framework, assertion style, file naming for plan test specification.
- **Brainstorm context-adaptive questions** — core 2 + context-adaptive 1-3 (by task type: feature/refactoring/bug/performance/integration) + closing boundary question.
- **Brainstorm `Scope Assessment`** — decomposition check + quick codebase pulse before approach comparison.
- **Brainstorm `Boundaries` section** — documents what explicitly stays unchanged, feeds into plan Boundary section.
- **Review gate dimensions: `code_completeness`, `buildability`** — synchronized across 4 locations (structural table, hardcoded dimensions, cross-model Plan Rubric, JSON schema).
- **Review gate backward compatibility fallback** — legacy plans without `expected_output`/`steps` evaluated with relaxed criteria per dimension.

### Changed
- `deep-implement.md` slice parser now recognizes `expected_output`, `steps`, `contract`, `acceptance_threshold` fields (all optional for backward compatibility).
- Step B-1 (RED) uses test code from `failing_test` field when available (M/L slices).
- Step B-2 (GREEN) compares `verification_cmd` output against `expected_output` when available.
- `deep-work.md` inline plan template updated: `failing_test: [to be determined during implementation]` → `[구현 시 결정 — inline mode]` with Completeness Policy exemption comment.
- `research-guide.md` quality criteria expanded from 4 to 8 items (RF/RA tags, code snippets per section, test patterns).
- `plan-templates.md` API Endpoint template upgraded to v5.8 exemplar with full slice format. Legacy templates marked with migration guide.
- `testability` dimension description clarified: `expected_output` is recommended, not required.

## [5.7.0] - 2026-04-08

### Added
- **W1: Sprint Contract 생성** — Phase 2 plan 승인 후, deep-review 플러그인이 설치되어 있으면 plan.md의 슬라이스에서 `.deep-review/contracts/SLICE-{NNN}.yaml` 자동 생성
- **W2-a: 슬라이스 리뷰 제안** — Phase 3에서 슬라이스 GREEN 도달 시 `/deep-review --contract SLICE-{NNN}` 실행 제안
- **W2-b: 전체 리뷰 제안** — Phase 4 진입 시 `/deep-review` 전체 리뷰 실행 제안
- **K1: 위키 ingest 제안** — Phase 4 완료 후 `/wiki-ingest report.md` 실행 제안

### Changed
- Sprint Contract 생성 시점을 plan 작성 직후에서 **plan 승인 후**로 이동 (최종 plan과 contract 일치 보장)
- 플러그인 감지를 cache + plugins 이중 경로로 통일 (설치 방식 무관)

## [5.6.0] - 2026-04-07

### Added
- **`/deep-fork` command**: Fork a deep-work session to explore different approaches while preserving the original session.
  - Git environment: worktree-based full replication with dirty state validation (`git stash --include-untracked`), session-ID-based branch suffix (race-condition-free), automatic worktree context switch (`FORK_PROJECT_ROOT`).
  - Non-git environment: artifacts-only replication with plan phase limit (implement/test blocked by phase guard).
  - Parent-child relationship tracking via `fork_info` and `fork_children` in state files.
  - `fork-snapshot.yaml` for comparison baseline at fork point.
  - Stale parent validation (commit existence for git, work_dir existence for non-git).
  - Fork generation limit: max 3 generations with warning.
- **`/deep-status --tree`**: Visualize fork relationship tree with UTF-8 tree characters.
- **`/deep-status --compare` auto-detection**: Auto-detect fork relationships when no session IDs given (parent↔child comparison).
- **`/deep-status` fork info display**: Show `fork_info` and `fork_children` in default status output.
- **`/deep-cleanup` fork support**: Scan for idle fork sessions, batch cleanup when parent + all children are idle.
- **Phase guard**: Block implement/test phases for `artifacts-only` fork sessions with actionable error message.
- **Fork utility functions** in `utils.sh`: `validate_fork_target`, `get_fork_generation`, `update_parent_fork_children`, `register_fork_session` (atomic registry + parent update).
- **`session-end.sh`**: Update parent's `fork_children` status to idle when fork session ends.
- **Fork integration tests**: 18 integration tests covering atomic registration, multi-fork, phase-guard integration, edge cases, and git worktree fork.

### Changed
- `deep-work-sessions.json` registry: Added `fork_parent` and `fork_generation` fields per session entry.
- State file YAML frontmatter: Added `fork_info` (parent relationship) and `fork_children` (child list) sections.

## [5.5.2] - 2026-04-06

### Added
- **Extended bash file-write detection**: 20+ new FILE_WRITE_PATTERNS including perl in-place (`perl -pi -e`), runtime language writes (node -e `fs.writeFileSync`, python -c `open().write()`, ruby -e `File.write`), awk in-place, swift, truncate, sponge, destructive git operations (`reset --hard`, `clean -f`), curl/wget output, ln, tar/unzip/cpio extraction, rsync, and generic `writeFile` detection.
- **Extended safe command patterns**: docker/kubectl read-only, cargo build/check/bench, go build/vet, deno test/check, bun run/x, python unittest, tsc --noEmit, stat/du/df/free/uname/hostname, diff/file, env/printenv, rmdir.
- **Extended test file patterns**: Dart (`.test.dart`, `_test.dart`), Elixir (`_test.exs`), Lua (`.test.lua`), Vue (`.test.vue`), `fixtures/`, `__fixtures__/`, `__mocks__/`, `spec/` directories.
- **Extended TDD exempt patterns**: `.toml`, `.ini`, `.cfg`, `.lock`, `.editorconfig`, `.svg`, `.png`, `.jpg`, `.gif`.
- **TDD state validation**: Unknown TDD states are now blocked with actionable error message in processHook.
- **Backtick and subshell handling**: `splitCommands` now correctly handles backtick quoting and `$()` subshell depth tracking, preventing false splits inside nested expressions.
- **Perl target file extraction**: `extractBashTargetFile` now extracts target files from `perl -pi -e` commands for accurate TDD enforcement.

### Fixed
- **Security: file-write-first detection order**: FILE_WRITE_PATTERNS are now checked before SAFE_COMMAND_PATTERNS, preventing safe patterns from masking file writes (e.g., `node -e` with `fs.writeFileSync` was previously bypassed).
- **file-tracker.sh Node.js 25 argv compatibility**: Fixed `process.argv` indexing — Node.js 25 no longer includes `[eval]` marker, causing receipt creation to silently fail. Now uses `process.argv.filter(a => a !== '[eval]')` for cross-version compatibility.
- **assumption-engine.js quality-timeline CLI**: Fixed reference to raw `input` string instead of parsed `parsed` object, causing the CLI action to always return empty results.
- **assumption-engine.js evalSignal threshold passing**: Signal evaluator `threshold` field is now correctly passed to `fn()` instead of relying on hardcoded default parameters.
- **assumption-engine.js readHistory dedup order**: Changed from keep-first to keep-latest when deduplicating by `session_id`, preventing finalized records from being ignored in favor of earlier active records.
- **assumption-engine.js input guards**: Added `Array.isArray` checks in `isSessionDuplicate`, `detectStaleness`, `detectNewModel`, and `generateReport` to prevent crashes on non-array inputs.
- **session-end.sh JSON validation**: Added JSON validation before JSONL append to prevent malformed entries from corrupting harness-sessions.jsonl.
- **session-end.sh session ID fallback**: Falls back to `DEEP_WORK_SESSION_ID` env var when `started_at` field is missing from state file.
- **session-end.sh error logging**: Errors now logged to `.claude/deep-work-guard-errors.log` instead of suppressed via `/dev/null`.
- **phase-guard.sh error logging**: Node.js errors now appended to `.claude/deep-work-guard-errors.log` instead of discarded.
- **utils.sh matchGlob trailing slash**: Normalized trailing slashes in exact path comparison.
- **utils.sh session pointer safety**: Added `mkdir -p` before writing session pointer file.
- **utils.sh session ID generation**: Fixed tab character stripping in hex generation from `/dev/urandom`.

### Changed
- **Redirect detection broadened**: General output redirection pattern changed from `(?:^|\|)` prefix to `(?:^|[|;]|\s)` to catch mid-command redirects (e.g., `cat << EOF > file`).
- **`node -e` removed from safe patterns**: Previously treated as safe, now evaluated against file-write patterns like any other command.
- **Model name sanitization**: `validateModelName` now strips non-alphanumeric characters; `lookupModel` adds `toString().trim()` for robust size normalization.
- **Signal evaluator thresholds**: Made configurable via `threshold` field on evaluator definitions (previously hardcoded as default parameters).
- **Broader redirect pattern**: Mid-command redirects (heredoc, after whitespace) now correctly detected.

## [5.5.1] - 2026-04-03

### Changed
- **Plan phase team research cross-verification**: When `team_mode: team`, the plan phase now loads partial research files (`research-architecture.md`, `research-patterns.md`, `research-dependencies.md`) as supplementary references. Claude self-review (Section 3.4.5) cross-checks plan decisions against these specialized analyses to catch details lost during synthesis.
- **TDD state update enforcement**: B-1 (RED_VERIFIED) and B-2 (GREEN) state file updates in `deep-implement.md` are now marked as mandatory with explicit phase guard blocking warnings.

### Fixed
- **phase-guard.sh input parsing**: Switched JSON input building from `process.argv` to stdin pipe to avoid `set -e` failures on large tool inputs.

## [5.5.0] - 2026-04-02

### Added
- **Research Cross-Model Review**: codex/gemini adversarial review now applies to research phase (previously plan-only). Uses dedicated research rubric (completeness, accuracy, relevance, risk_identification, actionability).
- **Claude Self-Review for Plan**: Automatic quality check after plan creation — scans for placeholders, internal inconsistencies, research alignment, scope creep, and missing rollback coverage. Auto-fixes obvious defects before structural review.
- **Consolidated Judgment Protocol**: Replaces per-conflict AskUserQuestion with Claude's synthesized judgment + user bulk confirmation. Applied to both research and plan cross-model reviews.
- **Auto-fix Snapshot Contract**: Mandatory snapshots before each auto-fix iteration with score-regression rollback. Research: `research.v{N}.md`, Plan: `plan.autofix-v{N}.md`.
- **Degraded Mode for Reviewers**: Failed cross-model reviewers are explicitly tracked (`reviewer_status` field). Consensus/conflict classification requires 2+ successful reviewers; single-reviewer results classified as standalone issues only.
- **State Schema Migration (v5.5)**: New fields `review_results.{phase}.judgments`, `judgments_timestamp`, `reviewer_status`. Auto-initialization for old state files. Resume validation compares document mtime vs judgments_timestamp.

### Changed
- **Structural Review threshold**: Auto-fix trigger raised from score < 5 to score < 7 for both research and plan phases. Max iterations increased to 3 for research.
- **Research user feedback gate**: Integrated into consolidated judgment step (Step 4.7). Removed duplicate AskUserQuestion from Step 5 and auto-flow Step 9-3.
- **deep-review.md**: Updated to use consolidated judgment protocol instead of per-conflict UX.
- **deep-resume.md**: Resume with `review_state: in_progress` now routes to new review flow with judgments_timestamp validation.

## [5.3.0] - 2026-03-31

### Added
- **Document Intelligence**: Automatic deduplication and pruning when feedback is applied to research.md/plan.md. 3-step protocol: Apply → Deduplicate → Prune with refinement log tracking.
- **Session Relevance Detection**: Scope check before applying feedback — detects out-of-scope requests and offers to start a new session or save to backlog (`deep-work/backlog.md`).
- **Plan Fidelity Score**: Numeric 0-100 score measuring implementation faithfulness to the approved plan. Integrated into drift-check and deep-test inline verification.
- **Session Quality Score**: Automatic quality score (0-100) at session completion. Core metrics: Test Pass Rate (35%), Rework Cycles (30%), Plan Fidelity (35%). Diagnostic metrics (Code Efficiency, Phase Balance) shown for reference only.
- **Assumption Snapshot**: Per-session capture of each assumption's enforcement level at session start. Enables accurate active/inactive cohort analysis.
- **Assumption Engine Quality Integration**: Quality scores fed into assumption evaluation. Cohort analysis with 3-session minimum gate per cohort. Quality impact displayed in `/deep-status --assumptions`.
- **Cross-Session Quality Trend**: ASCII chart showing quality score evolution over sessions. Available via `/deep-status --history`.
- **Quality Badge**: shields.io badge generation for README display. Available via `/deep-status --badge`. Badges: quality score, session count, plan fidelity.
- **Authoritative JSONL write**: `deep-finish` performs the authoritative write to `harness-sessions.jsonl` with atomic upsert (lock pattern). `session-end.sh` writes provisional records only.

### Fixed
- **JSONL path**: `session-end.sh` now writes to shared `deep-work/harness-history/` instead of per-session folder. Fixes bug where session data was invisible to trend/assumption commands.

### Changed
- **README renewal**: Removed demo GIFs. Restructured to problem-solution narrative. Added Quality Measurement and Self-Evolving Rules sections.
- **exportBadge()**: Returns `{ harness, quality, sessions, fidelity }` object instead of flat badge. Breaking change for direct consumers — tests updated.
- **hooks.json**: Description updated to "v5.3 Precision + Evidence Protocol".

## [5.2.0] - 2026-03-31

### Added
- **Auto-flow orchestration**: `/deep-work` now automatically chains all phases (brainstorm → research → plan → implement → test → finish). Plan approval is the only required user interaction
- **Unified `/deep-status`**: New flags `--receipts`, `--history`, `--report`, `--assumptions`, `--all` consolidate 5 separate commands into one
- **Auto-run test gates**: Drift Check (required), SOLID Review (advisory), and Insight Analysis run automatically during `/deep-test` without Quality Gates table configuration

### Changed
- 13 auxiliary commands marked as deprecated (still functional, deprecation notice added)
- `/deep-work` Step 1: session detection now offers resume/new/cancel instead of overwrite warning
- `/deep-test`: Quality Gates table in plan.md is now optional override (auto-detection is default)
- `phase-guard-core.js`: TDD block messages now include auto-flow alternative note
- SKILL.md trimmed from 461 to ~250 lines (version history sections removed)
- plugin.json keywords reduced from 36 to 12

### Deprecated
- `/deep-brainstorm` — auto-runs in `/deep-work` flow
- `/deep-review` — auto-runs in `/deep-plan`
- `/deep-receipt` — use `/deep-status --receipts`
- `/deep-slice` — auto-managed in `/deep-implement`
- `/deep-insight` — auto-runs in `/deep-test`
- `/deep-finish` — auto-runs at end of `/deep-work` flow
- `/deep-cleanup` — auto-detected in `/deep-work` init
- `/deep-history` — use `/deep-status --history`
- `/deep-assumptions` — use `/deep-status --assumptions`
- `/deep-resume` — auto-detected in `/deep-work` init
- `/deep-report` — use `/deep-status --report`
- `/drift-check` — auto-runs in `/deep-test`
- `/solid-review` — auto-runs in `/deep-test`

## [5.1.2] - 2026-03-30

### Added
- **Team mode auto-setup**: When user selects Team mode without the required environment variable, Claude Code now offers to automatically configure `~/.claude/settings.json` instead of only showing manual instructions
- **Team mode runtime validation**: All phases (research, plan, implement) now re-check `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` before attempting team operations, with automatic Solo fallback if unavailable

### Fixed
- **Team mode Solo fallback**: Team mode selection without proper configuration now reliably falls back to Solo mode across all phases, not just at initialization

## [5.1.1] - 2026-03-30

### Fixed
- **CRITICAL: Phase guard fail-closed** — `phase-guard-core.js` catch block now blocks (not allows) on internal errors, preventing TDD/phase enforcement bypass
- **CRITICAL: Receipt atomic writes** — Receipt JSON updates use temp-file + rename pattern to prevent data corruption from concurrent PostToolUse hooks
- **HIGH: Command chain bypass** — `detectBashFileWrite` now splits chained commands (`&&`, `||`, `;`, `|`) and checks each sub-command independently; safe prefix no longer shields file-write suffixes
- **HIGH: Bash TDD target extraction** — New `extractBashTargetFile()` extracts actual destination file from bash commands instead of matching test/exempt patterns against the entire command string
- **HIGH: Skipped phases exact matching** — Substring match replaced with comma-delimited exact match to prevent false positives
- **HIGH: Write/Edit fail-closed on missing file_path** — File editing tools now block (not allow) when file path cannot be extracted from tool input
- **MEDIUM: JSONL history locking** — `session-end.sh` uses mkdir-based locking for concurrent JSONL appends
- **MEDIUM: Cross-platform timestamp parsing** — Duration calculation replaced with Node.js `Date.parse` (removes macOS/GNU date branching)
- **MEDIUM: Notification JSON escaping** — Webhook payloads use `JSON.stringify` for proper newline/unicode escaping
- **MEDIUM: Path normalization** — `normalize_path` resolves `..` segments via `path.resolve` when present
- **MEDIUM: YAML field extraction** — `read_frontmatter_field` uses literal prefix matching instead of regex interpolation
- **MEDIUM: Receipt initial creation** — Heredoc replaced with `JSON.stringify` to prevent slice ID injection

### Changed
- `SIGNAL_EVALUATORS` in assumption engine now use `{ scope, fn }` format; session-scoped signals evaluate once per session, slice-scoped signals aggregate via any-true
- `TEST_FILE_PATTERNS` extended with Rust, Java, C#, Kotlin, Swift patterns
- New exports: `splitCommands`, `extractBashTargetFile` in phase-guard-core.js

## [5.1.0] - 2026-03-30

### Added
- **Auto-Loop Evaluation**: Plan review and test phase auto-retry with max retries and user escalation
- **Contract Negotiation**: Testable `contract` and `acceptance_threshold` fields in slice definitions
- **Assumption Engine Auto-Apply**: Automatic rule adjustment at session start based on Wilson Score evidence
- **Adaptive Evaluator Model**: All evaluator subagents use configurable model (default: sonnet), auto-adjustable by Assumption Engine
- **Phase Skip Flexibility**: `--skip-to-implement` flag for quick fixes, inline slice generation
- **Bidirectional adjustment**: Assumption Engine can tighten rules back when evidence supports it

### Changed
- Structural review now auto-loops on failure (up to 3 attempts) before escalating
- Test phase auto-returns to implement for targeted slice re-execution
- Assumption health report shows active auto-adjustments
- Slice format now includes `contract` and `acceptance_threshold` fields
- Default evaluator model changed from haiku to sonnet

### Fixed
- Assumption Engine report no longer says "Auto-application is a Phase 2 feature"

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
