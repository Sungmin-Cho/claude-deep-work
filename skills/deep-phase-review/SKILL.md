---
name: deep-phase-review
description: "Use when the user manually requests a deep-work phase document review. Parses --phase, --structural, and --adversarial compatibility arguments, then enters the canonical adaptive review protocol."
user-invocable: true
---

# Deep Phase Review Entry

> v6.12: 실행 계약은 adaptive-review-protocol.md + review-policy-runtime.js가 정본

이 skill은 수동 document review의 진입점과 args parser만 소유한다. reviewer 선택,
fallback, severity, degraded, finding verdict는 본문에 재정의하지 않는다.

## Args

| 인자 | 의미 |
|---|---|
| `--phase=brainstorm|research|plan` | 대상 document phase; 부재 시 current phase |
| `--structural` | 호환 플래그: structural-only single override 요청 |
| `--adversarial` | 호환 플래그: dual override 요청 |

두 mode 플래그가 함께 있으면 dual로 해석한다. 알 수 없는 값은 경고 후 무시한다.

## Entry

1. env session ID → pointer → legacy 순서로 state를 찾고 `work_dir`, current phase,
   `methodology_policy_json`, `review_execution_json`을 읽는다.
2. args의 phase를 검증하고 `$WORK_DIR/<phase>.md` 존재를 확인한다. 없으면 경로와 생성
   command를 표시하고 종료한다.
3. Read(`../shared/references/adaptive-review-protocol.md`)하고
   `artifactKind:'document'`, phase, state risk/policy/review override, 감지 채널을 입력으로
   조립한다. `--structural`/`--adversarial` compatibility 요청은 승인된
   `reviewModeOverride`로만 전달한다.
4. protocol의 `compileReviewPlan → reviewers → evaluateReviewExecution → finding verdict →
   persistence` 순서를 실행한다. structural role은
   Read(`../shared/references/review-gate.md`)의 차원과 snapshot 계약을 사용한다.
5. 결과를 `review_execution_json`과 호환 `phase_review`/`review_results`에 기록하고
   decision/verdict/open finding/degraded event를 표시한다.

Critical human-gate 또는 pause/needs-human이면 여기서 멈추며 자동 phase advance를 하지
않는다.
