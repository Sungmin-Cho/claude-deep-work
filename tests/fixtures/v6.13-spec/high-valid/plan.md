## Spec Contract Binding

```json
{"schema_version":1,"mode":"strict-spec","created_by_version":"6.13.0","spec_contract":{"schema_version":1,"spec_id":"SPEC-HIGH-VALID","spec_sha256":"8cec19275e69c2302e86b2bd6b69c907eb8abe148400df0116e2b4533d7ce882","spec_approved_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"risk_profile_sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}
```

## Slice Checklist

- [ ] SLICE-001: Enforce High failure matrix
  - outcome: every failure row is linked to negative evidence
  - files: [runtime/high.js, runtime/high.test.js]
  - depends_on: []
  - integration_touchpoints: [plan admission]
  - requirements: [REQ-001]
  - invariants: [INV-001]
  - failure_modes: [FM-001]
  - risk: { class: high, score: 9, triggers: [failure-matrix] }
  - negative_tests: [NEG-001]
  - evidence_required: [GATE-negative-tests, GATE-tdd-red, GATE-tdd-green]
  - rollback: { method: revert, verification: [GATE-recovery] }
  - review_policy: dual
  - scope_expansion_trigger: [new failure mode]
  - failing_test: stale spec binding fails
  - verification_cmd: node --test runtime/high.test.js
  - expected_output: fail 0
  - code_sketch: compilePlanProjectionV1()
  - spec_checklist: [REQ-001, FM-001]
  - contract: [failure matrix coverage is exactly 1]
  - acceptance_threshold: all
  - size: M
  - steps:
    1. Add the failure matrix regression
    2. Enforce complete negative evidence
