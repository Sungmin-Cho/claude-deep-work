# Executable Spec: Documentation goal

Use the observed risk class. This compact example is for a Low-risk documentation change. Add the actual invariants, failure matrix and negative tests required by the task/risk; validator coverage remains authoritative. Replace the example requirement with the real goal before approval. Do not create a fake test solely to fill a field.

## Scope

Document the retry setting.

## Non-goals

Runtime behavior changes.

## Contract

```json spec-contract
{
  "schema_version": 1,
  "spec_id": "SPEC-DOCS",
  "risk_class": "low",
  "requirements": [{
    "id": "REQ-001",
    "statement": "README documents retry_count",
    "acceptance": "README.md contains retry_count and its meaning",
    "priority": "must",
    "negative_test_ids": [],
    "evidence_gate_ids": ["GATE-outcome-verification", "GATE-outcome-oracle-controls"]
  }],
  "invariants": [],
  "failure_matrix": [],
  "negative_tests": [],
  "compatibility": {"legacy_inputs": "unchanged", "migration": "none"},
  "open_questions": []
}
```

## Requirement Notes

The positive check and contrary document establish the observable documentation requirement.

## Failure and Recovery Notes

Restore the prior document if the requested explanation is incorrect.

## Decisions and Trade-offs

A built-in file-content oracle is proportionate to this example. Semantic explanation quality still receives the applicable independent review.

## Open Questions

None.

## Spec Gate Result

Validation and approval are published by the runtime for the final bytes.
