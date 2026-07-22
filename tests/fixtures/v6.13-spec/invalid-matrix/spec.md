# Executable Spec: Invalid High Matrix

## Scope

- Exercise incomplete recovery evidence.

## Non-goals

- Successful admission.

## Contract

```json spec-contract
{"schema_version":1,"spec_id":"SPEC-INVALID-MATRIX","risk_class":"high","requirements":[{"id":"REQ-001","statement":"Failures are recoverable.","acceptance":"Every failure row is complete.","priority":"must","negative_test_ids":["NEG-001"],"evidence_gate_ids":["GATE-negative-tests"]}],"invariants":[{"id":"INV-001","statement":"Recovery is explicit.","requirement_ids":["REQ-001"]}],"failure_matrix":[{"id":"FM-001","trigger":"A fault occurs.","affected_requirement_ids":["REQ-001"],"invariant_ids":["INV-001"],"expected_behavior":"Fail closed.","detection":"A typed failure is emitted.","negative_test_ids":["NEG-001"],"evidence_gate_ids":["GATE-negative-tests"],"recovery":"","rollback":"Restore prior bytes."}],"negative_tests":[{"id":"NEG-001","statement":"Trigger the incomplete fault row.","requirement_ids":["REQ-001"],"failure_mode_ids":["FM-001"],"expected_signal":"contract-failure-matrix-coverage","gate_id":"GATE-negative-tests"}],"compatibility":{"legacy_inputs":"rejected","migration":"complete the row"},"open_questions":[]}
```

## Requirement Notes

### REQ-001

The row is intentionally incomplete.

## Failure and Recovery Notes

### FM-001

Recovery is missing by construction.

## Decisions and Trade-offs

- This is a negative fixture.

## Open Questions

- None.

## Spec Gate Result

- Status: FAIL
- Requirement coverage: 1
- Failure matrix coverage: 0
