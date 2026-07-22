## Spec Contract Binding

```json
{"schema_version":1,"mode":"strict-spec","created_by_version":"6.13.0","spec_contract":{"schema_version":1,"spec_id":"SPEC-MEDIUM-VALID","spec_sha256":"a4333101fb452dca47eef07266d92cfff319d17364532206e4b10752b66e4baa","spec_approved_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"risk_profile_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
```

## Slice Checklist

- [ ] SLICE-001: Enforce Medium plan admission
  - outcome: strict plan reaches implementation only with complete coverage
  - files: [runtime/medium.js, runtime/medium.test.js]
  - depends_on: []
  - integration_touchpoints: [plan admission]
  - requirements: [REQ-001]
  - invariants: [INV-001]
  - failure_modes: []
  - risk: { class: medium, score: 6, triggers: [strict-admission] }
  - negative_tests: [NEG-001]
  - evidence_required: [GATE-plan-alignment, GATE-tdd-red, GATE-tdd-green]
  - rollback: { method: revert, verification: [GATE-recovery] }
  - review_policy: dual
  - scope_expansion_trigger: [new requirement]
  - failing_test: missing or stale binding fails
  - verification_cmd: node --test runtime/medium.test.js
  - expected_output: fail 0
  - code_sketch: compilePlanProjectionV1()
  - spec_checklist: [REQ-001]
  - contract: [coverage is exactly 1]
  - acceptance_threshold: all
  - size: M
  - steps:
    1. Add the admission regression
    2. Enforce exact digest and coverage
