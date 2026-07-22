---
name: deep-spec
description: "Author the executable spec contract for deep-work research sessions. Invoked through /deep-spec, $deep-work:deep-spec, or orchestrator dispatch."
user-invocable: true
---

# deep-spec

The `medium|high|critical` risk classes make this workflow mandatory. Low risk
may opt in.

> [!IMPORTANT]
> Do not echo this skill body or its template. Perform the workflow and report
> only the gate result, artifact path, and actionable blockers.

## Section 1: Load authoritative state

1. Resolve the session from `--session=ID`, otherwise from the active entry in
   `.claude/deep-work-sessions.json`.
2. Read `.claude/deep-work.{SESSION_ID}.md` and resolve `$WORK_DIR` from its
   `work_dir` field (default `deep-work`). Read `$WORK_DIR/research.md`.
3. Require `current_phase: research`. The runtime records `subphase: spec`;
   `spec` is not a new phase in the phase graph.
4. Decode the authoritative scalar `risk_profile_json` and
   `methodology_policy_json`. `medium|high|critical` is mandatory and any
   missing/corrupt admission input fails closed. A `low` session may opt out.
5. On resume, read an existing `$WORK_DIR/spec.md` and the state fields
   `spec_approved_hash`, `spec_contract_json`, and `spec_gate_result_json`.
   Never trust those summaries until they match the current spec.md bytes.

Do not implement source code and do not create `requirements.json`,
`failure-matrix.json`, or any other spec output.

## Section 2: Author and review the executable spec

Announce: "Spec 단계를 시작합니다. research.md를 실행 가능한 계약으로 고정합니다."

1. Read `../shared/templates/spec-template.md` and write exactly one
   `$WORK_DIR/spec.md`. Preserve the required heading order and exactly one
   fenced `json spec-contract` block.
2. Replace every template marker. An unresolved marker (`PENDING`, `TBD`,
   `TODO`, `FIXME`, `PLACEHOLDER`, bracket placeholder) or an unresolved
   blocking Open Question is a gate failure.
3. Derive requirements, invariants, failure modes, negative tests, evidence
   gates, compatibility, and non-goals from the approved research and explicit
   user constraints. The JSON contract is normative; prose must not contradict
   it.
4. Run:

   `node scripts/validate-spec-contract.js --spec "$WORK_DIR/spec.md" --risk-class "$RISK_CLASS"`

   Require exit 0 and one stdout JSON object with `pass:true`. Medium+ requires
   contract requirement coverage `1`; High/Critical additionally requires a
   non-empty failure matrix with coverage `1`.
5. Submit `spec.md` through the existing document review workflow. Resolve all
   blocking findings, rerun the validator after every edit, and obtain final
   document approval for the exact current bytes.

## Section 3: Fresh approval and return

After validator PASS and document review approval:

1. Compute SHA-256 over the current spec.md bytes. This whole-file digest is
   `spec_approved_hash`; it is distinct from the canonical contract
   `spec_sha256` returned by the validator.
2. Request the runtime `phase spec approve` route with the current artifact
   capability, `spec_approved_hash`, validated contract, and Spec Gate result.
   The skill does not directly mutate state.
3. If the current spec.md bytes differ from the reviewed bytes, reject the stale
   approval, keep `current_phase: research` and `subphase: spec`, then repeat
   validation and document review. Fail closed for Medium+.
4. Return control to the orchestrator only after the runtime persists
   `spec_completed_at`, `spec_approved_hash`, `spec_contract_json`, and
   `spec_gate_result_json`. The Research Exit Gate clears `subphase` when it
   advances to plan.

On resume, a byte-identical approved artifact may re-display the gate result.
Any edit invalidates approval. Plan-bound validation later rechecks the same
whole-file freshness together with contract, risk, and plan binding digests.
