# Review + Approval Workflow Shim

> v6.12: 실행 계약은 adaptive-review-protocol.md + review-policy-runtime.js가 정본

Research/Plan 자동 리뷰는 phase skill의 단일 unified review 진입점에서 이미 완료된다.
이 문서는 리뷰를 다시 실행하지 않으며 사용자 승인 UX와 integrity hash만 소유한다.

## Step 4: 1차 승인 요청 (수정 항목)

`review_execution_json`의 execution decision과 canonical finding verdict를 읽어 사용자에게
제시한다. pause/needs-human/BLOCK은 승인 UX로 우회하지 않고 adaptive protocol로 반환한다.

```text
반영 제안:
1. <finding ID> — <main disposition 근거>

반영하지 않는 항목:
- <finding ID> — <reject/defer 근거>

1) 전체 승인
2) 선택 승인
3) 추가 설명 요청
```

## Step 5: 수정 적용

- 사용자가 승인한 finding만 작성자(main)가 research.md/plan.md에 반영한다.
- reviewer가 artifact를 직접 수정하지 않는다.
- 수정이 review round 안에 있으면 adaptive protocol round 2의 open finding ID + 수정 diff
  재검증 계약을 따른다.
- 수정 요약과 finding disposition을 표시한다.

## Step 6: 2차 승인 요청 (최종 확인 + 다음 phase)

```text
수정 완료. 최종 문서를 확인해주세요.
1) 문서 최종 승인
2) 추가 수정 요청
3) 이 phase 재실행
```

- 승인: `*_approved: true`, `*_approved_at`, `*_approved_hash`를 기록한다. hash는 승인
  시점 `sha256(${WORK_DIR}/{research,plan}.md)`다.
- 추가 수정: Step 5로 돌아간다.
- 재실행: phase skill을 `--force-rerun`으로 호출하기 전에 기존 `*_approved`,
  `*_approved_at`, `*_approved_hash`를 모두 clear한다.

`*_completed_at`/`*_complete`는 phase skill marker이고 approval marker가 아니다. resume은
현재 파일 hash와 `*_approved_hash`를 비교해 불일치하면 approval을 invalidate하고 unified
review와 이 승인 UX를 다시 실행한다.

승인은 문서 내용 확인이고 Orchestrator Exit Gate는 phase 전환 확인이다. 승인 시
`current_phase`를 바꾸지 않으며 Exit Gate의 “진행” 선택만 phase를 전환한다.
