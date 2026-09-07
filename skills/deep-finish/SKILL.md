---
name: deep-finish
description: "Use when finishing an authorized deep-work session with keep, PR, merge or discard and a durable receipt."
user-invocable: true
---

# Finish with durable evidence

Resolve the plugin root to a literal absolute path. Before reading or running any plugin file, resolve its real path and require containment in that root. All `${CLAUDE_PLUGIN_ROOT}` paths below mean that verified root.

Resolve `--session=ID` from `$ARGUMENTS`; otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context`. Read the returned state path and its `work_dir`; never guess a work directory or change the active pointer to another session. Validate with `session authority validate --state "$STATE_FILE"`. Use the runtime's phase-aware result: a legitimate pre-plan session does not require a plan that has not been created.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`. The runtime owns phase, approval, write, review and receipt mutations. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` for exact current route arguments; consume returned IDs/digests rather than inventing them.

Resolve outcome from explicit arguments or existing user authorization: merge, pr, keep or discard. Ask for an outcome only when it is genuinely unspecified and cannot be inferred. Discard remains destructive and must be actually authorized. Internal continuation preferences do not grant push/PR/merge/publication authority.

Use the runtime's authenticated completion/metrics projection. Read `${CLAUDE_PLUGIN_ROOT}/skills/deep-finish/references/session-quality-score.md` for interpretation. Create any required payload/title/body as owned temps; never write a completed session receipt or finalized history record by hand.

Invoke the exact `session finish keep`, `session finish publish-pr`, `session finish merge` or `session finish discard` route from runtime help. It validates readiness before effects and records their intent/results. A post-effect verification or receipt failure resumes from the stored effect identity; never issue a duplicate PR, merge or discard to recover a missing receipt.

The runtime publishes the stable session M3 envelope through the contained canonical wrapper before finalizing state, registry and pointer. New slice/session payloads use registry version 1.1; the top envelope format remains 1.0. Do not invoke the wrapper with a handcrafted completion payload to bypass the runtime.

Verify the terminal receipt and actual requested repository/external outcome. Preserve the active worktree and evidence unless cleanup was requested. Optional memory/wiki ingestion follows explicit applicable authorization and does not substitute for goal completion.

Final response: outcome, artifact/PR/release links, relevant verification and concrete limitations. Do not claim success while publication or verification remains pending.
