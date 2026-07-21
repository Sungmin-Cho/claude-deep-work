# v6.12 Adaptive Routing & Unified Review — 구현 계획(plan) 독립 리뷰

- **리뷰 대상:** `docs/plans/2026-07-21-v6-12-adaptive-routing-plan.md` (draft)
- **정본 설계:** `docs/design/v6-12-adaptive-routing-unified-review.md` (3라운드 APPROVE)
- **리뷰 일자:** 2026-07-21
- **리뷰어:** deep-loop 독립 checker 세션 (blind — 설계 리뷰의 사전 판단이 아니라 plan 자체를 평가)
- **구현자 대상:** Codex (gpt-5.6-sol, effort medium) SDD 순차 실행

> 리포트 산출만 — 저장소 파일 수정 없음.

---

## (a) 리뷰 실행 메타

| 채널 | 도구 | 관점 |
|---|---|---|
| Claude semantic/architecture | Opus 4.8 (1M) | 설계→태스크 완전성 · DAG 정확성 · 코드 대조 executability |
| Codex executability | codex-cli (gpt-5.x, high) | 태스크 서술 착수 가능성 · 파일 스코프/테스트 계약 정합 |

리뷰 관점: (a) 완전성, (b) 태스크별 실행 가능성, (c) DAG/순서, (d) TDD·무수정 예외(E1/E2), (e) 구현자 모호성.

---

## (b) Finding 목록

> Claude 독립 리뷰(PF1·PF3) + Codex executability 종합(PF4~PF12). 모든 신규 주장은 파일:라인으로 재검증했다.

### BLOCKER

#### PF1 — T0가 요구하는 state 형태를 결정론적으로 재현할 수 없음 (T1이 착수 불가)

- **위치:** plan T0(acceptance L45), T1(L50 "parseFrontmatter 금지 + extractRoutingBlocks"). 설계 §5.4-3. 코드: `runtime/session-store.js:136-148`(buildSessionState), `:242-249`(리더가 parseFrontmatter), `runtime/frontmatter.js:63-78`(parser nested 거부), `:83-94`(formatScalar object 거부), `skills/deep-work-orchestrator/SKILL.md:320-336,364-381`(블록은 prose에만).
- **근거(재검증):** T0 acceptance는 state에 `model_routing_meta:` **nested 블록**(내부 `tiers:`/`pinned:`)이 실물로 존재함을 요구하고, T1은 그 블록을 raw-scan하는 `extractRoutingBlocks`를 두며 parseFrontmatter를 금지한다. 그러나:
  - 결정론 초기화 `buildSessionState`는 flat 필드만 쓰고 `model_routing`/`model_routing_meta`를 **아예 쓰지 않는다**(`session-store.js:136-148` — 확인: schema_version/session_id/current_phase/work_dir/tdd_state/... 만).
  - nested 블록은 orchestrator **prose(LLM authoring)에만** 존재(`SKILL.md:335` "MR_OUT.meta → model_routing_meta 블록").
  - frontmatter serializer(formatScalar)는 object 값을 **거부**(`:89` throw) → 결정론 mutation writer가 블록을 못 쓴다.
  - parser(parseFrontmatter)는 들여쓴 nested mapping을 **거부**(`:66-67` throw)하고 세션 리더가 이 parser를 쓴다(`session-store.js:242-249`) → nested 블록을 담은 state는 리더가 크래시.
  - 실제 코드는 `model_routing_json` **JSON-string 스칼라**를 쓴다(`deep-work-runtime.test.js:39`, `slice-runtime.js:174`).
- **실패 시나리오:** 결정론 세션 writer로 만들면 라우팅 블록이 없어 T0 acceptance 실패. orchestrator prose를 따라 만들면 **LLM-authored라 형태가 비결정론적**이고, 그 state는 이후 런타임이 `parseFrontmatter`로 읽을 때 크래시한다. **T1은 지원되지 않는 비결정론 표현을 추출 계약으로 동결하게 된다** → 착수 자체가 막힌다.
- **수정 방향(Codex 권고 반영):** T0는 (a) **결정론 라우팅-state writer를 먼저 도입**하거나, (b) 기존 frontmatter 런타임과 호환되는 **JSON-string 스칼라 필드를 정의·테스트**해야 한다. 캡처된 full state는 단순히 텍스트 블록을 담는 게 아니라 **`parseFrontmatter`/`sessionFromState`를 통과**해야 함을 acceptance로 요구하라. 설계 §5.4-3의 "parseFrontmatter 금지"는 nested YAML에 대해서만 옳고, 그 nested 표현 자체가 결정론 state layer에서 지원되지 않는다 — 스칼라라면 parseFrontmatter+JSON.parse가 정답이다.

### MAJOR

#### PF5 — T1 `--reuse-input`에 구현 가능한 digest-불일치 검사도, 완결된 init 데이터흐름도 없음

- **위치:** plan T1(L47-52). 코드: `scripts/risk-profile-cli.js:70-87`(artifact = `{...received, signals}`, digest는 `input_ref`에 별도), `:96-107`(policy 컴파일이 `received.model_routing/tiers/pinned` 필요). 설계 §5.2(init 순서: risk-only → routing → policy).
- **근거:** init 순서상 재사용 artifact는 **model routing 실행 전(stage-1)**에 생성된다. 그 artifact는 stage-2 routing 산출(model_routing/tiers/pinned)을 담을 수 없다. stage-3에서 그대로 재사용하면 `compilePolicySnapshot`이 routing/tiers/pin 결측으로 **다시 공집합 routing_diff**를 만든다 — 인계(b)가 고치려던 바로 그 문제. 또 digest는 artifact에 embed되지 않고 `input_ref`로 분리 반환되므로, **비교할 expected digest가 없어** 불일치 검출이 불가능하다.
- **수정 방향:** expected-digest 출처를 명시하고, stage-2 routing 값이 재사용 artifact에 **어떻게 overlay되는지**(signals 재수집 없이)를 규정하라.

#### PF6 — T1 state-추출 에러의 **소유권**이 미정의

- **위치:** plan T1(L49-51 "추출 실패 → `risk_profile_json.errors` append"). 코드: `scripts/risk-profile-cli.js:78-108`(CLI는 result object emit + risk-input artifact만 씀, state 미변경), `skills/deep-research/SKILL.md:289-292`(state 병합은 LLM 스킬 책임).
- **근거:** 현 CLI는 세션 state를 mutate하지 않는다. 그런데 T1은 실패를 `risk_profile_json.errors`에 append한다고만 한다 — `--state-file`이 입력 state를 직접 mutate하는지, 구조화 에러 필드를 emit해 T9가 persist하는지, 전체 run을 `risk_profile:null`로 바꾸는지 **불명**. 해석마다 테스트·런타임 계약이 달라진다.
- **수정 방향:** CLI는 **명시적 구조화 error 배열을 emit**하고, **T9를 유일 state writer**로 지정해 그것을 append하도록 명문화하라.

#### PF7 — T4 "바이트 동일" 회귀 테스트가 clock 계약 없이는 **실행 불가**

- **위치:** plan T4(L68-73 "riskClass 부재 시 기존 결과 바이트 동일"). 코드: `runtime/model-routing-runtime.js:185`(`decided_at: new Date().toISOString()`).
- **근거:** 모든 `decideModelRouting` 결과가 매 호출 현재 timestamp `decided_at`를 담는다. old/new 두 호출은 나머지가 같아도 timestamp가 달라 **직렬화 바이트 비교가 항상 실패**한다. 구현자는 테스트를 키-존재 확인으로 약화하거나 생략할 유인이 생긴다.
- **수정 방향:** 주입 clock/고정 timestamp를 규정하거나, `decided_at`를 명시 제외한 **canonical projection**에 대해 바이트 동일을 정의하라.
- **참고:** 기존 `runtime/model-routing-runtime.test.js`(존재·38 참조)는 risk/floor 미포함으로 현 동작을 assert하며, meta 키 생략 규율상 **무수정으로 green 유지** — T4 자체에는 3번째 예외 불필요(단 위 clock 계약은 필요).

#### PF8 — T9 "스킬 markdown은 자동 테스트 불가"는 사실이 아님 (전역 TDD 규율·기존 테스트와 모순)

- **위치:** plan §0.1(전역 TDD), T9(L107 "fixture 시나리오 문서 체크"). 코드: `package.json:7`(npm test = 전체), `tests/deep-memory-integration.test.js:27-49`·`tests/plan-quality-contract.test.js:10-19`(기존 테스트가 이미 SKILL.md 계약을 assert).
- **근거:** 스킬 markdown은 이미 자동 테스트 대상이다(기존 2개 테스트가 증거). T9의 "체크리스트 검증"은 오탈자 CLI 플래그·누락된 `--floor-baseline`·낡은 LLM 추출 문단·resume 복원 누락이 **전체 스위트를 통과**하고 미정의 리뷰어 체크리스트에 의존하게 만든다.
- **수정 방향:** T9에 **명명된 contract-test 파일**(필수/금지 스니펫 + 문서화된 모든 CLI 예시의 argv 파싱)을 두라. T10도 동일(아래 PF9).

#### PF9 — T10 acceptance가 §3.3 8개 문제 중 5개만 커버 + 핵심 게이트 객관 검증 부재

- **위치:** plan T10(acceptance L114 "§3.3 모순 5행"). 설계 §3.3(L61-72, **8행**), §12(L375-387 external_change_lock).
- **근거:** §3.3은 8개 문제(이중리뷰·직접모순·severity·조용한통과·수렴조건·**adversarial 파일명 불일치**·**slice finding 본문 손실**·**위험도-무관 degraded**)를 열거하나 T10 acceptance는 5개만 명명한다. 구현자가 **파일명 분기 잔존·finding 본문 손실·High 세션에 Low degraded 적용·lock=true인데 finish 미차단**을 남긴 채 acceptance를 충족할 수 있다.
- **수정 방향:** §3.3 8행 전부 + 리뷰 실행 순서 + headless Critical pause + attended ack + lock/unlock deep-finish 분기에 대한 **실행 가능 시나리오**를 acceptance로 명시하라.

#### PF10 — DAG 누락 간선 `T9 → T10`

- **위치:** plan DAG(L29-33), T9/T10(L103-113 둘 다 orchestrator·deep-implement SKILL 수정). 설계 §4.1(`policyMode`/`reviewModeOverride` 소비), §7.1(L280-284 T9가 flag state persist).
- **근거:** T9가 policy/risk/review 플래그 state persist를 소유하고, unified-review 컴파일러가 그 `policyMode`/`reviewModeOverride`를 소비한다. DAG는 T10에 T6/T7/T8만 준다. DAG-구동 실행기가 T10을 T9 전에 시작하면 **아직 안 쓰인 state 필드에 리뷰 컴파일을 배선**하고, 같은 파일(orchestrator·deep-implement)에 **중첩 편집**을 만든다.
- **수정 방향:** 간선 `T9 → T10` 추가.

#### PF11 — 정규화 finding **저장 경로의 writer/reader 마이그레이션**이 어느 태스크에도 미할당

- **위치:** 설계 §4.2(L157 canonical `$WORK_DIR/reviews/<point>-round<N>-findings.json` + 구 파일명 fallback). plan T6(L82-87, 순수 runtime+테스트만). 코드: `runtime/phase-runtime.js:250-279`(결정론 review writer가 `brainstorm|research|plan` + 고정 legacy 파일명만 지원 — 확인 `:4` `['brainstorm','research','plan']`), `skills/deep-status/SKILL.md:163-164`·`deep-resume/SKILL.md:189-194`(consumer가 legacy 파일명 read).
- **근거:** T6은 §4.2 전체를 acceptance로 claim하나 스코프는 순수 runtime(normalize/verdict)뿐이다. 결과적으로 **slice/cross-slice/final finding을 canonical 경로에 쓰는 컴포넌트가 없고**, status/resume은 신규 파일도 fallback도 소비하지 못한다.
- **수정 방향:** dispatcher/runtime writer + canonical 경로 검증 + atomic write + reader 마이그레이션/fallback을 다루는 **구체 persistence 태스크**를 추가하라.

#### PF12 — T12가 무수정 예외 2건 규율(및 자기 파일 스코프)을 위반 (E3 필요)

- **위치:** plan §0.2(E1/E2만 허용), T12(L123-126 manifests·changelog만). 코드: `tests/integration/v6.4.0-smoke.test.js:214-230`(`const version='6.11.0'` + `assert.equal(pkg.version, version)` — 확인).
- **근거:** 3 manifests를 6.12.0으로 bump하면 이 통합 테스트가 **실패**한다. 테스트를 고치면 전역 예외 목록(E1/E2)과 T12 파일 스코프를 **동시에 위반**한다.
- **수정 방향:** 릴리스 메타데이터 통합 테스트용 **E3 예외를 추가**하고 그 파일을 T12 스코프에 넣어라.

#### PF4 — T11이 실제 codex dispatch 구현을 스코프에서 누락 + 간선 `T10→T11`·`T8→T11` 누락

- **위치:** plan T11(L116-121, dep=T7만, "codex-cli 채널 호출부" 추상). 코드: `scripts/deep-work-runtime.js:86-87`(dispatcher grammar = engine/prompt/timeout/mode — effort 없음), `runtime/dispatcher-routes.js:63-67`(codex argv 정적 구성, effort 없음)·`:270-276`(handler가 effort 메타 미수용), `scripts/deep-work-route-contracts.js:81-82`(route 계약에 effort/model 없음).
- **근거:** effort 적용은 실제 codex dispatcher를 거치는데, T11 파일 스코프가 그 dispatcher(위 4파일)를 누락한다. **strict 파일-스코프 규율(§0.5)상 T11은 이들 수정 필요를 발견하면 중단해야** 한다. 진행하더라도 reviewer effort 선택·fallback 기록에 필요한 T10(리뷰 실행 배선)·T8(persistence)이 없다.
- **수정 방향:** T11 파일 스코프에 dispatcher 3파일+테스트를 명시하고, 간선 `T10 → T11`·`T8 → T11`을 추가하라.

### MINOR

#### PF3 — plan §3 "§12 Exit criteria 10항"은 실제 11항

- **위치:** plan §3(L130). 설계 §12는 `- [ ]` **11개**(확인 — round-3에서 M6·M9 DoD 추가). "전부"로 의미상 커버되나 카운트 stale → "11항"으로 정정.

### INFO / 강점

- **DAG는 그린 간선에 대해 위상 정렬로는 유효**하나, **실제 구현 의존을 반영한 DAG는 아니다**(PF10·PF4의 누락 간선). 순차 순서 자체는 그린 간선 위상 정렬로 정확.
- **완전성은 대체로 양호하나 2건 누락**: §4.2 finding 저장 writer/reader(PF11), T0 결정론 state-writer(PF1). 그 외 §4-§9·부록 B는 최소 명목 owner 보유(단 §6은 "§6.1-§6.4 전체" 같은 광범위 문구라 T10 시나리오 매트릭스 필요 — PF9).
- **파일 스코프 대체로 정확**: `flags-runtime.js`·`parse-deep-work-flags.js`(T5), `risk-profile-cli.js`(T1 신규 플래그가 기존 hand-written `parseArgs` 구조에 부합 — Codex 확인), `validate-receipt.sh`(T3), `model-routing-cli.js`(T4 신규 플래그 부합). 예외: T11 dispatcher 누락(PF4).
- **리스크표가 T0 형태 위험을 인지**하나, T0 acceptance·T1 접근이 그 완화(형태 재확인)와 상충(PF1).
- (교정) round-1 초안의 "model-routing 기존 테스트 부재"는 **오류** — `runtime/model-routing-runtime.test.js`가 존재한다(내 grep이 `tests/`만 조회해 누락). 결론(T4 3번째 예외 불필요)은 동일하나 이유가 다르다(테스트 존재+키 생략으로 green 유지 — PF7 참고).

---

## (c) 코드 대조 검증

| plan 주장 | 검증 | 판정 |
|---|---|---|
| state 파일 경로 `.claude/deep-work.*.md` (T0) | `session-store.js:181,204,385` | ✅ 정확 |
| `flags-runtime.js`/`parse-deep-work-flags.js` 실재 (T5) | 둘 다 존재 | ✅ |
| `risk-profile-cli.js`에 플래그 추가 (T1) | 파일 실재, round-1 확인 | ✅ |
| `validate-receipt.sh:186`/`:100` fix (T3) | round-1 확인 (한 칸 밀림) | ✅ |
| `model-routing-runtime.test.js` 부재 (초안 주장) | **존재**(`runtime/model-routing-runtime.test.js`, 38 참조) — 초안 오류 교정 | ❌ 초안 오류 |
| E1/E2가 유일 무수정 예외 | `v6.4.0-smoke.test.js:214-230`이 `pkg.version==='6.11.0'` assert → T12 bump가 깨뜨림 | ❌ **E3 필요 → PF12** |
| T0 acceptance: `model_routing_meta:` **블록** 형태 실물 | buildSessionState(136-148) 라우팅 미기록; parseFrontmatter(66-67)·formatScalar(89) nested throw; `model_routing_json` 스칼라 사용 | ❌ **불일치 → PF1(blocker)** |
| T1 `--reuse-input` digest 검사 | artifact에 digest embed 없음(`input_ref` 분리), stage-1 artifact가 stage-2 routing 미포함 | ❌ 데이터흐름 갭 → PF5 |
| T4 "바이트 동일" 테스트 | `decided_at: new Date().toISOString()`(`:185`) — 매 호출 상이 | ❌ clock 계약 필요 → PF7 |
| finding canonical 경로 writer 존재 | `phase-runtime.js:4`가 `brainstorm\|research\|plan`만, slice/cross-slice/final writer 없음 | ❌ 미할당 → PF11 |
| T11 파일 스코프에 dispatcher 포함 | 실제 dispatch는 `deep-work-runtime.js:86`·`dispatcher-routes.js:63-67,270`·`route-contracts.js:81` (effort 없음) | ❌ 스코프 누락 → PF4 |
| 스킬 markdown 자동 테스트 불가 (T9 주장) | 기존 `deep-memory-integration.test.js:27`·`plan-quality-contract.test.js:10`이 SKILL.md assert | ❌ 반증 → PF8 |
| plan §3 "§12 10항" | 설계 §12 = 11항 | ❌ 카운트 오류 → PF3 |

---

## (d) Cross-model 종합 (Codex executability)

Codex(codex-cli 0.144.6, high effort) plan executability 리뷰를 job store(`task-mru6xkar-y9pfnz`, status=completed, exit 0)에서 직접 회수했다. Codex는 **10개 finding**을 코드 근거로 냈고, 전건을 Claude가 파일:라인으로 재검증했다(위 §b/§c 반영).

- **Codex ↔ Claude 대응:** Codex #1(T0)=**PF1**(Codex는 blocker 판정 — Claude도 격상), #2(reuse-input)=PF5, #3(error 소유권)=PF6, #4(byte-identical clock)=PF7, #5(T9 markdown testable)=PF8, #6(T10 5/8행)=PF9, #7(T9→T10 간선)=PF10, #8(T11 dispatcher+간선)=PF4, #9(finding 저장 미할당)=PF11, #10(T12 E3)=PF12.
- **Codex가 Claude 단독 리뷰를 넘어 추가로 발견한 것**: PF5(reuse-input 데이터흐름), PF6(error 소유권), PF7(decided_at clock), PF9(§3.3 8행 중 5행), PF10(T9→T10), PF11(finding writer 미할당), PF12(버전 테스트 E3), 그리고 PF4를 실제 dispatcher 파일 4곳으로 구체화. 또 Claude 초안 오류(model-routing 테스트 부재 주장)를 교정(테스트 존재).
- **Codex overall verdict: Reject** — "T0의 authoritative fixture 전제가 결정론 state 구현과 호환 불가라 T1이 안전하게 착수 불가. reuse-input 의미론·canonical finding persistence·필수 DAG 간선·검증 가능한 T9/T10 계약 부재. 이는 polish가 아니라 implementation-start blocker."

---

## (e) 최종 verdict

plan은 **DAG 그린-간선 위상 정렬·태스크-설계 귀속·TDD 골격**이 대체로 건전하나, **구현 착수를 막는 blocker 1건 + major 9건**이 코드 대조로 드러났다:

- **PF1 (blocker)** — T0가 요구하는 nested-블록 state 형태를 결정론적으로 재현·검증할 수 없다(buildSessionState 미기록·parseFrontmatter/formatScalar가 nested 거부). T1의 (b) fix가 착수 불가.
- **PF4~PF12 (major 9)** — reuse-input 데이터흐름 갭·state-error 소유권 미정의·byte-identical의 decided_at·T9 markdown 테스트 가능성·T10 8행 중 5행·T9→T10 간선·finding 저장 writer 미할당·T12 E3·T11 dispatcher 스코프.

이들은 서술 다듬기가 아니라 **태스크 착수 전 해소해야 할 실장 계약 결함**이다(Codex도 Reject). 특히 PF1은 T0/T1을 정지시키고, PF11은 unified review의 finding 영속을 통째로 미할당으로 남긴다. 최소한 T0(결정론 state-writer 또는 스칼라 계약)·T1(reuse-input·error 소유권)·finding persistence 태스크 신설·DAG 간선 3건·E3·T9/T10 contract-test를 반영한 개정이 필요하다.

_Codex overall: Reject. Claude 독립 판정: 동일._

_Round 1 verdict: REQUEST_CHANGES_

---

## Round 2 — 재검증 (PF1 blocker + PF3-PF12 반영본)

- **대상:** plan(상태 "round-1 리뷰 반영본") + 이번에 개정된 설계 §5.4-3/§5.4-2/§5.1/§10-1. round-2 계약: 열린 finding 해소 여부만.
- **방법:** 개정 설계 §5.4-3(스칼라 carrier)를 재독하고 writer/reader 마이그레이션 스코프를 코드로 추적. T11 파일 경로·리스크표 잔존 문구 검증.

### Finding별 판정 (Claude 독립 + Codex round-2 종합 — 코드 재검증)

Codex round-2가 in-memory frontmatter round-trip + 소비자/migration 경로 추적으로 **Claude 독립 판정의 과대평가를 교정**했다(PF5/PF9/PF11/PF12는 resolved가 아니라 partial). 모든 판정은 파일:라인 재검증.

| ID | 판정 | 근거 |
|---|---|---|
| **PF1** (구 blocker) | **부분(partial) → R2-B1 승계** | 스칼라 carrier 계약 자체는 성립(§5.4-3, `formatScalar`/`parseFrontmatter` in-memory round-trip 확인). 그러나 **기존 소비자·migration 전환이 미귀속** → 아래 R2-B1(신규 blocker)로 승계 |
| **PF5** | **부분** | signals-only 재사용·routing 결측 error는 해소. 그러나 `input_digest` **self-embed preimage 미정의** — 현 CLI는 `effective` 전체를 digest(`risk-profile-cli.js:70-76`)하고 그걸 artifact로 기록(`:78-87`), `canonicalDigest`가 전 키 포함(`risk-runtime.js:176-188`) → digest 필드를 넣고 전체 재계산하면 self-reference로 불일치. `input_digest` 제외 projection 규칙 필요(R2-M1) |
| **PF6** | resolved | CLI 무mutate·구조화 emit·T9 유일 writer가 실제 구조(`risk-profile-cli.js:78-108`, `deep-research:289-292`)와 일치 |
| **PF7** | resolved | `now` 주입 + 고정 clock 완전 동일 / 무주입 canonical projection(`plan:74-78`, 설계 §198) — 변경 위치 정확(`model-routing-runtime.js:185`) |
| **PF8** | **부분** | contract test 2종 신설은 해소. 그러나 **리스크표 L144 "자동 테스트 불가" 문구 잔존** — 본문 L113/120과 직접 모순(PF14) |
| **PF9** | **부분** | §3.3 8행 열거·자동리뷰 삭제 contract test는 해소. 그러나 (a) "직접 모순" 행이 auto-fix(§4.4)로 치환돼 8행 대응이 부정확, (b) **T10이 external_change_lock "게이트 판정 로직(runtime 함수)" 단위 테스트를 요구하나 T10 파일 범위에 그 runtime 함수·파일이 없다** — 설계는 이를 "스킬 레벨 게이트"로 정의(§266)라 strict 스코프상 pure gate 함수 owner 부재(R2-M2) |
| **PF10** | resolved | `T9→T10` 간선 + 순차 순서 보장(`plan:30-32,36`) |
| **PF11** | **부분** | T6 `writeFindings`/`readFindings` 귀속은 해소. 그러나 (a) `readFindings`에 **legacy 파일명 fallback 미명시**(설계 §157-158 요구), (b) 결정론 writer가 여전히 `${phase}-review.json`/`adversarial-review.json` 사용(`phase-runtime.js:250-279`), (c) **legacy finding 리더 `deep-status:163-164`·`deep-resume:189-194`가 T6/T10 범위 밖** → reader migration/fallback 미완결 |
| **PF12** | **부분** | E3를 plan §0-2에 추가·T12 포함은 해소. 그러나 (a) 실제 파일은 `tests/integration/v6.4.0-smoke.test.js`(plan의 `tests/v6.4.0-smoke.test.js`는 부재), (b) **정본 설계 §368/§388이 아직 "예외 2건"** — plan §15가 "설계가 정본"이라 선언하므로 "3건 vs 2건" 모순이 구현자에게 상충 지시(설계 미갱신) |
| **PF3** | resolved | §3 "§12 11항" 정정, 설계 §12도 11항(`:376-388`) |
| **PF4** | **부분** | `T8→T11`·`T10→T11` 간선은 해소. 그러나 **T11 파일 경로 2건 오류** — 실제 `scripts/deep-work-runtime.js`·`scripts/deep-work-route-contracts.js`(plan은 `runtime/`). §0-5 strict 스코프상 오경로는 중단 유발(R2-M3) |

### 신규 finding (round-2 반영이 유발 — Codex 종합)

| ID | severity | 근거 | 수정 방향 |
|---|---|---|---|
| **R2-B1** canonical carrier 소비자/migration 미귀속 (blocker) | **blocker** | ① reader 미귀속: `deep-implement:167-180`이 `state.model_routing_meta.tiers` **구조체 직접 접근**, `deep-status:143-152` `model_routing`, `deep-resume:122-136` 구조체 meta+nested 블록, `deep-test:21-54` `model_routing.test`, `deep-finish:207` 구조체 meta를 읽는다. 스칼라만 기록되면 decode 단계 없이 **즉시 실패**. T9는 이들 중 일부만 파일에 넣고 scalar decode migration을 명시하지 않으며 deep-status/deep-finish/shared guide는 범위 밖. ② **migration clobber (신규·심각)**: `slice-runtime.js:172-183` migrateModelRouting이 `model_routing_meta_json` guard 없이 `model_routing_json`의 `main`→`sonnet`을 무조건 치환하고, `migrate-model-routing.js:31` guard는 nested `model_routing_meta:` 블록만 감지 → **v6.12 스칼라 carrier의 의도적 fail-safe `main`이 legacy migration에 clobber**된다(설계는 이름 충돌만 인지, WRITE clobber 미대응) | scalar-first/legacy-fallback **공통 decoder** + orchestrator writer 전환 + deep-research/implement/test/status/resume/finish·shared guide 소비자 전수 전환 + **두 migration의 canonical-meta guard** + 소비자별 scalar fixture contract test를 T9 또는 신규 태스크에 명시 |
| **R2-M1** self-embed digest preimage 미정의 | major | PF5 참조 — `input_digest` 제외 canonical projection / versioned envelope / 별도 immutable signals payload 중 정본 1택 + tamper fixture 필요 |
| **R2-M2** external lock gate 함수 owner 부재 | major | PF9 참조 — pure predicate를 T7 `review-policy-runtime.js`에 명명 귀속하거나 T10 파일 범위에 runtime module 명시 |
| **R2-M3** strict 스코프 위반 실제 경로 오기 | major | PF4/PF12 참조 — 오탈자 아님. `plan:16` 스코프 규율상 올바른 파일 발견 시 중단 강제 → T11(dispatcher 3파일)·T12(`tests/integration/v6.4.0-smoke.test.js`) 경로 정정 필수 |

(minor 정정: 설계/plan이 object throw를 `frontmatter.js:89`로 인용하나 실제는 `:87`; plan의 `phase-runtime.js:4` 인용은 실제 `:251`/`:273-279`.)

---

## (f) 최종 verdict (Round 2)

round-1 blocker PF1의 **carrier 계약**(스칼라 2종)은 성립했으나, 그 전환의 **end-to-end 소비 경로가 빠져** 새 blocker로 승계됐다. Claude 독립 + Codex round-2 종합:

- **resolved (4):** PF6·PF7·PF10·PF3.
- **부분(partial) (7):** PF1·PF5·PF8·PF9·PF11·PF12·PF4 — 각각 계약은 개선됐으나 소비자 전환·digest preimage·리스크표 문구·gate 함수 owner·legacy fallback·설계 예외 카운트·파일 경로가 미완.
- **신규 blocker (1):** **R2-B1** — 스칼라 carrier로 전환하면 주요 phase 소비자(deep-implement 등)가 구조체 직접 접근으로 즉시 실패하고, 기존 legacy migration이 v6.12 fail-safe `main`을 clobber한다. **구현 착수 blocker.**
- **신규 major (3):** R2-M1(digest preimage)·R2-M2(gate 함수 owner)·R2-M3(경로 오기 strict-scope 중단).

Codex overall도 REQUEST_CHANGES(신규 blocker R2-B1). round-1 대비 진전은 분명하나(PF1 carrier 계약 확정, 4건 완전 해소), carrier 전환의 소비자/migration 미귀속이 열린 blocker다. 다음 라운드: R2-B1(공통 decoder + writer/reader 전수 전환 + migration guard) + PF5/PF9/PF11/PF12 partial 정정 + 설계 §12 예외 카운트를 3건으로 동기화 + 파일 경로 정정.

_Codex overall: REQUEST_CHANGES(R2-B1 blocker). Claude 독립 판정: 동일._

_Round 2 verdict: REQUEST_CHANGES_

---

## Round 3 — 재검증 (R2-B1 · R2-M1/M2/M3 · PF8/PF11/PF12 반영본)

- **대상:** 개정 plan + 설계 §5.4-2/§5.4-3/§6.4/§10-7. round-3 계약: round-2 열린 finding 해소 여부만.
- **방법:** migration guard 로직·리더 전수 목록·finishGateAllowed 귀속·경로 실측·예외 카운트 동기화를 코드/문서로 재검증.

### Finding별 판정 (Claude 독립 + Codex round-3 종합 — 코드 재검증)

Codex round-3가 **소비처 전수 추적으로 Claude 독립 판정을 재교정**했다: R2-B1①의 "전수 리더 목록"이 실제로 전수가 아니어서 **blocker가 잔존**한다. (Claude 독립 판정은 plan의 "정본·누락 금지" 문구를 신뢰해 5개 리더만 검증했고, 누락 리더를 Codex의 exhaustive grep이 포착.)

| ID | 판정 | 근거 |
|---|---|---|
| **R2-B1 ①** reader 전수 전환 | **부분(partial) — blocker 잔존** | 정본 목록(설계 §5.4-3:225·plan T9:112)이 5개 스킬만 열거하나 **실제 소비처 전수가 아님**: `deep-research:160,167,187,194,200`이 연구 phase 자체 Agent spawn에서 `state.model_routing.research`를 직접 소비(T9의 `--state-file`은 :270 authoritative만 다룸, 초기 모델 선택 리더는 잔존), `deep-report:131` Model Routing 출력, `skills/shared/references/implementation-guide.md:135`(호출 deep-implement:576)도 직접 읽기 — 모두 목록 누락(grep 확인). 또 **contract test가 "guide 참조 존재"만 assert**하는데 `deep-implement`는 이미 guide 참조(:195)와 nested 직접접근(:167)을 병존하므로 현 형태로도 통과 → direct-access 제거를 증명 못 함. 스칼라-only state 도입 시 deep-research 초기 모델 선택이 깨질 수 있어 **blocker 성격 유지** |
| **R2-B1 ②** migration clobber guard | **resolved (plan-level)** | 설계 §5.4-3(:226)·plan T4(:77): 두 migration에 canonical-meta guard(스칼라/nested meta 존재 시 skip) + clobber 회귀 테스트. Codex 확인: nested guard는 `mutateState`가 먼저 `parseFrontmatter`를 부르므로(`slice-runtime.js:17`) raw text를 parse 전 검사해야 하나 요구 결과는 plan에 충분히 명시 — plan finding resolved |
| **R2-M1** digest preimage | resolved | 설계 §5.4-2(:219): preimage=`input_digest` 제외 canonical JSON. 현 `canonicalDigest`(전 키 포함, `risk-runtime.js:176`)와 정확 대응(Codex 확인) |
| **R2-M2** gate 함수 owner | resolved | 설계 §6.4(:268)·plan T7(:98): `finishGateAllowed` pure 함수를 T7 소유, deep-finish는 결과로만 결정, T10은 호출 문구만 검증(단 설계 §10-3 cross-ref에 함수명 누락 — 문서 정리 필요) |
| **R2-M3** 경로 오기 | resolved | plan T11(:128) 실측 정정 — `scripts/deep-work-runtime.js`·`runtime/dispatcher-routes.js`·`scripts/deep-work-route-contracts.js` 3파일 실재·구조 일치(Codex 확인) |
| **PF8** 리스크표 문구 | resolved | 리스크표(:147) "자동 테스트 불가" 철회, contract test 2건이 argv·decode·gate 호출 assert (단 R2-B1①의 assertion 범위 약함은 별개) |
| **PF11** finding reader migration | **부분(partial)** | T6(:91) canonical writer/reader + legacy fallback 순서·T10(:122) status/resume 전환은 추가됨. 그러나 **라인 참조 오류**: `deep-status:163`은 state 필드 읽기(legacy 파일 리더는 :164), `deep-resume:189`는 `review_state`(legacy 리더 :194), `phase-runtime.js:4`는 phase 열거 아님(실제 :250/:273). 또 T6 테스트(:92)에 fallback 순서·`source:'legacy'` 검증 없고, T10 contract test(:123)에 status/resume 전환 assertion 없음 |
| **PF12** 예외 카운트 동기화 | **부분(partial)** | 설계 §10-7(:370)은 "예외 3건"·경로 정정(`tests/integration/v6.4.0-smoke.test.js`, version literal :219 / assert :230). 그러나 **설계 §12(:390)가 아직 "예외 2건"** — 한 곳 stale(plan §15 "설계 정본" 선언상 모순) |

### 잔여 (비차단 minor)

- **T9 파일목록 정합**: "파일:" 헤더(:111)가 orchestrator/deep-research/deep-plan/deep-resume만 — R2-B1① 리더 대상이 헤더에 미포함(:112 정본 목록과 불일치).
- **문서 정합**: plan 메타데이터(:8)가 아직 "round-2 리뷰 반영본"(round-3 제출인데 stale), plan/design의 `frontmatter.js:89` object-throw 인용은 실제 `:87`(89는 정규식 일부), 설계 §10-3에 `finishGateAllowed` 함수명 cross-ref 누락, PF11 3개 라인 참조 정정 필요.

### 새 blocker·회귀 스캔

- **독립 신규 blocker ID 없음.** 그러나 **R2-B1①이 실제 reader 누락으로 blocker 유지**. R2-B1②·R2-M1/M2/M3·PF8은 resolved, PF11·PF12는 partial.

---

## (g) 최종 verdict (Round 3)

round-2 blocker R2-B1은 **② migration guard는 완전 해소**됐으나 **① reader 전수 전환이 실제 전수가 아니어서 blocker가 잔존**한다. Claude 독립 + Codex round-3 종합:

- **resolved (5):** R2-B1②·R2-M1·R2-M2·R2-M3·PF8.
- **부분(partial) (3):** R2-B1①(blocker 잔존 — deep-research 초기 리더·deep-report·implementation-guide 누락 + contract test assertion 약함), PF11(라인 참조 오류·fallback/source 테스트 누락), PF12(설계 §12 예외 카운트 stale).
- **열린 blocker (1):** R2-B1① — 스칼라-only carrier 도입 시 미이전 리더(특히 deep-research 초기 모델 선택)가 라우팅을 읽지 못한다.

Codex overall도 REQUEST_CHANGES. round-2 대비 진전은 크다(migration clobber guard 완결, 4건 신규 resolved). 그러나 carrier 전환의 소비처 전수 이전이 미완이라 열린 blocker다. 다음 라운드: R2-B1① 리더 목록을 실제 전수(+deep-research 초기 리더·deep-report·implementation-guide)로 확장하고 contract test를 "direct-access 부재"까지 assert하도록 강화 + PF11 라인/테스트 정정 + PF12 설계 §12 동기화 + 문서 정합 minor.

_Codex overall: REQUEST_CHANGES(R2-B1① blocker 잔존). Claude 독립 판정: 동일(자기 교정 반영)._

_Round 3 verdict: REQUEST_CHANGES_

---

## Round 4 — 재검증 (수렴 라운드; R2-B1① · PF11 · PF12 · minor 반영본)

- **대상:** 개정 plan T9/T6/T10 + 설계 §5.4-3/§12. round-4 계약(수렴): 열린 항목 해소 여부만, 신규 finding은 진짜 새 blocker만(§9.6 스타일 루프 방지).
- **방법:** R2-B1①에서 두 번 "전수" 주장에 당했으므로 **소비처를 독립 포괄 grep**(`grep -rln model_routing skills/`)해 8-리더 목록의 완전성을 직접 대조. PF11 라인·PF12 카운트·minor 실측.

### 독립 소비처 전수 대조 (R2-B1① 핵심)

`grep -rln "model_routing" skills/`가 찾은 리더 전부: deep-finish·deep-implement·deep-research·deep-resume·deep-status·deep-test·implementation-guide.md·model-routing-guide.md(규칙 정의처)·orchestrator(writer). **plan 8-리더 목록이 이들을 전부 포함**하며(deep-report는 방어적 과포함), 목록 외 후보 스킬(deep-slice/deep-phase-review/deep-work-workflow/deep-integrate/…)은 0 refs — **누락 소비처 없음 확인**. round-3의 3곳 누락이 해소됨.

### Finding별 판정

| ID | 판정 | 근거 |
|---|---|---|
| **R2-B1 ①** reader 전수 + 강한 test | **resolved** | plan T9(:112)·설계 §5.4-3(:225)가 리더를 **8곳으로 전수 확장**(deep-research 초기 spawn·deep-report·implementation-guide 추가), 독립 포괄 grep과 대조해 누락 없음 확인. **contract test가 negative assert로 강화** — nested 직접접근(`model_routing_meta.tiers`/`state.model_routing.<phase>`)이 decode 규칙 경유 없이 잔존하지 않음을 검증 → deep-implement 참조+직접접근 병존 통과 문제 해소 |
| **R2-B1 ②** | resolved (prior) | migration clobber guard(§5.4-3:226·T4:77) — round-3 확정 |
| **R2-M1** | resolved (prior) | digest preimage input_digest 제외(§5.4-2:219) |
| **R2-M2** | resolved (prior) | finishGateAllowed pure 함수 T7 소유(§6.4:268·T7:98) |
| **R2-M3** | resolved (prior) | T11 경로 실측(:128) |
| **PF8** | resolved (prior) | 리스크표 문구 교체(:147) |
| **PF11** | **resolved** | 라인 정정 확인 — deep-status:164(legacy 산출물 리더)·deep-resume:194 실제 위치 일치, phase-runtime `:250,273`로 정정(T6:91). T6 테스트(:92)에 **legacy fallback 순서(`${phase}-cross-review.json`→`adversarial-review.json`)+`source:'legacy'` 명시 테스트** 추가 |
| **PF12** | **resolved** | 설계 §12(:390) "예외 3건 — §10-7 —"으로 동기화, §10-7과 일치 |

### 문서 cite nit (해소됨)

- plan T0(:42)의 `frontmatter.js:89` → **`:87`로 정정 확인**(라이브 grep: `frontmatter.js:87`). 설계 §221과 동기화 완료. 실제 object throw는 `:87`.
- plan 상태 메타(:8)는 "round-3 리뷰 반영본"으로 갱신됨(resolved).

### Cross-model 종합 (Codex round-4)

Codex(codex-cli, high) round-4를 job store(`task-mru96auw-s4ewwm`, completed, exit 0)에서 회수. Codex 판정:

- **R2-B1① → resolved**: Codex가 **독립 source inspection으로 8-소비처 열거를 대조** — deep-implement:167/deep-status:150/deep-resume:135/deep-test:53/deep-finish:207 + 신규 deep-research:160/167/187/194/200·deep-report:131·implementation-guide.md:135(호출 deep-implement:576) 전부 확인, orchestrator는 writer(:335)·model-routing-guide는 규칙 정의처(:39) — **"No missing real consumer was found"**. negative-assert가 deep-implement 참조(:195)+직접접근(:179) 병존을 잡음.
- **PF11 → resolved**: 라인 정정(deep-status:164/deep-resume:194/phase-runtime:250,273) 실측 일치, fallback 순서·`source:'legacy'` 테스트 명시(plan:92).
- **PF12 → resolved**: 설계 §12(:390) "예외 3건 — §10-7 —", §370과 일치.
- Codex는 "새 blocker 없음"을 확인했고, 유일 미해소로 plan:42 `:89` cite nit만 남겨 "NOT CONVERGED"로 판정했다 — **그 nit이 이후 `:87`로 정정되어(라이브 확인) Codex 자신의 논리대로도 전건 수렴**한다.

### 새 blocker 스캔 (§9.6)

- **새 blocker 없음** (Claude 독립 + Codex 동일). R2-B1① reader 전수(양측 독립 대조)·negative-assert test로 완전 해소. 열린 항목(R2-B1①·PF11·PF12) 전건 resolved. 마지막 cite nit도 정정됨.

---

## (h) 최종 verdict (Round 4 — 수렴)

round-3의 열린 항목이 **전건 해소**됐다. blocker였던 **R2-B1①**은 리더 목록을 실제 소비처 8곳으로 전수 확장(Claude 독립 포괄 grep + Codex 독립 source inspection **양측이 누락 0 확인**)하고 contract test를 **direct-access 부재 negative assert**로 강화해 완결됐다. PF11(라인 정정·legacy fallback 테스트)·PF12(설계 §12 예외 카운트 3건 동기화)도 해소됐고, 마지막 남았던 plan:42 cite nit(`:89`→`:87`)도 정정 확인됐다.

4라운드에 걸쳐 blocker 1(R2-B1) + major 9(round-1 M1-M9급 포함) + 다수 partial이 모두 수렴했고, 각 라운드의 해소를 코드 근거로 재검증했으며 cross-model(Codex)이 Claude 단독 판정의 과대평가를 두 차례 교정했다(reader 누락·partial 재판정). 남은 것은 구현 착수뿐 — 신규 finding 없음.

_Codex overall: 잔여 cite nit 정정으로 CONVERGED. Claude 독립 판정: 동일._

VERDICT: APPROVE
