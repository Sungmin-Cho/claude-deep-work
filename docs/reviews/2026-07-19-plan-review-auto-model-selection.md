# 계획 리뷰 — 자동 모델 선택 (Auto Model Selection) Implementation Plan

- 날짜: 2026-07-19
- 리뷰어: 독립 checker 세션 (deep-loop, episode `004-deep-review`, review point: plan)
- 리뷰 대상: `docs/plans/2026-07-19-auto-model-selection-plan.md` (HEAD `e246f03`, base `d24f5f1`)
- 근거 스펙: `docs/design/auto-model-selection.md` (r2, 커밋 19f887f, 승인됨)
- 선행 리뷰: `docs/reviews/2026-07-19-design-review-auto-model-selection.md` (design CONCERN — Medium 3건)
- 브랜치: `worktree-auto-model-routing`
- 방법: maker 컨텍스트 비공유 fresh 세션. `deep-review-loop --contract --codex`는 문서(계획) 1개 리뷰에 부적합(Respond 단계가 파일 수정 → "리뷰 전용" 제약 충돌)하여 선행 checker 002/003과 동일하게 직접 정독 + 코드베이스 기계적 대조로 전환.

## 최종 판정: CONCERN

계획은 설계 r2 §1 컴포넌트 표 12행 전부와 design 리뷰 Medium 3건 해소 규칙을 태스크·acceptance·테스트로 충실히 매핑한다. 코드 스니펫의 라인 오프셋·`slice()` 인덱스·함수 시그니처·SKILL.md 섹션 앵커는 **대조한 범위에서 대부분 실제 코드와 일치**하며, TDD 사이클(실패 테스트 → 실패 확인 → 구현 → 통과 → 커밋)이 Node 모듈 태스크 전반에 존재한다. 핵심 정합성(세션 tier=standard일 때 per-slice 규칙이 기존 slice-size auto와 정확히 등가)도 검증 시 성립한다.

구현 자체를 막는 하드 블로커(스펙 완전 미커버로 실행 불가·코드 스니펫이 실제 코드와 어긋나 테스트가 원천적으로 불가능·TDD 사이클 전면 결손)는 **없다**. 다만 (a) 설계 §7이 명시한 in-repo 산출물 1건이 어느 태스크에도 매핑되지 않았고, (b) production 도달 가능한 `validateRecommendation` 수정에 전용 RED 테스트가 없으며, (c) 2개 스니펫이 paste-and-run 기준으로는 어긋나 있어(RED 테스트로 자기교정되긴 함), 구현 착수 전 maker가 짚고 넘어가면 회귀·누락을 피할 수 있다. 따라서 APPROVE 대신 CONCERN. High(블로커) 0건, Medium 2건, Low 6건.

---

## 대조한 코드베이스 사실 (근거)

| 계획 주장 | 실제 코드 | 판정 |
|---|---|---|
| `--model-routing=` 값은 `arg.slice(16)` (Task 8) | `--model-routing=` = 정확히 16자 (`--`2 + `model`5 + `-`1 + `routing`7 + `=`1) | ✓ 정확 |
| flags 초기값 `:29`, `--worktree=` 분기 다음 `:50` 앞 삽입 (Task 8) | `flags-runtime.js:26-29` 초기 객체, `:48-49` `--worktree=` 분기, `:50` `else task.push` | ✓ 정확 |
| createV3Profile 템플릿 `:51`, v2→v3 fallback/interactive `:32`/`:34` (Task 9) | `profile-runtime.js:51` 템플릿 문자열, `:32` `fallback.model_routing`, `:34` interactive 목록 | ✓ 라인 정확 (용어는 §Low-6) |
| migrateStateFile 파일 read 직후 가드 (Task 10) | `migrate-model-routing.js:25` `const src = readFileSync(...)`; 치환 로직 `:33-` | ✓ 위치 정확 / ✗ 변수명(§Low-3) |
| recommender parseRecommendation/validateRecommendation 구조 (Task 7) | `recommender-runtime.js:24-32`(lenient), `:33-39`(strict exact-match) | ✓ 정확 |
| deep-implement `## Model Routing` `:167`·`model=state.model_routing.implement` `:191/:402/:425` (Task 11) | `deep-implement/SKILL.md:165` 헤더, `:167` 본문, `:171` `"auto"` 분기, `:191/:402/:425` spawn | ✓ 정확 |
| orchestrator `§1-4-2 sanitizeInput ask_items` (Task 11) | `orchestrator/SKILL.md:230` `ask_items: PROFILE_DATA.interactive_each_session` | ✓ 정확 |
| orchestrator `§1-9` 필드 목록에 `model_routing` (Task 11) | `orchestrator/SKILL.md:316` `team_mode, tdd_mode, model_routing, worktree_*, cross_model_*` | ✓ 정확 |
| `test:all` glob이 `runtime/**`·`scripts/**` 자동 포함 | `package.json:9` glob에 두 경로 포함, `--test-concurrency=1` | ✓ 정확 |
| 신규 엔진 4파일은 net-new | model-routing-runtime/model-catalog/detect-runtime/model-routing-cli 모두 부재 | ✓ 정확 |
| 설계 §7 session-receipt payload에 model_routing_meta 추가 | deep-finish `§Step 2.1`이 payload를 **명시 필드로 Write** → 자동 유입 없음, 매핑 태스크 없음 | ✗ 미커버 (§M-1) |

---

## 관점별 findings

### 1. 스펙 커버리지

**[Medium-1] 설계 §7 "session-receipt payload에 model_routing_meta 추가"가 어느 태스크에도 매핑되지 않음.**
설계 §7은 두 가지를 구분한다: (1) `session-receipt` payload에 `model_routing_meta`를 forward-compatible 옵셔널로 **추가**(문장 주어에 in-repo 제외 문구 없음), (2) deep-suite `payload-registry` minor bump는 suite 후속 작업으로 분리("이 repo PR에는 포함하지 않는다"는 (2)에만 결부). 계획은 (2)의 제외만 Task 13 Step 5에 기록하고 (1)의 plugin-side 방출은 **누락**했다.
- `skills/deep-finish/SKILL.md`의 `#### Step 2.1`은 payload를 `Write` 도구로 **명시 필드만** 조립한다(`.session-receipt.payload.json`). state를 통째로 복사하지 않으므로, orchestrator가 state에 `model_routing_meta`를 써도(Task 11) 그 값은 **receipt payload로 자동 유입되지 않는다**.
- 결과: 설계가 in-repo로 지시한 산출물이 태스크·acceptance·테스트 없이 빠졌다. 계획 self-review(§1516-1519)도 §1 12행만 언급하고 §7을 다루지 않는다.
- 성격: `model_routing_meta`는 옵셔널·forward-compatible이라 **핵심 기능(자동 모델 선택) 동작에는 영향 없음** → 하드 블로커 아님. 그러나 설계 명시 항목이므로 (a) deep-finish Step 2.1에 `model_routing_meta` 필드 추가 태스크를 넣거나, (b) 의도적 v2 연기라면 계획·설계에 그 사실을 명시할 것. 권장: Task 11 또는 신규 소태스크로 편입 + 최소 grep/픽스처 acceptance.

**스펙 커버리지 긍정 확인:** 설계 §1 컴포넌트 12행 전부(model-catalog=T1, detect-runtime=T2, model-routing-runtime=T3-5, model-routing-cli=T6, session-recommender+recommender-runtime=T7, flags-runtime=T8, profile-runtime=T9, orchestrator/deep-implement/deep-resume/guide=T11)와 §2.2 baseline 전 분기, §2.3 ±1 clamp, §2.4 우선순위, §2.5 per-slice, §3.1 감지 순서, §3.2 카탈로그+§3.3 불변식, §5 마이그레이션(profile auto=T9, migration guard=T10, recommender 하위호환=T7, resume 재해석=T11), §6 에러(경고) 경로가 태스크에 매핑됨. design 리뷰 Medium-1(→§2.5/T4/T11), Medium-2(→T10), Medium-3(→filterAskItems/T7/T11) 3건 모두 설계 규칙 + 계획 태스크 + 테스트 3중 매핑 확인.

### 2. 계획 품질 (writing-plans 기준)

**[Medium-2] Task 7 `validateRecommendation` 수정에 전용 RED 테스트 부재 + 기존 깨지는 테스트의 갱신 형태 미명세.**
- `validateRecommendation`은 test-only가 아니라 **production 도달 가능**: `runtime/dispatcher-routes.js:295` `on('recommender validate', ...)` 라우트에서 호출된다.
- 계획 Task 7은 산문(§973-974)으로 exact-key 검사를 `Object.keys(parsed).filter(k=>k!=='task_difficulty'&&k!=='model_routing')...`로 바꾸라 지시하나, Step 1 테스트 블록에는 이 새 동작을 고정하는 케이스가 **없다**(`capabilityToDisabled` throw 테스트만 있음).
- 기존 `runtime/recommender-runtime.test.js:13-16`은 `validateRecommendation`에 **5-key(model_routing:'auto' 포함)** 입력을 주고 `Object.keys(data).sort()`가 5개 키(model_routing 포함)임을 단언한다. KEYS 4-key화 시 이 단언은 **반드시 깨진다** — 계획은 "기존 5-key 기대는 4-key로 갱신"(§888, §994)이라고만 하고 갱신 후 기대 형태를 명시하지 않는다.
- writing-plans 관점: 동작 변경에는 실패 테스트가 선행해야 한다. production 함수의 계약 변경을 산문 + "기존 테스트 갱신"에 위임하면 갱신 형태가 구현자 재량이 되어 회귀 위험이 남는다. 권장: Task 7 Step 1에 (a) 4-key + task_difficulty 입력 통과, (b) legacy model_routing 키 무시 통과, (c) 진짜 extra 키 throw를 검증하는 `validateRecommendation` 케이스를 추가하고, `:13-16` 갱신본을 Step 1에 명시.

**계획 품질 긍정 확인:** placeholder("TBD"/"적절히") 부재(Task 12 codex 모델명만 의도된 실기-확정이며 미확정 시 null fail-safe 동작까지 명세). 태스크 간 시그니처 일관: `resolveTier(tier,runtime,catalog?)→{model,warning}`(T1↔T5↔T11), `sliceModelTier(sessionImplementTier,size)`(T4↔T11), `filterAskItems(items)`(T7↔T11), `decideModelRouting({...})→{model_routing,meta,warnings}`(T5↔T6↔T11), `flags.model_routing` 검증 원문 문자열(T8↔T6 `--pinned`) 모두 정합. 태스크 순서(카탈로그 T1→엔진 T3-5→CLI T6→배선 T11)와 `depends_on` 관계가 require 의존을 만족.

### 3. 코드 정합성 (스니펫 ↔ 실제 코드)

**[Low-3] Task 10 가드 스니펫의 변수명 `text` ≠ 실제 `src`.**
Task 10 Step 3은 `if (/^model_routing_meta:/m.test(text)) {...}`를 제시하나, `migrate-model-routing.js:25`의 파일 내용 변수는 `src`다(`const src = fs.readFileSync(...)`). `text`는 이 함수 스코프에 없어 verbatim paste 시 `ReferenceError: text is not defined`. RED 테스트가 즉시 잡아 자기교정되나 스니펫 결함. 가드 정규식 `/^model_routing_meta:/m` 자체는 정확(기존 `:34` 블록 탐지 `/^model_routing:\s*(#.*)?$/`와 상호 오탐 없음 — `model_routing_meta:`는 `_meta:` 요구, `model_routing:`은 불일치). 권장: 스니펫을 `src`로 정정.

**[Low-4] Task 10 테스트 스니펫 스타일이 기존 파일과 불일치.**
`scripts/migrate-model-routing.test.js`는 `const { describe, it } = require('node:test')` + `node:assert/strict`를 쓰고 bare `test`를 import하지 않는다. 계획 Task 10 Step 1은 `test('...', ()=>{...})` 블록을 append하는데, 그대로면 `test is not defined`. 구현자가 `it(...)`로 감싸거나 `test` import를 추가해야 함(자기교정 가능, 저위험). 참고: Task 7 대상 `recommender-runtime.test.js`는 `const test = require('node:test')`를 이미 import하므로 Task 7 append는 스타일 정합(문제 없음). Task 8/9 대상 테스트 파일의 import 스타일은 미확인 — 구현 시 확인 권장.

**[Low-5] Task 5 `decideModelRouting`의 warnings dedupe가 산문에만 존재.**
Step 3 코드 스니펫(§689-726)은 `warnings`를 그대로 반환하고, `warnings = [...new Set(warnings)]` dedupe는 스니펫 아래 산문(§729)에만 있다. 구현자가 산문 지시를 놓치면 unknown 런타임 시 동일 경고 3건이 남는다(테스트 `>=1`은 통과하므로 테스트로 강제되지 않음). 기능 결함 아님, UX 저하만. 권장: dedupe를 스니펫 return에 반영하거나 dedupe 검증 테스트 1건 추가.

**코드 정합성 긍정 확인:** Task 8 `slice(16)`·flags 라인 오프셋, Task 9 profile 템플릿 라인, Task 11 deep-implement/orchestrator 앵커·라인은 실측과 일치. Task 5 엔진 분기(pinned tier 교체 후 해석 / pinned concrete 현 런타임 통과 / 런타임 불일치 concrete 거부+경고 / brainstorm·plan pin 거부 / catalogOverride 병합)를 손으로 추적한 결과 각 테스트 단언과 정합. Task 1 `mergeCatalog`/`resolveTier`/`concreteModelsFor` 및 Task 4 `baselineTiers`/`applyDifficulty`/`sizeToTier`/`sliceModelTier`도 테스트 기대와 정합.

### 4. 실행 가능성

**[Low-6] 부수 부정확·연기 항목(비-블로커).**
- Global Constraints·Architecture는 "Node 20+"라 하나 `package.json:4` `engines.node`는 `>=22`. `node --test`는 양쪽 지원하므로 실행 무해하나 문구는 22로 정정 권장.
- Task 9는 `:32`를 "PRESET defaults 상수"로 지칭하나 실제로는 `v2TextToV3Text` 내부 `fallback` 객체다(라인은 정확, 명칭만 부정확). 또한 Task 9 테스트는 `createV3Profile`만 검증하고 `v2TextToV3Text`(마이그레이션 경로) 변경은 미검증 — 다만 구프로필 ask 회귀는 orchestrator `filterAskItems` 안전망(Medium-3 해소)이 덮으므로 위험은 좁다.
- Task 11 Step 3의 신규 섹션을 "§1-8-6"으로 번호 부여 — `§1-8 Git Branch + Worktree`의 하위-하위로 읽혀 의미상 어색(프롬프트 표시용, 기능 무관). 별도 §1-8-5 또는 독립 섹션 권장.
- Task 2 `detect-runtime.js`는 CLI(`require.main` 블록) 없이 모듈만 export → Task 11 Step 6 resume 재해석이 `node -e '...detectRuntime()'`로 우회. 계획이 이를 인지·명시하므로 정합(경미한 비대칭).
- 설계 §2.5/§8이 요구한 "구세션 `"auto"` 문자열 → sonnet 취급"은 deep-implement SKILL.md 산문(T11 Step 5)으로만 존재 — Node 함수가 아니라 픽스처 고정 불가. 설계 §8의 "픽스처로 고정" 의도와 소폭 괴리(저위험, 프롬프트 경로).

**실행 가능성 긍정 확인:** 테스트 커맨드가 실제 러너와 일치 — 개별 `node --test <file>`, 전체 `npm test`=`test:all`(glob이 신규 `runtime/`·`scripts/` 테스트 자동 포함). Task 6 CLI는 항상 exit 0 + all-main fallback로 orchestrator 진행 차단을 방지(§758). Task 12 codex 실기 검증의 fail-safe acceptance가 명확(Step 3: "Step 1-2 모두 확인 불가 시 null 유지 + PR 본문 '미완' 기록, Step 4는 수행")하고, 테스트가 null/concrete 양쪽 분기를 지원해 pin 여부와 무관하게 green.

### 5. 리스크 / 태스크 순서

- 태스크 순서·의존은 올바르다: T1(catalog)→T2(detect)→T3(signals)→T4(baseline, T1 소비)→T5(decide, T1+T4)→T6(CLI, T2+T3+T5)→T7(recommender)→T8(flags, T1)→T9(profile)→T10(migration)→T11(배선, T1/T4/T6/T7)→T12(codex pin)→T13(release). 각 require 대상은 선행 태스크가 생성.
- 회귀 방어: 계산 로직 전량 Node 모듈로 내려 `test:all`이 자동 포함, SKILL.md는 호출·표시만(grep 검증). Task 11 grep acceptance(filterAskItems≥2, model-routing-cli≥1, sliceModelTier≥1, model_routing_meta≥1, 자동 선택≥1)로 배선 누락을 최소 방어.
- 잔여 회귀 위험: (1) 설계 §7 미커버(§M-1) — 옵셔널이라 좁음, (2) `validateRecommendation` 갱신 형태 미고정(§M-2) — dispatcher 라우트 소비 있음, (3) Task 9 v2→v3 마이그레이션 출력 변경 미검증(Low-6) — filterAskItems 안전망이 덮음.

---

## 수정 제안 요약 (maker에게 — 리뷰어는 maker 파일 미수정)

1. **(Medium-1)** 설계 §7 in-repo 산출물: deep-finish `Step 2.1` payload 조립에 `model_routing_meta` 추가 태스크(또는 Task 11 편입) + 최소 acceptance. 의도적 v2 연기라면 계획·설계에 명시.
2. **(Medium-2)** Task 7 Step 1에 `validateRecommendation` 전용 RED 테스트(4-key+task_difficulty 통과 / legacy model_routing 무시 / 진짜 extra throw) 추가하고, 기존 `recommender-runtime.test.js:13-16` 갱신본을 명시.
3. **(Low-3)** Task 10 가드 스니펫 `text` → `src` 정정.
4. **(Low-4)** Task 10 테스트를 `describe/it` 스타일에 맞추거나 `test` import 추가; Task 8/9 대상 테스트 import 스타일 확인.
5. **(Low-5)** Task 5 warnings dedupe를 스니펫 return에 반영(또는 dedupe 테스트 추가).
6. **(Low-6)** Node 22 문구 정정, Task 9 `fallback` 명칭·v2→v3 경로 테스트 보강, §1-8-6 번호 재정렬, 구세션 `"auto"` 취급 픽스처 여부 재확인.

## 판정 근거

- 블로커(스펙 완전 미커버로 실행 불가 / 스니펫이 실제 코드와 어긋나 테스트 원천 불가 / TDD 사이클 전면 결손) 부재 → REQUEST_CHANGES 아님.
- 설계 §1 12행 + design 리뷰 Medium 3건 + §2.2~§6 규칙이 태스크·테스트에 매핑, 라인·오프셋·시그니처·앵커가 실측과 대부분 일치, 핵심 등가성(standard tier ↔ 기존 slice-size auto) 성립 → 진행 가능.
- 단 설계 §7 plugin-side 산출물 1건 미커버(Medium-1, 옵셔널)와 production 도달 `validateRecommendation` 수정의 TDD 미완(Medium-2), 자기교정 가능한 스니펫 결함 다수(Low) → 구현 착수 전 해소 권장 → **CONCERN**.
