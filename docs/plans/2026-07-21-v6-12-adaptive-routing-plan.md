# v6.12 — Adaptive Routing & Unified Review 구현 계획

- **작성일:** 2026-07-21
- **정본 설계:** `docs/design/v6-12-adaptive-routing-unified-review.md` (3라운드 리뷰 수렴 — APPROVE, blocker 1·major 9·minor 7 전건 해소)
- **리뷰 기록:** `docs/reviews/2026-07-21-design-review-v6-12-adaptive-routing.md`
- **구현자:** Codex (gpt-5.6-sol, effort medium) — SDD 태스크 단위 순차 실행
- **브랜치:** `worktree-v6-12-adaptive-routing` (base `aed7bb9` = v6.11.0)
- **상태:** round-3 리뷰 반영본 (round-1 PF1-PF12 + round-2 R2-B1·R2-M1/M2/M3 + round-3 리더 전수 확장·direct-access 부재 증명·라인 정정 반영 — `docs/reviews/2026-07-21-plan-review-v6-12-adaptive-routing.md`)

## 0. 실행 규율 (모든 태스크 공통)

1. **TDD**: 각 태스크는 실패 테스트 먼저(RED) → 구현(GREEN) → 필요 시 리팩터. 테스트 없는 프로덕션 변경 금지.
2. **회귀 게이트**: 각 태스크 종료 시 `npm test` 전체 green. **기존 테스트 무수정 원칙** — 문서화된 예외 3건만 허용: (E1) T2의 risk fixture 기대값 갱신(설계 §8.1 — 의도 수정 개별 문서화), (E2) T3의 `tests/methodology-shadow-receipt.test.js` 강화(설계 §8.3), (E3) T12의 `tests/integration/v6.4.0-smoke.test.js:230` 버전 assert(`pkg.version === '6.11.0'`) 갱신 — 버전 bump의 기계적 동반 수정(PF12). 설계 §10-7도 동일하게 3건으로 동기화됨.
3. **커밋**: 태스크당 1 커밋(atomic), HEREDOC 메시지 + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `git add -A` 금지 — 파일 명시 add.
4. **설계 준수**: 아래 태스크 서술이 설계와 다르게 읽히면 **설계 문서가 정본** — 임의 해석 금지, 모순 발견 시 중단·보고.
5. **스코프 밖 수정 금지**: 태스크별 명시 파일 외 수정 필요가 생기면 중단·보고(설계 §2 Non-goals 위반 방지).

## 1. 태스크 DAG

```
T0 (결정론 state carrier + fixture)
 ├─→ T1 (extractRoutingState + risk-profile-cli 확장) [T0 필요]
T2 (risk-runtime trigger 재설계)          [독립]
T3 (validate-receipt.sh fix)              [독립]
T4 (model-routing-runtime floor/effort)   [독립]
T5 (flags 파싱)                           [독립]
T6 (review-finding-runtime + persistence) [독립]
T7 (review-policy-runtime)                [T6 뒤 권장 — verdict 연동 테스트]
T8 (state/receipt 확장)                   [T4·T7 뒤 — shape 참조]
T9 (스킬 배선 1: 라우팅)                  [T1·T4·T5·T8 뒤]
T10 (스킬 배선 2: unified review + 문서)  [T6·T7·T8·**T9** 뒤 — PF10: T9가 flag state persist를 소유하고 T10 컴파일러가 소비, 동일 파일 중첩 편집]
T11 (effort 적용 채널)                    [T7·**T8**·**T10** 뒤 — PF4: 리뷰 실행 배선(T10)과 record shape(T8)에 의존]
T12 (CHANGELOG + 버전 bump)               [마지막]
```

순차 실행 권장 순서: **T0 → T2 → T3 → T4 → T5 → T6 → T7 → T1 → T8 → T9 → T10 → T11 → T12** (그린 간선 위상 순서 유지)

## 2. 태스크 상세

### T0 — [선행 게이트] 결정론 routing-state carrier 확정 + fixture (설계 §5.4-3, PF1 해소)

- **목적**: routing state의 **결정론 carrier**를 확정하고 fixture로 고정한다. 설계 §5.4-3(PF1 반영)이 정본: nested YAML 블록은 결정론 writer가 없으므로(`session-store.js:136-148` buildSessionState가 model_routing 미기록, `frontmatter.js:87` formatScalar object throw, `:66-68` parseFrontmatter nested throw) **carrier는 JSON-string 스칼라 2종**(`model_routing_json`/`model_routing_meta_json`)이다.
- **방법**: ① 신규-form fixture: 스칼라 2종을 포함한 state를 **결정론 경로로 생성**(`updateFrontmatterText` 또는 buildSessionState 확장 사용 — LLM heredoc 재현 금지)해 `tests/fixtures/state-model-routing/`에 저장(엔진 자동/pinned 포함 2종). ② legacy-form fixture: nested 블록 형태 1종을 **`legacy-` 접두 파일명으로 명시 라벨링**해 수작업 작성(orchestrator §1-9 서술 기반 대표형 — best-effort fallback 검증 전용임을 README에 명시).
- **산출**: fixture 3종 + `tests/fixtures/state-model-routing/README.md`(각 fixture의 출처·용도·결정론/legacy 구분).
- **acceptance (PF1)**: 신규-form fixture가 (a) `parseFrontmatter` 전체 파싱 통과, (b) `session-store`의 세션 리더(`sessionFromState` 경로) 통과, (c) 스칼라 2종 `JSON.parse` round-trip 성립. legacy fixture는 (a)(b) 통과를 요구하지 않는다(fallback 전용).

### T1 — risk-profile-cli 확장 + `extractRoutingState` (인계 (b), 설계 §5.4, PF1/PF5/PF6 반영)

- **파일**: `scripts/risk-profile-cli.js`(+ 추출기를 별도 둘 경우 `runtime/state-block-extract.js`), 테스트 `scripts/risk-profile-cli.test.js` 확장 + 신규 추출기 테스트.
- **내용**:
  - ① `--risk-only`(policy 컴파일 생략).
  - ② `--reuse-input <artifact>` (**PF5 계약**): artifact에 self-embed된 `input_digest`를 내용 재계산과 대조 후 **signals만** 재사용(불일치 시 재수집+경고 fail-open). policy 컴파일 호출은 routing 입력(`model_routing`/`tiers`/`pinned`)을 입력 JSON으로 신선 공급해야 하며, **routing 입력 부재 상태로 policy 컴파일에 도달하면 조용한 공집합 `routing_diff` 대신 구조화 error를 출력에 기록**한다.
  - ③ `--state-file <path>` — `extractRoutingState(rawStateText)`: 1차 `parseFrontmatter`+스칼라 2종 `JSON.parse`(정본), 2차 legacy raw 라인 스캔 fallback(`extraction_mode:'legacy-scan'` 표기) — 설계 §5.4-3.
  - ④ **에러 소유권 (PF6)**: CLI는 state 파일을 **절대 mutate하지 않는다** — 추출/검증 실패는 stdout 출력 JSON의 구조화 `errors` 배열로만 emit하고 exit는 fail-open 규약을 따른다. `risk_profile_json.errors`로의 영속은 **T9의 스킬(유일 state writer)** 이 CLI 출력을 받아 수행한다.
- **테스트**: T0 fixture 3종(신규 2 + legacy 1) 추출 정확성·mode 표기, 손상 state fail-open+구조화 errors emit(state 무변경 확인), --risk-only 출력 계약, --reuse-input digest 일치/불일치/routing 결측 error.
- **acceptance**: 설계 §5.4 항목 ①-④ 전부 + §10-6.

### T2 — risk-runtime hard trigger 3부+iv 매칭 재설계 (인계 (a)+M4, 설계 §8.1)

- **파일**: `runtime/risk-runtime.js`, `tests/risk-fixture-matrix.test.js`(예외 E1), 신규 fixture.
- **내용**: `corpusWithPaths` 폐기 → (i) textCorpus / (ii) 경로별 개별 / (iii) text×path conjunction(트리거 2종, 토큰 파티션은 설계 §8.1의 열거가 정본) / (iv) db-context path×path 집합 conjunction(db-context 분류: `db/`·`migrations/`·`prisma/` 하위 또는 basename `*.sql`/`schema.*`/`*migration*`). `PATH_PATTERNS`의 `\|auth`를 세그먼트 경계로 교정.
- **테스트**: 설계 §8.1 fixture 4종(FN-보존 text×path, FN-보존 path×path, FP-제거, 단일 경로 TP) + oauth negative + 26종 matrix 재검(변경 항목은 커밋 메시지에 개별 사유 명시), destructive-migration 케이스 보존 별도 assert.
- **acceptance**: 설계 §8.1 전체 + §10-6.

### T3 — validate-receipt.sh summary JSON fix (인계 (c), 설계 §8.3)

- **파일**: `hooks/scripts/validate-receipt.sh`, `tests/methodology-shadow-receipt.test.js`(예외 E2).
- **내용**: `:186` `const [,, ...]` → `const [, ...]`; 조기반환 emitter(`:100`)와 node-실패 fallback echo에 `errors`/`warnings` 키 일관 포함.
- **테스트**: healthy/fail 두 경로에서 summary JSON의 `result`/`passed`/`total`/`errors`/`warnings`를 **직접 assert**(기존 "신뢰 불가" 우회 제거).
- **acceptance**: 설계 §8.3.

### T4 — model-routing-runtime adaptive floor + effort meta (설계 §5.1-§5.3)

- **파일**: `runtime/model-routing-runtime.js`, `scripts/model-routing-cli.js`, 관련 테스트.
- **내용**: `decideModelRouting`에 `riskClass`/`policyMode`/`floorBaseline` 추가; `applyPolicyFloor`(TIER_CATALOG floor, 상향 전용) → `applyFloorBaseline`(단조성) 순서; `meta.policy`(floors_applied/floors_effective/floor_overridden_by_pin)·`meta.efforts` — **risk/floor 입력 부재 시 두 키 생략(null 금지)**; `sliceModelTierWithRisk(sessionTier, size, sliceRiskClass)`; CLI에 `--risk-class`/`--policy-mode`/`--floor-baseline '<json>'`(파싱 실패 항목 무시+경고 fail-open).
- **내용 추가 (PF7)**: `decideModelRouting`에 optional `now` 주입 입력 추가(기본값 현재 동작 — `meta.decided_at`이 매 호출 `new Date()`라 문자 그대로의 바이트 비교가 불가능하므로).
- **내용 추가 (R2-B1 ② — migration clobber 가드)**: `runtime/slice-runtime.js:172-183` `migrateModelRouting`과 `scripts/migrate-model-routing.js`에 **canonical meta 존재 guard** 추가 — 스칼라 `model_routing_meta_json` **또는** nested `model_routing_meta:` 블록이 존재하면(=engine-authored) `main`→`sonnet` 치환을 skip한다. 테스트: 스칼라 carrier state(fail-safe `main` 포함)가 두 migration 경로에서 clobber되지 않음 + legacy state(meta 부재)는 기존 migration 동작 유지.
- **테스트**: 설계 §10-1 전체 — floor 결정론 fixture, 상향-전용 property, **단조성 property(2회 호출 floorBaseline 스레딩)**, `main` 불변, pin 최우선+`floor_overridden_by_pin`, riskClass 부재 시 기존 결과 동일(**고정 clock 주입 시 완전 동일 + 무주입 시 decided_at 제외 canonical projection 동일 — PF7**; meta 키 생략 확인), cross-leak 회귀(effort 축 포함), `sliceModelTierWithRisk` §10-2.
- **acceptance**: 설계 §5.1/§5.2/§5.3 meta 계약 + §10-1/10-2.

### T5 — flags 파싱 (M8 ①, 설계 §7.1)

- **파일**: `runtime/flags-runtime.js`, `scripts/parse-deep-work-flags.js`, 테스트.
- **내용**: `--policy=adaptive|shadow`, `--risk=<class>`, `--review=auto|single|dual` 파싱 필드 추가(무효 값은 경고+무시, task text 유출 금지).
- **테스트**: 3플래그 각 값·무효 값·부재 기본값, 기존 플래그 회귀.
- **acceptance**: 설계 §7.1 표 + 배선 1단계.

### T6 — review-finding-runtime + finding persistence (설계 §4.2, PF11 반영)

- **파일**: 신규 `runtime/review-finding-runtime.js` + 테스트.
- **내용**: finding v1 스키마 validate, `normalizeSeverity`(source scheme 매핑 표 = 설계 §4.2 정본), blocker 자격 미달 → major 강등(`demoted` 기록), `dedupeFindings`(구조 키 완전 일치만), `verdictFromFindings(findings, reviewPlan)`. **persistence (PF11)**: canonical 저장 경로 `$WORK_DIR/reviews/<point>-round<N>-findings.json`의 writer/reader 함수(`writeFindings`/`readFindings` — atomic write, 손상 시 `{findings:[]}` fail-open + 경고)를 이 런타임이 소유한다. `readFindings`는 canonical 경로 부재 시 **legacy 파일명 fallback**(`${phase}-cross-review.json` → `adversarial-review.json` 순서, 읽기 전용 best-effort + `source:'legacy'` 표기)을 수행한다 — 구세션 산출물 소비 경로 보존. `runtime/phase-runtime.js`(:250, :273 — phase 관련 열거 실제 위치)는 이 경로와 무관하나, point 어휘(`research|plan|slice-SLICE-NNN|cross-slice|final`)를 이 런타임의 상수로 정의해 T10 소비처가 공유한다.
- **테스트**: 설계 §10-4 — 매핑 표 고정, 강등, dedupe 결정론, verdict, round-trip + **persistence: 경로 규약·atomic write·손상 fail-open·point 어휘 고정 + legacy fallback 순서(`${phase}-cross-review.json` → `adversarial-review.json`)와 `source:'legacy'` 표기의 명시 테스트**.
- **acceptance**: 설계 §4.2 전체 + persistence 계약.

### T7 — review-policy-runtime (설계 §4.1 + B.1/B.2)

- **파일**: 신규 `runtime/review-policy-runtime.js` + 테스트.
- **내용**: `compileReviewPlan`(B.1 매트릭스 상수, `policyMode`/`reviewModeOverride`, riskClass 부재→`source:'default'`, document에 deep-review channel 비배정, sliceRiskClass max 규칙); **`evaluateReviewExecution`**(B.2 결정론 인코딩 — low `degraded-proceed`/medium `needs-human`/high·critical `pause`, critical `human_gate`); **`finishGateAllowed(reviewExecutionJson)`**(R2-M2 — external_change_lock/미충족 ack 판정 pure 함수, 설계 §6.4 정본); `detectReviewChannels({runtime, env})`; 컴파일 예외 시 risk-aware 처리(high/critical known → pause 신호).
- **테스트**: 설계 §10-3 전체 — B.1/B.2 전 셀, evaluateReviewExecution oracle fixture(M6), 컴파일 예외 fail-closed(M2), rounds_max 2, 비배정 property, override 전달, detectReviewChannels 결정론(프로브는 주입 가능한 exec 시뮬레이터로).
- **acceptance**: 설계 §4.1 시그니처·의미론 전체.

### T8 — state/receipt 확장 (설계 §7.2/§7.3)

- **파일**: state round-trip 테스트(기존 `tests/risk-state-roundtrip.test.js` 패턴의 신규 파일), `skills/deep-finish/SKILL.md`의 receipt emit 절(§7.3 블록), slice receipt 관련 문서/헬퍼, forward-compat 테스트.
- **내용**: `methodology_policy_json`/`review_execution_json` frontmatter 스칼라 round-trip(§7.2 shape — `channels`/`execution_decision`/`human_ack`/`external_change_lock`/`risk_acceptances` 포함); session receipt optional `methodology_policy`/`review_execution` 블록; slice receipt optional `review` 확장.
- **테스트**: 설계 §10-5 — round-trip 양 리더, 손상 `{}` fail-open, receipt 리더군 forward-compat(v6.11 §6.2 목록 재사용), `verify-receipt-core.js` 8-check 무영향.
- **acceptance**: 설계 §7.2/§7.3 shape 그대로.

### T9 — 스킬 배선 1: adaptive routing + 스칼라 carrier 리더 전수 전환 (설계 §5.2/§5.4/§5.5, R2-B1 ①)

- **파일**: `skills/deep-work-orchestrator/SKILL.md`(§1-8.5/8.6 재배열 + §1-9 스칼라 2종 기록 + 플래그 state 기록 + ⚠️ pin-below-floor 표면화), `skills/deep-research/SKILL.md`(LLM 추출 절차 삭제 → `--state-file` + authoritative 재라우팅 `--floor-baseline` + `methodology_policy_json` 갱신), `skills/deep-plan/SKILL.md`(slice risk → `sliceModelTierWithRisk` 소비 연결점 명시), `skills/deep-resume/SKILL.md`(신규 state 필드 복원 + :122-136 리더 전환).
- **스칼라 carrier 리더 전수 전환 (R2-B1 ① — round-3 전수 확장, 이 목록이 정본·누락 금지)**: 공통 decode 규칙("스칼라 `model_routing_json`/`model_routing_meta_json` `JSON.parse` → 부재 시 legacy nested 블록 fallback")을 `skills/shared/references/model-routing-guide.md`에 1곳 정의하고, 다음 리더 **8곳** 전부를 그 규칙 참조로 전환한다: `deep-implement`(:167-180 `state.model_routing_meta.tiers`), `deep-status`(:143-152), `deep-resume`(:122-136), `deep-test`(:21-54), `deep-finish`(:207), **`deep-research`(:160/167/187/194/200 — research spawn의 `state.model_routing.research` 초기 소비. `--state-file`은 :270 authoritative 경로만 다루므로 별개)**, **`deep-report`(:131)**, **`skills/shared/references/implementation-guide.md`(:135, 호출부 `deep-implement`:576)**. **contract test는 참조 존재가 아니라 direct-access 부재를 증명한다**: 각 대상 파일에 대해 (a) decode 규칙 참조 존재 assert + (b) nested 직접 접근 패턴(`model_routing_meta.tiers`/`state.model_routing.<phase>` 직접 읽기 서술)이 decode 규칙 경유 없이 잔존하지 않음을 negative assert.
- **내용**: init 3단계 흐름(risk-only → routing --risk-class → 기존 provisional policy snapshot(--reuse-input)); `--risk` 하향 시 risk_acceptances 기록; evaluator_model 지위 변경(§5.5 — 사용자 override 전용).
- **역할 경계 (PF6)**: T9의 스킬 절차가 **유일한 state writer**다 — T1 CLI의 구조화 errors 출력을 받아 `risk_profile_json.errors`에 영속하는 책임 포함.
- **검증 (PF8 — "자동 테스트 불가" 철회)**: 기존 선례(`tests/deep-memory-integration.test.js`·plan-quality-contract류 — SKILL.md 본문을 assert)를 따라 **명명된 contract test** `tests/v6.12-routing-wiring-contract.test.js`를 신설한다: orchestrator/deep-research SKILL.md에 (a) 3단계 init 흐름의 CLI 호출 argv(`--risk-only`/`--risk-class`/`--reuse-input`/`--state-file`/`--floor-baseline`)가 실제 CLI 계약과 일치하는 문자열로 존재, (b) LLM 추출 절차 문구가 삭제됨, (c) 스칼라 2종 기록 절차 존재를 assert.
- **acceptance**: 설계 §5.2 흐름 전체 반영 + §6.1 문구와 모순 없음 + contract test green.

### T10 — 스킬 배선 2: unified review + 문서 shim (설계 §4.3/§6/§6.4)

- **파일**: 신규 `skills/shared/references/adaptive-review-protocol.md`; shim 전환 4건(`review-gate.md`/`phase-review-gate.md`/`review-approval-workflow.md`/`skills/deep-phase-review/SKILL.md`); `skills/deep-implement/SKILL.md` C-2(크로스워크·blocker 차단·finding 보존·위임 blind=입력 격리); `agents/implement-slice-worker.md`(기록 계약만); `skills/deep-test/SKILL.md` 4-1/4-2; `skills/deep-finish/SKILL.md`(external_change_lock 게이트); orchestrator(리뷰 진입 단일화 — review-approval-workflow §2 자동 리뷰 삭제).
- **내용**: 설계 §6.1-§6.4 전체. 실행 순서 계약(reviewers→evaluateReviewExecution→verdictFromFindings)을 protocol 문서와 각 소비 스킬에 일관 기입. finding 기록은 T6 persistence(`writeFindings`) 경유로 일원화. shim 배너 명시.
- **파일 추가 (PF11 잔여, round-3 라인 정정)**: `skills/deep-status/SKILL.md`(:164)·`skills/deep-resume/SKILL.md`(:194)의 legacy adversarial 산출물 리더를 T6 `readFindings`(canonical→legacy fallback) 경유로 전환 — 스코프에 명시 포함.
- **검증 (PF8/PF9/R2-M2)**: T9와 동형의 **contract test** `tests/v6.12-review-wiring-contract.test.js` 신설 — (a) review-approval-workflow §2 자동 리뷰 삭제 확인, (b) 4개 shim 문서의 배너·본문 축소 확인, (c) 소비 스킬의 실행 순서 계약 문구, (d) deep-finish가 `finishGateAllowed`(T7 pure 함수)를 호출하는 문구 확인 — 게이트 판정 자체의 단위 테스트는 T7에서 함수 대상으로 수행(스킬 prose가 아니라 pure 함수가 oracle).
- **acceptance (PF9 — §3.3 8행 전수)**: §3.3의 모순/중복 **8행 전부**의 구조적 해소를 acceptance로 명시한다 — ① 경로A/B 이중 리뷰 제거, ② severity 5종→단일 정규화, ③ auto-fix 책임 분리, ④ 고위험 조용한 통과 차단(evaluateReviewExecution+Stage2 blocker), ⑤ 수렴 cap 단일화(rounds_max 2), ⑥ adversarial 파일명 불일치 흡수(T6 canonical 경로), ⑦ slice finding 본문 보존(receipt pass/fail-only 해소), ⑧ 위험도-무관 degraded 해소(B.2 risk별 분기).

### T11 — effort 적용 채널 (M5, 설계 §5.3/B.3, PF4 반영)

- **파일 (PF4/R2-M3 — 실제 codex dispatcher 경로, ls로 실측 확정)**: `scripts/deep-work-runtime.js`(codex 실행 조립), `runtime/dispatcher-routes.js`(codex argv 라우트), `scripts/deep-work-route-contracts.js`(계약에 effort 파라미터 수용 추가), B.3 매핑 상수(위치는 review-policy-runtime 또는 전용 모듈), 관련 테스트. 이 파일들이 현재 effort를 수용하지 않으므로 **스코프에 명시 포함**한다(§0-5 스코프 밖 중단 규율과 충돌 방지).
- **내용**: B.3 매핑 표(medium/high/xhigh 직접, max는 gpt-5.6 model-gated 아니면 xhigh 클램프+`effort_clamped`) 상수화; `-c model_reasoning_effort=<mapped>` 전달; 프로브 실패 시 플래그 제거 재시도+`effort_applied:false`; subagent/gemini 채널 `effort_applied:false` 고정.
- **테스트**: 매핑 표 fixture(§12 DoD — high/critical에서 최소 1개 `effort_applied:true`), 클램프 기록, 폴백.
- **acceptance**: 설계 §5.3/B.3 + §12 effort 2항.

### T12 — CHANGELOG + 버전 bump (설계 §11, PF12 반영)

- **파일**: `CHANGELOG.md`/`CHANGELOG.ko.md`(v6.12.0 엔트리), `.claude-plugin/plugin.json`/`.codex-plugin/plugin.json`/`package.json`(6.12.0), **`tests/integration/v6.4.0-smoke.test.js:230`의 버전 assert 갱신(E3 예외 — PF12)**, 필요 시 `scripts/validate-envelope-emit.js` 셀프체크 통과 확인.
- **acceptance**: 3 manifests 6.12.0 일치, CHANGELOG 양언어, `npm test` 전체 green (E3 갱신 포함).

## 3. 완료 기준 (설계 §12 전사)

설계 §12 Exit criteria 11항 전부 + `npm test` green + 태스크당 atomic commit. 구현 완료 후 deep-loop implementation point 리뷰(deep-review-loop cross-model, opus/xhigh + gpt-5.6-sol/high)로 최종 수렴한다.

## 4. 리스크·완화

| 리스크 | 완화 |
|---|---|
| legacy state 형태의 다양성이 fallback 스캔 부분집합을 벗어남 | legacy 경로는 best-effort로 한정(대표형 fixture 1종) — 실패는 구조화 errors로 관측되고, 정본 경로는 스칼라 carrier(결정론 writer/reader)가 담당 |
| 스킬 markdown 배선(T9/T10)의 계약 이탈 | 명명된 contract test 2건(`v6.12-routing-wiring-contract`/`v6.12-review-wiring-contract`)이 SKILL.md 본문의 CLI argv·decode 규칙·게이트 호출 문구를 assert (PF8 — 기존 선례 준거) + implementation 리뷰에서 executability 리뷰어가 재검증 |
| 26 fixture 기대값 변경의 파급 | 변경 항목 개별 사유를 커밋 메시지·리뷰에 명시(E1 예외 규율) |
| codex effort 도메인 재확인 실패 | B.3 규율 — 불일치는 설계 변경으로 승격, 조용한 폴백 금지 |
