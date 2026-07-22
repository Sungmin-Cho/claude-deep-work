# Executable Spec: Low Legacy Compatibility

## Scope

- Preserve a proven pre-v6.13 no-spec lineage.

## Non-goals

- Relabeling a fresh session as legacy.

## Contract

```json spec-contract
{"schema_version":1,"spec_id":"SPEC-LOW-LEGACY","risk_class":"low","requirements":[],"invariants":[],"failure_matrix":[],"negative_tests":[],"compatibility":{"legacy_inputs":"accepted only with durable pre-v6.13 proof","migration":"run deep-spec when proof is ambiguous"},"open_questions":[]}
```

## Requirement Notes

None.

## Failure and Recovery Notes

None.

## Decisions and Trade-offs

- Empty coverage is explicitly not applicable at Low risk.

## Open Questions

- None.

## Spec Gate Result

- Status: PASS
- Requirement coverage: not-applicable
- Failure matrix coverage: not-applicable
