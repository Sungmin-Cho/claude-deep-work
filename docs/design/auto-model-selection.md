# 자동 모델 선택 (Auto Model Selection) — 설계 문서

- 날짜: 2026-07-19
- 상태: 사용자 승인됨 (deep-loop run `01KXWB9XVNFQGCFGPD8R8RB2B8`, episode `001-deep-work`, design point)
- 브랜치: `worktree-auto-model-routing` (base `d24f5f1`)
- 개정: r2 — design 리뷰(episode `002-deep-review`, verdict CONCERN) Medium 3건 + Low 지적 반영. 리뷰 리포트: `docs/reviews/2026-07-19-design-review-auto-model-selection.md`

## 0. 문제 정의와 목표

현재 deep-work는 세션 초기화 5-key ask(team_mode / start_phase / tdd_mode / git / **model_routing**)에서
유저가 model_routing을 직접 선택한다(`default|custom`, custom이면 phase별 sonnet/haiku/opus/main 수동 지정).
이는 스마트하지 않은 UX다 — 모델 선택은 코드베이스 규모와 작업 난이도로부터 AI가 자동 결정해야 한다.

**목표:**

1. model_routing을 ask에서 **완전 제거**(5-key → 4-key). AI가 자동 결정하고 근거와 함께 표시만 한다.
2. 판단은 **하이브리드**: 결정론적 Node 엔진(코드베이스 신호) + session-recommender LLM의 난이도 보정(±1단계).
   LLM 실패 시 결정론적 기준선으로 동작(오프라인 안전).
3. **런타임 중립 tier 추상화**: 엔진은 논리 tier(`light`/`standard`/`deep`/`main`)만 결정하고,
   런타임별 카탈로그가 실제 모델명으로 해석한다. Claude Code / Codex 양쪽 호환 —
   Codex에서 실행 시 Codex에 맞는 모델이 자동 선택된다.
4. 해석 시점은 **init + resume 재해석**(승인된 접근 A): 세션 초기화 시 해석값을 state에 저장해
   기존 소비 경로를 보존하고, 다른 런타임에서 `/deep-resume`할 때만 tier에서 재해석한다.

**비-목표 (v1 범위 제외):**

- per-slice 동적 난이도 스코어링(plan 단계 slice별 difficulty 필드) — v2 후보.
  기존 slice-size 기반 auto와 `/deep-slice model` override가 유사 기능을 이미 제공한다.
- evaluator_model / recommender 모델 자체의 자동화 — 기존 동작 유지.
- deep-suite payload-registry 스키마 bump — suite 측 후속 작업으로 분리(§7).

## 1. 아키텍처 & 컴포넌트

기존 `runtime/` 컨벤션(순수 Node, zero-dep, 파일별 `.test.js`, 소문자-하이픈 파일명)을 따른다.

| 컴포넌트 | 신규/수정 | 역할 |
|---|---|---|
| `runtime/model-routing-runtime.js` | 신규 | 신호 수집 → baseline tier → LLM 보정(±1 clamp) → 카탈로그 해석. 순수 함수 중심 |
| `runtime/model-catalog.js` | 신규 | tier → 런타임별 실제 모델명 매핑 + 프로필 `model_catalog:` override 병합 |
| `scripts/detect-runtime.js` | 신규 | 호스트 감지(claude/codex/unknown). `detect-capability.js`와 같은 스타일의 순수 판별 모듈 |
| `scripts/model-routing-cli.js` | 신규 | orchestrator SKILL.md에서 한 줄 호출용 CLI 래퍼(신호 수집+결정+해석 JSON 출력) |
| `agents/session-recommender.md` | 수정 | ask 추천 5-key → 4-key. `model_routing` 추천 제거, `task_difficulty`(low/medium/high + reason) 출력 추가 |
| `runtime/recommender-runtime.js` | 수정 | KEYS 4-key화 + `task_difficulty` 검증 + `filterAskItems()` 헬퍼. **blast radius(리뷰 Low-4)**: lenient `parseRecommendation`(실사용 경로), strict `validateRecommendation`(exact key-set 등치), `capabilityToDisabled`(비-KEYS item throw), `formatOptions` 호출부를 함께 갱신. 구버전 5-key 응답은 관용 파싱(model_routing 키 무시) |
| `runtime/flags-runtime.js` | 수정 | `--model-routing=implement=opus,test=haiku` 플래그 추가(allowlist 검증). `scripts/parse-deep-work-flags.js`는 thin re-export이므로 실 로직·테스트는 flags-runtime에 위치 (리뷰 Low-1) |
| `skills/deep-work-orchestrator/SKILL.md` | 수정 | §1-4 ask에서 model_routing 제거, §1-9 직전 엔진 실행 + state 기록, §1-11 자동 결정 결과·근거 표시. **ask 항목 필터(리뷰 Medium-3)**: ask 루프는 `PROFILE_DATA.interactive_each_session`을 순회하므로 구프로필에 남은 `model_routing` 항목을 orchestrator가 **무조건 필터링**한다 — 순수 헬퍼 `filterAskItems()`(recommender-runtime 수록, 테스트 가능)를 §1-4-2 recommender `ask_items` 입력과 §1-4-3 ask 루프 양쪽에 적용 |
| `skills/deep-resume/SKILL.md` | 수정 | resume 시 `model_routing_meta.runtime` ≠ 현재 runtime → tier에서 재해석 + state 갱신 + 1회 안내 |
| `skills/deep-implement/SKILL.md` | 수정 | per-slice tier 결정 규칙 도입(§2.5) — slice-size tier + 세션 난이도 offset을 카탈로그로 해석. **소비 경로가 실제로 변경됨을 인정**(리뷰 Medium-1): spawn 직전 resolver 헬퍼 호출이 추가된다 |
| `skills/shared/references/model-routing-guide.md` | 수정 | 자동 선택 동작·tier·카탈로그·override 경로 문서화 |
| `runtime/profile-runtime.js` | 수정 | 신규 프로필 defaults `model_routing: auto`(전 phase; plan/brainstorm은 main 고정 규칙이 엔진에 있음) |

## 2. 데이터 흐름 & 결정 규칙

```
세션 init (orchestrator §1-9 state 작성 직전):
  runtime  = detectRuntime(env)                     # claude | codex | unknown
  signals  = collectCodebaseSignals(root)           # 결정론적, <1s 목표 (§2.1)
  baseline = baselineTiers(signals, taskText)       # 규칙표 (§2.2)
  hint     = recommender.task_difficulty | null     # LLM 보정 입력 (§2.3)
  tiers    = applyDifficulty(baseline, hint)        # ±1단계 clamp
  resolved = resolveTiers(tiers, runtime, catalog)  # tier → 실제 모델명 (§3)

  state.model_routing      = resolved               # concrete 모델명 — research/test 소비 경로 무변경 (implement은 §2.5)
  state.model_routing_meta = { tiers, signals_summary, difficulty, reasons,
                               runtime, catalog_version, decided_at }
```

### 2.1 결정론적 신호 (collectCodebaseSignals)

| 신호 | 수집 방법 | 캡 |
|---|---|---|
| `tracked_files` | `git ls-files` count (비-git이면 fs walk) | walk 시 최대 5,000개에서 중단 |
| `loc_estimate` | tracked 파일 중 소스 확장자 샘플 최대 200개의 LOC 합 × 외삽 | 파일당 1MB skip |
| `languages` | 소스 확장자 종류 수 | — |
| `has_tests` | `test`/`tests`/`__tests__`/`spec` 디렉터리 또는 `*.test.*` 존재 | — |
| `deps_count` | package.json 등 매니페스트의 의존성 수(있으면) | — |

수집 실패(권한/타임아웃)는 신호별 null 허용 — null이 많으면 `standard`로 수렴(§6 fallback).

### 2.2 Baseline 규칙표

repo 규모 분류: `small`(tracked_files < 200), `medium`(< 2,000), `large`(그 이상).

| Phase | small | medium | large | 비고 |
|---|---|---|---|---|
| brainstorm | main | main | main | 대화형 메인 세션 고정(기존 spec §3 D1 W1 유지) |
| research | light | standard | standard | 대형 다언어(languages ≥ 4)면 deep 상향 |
| plan | main | main | main | 대화형 메인 세션 고정 |
| implement | standard | standard | deep | 소형 + 좁은 task 키워드("fix", "한 줄", "typo")면 light 하향 |
| test | light | light | standard | — |

task 키워드 휴리스틱(예: "마이그레이션"/"리팩터"/"전면" → 상향 후보)은 baseline 단계에서 1회만 적용하고,
LLM 보정과 중복 적용하지 않는다(이중 상향 방지).

### 2.3 LLM 난이도 보정 (하이브리드)

- session-recommender 출력에 `task_difficulty: { value: low|medium|high, reason }` 추가.
- `high` → research/implement/test tier +1단계, `low` → −1단계, `medium` → 무보정. `light↔deep` 범위 clamp.
- `main`(plan/brainstorm)은 보정 대상 아님.
- recommender skip/실패/timeout(기존 §1-4-2 fallback 경로)이면 보정 없이 baseline 그대로 — 결정론적으로 항상 동작.

### 2.4 우선순위 (강한 것이 이김)

1. CLI `--model-routing=implement=opus,...` (명시 k=v — 콤마 구분, **공백 불가**; 리뷰 Low-2)
2. 프로필 defaults의 concrete 모델명 (user-pinned — §5 마이그레이션)
3. `/deep-slice model SLICE-NNN <model>` (implement 진행 중 per-slice)
4. 엔진 자동 결정 (기본 경로)

### 2.5 Implement phase의 state 저장값과 per-slice 규칙 (리뷰 Medium-1 해소)

**state에 저장되는 값**: `state.model_routing.implement`는 항상 **concrete 세션 해석값**이다
(tier명·`"auto"` sentinel을 state에 저장하지 않는다 — tier명이 Agent spawn `model=`로 새는 실패 모드 차단).
엔진의 tier 결정은 `model_routing_meta.tiers.implement`에 병행 저장된다.

**deep-implement의 spawn 규칙** (소비 경로 변경 있음 — resolver 헬퍼 호출 추가):

- **pinned 경로**(§2.4 우선순위 1–3으로 결정된 concrete 값): 그 값을 그대로 spawn `model=`에 전달 — 기존 동작과 동일.
- **엔진 자동 경로**(`model_routing_meta.tiers.implement` 존재): slice마다
  `slice_tier = sizeToTier(size)` (S→light, M/L→standard, XL→deep),
  `offset = tierIndex(meta.tiers.implement) − tierIndex('standard')` (난이도 보정: −1/0/+1),
  `final_tier = clamp(slice_tier + offset, light..deep)`,
  spawn model = `catalog[runtime][final_tier]`.
  - 세션 tier가 `standard`이면 기존 slice-size auto와 **정확히 동일**(S→haiku, M/L→sonnet, XL→opus on Claude).
  - slice `size` 부재 시 `final_tier = meta.tiers.implement` (세션값 그대로).
- 기존 `model_routing.implement === "auto"` 문자열 분기(deep-implement §Model Routing)는 위 규칙으로 **대체**된다.
  구세션 state에 `"auto"`가 남아 있으면 meta 부재 시 `sonnet`으로 취급(현행 기본과 동일) + 1회 경고.

§0 비-목표의 "기존 slice-size auto가 유사 기능 제공"은 이 규칙으로 계승된다(발동 조건이
`"auto"` 문자열에서 "엔진 자동 경로"로 이동).

## 3. 런타임 감지 & 카탈로그

### 3.1 감지 (detect-runtime)

판별 순서 (첫 매치 승리) — **impl-review H-1로 구현 단계에서 아래와 같이 정정됨** (원 설계는
"override > codex > claude > unknown"이었으나, Claude Code 세션이 codex companion의
`CODEX_HOME`을 물려받는 병설 환경에서 codex로 오판되는 역방향 유출 버그가 실측되어 수정):

1. `DEEP_WORK_RUNTIME` env — 명시 override (`claude`|`codex`, 그 외 값 무시+경고)
2. Claude-native 배타 마커 — `CLAUDECODE` / `CLAUDE_CODE_ENTRYPOINT`(Claude Code만 세팅; codex-native
   세션은 세팅하지 않음). codex companion의 `CODEX_HOME`을 물려받아도 이 그룹이 우선해 `claude`로 확정.
3. Codex 마커 — `CODEX_HOME` 등 Codex CLI가 세팅하는 env (**구현 단계에서 실제 Codex 세션 실기 검증으로 마커 목록 pin**)
4. 비배타 Claude 마커 — `CLAUDE_PLUGIN_ROOT` 등 (순수 codex 세션이 claude 잔존 env를 물려받는
   정방향 오염 시나리오에서는 여전히 codex 마커가 우선한다)
5. 판별 불가 → `unknown`

### 3.2 카탈로그 (model-catalog)

```yaml
# 기본 카탈로그 (코드 내 상수) — 프로필 model_catalog: override는 mergeCatalog로 모듈
# 레벨 지원되나 CLI/프로필 end-to-end 배선은 향후 확장(v1 미배선, impl-review L-1)
claude:
  light: haiku
  standard: sonnet
  deep: opus
  main: main
codex:
  light: <codex-소형-모델>       # 구현 단계에서 설치된 codex CLI 실기 검증으로 pin
  standard: <codex-표준-모델>    # (예: codex CLI의 기본 모델) — 설계에 하드코딩하지 않음
  deep: <codex-대형-모델>
  main: main
```

- `main`은 "모델 지정 없이 현재 세션 모델 사용" sentinel — 카탈로그 해석을 거치지 않는다.
- `unknown` 런타임 → 전 phase `main` fallback + 1회 경고. 잘못된 모델명으로 spawn이 실패하는 것보다
  세션 모델로 도는 것이 안전하다(fail-safe).
- Codex 카탈로그의 정확한 모델명은 **구현(implement) 단계에서** 설치된 codex CLI(`codex exec` 지원 모델)를
  실기 확인해 pin한다. 카탈로그는 단일 파일 상수 + 프로필 override라서 모델 세대 교체 시 교체 비용이 국소적이다.
- state/receipt에는 **tier와 해석된 모델명을 둘 다 기록**해 런타임 전환·모델 세대 교체를 추적 가능하게 한다.

### 3.3 Codex에서의 소비 의미

- Claude Code: 기존대로 Agent spawn `model` 파라미터에 해석값 전달(소비 skill 무변경).
- Codex: Agent-스폰이 없는 경로(솔로/inline)에서는 해석값이 기록·표시용이며, `codex exec`류 서브프로세스
  호출이 있는 경로에서는 `--model` 인자로 전달한다. 호스트가 모델 파라미터를 지원하지 않는 지점은
  `main`과 동일하게 동작(세션 모델) — 어떤 경우에도 Claude 모델명이 Codex에 전달되지 않는다.

## 4. UX

- **ask**: 5-key → 4-key(team_mode / start_phase / tdd_mode / git). model_routing 질문 제거.
- **세션 시작 메시지**(orchestrator §1-11):

  ```
  모델 라우팅(자동): R=sonnet P=main I=sonnet T=haiku
    근거: 중형 코드베이스(약 1.2k files, 3개 언어) · 난이도 medium(추천기)
    조정: --model-routing="implement=opus" 또는 /deep-slice model
  ```

- **override**: ① `--model-routing=k=v,...` 플래그 — 콤마 구분·**공백 불가**(orchestrator 진입부가 whitespace split하므로; 리뷰 Low-2). 값 allowlist: tier명(light/standard/deep/main — 카탈로그 해석) + **현재 런타임의** concrete 모델명. 런타임 불일치 concrete 명칭(예: Codex 세션의 `opus`)은 해당 항목 거부+경고 후 tier 사용 안내 — §3.3 불변식 유지(리뷰 Low-6). ② `/deep-slice model` 유지 ③ 프로필 pinned 값 존중.
- recommender 실패 시에도 질문으로 되돌아가지 않는다 — baseline 자동값 + "(자동 추천 실패 — 기준선 적용)" 1회 표시.

## 5. 호환성 & 마이그레이션

- **프로필 v3**: 신규 프로필 defaults는 `model_routing: auto` — 스칼라 sentinel. 이는 프로필 defaults 위치에서의
  **신규 의미 부여**다(ENUMS의 `auto`는 ask-item 모드값 namespace로 별개 — 리뷰 Low-3).
  `loadV3Profile`이 스칼라/블록 양쪽을 이미 파싱하므로 기계적으로 안전.
  기존 프로필의 per-phase concrete 값(`research: sonnet` 등)은 **user-pinned로 재해석**하여 그대로 존중
  (해당 phase 엔진 skip + 1회 안내). 파일 수정 강제 없음 — 파괴적 변경 없음.
- **state 스키마**: `model_routing`은 계속 concrete 모델명(소비 skill 무변경). `model_routing_meta`는
  신규 옵셔널 필드 — phase-guard는 `current_phase`/`*_completed_at`/`*_approved`만 검사하므로 enforcement 영향 없음.
- **기존 migration**(v6.4.0 `main→sonnet`, `scripts/migrate-model-routing.js`)과의 상호작용(리뷰 Medium-2):
  이 스캐너는 state 파일의 `model_routing:` 블록을 **provenance 무관하게** 텍스트 스캔한다(pinned/엔진 값 구분 불가).
  엔진이 unknown-runtime fail-safe로 쓴 `main`을 resume 시 `sonnet`으로 clobber하면 안 되므로,
  가드는 `migrateStateFile` 내부 조기 반환으로 구현(호출부 prose 가드보다 테스트 가능).
  (엔진이 쓴 state는 v6.10+이며 legacy `main` 사용자 선택이 존재할 수 없다 — fail-safe `main`은 의도된 값).
  legacy 세션(meta 부재)에는 기존 migration이 그대로 적용된다.
- **state 표현의 authoritative 확인**(리뷰 Low-5): 소비 경로가 읽는 것은 YAML `model_routing:` 블록이며,
  `model_routing_json` 스칼라 필드(slice-runtime `migrateModelRouting` 대상)는 migration 전용 orphan으로
  모델 선택에 소비되지 않는다. 엔진은 **YAML 블록에만** 쓴다.
- **recommender 하위 호환**: 파서는 구버전 5-key 응답을 받으면 model_routing 키를 무시하고 4-key만 소비
  (stale agent 캐시 관용). `task_difficulty` 부재 시 무보정.
- **`/deep-resume`**: state의 `model_routing_meta.runtime` ≠ 현재 감지 runtime →
  저장된 tiers를 현재 카탈로그로 재해석해 `model_routing` 갱신 + 1회 안내. meta 부재(구세션) → 재해석 skip(기존 값 유지).

## 6. 에러 처리 (모든 fallback은 silent 금지 — 1회 경고 표시)

| 실패 지점 | 동작 |
|---|---|
| 신호 수집 실패/타임아웃 | 해당 신호 null → 규모 `medium` 취급(`standard` 수렴) + 경고 |
| recommender 실패/timeout | 보정 없이 baseline (기존 fallback 경로 재사용) + 안내 |
| 런타임 판별 불가 | 전 phase `main` + 경고 |
| 카탈로그 miss(tier 키 없음) | 해당 phase `main` + 경고 |
| `--model-routing` 파싱 실패 | 해당 항목 무시 + 경고(전체 거부 아님 — 기존 flag warning 패턴) |

## 7. Receipt / suite 연동

- `session-receipt` payload에 `model_routing_meta` 추가 — forward-compatible 옵셔널 추가.
  deep-suite `payload-registry` minor bump는 **suite 측 후속 작업**(deep-suite Phase 3 배치)으로 분리하고
  이 repo PR에는 포함하지 않는다(CLAUDE.md "Suite-side updates" 규칙).

## 8. 테스트 전략 (TDD: RED → GREEN → REFACTOR)

- `runtime/model-routing-runtime.test.js` (신규):
  - fixture 디렉터리 기반 신호 수집(캡·null 허용 포함)
  - baseline 규칙표 전 분기(small/medium/large × phase)
  - difficulty ±1 clamp(light 하한·deep 상한·main 불변)
  - 카탈로그 해석(claude/codex/unknown fallback), 프로필 override 병합
  - 우선순위(CLI > pinned > slice > auto)
- `runtime/recommender-runtime.test.js` (갱신): 4-key 파싱, `task_difficulty` enum 검증,
  구버전 5-key 관용 파싱, difficulty 부재 무보정.
- `runtime/profile-runtime.test.js` (갱신): 신규 프로필 `auto` 기본값, pinned concrete 값 보존.
- `runtime/flags-runtime.test.js` (갱신): `--model-routing` k=v allowlist, 공백 포함 값 거부, 런타임 불일치 concrete 거부.
- 리뷰 지정 회귀 픽스처(리뷰 §6 보강 3건):
  - **구프로필 ask 필터링**(Medium-3): `interactive_each_session`에 model_routing이 있는 구프로필 로드 시 ask 목록·recommender ask_items에서 model_routing 부재 검증.
  - **migration ↔ 엔진 상호작용**(Medium-2): `model_routing_meta` 존재 state에서 migration skip, meta 부재 legacy state에서 기존 main→sonnet 동작 유지.
  - **implement per-slice 규칙**(Medium-1): 세션 tier standard에서 기존 slice-size auto와 동일 결과(S→haiku 등가), offset ±1 시프트, size 부재 fallback, 구세션 `"auto"` 문자열 → sonnet 취급을 픽스처로 고정.
- 전체 회귀: `npm test`(Node 20+) green 유지.

## 9. 리스크

| 리스크 | 완화 |
|---|---|
| Codex 모델명이 세대 교체로 무효화 | 카탈로그 단일 파일 + 프로필 override + tier/모델 병행 기록 |
| 자동 결정이 유저 기대와 다름 | 근거 표시 + 3중 override 경로(CLI/프로필 pinned/slice) |
| 신호 수집이 대형 repo에서 느림 | 샘플링·파일 수 캡, <1s 목표, 실패 시 standard 수렴 |
| LOC 샘플 외삽의 규모 오분류(리뷰 Low-7) | 규모 경계(200/2,000)는 tracked_files 우선 판정, LOC은 보조 신호로만 사용 + 오차 시 standard 수렴 |
| migration이 엔진 fail-safe `main`을 clobber(리뷰 Medium-2) | `model_routing_meta` 부재 시에만 migration 실행 가드(§5) + 회귀 테스트 |
| 구프로필에서 model_routing ask 재발(리뷰 Medium-3) | orchestrator 무조건 `filterAskItems()` 필터(§1) + 회귀 테스트 |
| SKILL.md(프롬프트) 변경의 회귀 | 계산 로직은 전부 Node 모듈로 내려 테스트로 고정, SKILL.md는 호출·표시만 |
