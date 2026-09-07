---
name: deep-resume
description: "Use when resuming an interrupted or parked deep-work session from its current phase."
user-invocable: true
---

# Resume without losing task authority

Resolve the plugin root to a literal absolute path. Before reading or running any plugin file, resolve its real path and require containment in that root. All `${CLAUDE_PLUGIN_ROOT}` paths below mean that verified root.

Resolve `--session=ID` from `$ARGUMENTS`; otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context`. Read the returned state path and its `work_dir`; never guess a work directory or change the active pointer to another session. Validate with `session authority validate --state "$STATE_FILE"`. Use the runtime's phase-aware result: a legitimate pre-plan session does not require a plan that has not been created.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`. The runtime owns phase, approval, write, review and receipt mutations. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` for exact current route arguments; consume returned IDs/digests rather than inventing them.

Read only the artifacts appropriate to the current phase. Brainstorm/Research before any plan was bound may resume without spec.md or plan.json. Once a plan has been bound, missing or stale authority requires its authenticated recovery path; do not reset plan_bound_once or convert the session to legacy.

Preserve the original task, latest user steering, explicit method/model/effort, repository mode and accepted evidence. `main` means current model. An unavailable pinned model remains explicitly unavailable; do not migrate it to a cheaper default or silently drop a pin on host change.

If parked, use `session restore` with the current reader and revalidate its source authority. A changed source needs replan; a parked tombstone is not a completed session. Downgrade-check lists active incompatible authority separately from retained parked artifacts.

Recover pending writes, process operations and publication before selecting new work. A completed internal receipt with missing public M3 needs republication, not implementation. A recorded successful external effect needs post-check/publication recovery, not another invocation.

Read the current phase entry by an explicitly contained `${CLAUDE_PLUGIN_ROOT}/skills/deep-<phase>/SKILL.md` path and continue its work. Use `phase continue` for the next internal transition after evidence is valid. `--resume-from` is not authority to clear completed state or skip gates; use the runtime's authenticated rerun/replan operation when required.

Report where work resumed and the next meaningful check; continue existing authorized work without repeated approval prompts.
