# Executable Spec: [Title]

## Scope

- [Observable behavior included in this change]

## Non-goals

- [Explicitly excluded behavior]

## Contract

```json spec-contract
{
  "schema_version": 1,
  "spec_id": "SPEC-EXAMPLE",
  "risk_class": "medium",
  "requirements": [
    {
      "id": "REQ-001",
      "statement": "[One observable requirement]",
      "acceptance": "[Exact pass condition]",
      "priority": "must",
      "negative_test_ids": ["NEG-001"],
      "evidence_gate_ids": ["GATE-targeted-tests"]
    }
  ],
  "invariants": [
    {
      "id": "INV-001",
      "statement": "[State that must always hold]",
      "requirement_ids": ["REQ-001"]
    }
  ],
  "failure_matrix": [
    {
      "id": "FM-001",
      "trigger": "[Concrete fault or invalid input]",
      "affected_requirement_ids": ["REQ-001"],
      "invariant_ids": ["INV-001"],
      "expected_behavior": "[Fail-safe behavior]",
      "detection": "[Observable signal]",
      "negative_test_ids": ["NEG-001"],
      "evidence_gate_ids": ["GATE-negative-tests"],
      "recovery": "[Recovery verification or not-applicable with reason]",
      "rollback": "[Rollback action or not-applicable with reason]"
    }
  ],
  "negative_tests": [
    {
      "id": "NEG-001",
      "statement": "[Exact negative test]",
      "requirement_ids": ["REQ-001"],
      "failure_mode_ids": ["FM-001"],
      "expected_signal": "[Exact failure signal]",
      "gate_id": "GATE-negative-tests"
    }
  ],
  "compatibility": {
    "legacy_inputs": "[accepted/rejected behavior]",
    "migration": "[none or exact migration]"
  },
  "open_questions": []
}
```

## Requirement Notes

### REQ-001

[Rationale and source evidence. Do not restate the normative JSON ambiguously.]

## Failure and Recovery Notes

### FM-001

[Why the negative test and recovery evidence are sufficient.]

## Decisions and Trade-offs

- [Decision, rejected alternative, reason]

## Open Questions

- None.

## Spec Gate Result

- Status: PENDING
- Spec digest: PENDING
- Requirement coverage: PENDING
- Failure matrix coverage: PENDING
