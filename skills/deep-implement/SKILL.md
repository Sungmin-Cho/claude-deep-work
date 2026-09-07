---
name: deep-implement
description: "Use when implementing dependency-ready deep-work slices with their sealed strict or outcome verification basis."
user-invocable: true
---

# Implement and verify each sealed outcome

Resolve the plugin root to a literal absolute path. Before reading or running any plugin file, resolve its real path and require containment in that root. All `${CLAUDE_PLUGIN_ROOT}` paths below mean that verified root.

Resolve `--session=ID` from `$ARGUMENTS`; otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context`. Read the returned state path and its `work_dir`; never guess a work directory or change the active pointer to another session. Validate with `session authority validate --state "$STATE_FILE"`. Use the runtime's phase-aware result: a legitimate pre-plan session does not require a plan that has not been created.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`. The runtime owns phase, approval, write, review and receipt mutations. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` for exact current route arguments; consume returned IDs/digests rather than inventing them.

Read `$WORK_DIR/plan.md`, its runtime projection and `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/implementation-guide.md`. Preserve the requested current model and effort; explicit available delegation follows `${CLAUDE_PLUGIN_ROOT}/skills/deep-implement/references/execution-mode.md`.

Select an incomplete dependency-ready slice through `slice activate`. A session has one active slice/write window. Open the appropriate scope with `implement write begin`, edit only those files, and immediately call `implement write accept` with the returned operation/pre-manifest identity. Failed acceptance requires recovery/replan; never mark the edit accepted yourself.

For `strict-tdd-v2`, use actual failing-test writes → `verification run-v2` → `verification red-transition` → `verification proof-publish` before production writes. Then run actual GREEN, applicable sensors/refactor checks and `implement slice complete-v2`. Unsupported policy/Node/runner is an explicit capability result, not permission to fake RED.

For `outcome-v1`, do not run the TDD transition path. After accepted source writes (or `outcome source observe` for already-correct source), use `verification outcome-explain` and explicit `verification outcome-run --prepared-digest ...`. Authenticate positive/control results, publish the required per-ID oracle review and call `implement outcome-complete`. Both views use the final oracle/dependencies; accepted production files are never reverted for a counterexample.

Completion is the authenticated internal receipt plus its public M3 publication. Recover missing publication instead of repeating code. Continue dependency-ready slices, then the Test phase. Report actual completed outcomes and unresolved verification, not instructions or synthetic counts.
