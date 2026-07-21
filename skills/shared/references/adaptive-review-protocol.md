# Adaptive Review Protocol (v6.12 canonical)

이 문서는 deep-work의 document, slice-diff, cross-slice, session-final 리뷰에 대한 단일
실행 정본이다. 강도 표를 prose에서 다시 구현하지 않는다. 정책과 degraded 판정은
`runtime/review-policy-runtime.js`, finding 정규화와 저장은
`runtime/review-finding-runtime.js`가 소유한다.

## 1. 입력 조립

리뷰 point에서 다음 입력을 조립한다.

- `artifactKind`: `document | slice-diff | cross-slice | session-final`
- `phase`와 point: `research | plan | slice-SLICE-NNN | cross-slice | final`
- `riskClass`; slice-diff는 `sliceRiskClass`도 전달한다.
- `runtime`, `availableChannels`, `tddMode`, 사용자 전용 `evaluatorModelOverride`
- state의 `methodology_policy_json.mode`를 `policyMode`로,
  `review_mode_override`를 `reviewModeOverride`로 전달한다.

채널은 `detectReviewChannels({runtime, env})` 결과를 세션 init에 기록하고 resume에서
재프로브한다. document에는 deep-review channel을 배정하지 않는다.

## 2. 정본 실행 순서

아래 순서는 모든 소비 스킬에서 동일하다.

1. 입력을 `compileReviewPlan(...)`에 전달한다. 반환된 reviewers, `rounds_max: 2`,
   `blind_first_round`, gate만 실행 권한이다.
2. plan의 **reviewers 실행** 결과를 role/channel/required/status/report_ref와 함께 모은다.
   `compileReviewPlan`이 각 reviewer의 concrete `reviewer.model`을 확정한다. codex-cli
   channel은 항상 `resolveTier(reviewer.tier, 'codex')`, subagent channel은 세션 runtime의
   `resolveTier(reviewer.tier, runtime)` 결과(명시적 evaluator override가 있으면 그 값)를
   사용한다. 소비자는 channel runtime을 다시 해석하지 않는다. `reviewer.channel ===
   'codex-cli'`이면 dispatcher 소유 prompt temp를 만들고 아래 route만 사용한다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" review run \
     --engine codex --prompt-file "$REVIEW_PROMPT_FILE" --timeout-ms 600000 --mode read-only \
     --model "${reviewer.model}" --effort "${reviewer.effort}"
   ```

   응답의 `effort_applied`, `effort_clamped`, `fallback_used`, `effort_failure`는 reviewer
   result/state/receipt에 그대로 기록한다. codex-cli를 직접 spawn하거나 compiled model과
   effort 중 하나를 생략하는 실행은 금지한다.
3. 먼저 `evaluateReviewExecution(plan, reviewerResults)`을 호출한다. 실행 판정이 `pause`
   또는 `needs-human`이면 finding PASS를 계산하지 않고 멈춘다.
4. `proceed` 또는 `degraded-proceed`에서만 각 raw finding을 `normalizeFinding`으로
   변환하고 유효 finding을 dedupe한다.
5. 정규 finding을 `verdictFromFindings(findings, plan)`에 전달한다. 실행 판정과 finding
   verdict를 모두 통과해야 gate가 통과한다.
6. 매 round 결과는 `writeFindings({workDir, point, round, findings})`로 canonical
   `$WORK_DIR/reviews/<point>-round<N>-findings.json`에 기록한다. reviewer status,
   execution decision, degraded events, human ack는 `review_execution_json`에 병합한다.
   이때 plan의 `gate.human_ack_required`를 point의 `human_ack_required`에도 보존해,
   ack 전 자연 상태인 `human_ack: null`도 finish gate가 required point로 판정하게 한다.

호출 순서를 한 줄로 고정하면 다음과 같다:
`compileReviewPlan → reviewers 실행 → evaluateReviewExecution → normalizeFinding → verdictFromFindings → writeFindings`.

## 3. Blind round 1 프롬프트 계약

round 1은 `blind: true`이며 **입력 격리**가 blind의 의미다. 각 reviewer prompt에는 대상
artifact/diff, 적용 계약, 필요한 코드 문맥만 넣는다. 다른 reviewer의 finding/점수/판정,
main agent의 사전 결론은 넣지 않는다. 순차 실행이어도 이 격리를 지키면 blind다.

리뷰어는 코드를 고치거나 문서를 재작성하지 않고 finding만 반환한다. 수정은
작성자/구현자가 수행하며 finding disposition은 main agent가 기록한다.

## 4. Round 2 재검증과 adjudication

round 2 prompt는 round 1의 **open finding ID**와 그 finding에 대응하는 **수정 diff**만
받는다. 새 전면 리뷰를 시작하거나 해결된 finding을 재논의하지 않는다. 각 finding을
`fixed | open | accepted | rejected | deferred`로 판정하고 근거를 남긴다.

`rounds_max`는 항상 2다. 두 reviewer가 동일 증거에 대해 충돌하거나 blocker가 round 2
후에도 열려 있으면 자동 round 3을 만들지 않고 **adjudication**으로 넘긴다. main agent가
계약/근거를 비교해 disposition을 제안하며, 사람 판단이 필요한 경우 `needs-human`으로
표면화한다.

## 5. Degraded 실행

리뷰어 timeout/failed/skipped를 성공 finding 부재로 숨기지 않는다. 매 결과를
`evaluateReviewExecution`에 전달하고 반환 decision을 그대로 따른다.

- Low required 실패: 성공분과 기록으로 `degraded-proceed`.
- Medium required 실패: `needs-human`.
- High/Critical required 실패: `pause`(fail-closed).
- 모든 degraded 사건은 `review_execution_json.degraded_events`와 receipt에 기록한다.

fallback reviewer를 실행해도 원 실패와 `fallback_used`를 보존한다. fallback 성공은
원 required reviewer 실패 기록을 삭제하지 않는다.

## 6. Finding 및 severity

source severity는 `normalizeFinding(raw, {sourceScheme})`만 정규화한다. 스킬 prose에서
별도 severity 표를 만들지 않는다. blocker는 location, violated contract, evidence,
failure scenario, verification, confidence 자격을 만족해야 하며 미달은 major로 demote한다.
중복은 artifact+location+violated_contract가 완전히 같을 때만 합친다.

## 7. Artifact별 연결

- `document`: structural은 항상 required. structural 점수와 auto-fix snapshot은
  `review-gate.md`의 잔존 계약을 사용한다.
- `slice-diff`: Stage 1은 semantic, Stage 2는 executability role이다. High/Critical의
  Stage 2 blocker는 차단한다.
- `cross-slice`: deep-test의 4-1 required/4-2 advisory 지위는 유지하되 reviewer와
  severity는 통합 런타임에서만 받는다.
- `session-final`: finish 직전 final point를 평가하고 Critical ack를 포함한다.

## 8. Critical human-gate

Critical point는 `evaluateReviewExecution`의 `human_gate.required`를 따른다. attended
세션에서만 AskUserQuestion으로 ack를 받아
`review_execution_json.points[point].human_ack={required:true,at,actor:'human'}`를 쓴다.
headless/unattended에는 자동 승인이 없고 pause한다.

Critical init은 `external_change_lock: true`다. required point의 ack가 모두 기록될 때만
false로 해제한다. finish는 `finishGateAllowed(reviewExecutionJson)`만 호출해 판단하며
lock이 true거나 `missing_acks`가 있으면 PR/merge/push 제안과 실행을 차단하고 누락 point를
표면화한다. risk/review 하향 override는 이 잠금을 해제하지 않는다.

## 9. 호환 상태

`phase_review.{phase}`, `review_results.{phase}`, `review_state` dual-write는 기존 리더를
위해 유지한다. canonical finding은 신규 경로만 쓴다. 읽기는 `readFindings`가 canonical을
우선하고 `${phase}-cross-review.json`, `adversarial-review.json` 순서로 legacy fallback한다.
