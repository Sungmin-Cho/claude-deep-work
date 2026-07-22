# Executable Spec: Medium Strict Flow

## Scope

- Bind plan admission to one observable requirement.

## Non-goals

- High-risk failure-matrix obligations.

## Contract

```json spec-contract
{"schema_version":1,"spec_id":"SPEC-MEDIUM-VALID","risk_class":"medium","requirements":[{"id":"REQ-001","statement":"A strict plan covers the executable requirement.","acceptance":"SLICE-001 names REQ-001 and an evidence gate.","priority":"must","negative_test_ids":["NEG-001"],"evidence_gate_ids":["GATE-plan-alignment"]}],"invariants":[{"id":"INV-001","statement":"Plan and spec digests remain bound.","requirement_ids":["REQ-001"]}],"failure_matrix":[],"negative_tests":[{"id":"NEG-001","statement":"Reject a plan with stale or missing binding.","requirement_ids":["REQ-001"],"failure_mode_ids":[],"expected_signal":"plan-binding-identity","gate_id":"GATE-plan-alignment"}],"compatibility":{"legacy_inputs":"not accepted for this fresh session","migration":"author and approve spec.md"},"open_questions":[]}
```

## Requirement Notes

### REQ-001

The plan projection is the only implementation authority.

## Failure and Recovery Notes

No High-risk failure row applies.

## Decisions and Trade-offs

- Use strict binding rather than caller assertions.

## Open Questions

- None.

## Spec Gate Result

- Status: PASS
- Requirement coverage: 1
- Failure matrix coverage: not-applicable
