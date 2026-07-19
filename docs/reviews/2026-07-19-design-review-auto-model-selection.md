# 설계 리뷰 — 자동 모델 선택 (Auto Model Selection)

- 날짜: 2026-07-19
- 리뷰어: 독립 checker 세션 (deep-loop `01KXWB9XVNFQGCFGPD8R8RB2B8`, episode `002-deep-review`, review point: design)
- 리뷰 대상: `docs/design/auto-model-selection.md` (HEAD `4410db1`, base `d24f5f1`)
- 브랜치: `worktree-auto-model-routing`
- 방법: maker 컨텍스트 비공유 fresh 세션. `deep-review-loop --contract --codex` 시도 → Respond 단계가 파일을 수정하므로 "리뷰 전용" 제약과 충돌 + 문서 1개 커밋 상황 부적합 → 지침대로 직접 정독 + 코드베이스 대조 리뷰로 전환.

## 최종 판정: CONCERN

설계 방향과 핵심 메커니즘(concrete state 유지로 소비 경로 보존, 하이브리드 결정론 + LLM 보정, tier 추상화 + 런타임 카탈로그, unknown → `main` fail-safe)은 견고하고 실행 가능하며 하위 호환 철학이 명확하다. **구현 전 반드시 고쳐야 할 설계 모순·하위호환 파괴·실행 불가 결함은 없다.** 다만 planning/implementation에서 반드시 짚어야 할 완결성·상호작용 우려 몇 가지가 있어 APPROVE 대신 CONCERN으로 판정한다. High(블로커) 0건, Medium 3건, Low 5건.

---

## 대조한 코드베이스 사실 (근거)

| 설계 주장 | 실제 코드 | 판정 |
|---|---|---|
| ask는 현재 5-key(model_routing 포함) | `runtime/recommender-runtime.js:4` `KEYS=['team_mode','start_phase','tdd_mode','git','model_routing']` | ✓ 정확 |
| `auto`가 ENUMS에 이미 존재 | `recommender-runtime.js:7` `model_routing:['auto','default','custom']` | ✓ 단, ask-item 모드값 namespace (§Low-3) |
| state.model_routing은 concrete, 소비 skill 무변경 | `deep-research/deep-implement/deep-test`가 `state.model_routing.<phase>`를 concrete 모델명으로 spawn `model=`에 직접 전달 | ✓ (implement은 예외 — §M-1) |
| phase-guard는 `current_phase`/`*_completed_at`/`*_approved`만 검사 | orchestrator SKILL.md:331 명시, `model_routing_meta` 추가 안전 | ✓ 정확 |
| receipt payload 추가는 forward-compatible | `verify-receipt-core.js`는 model_routing을 required로 검사 안 함(주석 434만) | ✓ 정확 |
| migration은 무수정, pinned 값에만 적용 | `scripts/migrate-model-routing.js`는 **state** 파일의 model_routing 블록을 provenance 무관하게 스캔 | ✗ 부정확 (§M-2) |
| detect-runtime는 detect-capability.js 스타일 | `detect-capability.js`는 5줄 re-export, host(claude/codex) 감지 선례 **없음** | △ 신규 영역 (§C-1) |
| `--model-routing` 신규 플래그 | 미존재. 실제 파서는 `runtime/flags-runtime.js`(wrapper 아님) | ✓ 단 파일 지목 어긋남 (§Low-1) |

---

## 관점별 findings

### 1. 정합성 (설계 ↔ 코드베이스 일치)

**[Low-1] 파일 지목 어긋남 — 플래그 파서 실제 위치.**
§1 컴포넌트 표는 `scripts/parse-deep-work-flags.js 수정`으로 `--model-routing` 플래그 추가를 지목하나, 해당 파일은 `runtime/flags-runtime.js`의 `parseFlags`/allowlist를 **thin re-export**할 뿐이다(파일 전체가 24줄 재수출). 실제 파싱·allowlist·warning 로직은 `runtime/flags-runtime.js:25-54`에 있으며 플래그 추가는 여기서 이뤄져야 한다. 테스트도 `runtime/flags-runtime.test.js`가 실질 대상. 구현자가 곧 발견하겠지만 설계의 파일 targeting을 `flags-runtime.js`로 교정 권장.

**[Low-2] `--model-routing` 값 파싱 형식 미명세.**
`parseFlags`는 각 플래그를 `startsWith('--x=')` + `slice()`로 처리하고, orchestrator CLI 진입부(`parse-deep-work-flags.js:28-29`)는 단일 인자를 `/\s+/`로 split한다. `--model-routing="implement=opus, test=haiku"`처럼 콤마 뒤 공백이 있으면 whitespace split로 토큰이 쪼개진다. k=v 서브파싱은 구현 가능하나 "공백 불가, 콤마 구분" 형식을 설계에 명시 권장.

### 2. 완결성 (구현에 필요한 정보 충분성)

**[Medium-1] implement phase의 "concrete state / 소비 무변경"과 "slice-size→tier+catalog 치환"이 서로 긴장.**
- §2는 `state.model_routing = resolved`(concrete)라 소비 경로 무변경이라 하지만,
- §1은 deep-implement의 slice-size auto(현재 `state.model_routing.implement === "auto"`일 때만 `S→haiku,M/L→sonnet,XL→opus` 발동 — `deep-implement/SKILL.md:167-171`)를 tier 표현(S→light 등)+카탈로그 해석으로 **치환**한다고 함.
- 문제: 엔진이 implement에 concrete(`opus`)를 쓰면 slice-size auto는 **발동하지 않는다**(값이 `"auto"`가 아니므로). 반대로 tier/`"auto"`를 state에 쓰면 `deep-implement/SKILL.md:191` `model=state.model_routing.implement`가 그대로 Agent spawn `model`에 전달되어 `"deep"`/`"standard"` 같은 tier명이 모델명으로 넘어가 실패한다.
- 또한 §0 비-목표는 "per-slice 난이도 스코어링은 기존 slice-size auto가 유사 기능 제공"이라며 slice-size auto 존속에 의존하는데, 위 치환이 그 발동 조건을 스스로 없앤다.
- 필요한 명세: (a) state.model_routing.implement에 실제로 무엇이 저장되는가(concrete vs tier vs "auto"), (b) 세션 레벨 resolved implement 모델과 per-slice size 기반 tier 중 무엇이 이기며 각 슬라이스에 어떤 concrete 값이 최종 전달되는가. deep-implement는 tier→catalog 해석 로직을 갖게 되므로 "소비자는 표시만 바꾼다"는 인상과 달리 **소비 경로가 실제로 변경**된다 — 이 사실을 §5에 반영 권장.

**[Medium-3] 구프로필의 `interactive_each_session`에서 model_routing 미제거 시 ask 재발.**
ask 루프(§1-4-3)는 `KEYS`가 아니라 `PROFILE_DATA.interactive_each_session`을 순회한다(orchestrator `SKILL.md:259`, recommender 입력 `ask_items`도 동일). 기존 v3 프로필은 `createV3Profile`/`v2TextToV3Text`가 생성한 `interactive_each_session`에 `model_routing`을 포함한다(`profile-runtime.js:33-34,51`). 따라서 `recommender-runtime.js`의 `KEYS`를 4-key로 줄이고 session-recommender 에이전트가 model_routing 추천을 빼더라도, **구프로필에서는 ask 루프가 여전히 model_routing을 프롬프트**한다 — 그것도 추천이 없어 "(자동 추천 실패 — 직접 선택)" 라벨로, 기존보다 나쁜 UX 회귀. 설계가 "ask에서 model_routing 제거"를 달성하려면 신규 프로필 템플릿뿐 아니라 **orchestrator가 interactive_each_session에서 model_routing을 무조건 필터링**해야 한다(구·신 프로필 공통). 이 필터링 지점을 설계에 명시 권장.

**[Low-3] `auto` "재사용"의 개념적 conflation.**
§5의 "ENUMS에 이미 존재하는 auto 재사용"에서 `ENUMS.model_routing=['auto','default','custom']`은 **ask-item의 라우팅 모드값** namespace다. 반면 프로필 `defaults.model_routing`은 per-phase concrete **맵**(brainstorm:main, research:sonnet…)이며, 설계는 이를 스칼라 `auto` sentinel로 바꾸려 한다. 기계적으로는 `loadV3Profile`(`profile-runtime.js:76-78`)이 스칼라/블록 모두 파싱하고 `updateProfile`(:98)이 스칼라 기록을 지원하므로 동작한다. 다만 "재사용"이라기보다 프로필 default 위치에서의 **신규 의미 부여**이므로 표현 정밀화 권장(기능 결함 아님).

**[Low-4] KEYS 변경의 blast radius 미명세.**
`recommender-runtime.js`에서 `KEYS`는 `parseRecommendation`(lenient)·`validateRecommendation`(strict, `:34` 정확한 key-set 등치)·`capabilityToDisabled`(:40 KEYS 미포함 item throw)·`formatOptions`가 모두 참조한다. orchestrator 실사용 경로는 lenient `parseRecommendation`(`scripts/recommender-parser.js` 재수출)이라 **구버전 5-key 관용 파싱·extra key 무시 주장은 성립**한다(추가 key는 순회 대상 아님). 그러나 `validateRecommendation`의 exact-match와 `capabilityToDisabled('model_routing')` 호출부는 KEYS 4-key화 시 함께 손봐야 한다. 설계가 "파서 4-key"로 뭉뚱그린 부분을 두 파서 + 헬퍼로 구체화 권장(테스트 전략 §8에 recommender-runtime.test.js 갱신이 있어 관리 가능).

### 3. 하위 호환

**[Medium-2] "migration은 pinned 값에만 적용" 주장이 실제 메커니즘과 불일치.**
`scripts/migrate-model-routing.js`의 `migrateStateFile`은 orchestrator §1-3(Step 1-3)에서 **state 파일**의 `model_routing:` YAML 블록을 텍스트 스캔하여 `research/implement/test == "main" → "sonnet"`으로 치환한다(`SKILL.md:22,29,37`). 이 스캐너는 값이 user-pinned인지 엔진이 auto-resolve한 값인지 **구분할 수 없다** — 그냥 블록 안의 main을 본다. 따라서 §5의 "pinned 값에만 계속 적용"은 부정확하다. 실질 위험은 좁다: 신규 세션은 §1-3 시점에 state 파일이 없어 no-op(`SKILL.md:24`), 엔진이 research/implement/test에 `main`을 쓰는 경우는 unknown-runtime fail-safe(전 phase main)뿐이다. 그러나 그 세션을 (여전히 unknown 런타임으로) `/deep-resume`하면 migration이 fail-safe `main`을 `sonnet`으로 clobber → resume 재해석은 런타임 불변 시 skip이라 잘못된 `sonnet`이 잔존. 권장: (a) §5 문구를 "state 블록 스캔이라 provenance 무관"으로 정정, (b) migration ↔ 엔진 write 순서와 unknown-runtime `main` clobber 상호작용을 명시적으로 다룰 것.

**[Low-5] orphan `model_routing_json` 표현 미언급.**
state에는 소비 경로가 읽는 YAML `model_routing:` 블록(dotted `model_routing.implement`) 외에, `runtime/slice-runtime.js:172-183`의 `migrateModelRouting`이 다루는 `model_routing_json` 스칼라 필드가 존재한다. 후자는 dispatcher route `session state migrate-model-routing`(`dispatcher-routes.js:181`)에서만 도달하고 **모델 선택에 실제로 소비되는 곳은 없다**(migration-only orphan). 설계가 YAML 블록에 쓰는 것은 옳으나(소비자가 그것을 읽음), 두 migration 함수가 서로 다른 필드를 대상으로 한다는 사실과 어느 표현이 authoritative인지 한 줄 확인 권장(엔진을 엉뚱한 필드에 배선하는 실수 예방).

**하위 호환 긍정 확인:** `model_routing_meta` 신규 옵셔널 필드는 phase-guard 무영향(§확인)·receipt 검증 무영향(§확인)·`recommendations`(v6.4.2) 선례와 동형. 구세션(meta 부재) resume 시 재해석 skip 규칙도 안전. 프로필 파일 강제 수정 없음. — 이 축들은 파괴적 변경 없음이 성립한다.

### 4. 실행 가능성

**[Concern-1] goal #3(Codex 호환)의 구체값이 설계 시점 미검증 — fail-safe로 비-블로킹.**
런타임 중립 tier 추상화·카탈로그 구조 자체는 명확하고 구현 가능하다. 그러나 (a) Codex 감지 env 마커(§3.1)와 (b) Codex 카탈로그 실제 모델명(§3.2)이 모두 "구현 단계에서 실 Codex 세션 실기 검증으로 pin"으로 연기되어 있다. 코드베이스에 host(claude vs codex) 감지 선례가 없어(`detect-capability.js`는 git/worktree/team capability만) 이는 진짜 신규 영역이다. 다행히 unknown → 전 phase `main`(세션 모델) fail-safe가 있어, Codex 특정값 확정에 실패해도 Codex 세션은 세션 모델로 안전 동작한다. 즉 **추상화는 구조적으로 goal #3를 충족하고 안전하게 degrade**하나, "Codex에서 Codex 모델 자동 선택"의 concrete 실현은 구현기 발견에 의존한다. 설계 결함은 아니며 리스크 표(§9)에 이미 인지되어 있음 — CONCERN 근거로 기록.

**[Low-6] CLI override 값 allowlist의 런타임 혼합.**
§4 override allowlist는 `haiku/sonnet/opus/main`(Claude concrete) + `light/standard/deep`(tier)을 함께 허용한다. Codex 세션에서 사용자가 `--model-routing="implement=opus"`를 주면 Claude 모델명 `opus`가 Codex 경로로 전달되어 §3.3의 불변식("어떤 경우에도 Claude 모델명이 Codex에 전달되지 않는다")과 국소 충돌한다. 사용자 명시 override라 "user knows best"로 볼 수 있으나, Codex 런타임에서는 concrete Claude 명칭을 거부하고 tier-only로 제한하거나 경고하는 처리를 고려 권장.

### 5. 리스크 (설계 §9 검토)

설계의 리스크 표는 4개 주요 리스크(Codex 모델명 세대교체 / 자동 결정 기대 불일치 / 대형 repo 신호 수집 지연 / SKILL.md 프롬프트 회귀)를 적절히 식별하고 각기 합당한 완화책을 갖는다. 특히 "계산 로직 전부 Node 모듈로 내려 테스트 고정, SKILL.md는 호출·표시만"은 회귀 방어로 타당. 추가로 표에 반영되면 좋을 리스크:
- **[Low-7] 신호 수집의 결정성·성능**: `git ls-files` 미설치/비-git fs walk(5,000 cap)·LOC 샘플 200개 외삽이 대형 monorepo에서 규모 오분류를 낳을 수 있다. `<1s` 목표는 좋으나 규모 경계(200/2,000)가 샘플 외삽 오차에 민감. 완화는 이미 "실패 시 standard 수렴"으로 존재하나, 외삽 정확도 자체의 리스크를 한 줄 추가 권장.
- Medium-2(migration clobber)·Medium-3(구프로필 ask 회귀)는 리스크 표에 미포함 — 반영 권장.

### 6. 테스트 전략

§8은 TDD(RED→GREEN→REFACTOR) 하에 신규 `model-routing-runtime.test.js`(신호/baseline 전분기/±1 clamp/카탈로그 해석/우선순위)와 기존 `recommender-runtime.test.js`·`profile-runtime.test.js`·flags 테스트 갱신, `npm test` green 유지를 명시한다. 커버리지 설계는 견고하다. 보강 권장:
- **구프로필 interactive_each_session 필터링**(Medium-3) 회귀 테스트 — 구프로필 로드 시 ask 목록에서 model_routing 부재 검증.
- **migration ↔ auto-resolved 상호작용**(Medium-2) — unknown-runtime `main` state를 migrate했을 때의 기대 동작 고정.
- **implement slice-size ↔ 세션 resolved 상호작용**(Medium-1) — state에 저장되는 최종 값과 per-slice 해석 결과를 픽스처로 고정.
- 언급된 테스트 파일들은 모두 실재 확인(`runtime/*.test.js`, `scripts/*.test.js`).

---

## 수정 제안 요약 (maker에게 — 리뷰어는 파일 미수정)

1. (Medium-1) §5/§2에 implement phase의 state 저장값(concrete vs tier vs "auto")과 세션-resolved ↔ per-slice size tier 승패 규칙을 명시하고, deep-implement 소비 경로가 실제로 변경됨을 인정.
2. (Medium-2) §5 migration 문구를 "state 블록 스캔(provenance 무관)"으로 정정하고, migration 실행 순서 + unknown-runtime `main` clobber 상호작용 처리 추가.
3. (Medium-3) orchestrator가 `interactive_each_session`에서 model_routing을 무조건 필터링하는 지점을 설계에 명시(구프로필 ask 회귀 방지).
4. (Low-1) 플래그 파서 대상 파일을 `runtime/flags-runtime.js`로 교정, (Low-2) k=v 형식(공백 불가) 명시.
5. (Low-4) KEYS 4-key화의 blast radius(validateRecommendation exact-match, capabilityToDisabled, formatOptions) 구체화.
6. (Low-3/5/6/7, Concern-1) 개념 정밀화 및 리스크 표 보강.

## 판정 근거

- 블로커(설계 모순/하위호환 파괴/실행 불가) 부재 → REQUEST_CHANGES 아님.
- 방향·메커니즘·fail-safe 견고, 코드베이스 대조 시 핵심 주장 대부분 정확 → 진행 가능.
- 단 Medium 3건(implement 소비 경로 긴장, migration provenance 오기, 구프로필 ask 회귀)은 planning/implementation에서 반드시 해소해야 회귀를 피함, Codex concrete값은 구현기 검증 의존 → **CONCERN**.
