# Executable Spec: High Strict Flow

## Scope

- Bind a complete failure matrix to executable negative evidence.

## Non-goals

- Mutable remote production resources.

## Contract

```json spec-contract
{"schema_version":1,"spec_id":"SPEC-HIGH-VALID","risk_class":"high","requirements":[{"id":"REQ-001","statement":"Stale plan input fails closed.","acceptance":"SLICE-001 covers REQ-001 with negative evidence.","priority":"must","negative_test_ids":["NEG-001"],"evidence_gate_ids":["GATE-negative-tests"]}],"invariants":[{"id":"INV-001","statement":"No stale authority reaches implementation.","requirement_ids":["REQ-001"]}],"failure_matrix":[{"id":"FM-001","trigger":"The approved spec digest differs from the plan binding.","affected_requirement_ids":["REQ-001"],"invariant_ids":["INV-001"],"expected_behavior":"Reject plan admission without publishing authority.","detection":"plan-binding-identity is reported.","negative_test_ids":["NEG-001"],"evidence_gate_ids":["GATE-negative-tests"],"recovery":"Recompile and review the current plan.","rollback":"Restore the last approved plan and rerun the gate."}],"negative_tests":[{"id":"NEG-001","statement":"Replace the bound spec digest and compile the plan.","requirement_ids":["REQ-001"],"failure_mode_ids":["FM-001"],"expected_signal":"plan-binding-identity","gate_id":"GATE-negative-tests"}],"compatibility":{"legacy_inputs":"rejected at High risk","migration":"run strict spec and plan gates"},"open_questions":[]}
```

## Requirement Notes

### REQ-001

Admission is observable through the typed error.

## Failure and Recovery Notes

### FM-001

NEG-001 covers detection, recovery, and rollback.

## Decisions and Trade-offs

- Fail closed on every incomplete row.

## Open Questions

- None.

## Spec Gate Result

- Status: PASS
- Requirement coverage: 1
- Failure matrix coverage: 1
