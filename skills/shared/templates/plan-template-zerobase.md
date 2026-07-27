# Implementation Plan: [Task Title] (Zero-Base)

> Skill Author Note: `deep-plan` skill이 zero-base 모드에서 이 파일을 템플릿으로 사용한다. placeholder를 모두 치환하고 미해결 항목은 Open Questions로 이동.

## Plan Summary

- 접근: [프로젝트 스캐폴딩 방식]
- 변경 범위: [생성할 파일 N개]
- 리스크 수준: Low / Medium / High
- 핵심 결정: [tech stack, architecture pattern]

## Overview / Architecture Decision

[아키텍처 개요 + 선택한 패턴 이유]
- Research 근거: [RF-NNN 또는 "해당 없음 (zero-base)"]

## Project Structure (디렉토리 트리)

```
project-root/
  src/
    ...
  tests/
    ...
  ...
```

## Files to Create

| 파일 | 역할 | Size | Code sketch |
|------|------|------|-------------|
| `src/...` | ... | S/M/L | ... |

## Boundary: Files NOT to Modify

| 항목 | 이유 |
|------|------|
| (zero-base이므로 일반적으로 해당 없음) | |

## Setup Instructions

1. [dependency install]
2. [initial config]
3. ...

## Worker Handoff

- 담당 worker: [Worker ID 또는 "단일 worker"]
- write scope: [생성/수정 허용 파일/디렉토리의 Exact file path 목록]
- read-only scope: [참조만 허용되는 파일/디렉토리]
- 금지 범위: [수정 금지 파일/디렉토리]
- handoff notes: [초기화 순서, 병렬 작업자와의 충돌 방지 규칙, undefined reference 없음 확인]

## Verification Plan

- red command: [failing_test 실행 명령과 예상 실패]
- green command: [verification_cmd와 expected_output]
- regression command: [필요 시 전체 회귀 명령]
- evidence to capture: [테스트 출력, 생성 파일 경로, 주요 expected output]

## Spec Contract Binding

```json
{"schema_version":1,"mode":"strict-spec","created_by_version":"7.0.0","spec_contract":{"schema_version":1,"spec_id":"SPEC-EXAMPLE","spec_sha256":"[64-hex]","spec_approved_hash":"[64-hex]"},"risk_profile_sha256":"[64-hex]"}
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
  - spec_checklist: [...]
  - contract: [...]
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

- [ ] [미해결 또는 "없음"]
