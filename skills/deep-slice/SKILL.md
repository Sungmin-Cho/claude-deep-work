---
name: deep-slice
description: "Use when inspecting, activating or recovering a deep-work slice or selecting its model."
user-invocable: true
---

# Manage the current slice

Resolve the plugin root to a literal absolute path. Before reading or running any plugin file, resolve its real path and require containment in that root. All `${CLAUDE_PLUGIN_ROOT}` paths below mean that verified root.

Resolve `--session=ID` from `$ARGUMENTS`; otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context`. Read the returned state path and its `work_dir`; never guess a work directory or change the active pointer to another session. Validate with `session authority validate --state "$STATE_FILE"`. Use the runtime's phase-aware result: a legitimate pre-plan session does not require a plan that has not been created.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`. The runtime owns phase, approval, write, review and receipt mutations. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` for exact current route arguments; consume returned IDs/digests rather than inventing them.

With no action, display runtime-derived slice status: execution basis, active write window, authenticated completion/publication and pending evidence. Do not infer success from a checked box or a TDD display field.

For `activate SLICE-NNN`, use `slice activate` with the current plan. It rejects conflicting active windows and unmet dependencies. For reset/recovery, use the exact runtime slice operation and preserve unrelated files/healthy sibling receipts.

For model changes, preserve explicit requested model/effort and actual runtime availability. `main` is valid. An unknown model is unverified, not silently replaced.

For new plans, changing strict/outcome basis or promoting a spike requires authenticated replan and fresh evidence. Do not use a spike flag or direct state edit to evade strict-required scope. Historical sessions retain their runtime-supported legacy commands without being relabelled as V3.

After a requested management action, report the actual resulting state and continue the authorized task when applicable.
