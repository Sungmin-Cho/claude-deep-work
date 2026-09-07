# Review and approval continuity

Review establishes evidence about an exact artifact. User authorization determines which actions may proceed. Generic task authorization is not a claim that the user personally reviewed unseen Spec or Plan bytes.

For an automated fresh session, draft both spec.md and plan.md while at Spec. Keep the plan task-specific; the source compiler derives mechanical bindings and default metadata. One independent review can cover Spec adequacy and Plan conformance together. Use these public routes through the contained `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js"`:

1. `artifact approval preview --state "$STATE_FILE" --phases spec,plan` validates the draft without publishing approval or executing source. Correct concrete contract errors before dispatch.
2. `artifact approval packet-publish --state "$STATE_FILE" --phases spec,plan` returns a sealed packet and required reviewer roles/tiers. Save its returned ref as JSON; do not reconstruct hashes.
3. Select an available independent reviewer at each required tier, honoring explicit model pins. `artifact approval review-run --state "$STATE_FILE" --packet-ref-json "$PACKET_REF" --reviewer-json "$REVIEWER" --timeout-ms 300000` derives the exact request, prompt and binding. Collect its returned execution refs. Terminal execution alone does not mean review PASS.
4. `artifact approval publish --state "$STATE_FILE" --packet-ref-json "$PACKET_REF" --review-execution-refs-json "$REVIEW_REFS"` authenticates current artifacts and actual qualifying reviews. Save the returned approval ref as JSON.
5. `phase spec approve --state "$STATE_FILE" --artifact "$WORK_DIR/spec.md" --at "$NOW" --approval-ref-json "$APPROVAL_REF"`, then `phase continue --state "$STATE_FILE"`.
6. `phase approve --state "$STATE_FILE" --phase plan --artifact "$WORK_DIR/plan.md" --at "$NOW" --approval-ref-json "$APPROVAL_REF"`, then `phase continue --state "$STATE_FILE"`.

The same unchanged qualifying combined approval ref is consumed once per named phase. Source, task, policy or derivation-context changes require fresh evidence. Runtime progress changes after Plan approval do not require another identical source review. If draft Plan changes after Spec consumption, use `artifact approval reopen --state "$STATE_FILE"` while still at Spec/Plan, then review and approve the corrected bundle. This preserves historical receipts and source while clearing stale current approvals. After implementation begins, use authenticated replan instead. A standalone Spec or Plan review may use its single named phase when a combined bundle is not ready.

Resolve material findings against source and acceptance conditions, correcting supported issues within the authorized task and explaining disagreements with evidence. Preserve failed/unavailable attempts. Never write approval flags, simulated human declarations or completion evidence to bypass review. Test fixtures explicitly labelled simulated are not live review evidence.

Honor explicit-gates: that policy requires the user's exact artifact confirmation through the host-declared human route, whose identity is not authenticated by this plugin. Otherwise use independent review under existing authorization. Reuse-exact-review accepts the qualifying independent route. Do not ask the user for generic approval at every phase.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/adaptive-review-protocol.md` for execution, transport recovery and evidence-bound reuse. The runtime's `--help` is authoritative for exact current flags.
