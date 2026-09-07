---
name: deep-spec
description: "Use when authoring or reviewing a deep-work executable goal contract, /deep-spec or $deep-work:deep-spec."
user-invocable: true
---

# Author the executable goal contract

Resolve the plugin root to a literal absolute path. Before reading or running any plugin file, resolve its real path and require containment in that root. All `${CLAUDE_PLUGIN_ROOT}` paths below mean that verified root.

Resolve `--session=ID` from `$ARGUMENTS`; otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context`. Read the returned state path and its `work_dir`; never guess a work directory or change the active pointer to another session. Validate with `session authority validate --state "$STATE_FILE"`. Use the runtime's phase-aware result: a legitimate pre-plan session does not require a plan that has not been created.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`. The runtime owns phase, approval, write, review and receipt mutations. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` for exact current route arguments; consume returned IDs/digests rather than inventing them.

Read the task, relevant research and `${CLAUDE_PLUGIN_ROOT}/skills/shared/templates/spec-template.md`. Write `$WORK_DIR/spec.md` with concrete observable requirements and acceptance conditions. Low risk may use empty inapplicable invariant/failure/negative-test arrays; do not manufacture a failing test for a documentation edit. Medium+ and High/Critical retain their validated coverage requirements.

Choose evidence gates matching the planned basis: strict RED/GREEN for strict requirements, outcome positive/control gates for outcome requirements. Keep non-goals, compatibility and material unresolved questions explicit.

For the normal automated flow, draft plan.md alongside the Spec now. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/planning-guide.md` and its contained plan template. Omit mechanical metadata that the runtime derives from this Spec and current session. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/review-approval-workflow.md` and follow its combined Spec+Plan preview, independent review and approval sequence. Preview catches contract errors before spending a review call; it is not approval.

Consume the runtime-produced approval ref with `phase spec approve --state "$STATE_FILE" --artifact "$WORK_DIR/spec.md" --at "$NOW" --approval-ref-json "$APPROVAL_REF"`. An exact unchanged combined review can also authorize the later Plan approval; do not run it twice. An explicitly selected human-gates policy requires actual exact artifact confirmation, never an invented declaration.

Call `phase continue --state "$STATE_FILE"` after approval under existing authorization. Report the artifact and any concrete unresolved goal decision.
