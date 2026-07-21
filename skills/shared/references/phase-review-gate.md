# Phase Review Gate Shim

> v6.12: 실행 계약은 adaptive-review-protocol.md + review-policy-runtime.js가 정본

Phase 종료 시 이 문서는 다음 진입만 제공한다.

1. state의 risk/policy/review override와 artifact kind를 조립한다.
2. Read(`adaptive-review-protocol.md`)의 순서로 unified review를 실행한다.
3. document artifact는 `review-gate.md`의 structural 차원과 auto-fix snapshot을 함께 쓴다.
4. 실행/판정 결과를 `review_execution_json`에 기록하고, 호환을 위해
   `phase_review.{phase}`, `review_results.{phase}`, `review_state`를 dual-write한다.

문서 phase에는 deep-review channel을 배정하지 않는다. Phase 3 코드 리뷰의 채널도
`detectReviewChannels`와 `compileReviewPlan` 결과만 따른다. 모델 하드코딩, ad hoc
fallback 사다리, severity 변환, degraded 통과 규칙은 이 shim에 정의하지 않는다.

수동 `/deep-phase-review`도 같은 진입을 사용한다. `evaluateReviewExecution`이 pause 또는
needs-human이면 phase advance를 하지 않으며, Critical은 human ack와 external change lock
계약을 따른다.
