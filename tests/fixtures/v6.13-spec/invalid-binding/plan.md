## Spec Contract Binding

```json
{"schema_version":1,"mode":"strict-spec","created_by_version":"6.13.0","spec_contract":{"schema_version":1,"spec_id":"SPEC-MEDIUM-VALID","spec_sha256":"0000000000000000000000000000000000000000000000000000000000000000","spec_approved_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"risk_profile_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
```

## Slice Checklist

- [ ] SLICE-001: Reject the invalid binding
  - outcome: stale digest never publishes authority
  - files: [runtime/medium.js, runtime/medium.test.js]
  - depends_on: []
  - integration_touchpoints: [plan admission]
  - requirements: [REQ-001]
  - invariants: [INV-001]
  - failure_modes: []
  - risk: { class: medium, score: 6, triggers: [strict-admission] }
  - negative_tests: [NEG-001]
  - evidence_required: [GATE-plan-alignment]
  - rollback: { method: revert, verification: [GATE-recovery] }
  - review_policy: dual
  - scope_expansion_trigger: [new requirement]
  - failing_test: stale binding fails
  - verification_cmd: node --test runtime/medium.test.js
  - expected_output: plan-binding-identity
  - code_sketch: compilePlanProjectionV1()
  - spec_checklist: [REQ-001]
  - contract: [invalid fixture]
  - acceptance_threshold: all
  - size: M
  - steps:
    1. Load the stale binding
    2. Assert typed rejection
