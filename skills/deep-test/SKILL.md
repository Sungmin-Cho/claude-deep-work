---
name: deep-test
description: "Use when validating a deep-work goal, consuming completion evidence or retrying failed slices."
user-invocable: true
---

# Verify the completed goal

Resolve the plugin root to a literal absolute path. Before reading or running any plugin file, resolve its real path and require containment in that root. All `${CLAUDE_PLUGIN_ROOT}` paths below mean that verified root.

Resolve `--session=ID` from `$ARGUMENTS`; otherwise run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context`. Read the returned state path and its `work_dir`; never guess a work directory or change the active pointer to another session. Validate with `session authority validate --state "$STATE_FILE"`. Use the runtime's phase-aware result: a legitimate pre-plan session does not require a plan that has not been created.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`. The runtime owns phase, approval, write, review and receipt mutations. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` for exact current route arguments; consume returned IDs/digests rather than inventing them.

Load the current approved verification plan and authenticated completion receipts. Execute the required gates for each sealed basis; outcome IDs cannot satisfy strict RED/GREEN. Built-in positive/control results remain required even when verification_commands is empty.

Run the relevant checks once; broaden testing when changes, failures or unresolved risk justify it. Required unavailable evidence remains unavailable. Preserve separate observations for test results, machine trace, sensors, mutation and independent goal acceptance.

Before Test consumption, publish the actual completion and contract evidence into its package. For required gate IDs supported by `${CLAUDE_PLUGIN_ROOT}/runtime/completion-evidence-runtime.js` (`GATES`), run `evidence record completion --state "$STATE_FILE" --plan "$WORK_DIR/plan.json" --gate-id "$GATE_ID" --evidence-id "$EVIDENCE_ID"`. For required contract/plan-alignment gates, run `evidence record contract --state "$STATE_FILE" --plan "$WORK_DIR/plan.json" --spec "$WORK_DIR/spec.md" --gate-id "$GATE_ID" --evidence-id "$EVIDENCE_ID"`. The producers authenticate the underlying current receipts and contract; they do not execute missing verification or accept a caller PASS. A slice receipt alone is not the Test evidence package.

For required final independent review, `evidence review-binding --state "$STATE_FILE" --plan "$WORK_DIR/plan.json" --format packet` returns the compact semantic packet, deeper refs and role/tier requirements. Select the available reviewer explicitly, then `evidence review-run --state "$STATE_FILE" --plan "$WORK_DIR/plan.json" --reviewer-json "$REVIEWER" --timeout-ms 300000`; the runtime derives its exact request/prompt/binding. Collect actual execution refs and publish them with `evidence record review-executions` using the gate and evidence IDs required by the current verification plan. Do not rebuild a long review prompt or manually calculate its hashes. Required PASS and per-ID conclusions remain checked by the runtime.

Create an owned `gate-results` input with `temp create`, write the bytes onto the reserved path, and `temp write` to adopt them (`--stdin` remains valid for direct CLI). Then invoke `test pass --state "$STATE_FILE" --plan "$WORK_DIR/plan.json" --gate-results-json "$GATE_RESULTS" --at "$NOW"`. This consumes current evidence; a caller's PASS text is not authority.

On failure, diagnose and use `test retry` or `test exhaust` for the affected slices, preserving healthy sibling evidence. A material contract change goes through authenticated replan. Do not edit test_passed, receipt status or iteration counters yourself.

After Test passes, perform already requested integration and Finish. Optional integration suggestions must not interrupt an explicitly authorized finish chain. Report checks, skipped/unavailable capabilities and remaining goal IDs honestly.
