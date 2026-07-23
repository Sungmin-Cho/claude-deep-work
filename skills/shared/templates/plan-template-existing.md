# Implementation Plan: [Task Title]

> Skill Author Note: `deep-plan` skill이 research.md를 분석한 뒤 아래 각 섹션의 placeholder를 실제 slice·파일·스텝으로 채워 Write한다. TBD / TODO / "추후 정의" / "적절히" 등은 Completeness Policy에 의해 차단된다.

## Plan Summary

- 접근: [한 문장]
- 변경 범위: [N개 파일, N개 slice]
- 리스크 수준: Low / Medium / High
- 핵심 결정: [2-3 bullet]

## Overview

[범위 개요]

## Architecture Decision

- Research 근거:
  - [RF-001] ...
  - [RA-001] ...
- 선택 이유: [한 문장]

## Files to Modify

| 파일 | Action | Changes | Code sketch (S/M/L) | Line refs | Reason | Risk |
|------|--------|---------|---------------------|-----------|--------|------|
| `path/...` | modify/create | ... | ... | L10-L25 | ... | Low |

## Boundary: Files NOT to Modify

| 파일 | 이유 |
|------|------|
| `...` | ... |

## Execution Order

1. [slice 순서]
2. ...

## Dependency Analysis

[slice 간 의존성]

## Trade-offs

| 결정 | Pro | Con | 선택 이유 |
|------|-----|-----|---------|
| ... | ... | ... | ... |

## Rollback Strategy

[실패 시 되돌리는 방법]

## Worker Handoff

- 담당 worker: [Worker ID 또는 "단일 worker"]
- write scope: [수정 허용 파일/디렉토리의 Exact file path 목록]
- read-only scope: [참조만 허용되는 파일/디렉토리]
- 금지 범위: [수정 금지 파일/디렉토리]
- handoff notes: [선행 조건, 병렬 작업자와의 충돌 방지 규칙, undefined reference 없음 확인]

## Verification Plan

- red command: [failing_test 실행 명령과 예상 실패]
- green command: [verification_cmd와 expected_output]
- regression command: [필요 시 전체 회귀 명령]
- evidence to capture: [테스트 출력, 파일 경로, 주요 expected output]

## Spec Contract Binding

```json
{"schema_version":1,"mode":"strict-spec","created_by_version":"6.14.0","spec_contract":{"schema_version":1,"spec_id":"SPEC-EXAMPLE","spec_sha256":"[64-hex]","spec_approved_hash":"[64-hex]"},"risk_profile_sha256":"[64-hex]"}
```

replan_epoch: null
capability_facts: {"schema_version":1,"authority":"reviewed-plan","destructive":false,"external_action":false,"has_backward_compat":true,"has_migration":true,"host_dependent":false,"source_requirement_ids":["REQ-001"],"source_slice_ids":["SLICE-001","SLICE-999"],"facts_sha256":"[64-hex]"}

## Slice Checklist

- [ ] SLICE-001: [Goal]
  - slice_kind: functional
  - verification_spec: {"schema_version":2,"executable":{"kind":"node-toolchain","name":"node","supported_patches_sha256":"[64-hex]"},"args":["--test","--test-reporter=tap","--","path/to/failing.test.js"],"cwd_role":"worktree","timeout_ms":120000,"max_output_bytes":1048576,"environment":{"mode":"closed","values":{"LANG":"C","LC_ALL":"C","TZ":"UTC"}},"red_failure":{"adapter":"node-test-tap","adapter_version":1,"expected_class":"expected-failure","expected_signal":{"kind":"assertion","operator":"strictEqual","test_identity":{"test_file":"path/to/failing.test.js","test_name":"[exact test name]","start_line":1},"expected_digest":"[64-hex-or-null]","actual_digest":null,"message_pattern":"[normalized pattern]"}}}
  - outcome: [Observable vertical result]
  - files: [...]
  - depends_on: []
  - integration_touchpoints: [CLI, state-store]
  - requirements: [REQ-001]
  - invariants: [INV-001]
  - failure_modes: [FM-001]
  - risk: { class: medium, score: 6, triggers: [state-machine] }
  - negative_tests: [NEG-001]
  - evidence_required: [GATE-targeted-tests, GATE-negative-tests]
  - rollback: { method: revert-slice, verification: [GATE-recovery] }
  - review_policy: single
  - scope_expansion_trigger: [public API change]
  - failing_test: [...]
  - verification_cmd: [...]
  - expected_output: [...]
  - code_sketch: [...]
  - spec_checklist: [req1, req2]
  - contract: [testable criterion]
  - acceptance_threshold: all
  - size: S / M / L
  - steps:
    1. ...
    2. ...

- [ ] SLICE-999: Final release verification
  - slice_kind: release-verification
  - verification_spec: null
  - outcome: all authenticated release gates pass without writes
  - files: []
  - depends_on: [SLICE-001]
  - integration_touchpoints: [release gate catalog]
  - requirements: [REQ-001]
  - invariants: [INV-001]
  - failure_modes: [FM-001]
  - risk: { class: medium, score: 6, triggers: [release-verification] }
  - negative_tests: [NEG-001]
  - evidence_required: [GATE-full-relevant-suite]
  - rollback: { method: none, verification: [GATE-rollback-rehearsal] }
  - review_policy: dual
  - scope_expansion_trigger: [any write]
  - failing_test: none
  - verification_scope: [npm test, npm pack --dry-run --json]
  - release_gate_ids: [GATE-full-relevant-suite]
  - verification_cmd: none
  - expected_output: authenticated pass
  - code_sketch: none
  - spec_checklist: [REQ-001]
  - contract: [write-free]
  - acceptance_threshold: all
  - size: S
  - steps:
    1. Verify all bound release gate receipts.

## Open Questions

- [ ] [미해결 항목 또는 "없음"]
