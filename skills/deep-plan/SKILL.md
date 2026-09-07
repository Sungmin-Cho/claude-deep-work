---
name: deep-plan
description: "Use when authoring or revising the implementation plan for an approved deep-work goal."
user-invocable: true
---

# Plan work by observable outcome

Resolve the plugin root to a literal absolute path. Before reading or running any plugin file, resolve its real path and require containment in that root. All `${CLAUDE_PLUGIN_ROOT}` paths below mean that verified root.

Resolve `--session=ID` from `$ARGUMENTS`; otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context`. Read the returned state path and its `work_dir`; never guess a work directory or change the active pointer to another session. Validate with `session authority validate --state "$STATE_FILE"`. Use the runtime's phase-aware result: a legitimate pre-plan session does not require a plan that has not been created.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`. The runtime owns phase, approval, write, review and receipt mutations. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` for exact current route arguments; consume returned IDs/digests rather than inventing them.

Read the current Spec, relevant research and `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/planning-guide.md`. Author one `$WORK_DIR/plan.md`. Use enough slices to isolate meaningful outcomes and dependencies; there is no fixed step count, size quota or mandatory code sketch.

Fresh plans use schema 3 with one `## Execution Plan` JSON block. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/templates/plan-template-existing.md` (or `plan-template-zerobase.md`) for the authored-source contract. Omit mechanical bindings and capability facts that the compiler derives from the validated Spec and current session. Choose each slice's `execution_basis` explicitly. Source-writing work remains `slice_kind:functional`; `change_kind:non-functional` describes documentation/config work. Explicit strict-required slices cannot select outcome.

An outcome slice defines a positive oracle and a meaningful counterexample for every required ID. Prefer trusted built-in file/JSON checks when adequate. Program oracles bind reviewed code, exact registered command, input/dependency identities and non-secret environment. Never choose an always-zero verifier or alter oracle code to manufacture a negative result.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/review-approval-workflow.md`. If an unchanged combined Spec+Plan approval ref already exists, reuse it. Otherwise preview and publish the current packet, execute the required independent reviewers, then publish its approval ref. The packet exposes exact task-specific context and deeper evidence refs; reviewers assess Spec adequacy, Plan conformance and meaningful checks. Keep role/tier floors and explicit model pins.

Invoke `phase approve --state "$STATE_FILE" --phase plan --artifact "$WORK_DIR/plan.md" --at "$NOW" --approval-ref-json "$APPROVAL_REF"`. The runtime verifies the approval source and exact source/context bindings before emitting plan.json, immutable authority and the verification plan.

Do not add derived source/authority/projection hashes into the authored JSON or edit approved plan bytes for progress. Use runtime receipt/status data. Continue to implementation after approval; an existing authorization does not require another phase question.
