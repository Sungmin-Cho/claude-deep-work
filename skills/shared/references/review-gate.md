# Review Gate Structural Shim

> v6.12: 실행 계약은 adaptive-review-protocol.md + review-policy-runtime.js가 정본

이 문서는 document review의 structural 차원, 작성자 auto-fix snapshot, 사용자 조정 UX만
보존한다. reviewer 선택, adversarial 실행, severity, degraded, blocking, 재리뷰 cap은
Read(`adaptive-review-protocol.md`)와 런타임 결과를 따른다.

## 1. Structural review

`compileReviewPlan({artifactKind:'document', ...})`이 반환한 required structural reviewer가
문서를 차원별 1-10으로 평가한다. reviewer는 finding만 반환하고 문서를 수정하지 않는다.

| 점수 | structural 결과 |
|---|---|
| 7 이상 | PASS |
| 5-6 | WARNING — 사용자 판단 |
| 4 이하 | FAIL — 작성자 수정 필요 |

500자 미만 문서는 structural 평가가 불충분하다고 기록하고 protocol의 실행 판정을 따른다.

### Brainstorm 차원

- `problem_clarity`
- `approach_differentiation`
- `success_measurability`
- `edge_case_coverage`

### Research 차원

- `completeness`
- `accuracy`
- `relevance`
- `depth`
- `actionability`

### Plan 차원

- `architecture_fit`
- `slice_executability`
- `testability`
- `code_completeness`
- `buildability`
- `rollback_completeness`
- `risk_coverage`

**v6.7+ 필수 슬라이스 계약:** `testability`는 `failing_test`, `verification_cmd`, `expected_output`을 함께 요구한다.
일반 plan.md의 모든 비-inline S/M/L slice에는
`failing_test`, `verification_cmd`, `expected_output`, `code_sketch`, `steps`가 있어야 한다.
`tests/plan-quality-contract.test.js`가 이를 강제한다. 누락은 `testability`,
`code_completeness`, `buildability` finding으로 기록한다. legacy/resume plan은 best-effort로
평가하되 verdict 반영 여부를 명시한다.
인라인 plan은 review할 plan artifact가 없으므로 structural review를 skip한다.

Structural 결과는 호환 경로 `$WORK_DIR/${phase}-review.json`과 사람이 읽는
`${phase}-review.md`에 유지하며, 요약은 `review_execution_json`에 병합한다.

## 2. Auto-fix snapshot 계약

Auto-fix는 reviewer가 아니라 **작성자(main)** 책임이다.

1. 수정 전 snapshot을 만든다.
   - Research: `$WORK_DIR/research.v{N}.md`
   - Plan: `$WORK_DIR/plan.autofix-v{N}.md`
2. open finding이 지목한 섹션만 수정하고 전체 문서를 재작성하지 않는다.
3. structural score가 이전보다 하락하면 snapshot으로 즉시 복원하고 수동 수정을 요청한다.
4. snapshot은 finish에서 정리하고 최종 문서만 보존한다.

Structural auto-fix 자체는 최대 3회까지 허용되지만, unified review의 전면 round는
`rounds_max: 2`다. 두 cap을 혼동하지 않는다. 3회 후에도 structural FAIL이면 자동 수정을
멈추고 사용자에게 판단을 요청한다.

## 4-1. 사용자 조정 UX

`evaluateReviewExecution`과 `verdictFromFindings` 결과를 다음처럼 요약한다.

```text
📋 <Phase> 리뷰
  실행 판정: <proceed|degraded-proceed|needs-human|pause>
  verdict: <PASS|BLOCK|보류>
  open blocker: <N>
  degraded event: <N>

  1) 수용 finding 수정
  2) 항목별 조정
  3) 현재 판정 유지
```

항목별 조정은 finding ID별로 `accept | reject | partial | defer`와 이유를 기록한다.
blocker나 required reviewer 실패를 단순 “현재 상태로 진행” 선택으로 우회하지 않는다.
수정 후에는 adaptive protocol의 round 2 계약(open finding ID + 수정 diff만)을 따른다.
