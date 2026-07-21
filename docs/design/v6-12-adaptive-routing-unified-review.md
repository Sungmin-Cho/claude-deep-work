# v6.12 — Adaptive Routing & Unified Review 설계 스펙

- **작성일:** 2026-07-21
- **기준 버전:** v6.11.0 (`main` @ `aed7bb9`)
- **목표 버전:** v6.12.0
- **근거 문서:** `docs/research/2026-07-20-claude-deep-work-risk-adaptive-evidence-gated-improvement-proposal-ko.md` (§5, §9, §17 v6.12, §18 PR 2·3, §21) — 참고용. **정본 근거는 이 저장소의 코드베이스이며, 본 문서의 모든 현재-상태 주장은 파일:라인으로 검증되었다.**
- **선행 스펙:** `docs/superpowers/specs/2026-07-20-v6.11-shadow-risk-policy-design.md` (부록 A 정본 표를 이 스펙이 승계한다)
- **상태:** round-2 리뷰 반영본 (round-1 M1-M5·m1-m6 + round-2 M4/M5 정정·M6-M9·m7 반영 — `docs/reviews/2026-07-21-design-review-v6-12-adaptive-routing.md`)

---

## 1. 목표

v6.11이 shadow로 계산·기록만 하던 risk/policy를 **세 갈래로 실제 동작에 연결**한다.

1. **Adaptive tier routing** — policy 권장 tier(`TIER_CATALOG`)를 모델 라우팅의 **상향 전용 floor**로 적용한다. High/Critical 세션이 baseline 라우팅보다 약한 tier로 실행되는 일을 차단한다.
2. **Effort routing** — `EFFORT_CATALOG`의 role별 effort를 라우팅 산출물에 승격하고, **호스트 능력이 있는 채널에만** 적용한다(능력 없으면 기록+안전 폴백).
3. **Unified review contract** — 5갈래로 파편화된 리뷰 계약을 단일 결정론 런타임(`review-policy-runtime` + `review-finding-runtime`) + 단일 권위 문서(`adaptive-review-protocol.md`)로 통합한다. Low에서 불필요한 dual review를 제거하고, High/Critical에서 필수 dual review 누락 시 **fail-closed**한다.

그리고 **v6.11 PR(#47) 인계 3건**을 해소한다: (a) hard trigger의 cross-field 스퍼리어스 매칭 표면, (b) routing_diff authoritative 입력의 LLM 추출 신뢰도, (c) `validate-receipt.sh` summary JSON 기존 버그.

## 2. Non-goals (v6.13+ / v7.0으로 명시적 연기)

- Spec Contract(`spec.md`) / `deep-spec` 스킬 (제안서 §6 — v6.13)
- Evidence Package v2 / receipt evidence capture·redaction (제안서 §10 — v6.13)
- 위험도별 verification gate 컴파일러 — deep-test의 gate **목록** 재편성은 하지 않는다 (제안서 §11 — v6.13). v6.12는 deep-test의 **리뷰어 선택·severity 정규화만** 통합 런타임으로 교체한다.
- profile v4 / 정식 Spec phase / context policy runtime (v7.0)
- 기존 리뷰 문서의 **삭제** — v6.12는 shim 전환까지만, 제거는 v7.0
- **하향(down) tier 라우팅** — lean policy가 baseline보다 낮은 tier를 권장해도 v6.12는 tier를 낮추지 않는다(§5.2). 하향은 v6.12 실사용 routing_diff 관찰 후 v6.13에서 재검토
- session-recommender 변경 (5-key 파서 계약 유지)
- plan.md 슬라이스 포맷 변경 (deep-implement 파서 영향 차단 — slice risk는 v6.11의 `slice_risk_shadow_json` 외부 저장을 소비)
- deep-loop/deep-review 등 sibling 플러그인 저장소 변경

## 3. 현재-상태 근거 (검증 완료)

세 갈래 병렬 코드베이스 조사(risk/policy 런타임 · 라우팅 소비 경로 · 리뷰 계약)로 확인한 사실이다.

### 3.1 v6.11이 이미 제공하는 것 (승계 대상)

| 사실 | 검증 위치 |
|---|---|
| `compilePolicySnapshot()`이 profile·`role_routing.recommended_tiers`(research/implement/test)·`recommended_efforts`(role별)·`review_policy`·`routing_diff`를 이미 반환 | `runtime/policy-runtime.js:60-77` |
| `TIER_CATALOG`(profile×phase 권장 tier)·`EFFORT_CATALOG`(profile×role effort)·`PROFILE_BY_CLASS` 상수 정본 — "표시·기록 전용" 주석 명시 | `runtime/policy-runtime.js:5-20` |
| `EFFORT_CATALOG` role 키가 profile별 상이 — lean/standard는 `reviewer`, strict/critical은 `semantic_reviewer`/`executability_reviewer`(+`escalation`) | `runtime/policy-runtime.js:8-13` |
| state 저장은 frontmatter JSON-string 스칼라 3종(`risk_profile_json`/`policy_shadow_json`/`slice_risk_shadow_json`) | v6.11 스펙 §5.1, `tests/risk-state-roundtrip.test.js` |
| risk fixture matrix 26종 + property/round-trip 테스트 존재 | `tests/risk-fixture-matrix.test.js` 등 |

### 3.2 모델 라우팅 소비 경로 (adaptive routing의 후크 지점)

| 사실 | 검증 위치 |
|---|---|
| concrete 모델명 spawn 사이트는 `Agent(model=...)` 파라미터 방식 — implement 3곳(Solo L212 / Team Branch A L423 / Branch B L446), research 4 call-site(L166/187/193/199), test 위임 서술(L51-54) | `skills/deep-implement/SKILL.md`, `skills/deep-research/SKILL.md`, `skills/deep-test/SKILL.md` |
| per-slice tier 재도출: `sliceModelTier(sessionTier, size)` + `resolveTier(tier, runtime)`; `main`/error는 재도출 없이 inline | `runtime/model-routing-runtime.js:140-149`, deep-implement §Model Routing L165-195 |
| `decideModelRouting({signals, taskText, difficulty, runtime, catalogOverride, pinned})` — baseline(규모)→difficulty ±1→pin 순, `meta.tiers`/`meta.pinned` 반환 | `runtime/model-routing-runtime.js:151-196` |
| effort 개념은 라우팅 경로 어디에도 없음 | v6.11 스펙 §3 재확인 |
| `evaluator_model`은 state 정적 스칼라(기본 sonnet), tier/risk에서 도출되는 곳 없음. 소비처: deep-implement C-2(L271-283), deep-test 4-1/4-2(L95,102), deep-phase-review Step 4(L112) | 각 SKILL.md |
| `phase-review-gate.md` §2는 `model:"opus"` **하드코딩** — 라우팅 엔진 우회 | `skills/shared/references/phase-review-gate.md` §2 |
| implement-slice-worker는 frontmatter `tools:`에 Task/Agent가 없어 `evaluator_model`로 리뷰 subagent를 spawn하지 못함 — 인라인 힌트로만 기능 | `agents/implement-slice-worker.md:17-26` |
| risk/policy shadow를 읽어 실제 spawn·리뷰 분기를 바꾸는 소비 지점은 **0곳** (deep-status 표시·deep-finish 기록 전용) | orchestrator §1-8.6, deep-research §Shadow risk, deep-status §13, deep-finish L263-282 |

### 3.3 리뷰 계약 파편화 (unified review의 통합 대상)

| 모순/중복 | 검증 위치 |
|---|---|
| **이중 리뷰**: research/plan 문서가 경로A(스킬 §Phase Review Gate → `phase-review-gate.md` → `review-gate.md`: structural+adversarial+self+Opus)와 경로B(orchestrator → `review-approval-workflow.md` §2: `Agent(deep-review:code-reviewer)`+`Agent(codex:rescue)`)로 **연달아 두 번** 리뷰됨 | 각 문서 §1/§2 |
| **직접 모순**: `phase-review-gate.md:17` "deep-review는 코드 diff 리뷰어이므로 문서 Phase에 쓰지 않는다" vs 경로B의 문서 대상 `deep-review:code-reviewer` 호출. 해당 agent 정의 자체가 "직접 호출하지 않는다"고 명시 | `phase-review-gate.md:17`, `review-approval-workflow.md` §2 |
| **severity 5종**: `critical/major/minor`(review-gate §3) · `high/medium/low`(phase-review-gate §2) · binary(review-approval) · "Critical finding"만(deep-implement C-2) · `Required/Advisory/Insight`(deep-test §4) | 각 문서 |
| **고위험 조용한 통과**: slice Stage2는 Critical finding도 max 1 retry 후 **무조건 진행**(C-2 L271-283); deep-test 4-2 Quality는 Advisory라 차단 없음; phase-review-gate self+Opus 경로는 scoring gate 부재 | 각 문서 |
| **수렴 조건 5갈래**: structural max3 / re-review max2 / slice Stage1 max2·Stage2 max1 / phase-review-gate cap 없음 / deep-test는 `max_test_retries` 상한을 갖되(`skills/deep-test/SKILL.md:25,172,182`) 상한 **축이 서로 달라** 어느 계약도 다른 계약의 cap을 모른다 | 각 문서 |
| adversarial 산출 파일명 불일치: `${phase}-cross-review.json`(review-gate §9) vs `adversarial-review.json`(deep-phase-review §5) | 두 문서 |
| slice review 결과는 receipt에 pass/fail만 — finding 본문 미보존 | deep-implement C-2, `agents/implement-slice-worker.md` |
| degraded: review-gate §3은 실패 리뷰어 시 consensus 분류 금지·전원 실패 시 structural만으로 진행 — 위험도 무관 동일 정책 | `review-gate.md` §3 |

### 3.4 v6.11 인계 3건 (검증 완료)

| 항목 | 검증 위치 |
|---|---|
| (a) `detectHardTriggers`가 `corpusWithPaths`(taskText+keywords+side_effects+**changed_paths**를 공백 결합)에 거리-캡 정규식 실행 → 무관한 파일명 2개(`drop-handler.js`+`schema.json`)만으로 `destructive-migration`(Critical) 오발화 가능. `PATH_PATTERNS`의 `\|auth` 대안은 `oauth.js`/`author.js` substring 오탐 | `runtime/risk-runtime.js:142-146`, `:57` |
| (b) deep-research authoritative 단계에서 `model_routing`/`tiers`/`pinned`를 **LLM이 state 파일에서 추출** — 필드명조차 "미확정 후보, 실물 확인 필요" 주석. 오추출 시 routing_diff가 전 phase 제외 → **공집합 위양성**, errors에도 미기록 | `skills/deep-research/SKILL.md:261-293` (특히 :270-275) |
| (c) `validate-receipt.sh` 요약 emitter가 `node -e`인데 `const [,, result, ...] = process.argv`로 앞 2개를 스킵(`node -e`는 argv[1]이 첫 사용자 인자) → 전 필드 한 칸 밀림: `result`=CHECKS_PASSED, `passed`=CHECKS_TOTAL, `total`=NaN→null, `errors`=warnings, `warnings`=[]. exit code는 bash `$RESULT`로 정상이라 미검출. `tests/methodology-shadow-receipt.test.js:55-56`이 "기존 결함으로 신뢰 불가" 명시 | `hooks/scripts/validate-receipt.sh:185-191` |

---

## 4. 신규 컴포넌트

### 4.1 `runtime/review-policy-runtime.js` — 리뷰 정책 컴파일러 (결정론)

```
compileReviewPlan({ artifactKind, phase, riskClass, sliceRiskClass, runtime,
                    availableChannels, tddMode, evaluatorModelOverride,
                    policyMode = 'adaptive', reviewModeOverride = null })
  → { profile, mode, reviewers, rounds_max, blind_first_round,
      degraded, gate, source: 'risk'|'default' }

evaluateReviewExecution(plan, reviewerResults)          // M6 — 결정론 실행 판정 reducer
  → { decision: 'proceed' | 'degraded-proceed' | 'needs-human' | 'pause',
      degraded_events: [], human_gate: { required, satisfied }, reasons: [] }
```

- `policyMode`/`reviewModeOverride` (**M8**): §7.1 플래그의 수신 파라미터. `policyMode:'shadow'`면 risk 기반 강도 조정 없이 `source:'default'` 표준 강도를 반환하고, `reviewModeOverride`(`'single'|'dual'`)는 B.1의 mode를 대체한다(High/Critical에서 `single` 하향은 호출 스킬이 risk acceptance 기록 후에만 전달 — §7.1).
- **`evaluateReviewExecution` (M6 — blocker 해소)**: `verdictFromFindings`가 **finding 내용**을 판정한다면, 이 함수는 **리뷰 실행 상태**를 판정한다 — 이 분리가 없으면 "required reviewer가 아예 실행 실패했는데 성공한 리뷰어의 finding만 보고 PASS"하는 구멍이 생긴다. 입력 `reviewerResults`: `[{ role, channel, required, status: 'completed'|'failed'|'timeout'|'skipped', report_ref }]`. 판정은 부록 B.2 매트릭스의 **결정론 인코딩**이다: required 리뷰어 실패 시 low→`degraded-proceed`(기록), medium→`needs-human`, high/critical→`pause`; critical은 추가로 `human_gate.required=true`이며 human ack가 기록되기 전엔 `satisfied=false`(§7.2 `human_ack`)로 `needs-human`을 유지한다(M9). 모든 비-`proceed` 판정은 `degraded_events`에 기록. **스킬 실행 순서 계약: reviewers 실행 → `evaluateReviewExecution` → (proceed/degraded-proceed일 때만) `verdictFromFindings`** — 두 판정을 모두 통과해야 리뷰 게이트 통과다. §10-3의 fail-closed fixture가 호출하는 oracle이 바로 이 함수다.
- **`availableChannels`의 출처 (M7)**: 기존 `scripts/detect-capability.js`는 재사용할 수 **없다** — 반환이 `{git_worktree, team_mode_available, is_git}`뿐으로 리뷰어 채널 신호가 없다(`runtime/recommender-runtime.js` `detectCapability` 재export). 신규 결정론 감지기 `detectReviewChannels({runtime, env})`를 `review-policy-runtime.js`에 둔다: `codex_cli`/`gemini_cli`는 실행 파일 프로브(현행 phase-review-gate의 ad hoc `which codex`/`which gemini` 프로시저를 런타임 함수로 승격), `deep_review`는 플러그인 설치 확인(기존 phase-review-gate §1 Phase3 확인 로직과 동일 기준), `subagent`는 호스트 subagent spawn 능력(claude 런타임 true). 스킬은 세션 init에서 1회 감지해 `review_execution_json.channels`에 영속하고 resume 시 재프로브한다.

- `artifactKind`: `document | slice-diff | cross-slice | session-final`
- `riskClass` 부재/무효 → `source:'default'`로 **v6.11 이전과 동일 강도**(standard 상당)를 반환한다. risk 계산 실패가 리뷰를 약화·차단하지 않는다(§8.1).
- `sliceRiskClass`: slice-diff 전용 — 세션 class와 slice class 중 **높은 쪽**을 적용한다(제안서 §4.4.3: 세션 Medium이어도 권한 slice는 High).
- `availableChannels`: `{ subagent: true, codex_cli: bool, gemini_cli: bool, deep_review: bool }` — 출처는 위 `detectReviewChannels`(M7)가 유일 정본이다(기존 `scripts/detect-capability.js`는 리뷰어 채널 신호가 없어 재사용 불가).
- `reviewers[]` 항목: `{ role: 'structural'|'semantic'|'executability', channel: 'subagent'|'codex-cli'|'gemini-cli'|'deep-review', tier, effort, required: bool }`
  - `tier`는 부록 B.1의 리뷰어 tier 표에서, `effort`는 v6.11 `EFFORT_CATALOG`(정본 유지)에서 가져온다. `compileReviewPlan`이 concrete model을 확정한다: codex-cli channel은 항상 `resolveTier(tier, 'codex')`, subagent channel은 세션 runtime의 `resolveTier(tier, runtime)`을 사용한다(명시적 evaluator override는 subagent에만 적용). 소비자는 channel runtime을 다시 해석하지 않는다 — **런타임 교차 유출 금지**.
  - `channel` 배정 규칙: `document`에는 `deep-review` channel을 **절대 배정하지 않는다**(§3.3 모순의 구조적 해소 — `phase-review-gate.md:17`의 규칙을 런타임 상수로 승격). `slice-diff`/`cross-slice`의 executability role은 codex-cli 가용 시 codex-cli, 아니면 subagent.
- `mode`: `single | dual` — 부록 B.1 매트릭스.
- `rounds_max: 2` 고정 (제안서 §9.6; exit criteria). round 1 전면 독립, round 2는 open finding ID + 수정 diff만 재검증. 초과 시 자동 반복 금지 — adjudication 또는 사용자 판단으로 넘긴다.
- `blind_first_round: true` — round 1 리뷰어 프롬프트에 (i) 다른 리뷰어의 결과, (ii) main agent의 사전 판단을 포함 금지. 이 규칙은 `adaptive-review-protocol.md`가 프롬프트 계약으로 명문화하고, 산출 JSON에 `blind: true` 플래그를 기록한다.
- `degraded`: 부록 B.2 매트릭스 — **required dual 중 1 실패 시 High는 pause(fail-closed), Critical은 pause+외부 변경 금지**. 현재 review-gate §3의 "전원 실패 시 structural만으로 진행"은 Low/Medium 전용으로 강등된다.
- `gate`: `{ blocker_blocks: true, needs_evidence: ['blocker'] }` — blocker finding은 §4.2 스키마의 `evidence`+`failure_scenario` 필수(없으면 major로 강등, 제안서 §9.5).

### 4.2 `runtime/review-finding-runtime.js` — 통합 finding 스키마 + 판정

```
normalizeFinding(raw, { sourceScheme })     → finding | null(스키마 위반)
normalizeSeverity(sourceScheme, value)      → 'blocker'|'major'|'minor'|'info'
dedupeFindings(findings)                    → findings (구조 키 (artifact, location, violated_contract) 완전 일치만 병합 — 결정론. 의미적 "요지" 유사 병합은 하지 않는다 (m3))
verdictFromFindings(findings, reviewPlan)   → { verdict: 'PASS'|'BLOCK', open_blockers, demoted, reasons }
```

**정규화 finding 스키마 (v1)** — 저장 정본:

```json
{
  "id": "REV-<ROLE>-NNN",
  "severity": "blocker | major | minor | info",
  "confidence": 0.0,
  "review_role": "structural | semantic | executability",
  "channel": "subagent | codex-cli | gemini-cli | deep-review",
  "model": "<concrete>", "effort": "<effort|null>",
  "artifact": "<파일 경로>", "location": "<섹션/라인>",
  "violated_contract": "<계약|null>",
  "evidence": ["<근거 ref>"],
  "failure_scenario": "<실패 시나리오|null>",
  "verification": "<검증 방법|null>",
  "status": "open | accepted | rejected | fixed | deferred",
  "disposition_reason": null,
  "round": 1, "blind": true
}
```

**severity 매핑 표 (정본, fixture로 고정):**

| source scheme | 값 → 정규화 |
|---|---|
| `review-gate-adversarial` | critical→blocker, major→major, minor→minor |
| `phase-review-gate-opus` | high→blocker, medium→major, low→minor |
| `binary-disagreement` (구 review-approval) | 비동의→major (증거+시나리오 갖추면 blocker 승격 가능) |
| `slice-stage2` | Critical→blocker, 그 외→major/minor 서술 기준 |
| `structural-score` | score는 severity가 아니라 별도 축 유지 (§4.4) |

- blocker 자격 요건(제안서 §9.5): `violated_contract` 또는 명시 품질 계약 + `location` + `failure_scenario` + `verification` + `confidence`. 미충족 blocker는 `demoted`에 기록하고 major로 강등 — "막연한 우려 blocker" 차단.
- **저장 경로 단일화**: `$WORK_DIR/reviews/<point>-round<N>-findings.json` (point = `research | plan | slice-SLICE-NNN | cross-slice | final`). 기존 `${phase}-review.json`(structural)은 유지하되 adversarial/dual 결과는 신규 경로가 정본이다. `${phase}-cross-review.json` vs `adversarial-review.json` 파일명 분기는 신규 경로로 흡수한다(구 파일은 더 이상 쓰지 않고, 리더는 fallback으로만 읽는다).

### 4.3 `skills/shared/references/adaptive-review-protocol.md` — 단일 권위 문서

- "무엇을/언제/누가 리뷰하는가"의 권위 문서. 내용: artifactKind 정의, 부록 B 매트릭스 사본이 아닌 **런타임 호출 계약**(입력 조립→`compileReviewPlan`→reviewers 실행→`evaluateReviewExecution`(실행 판정, M6)→(proceed 시) `normalizeFinding`→`verdictFromFindings`→기록), blind round 1 프롬프트 계약, round 2 재검증 계약, adjudication 규칙(리뷰어는 수정하지 않는다 — finding만; 수정은 작성자/구현자; disposition은 main), degraded 처리, Critical human-gate(§6.4), 저장 경로.
- 기존 4개 문서(review-gate / phase-review-gate / review-approval-workflow / deep-phase-review)는 §6.3의 shim 규칙대로 이 문서와 런타임을 가리킨다.

### 4.4 Structural review의 위치

review-gate §1의 structural scoring(차원 1-10, ≥7 PASS)은 **폐기하지 않는다** — 문서 품질 사전 게이트로서 유일하게 결정론에 가까운 축이기 때문이다. v6.12에서의 재배치:

- structural은 `compileReviewPlan`이 반환하는 reviewers 중 `role:'structural'` 항목(문서 artifactKind 전용, 항상 required)이 된다.
- 점수 체계·auto-fix 스냅샷 계약(`research.v{N}.md`, score 하락 revert, max 3 iter)은 현행 유지 — 단 실행 주체 규칙을 명확화한다: auto-fix는 **작성자(main) 책임**이며 리뷰어 subagent가 문서를 재작성하지 않는다(제안서 §9.7).
- structural 결과는 기존 `${phase}-review.json` 유지(호환), 요약만 `review_execution_json`에 편입.

---

## 5. Adaptive Routing (tier + effort)

### 5.1 `decideModelRouting()` 확장 — 상향 전용 policy floor

`runtime/model-routing-runtime.js`의 `decideModelRouting()`에 optional 입력 `riskClass`·`floorBaseline`을 추가한다.

```
decideModelRouting({ signals, taskText, difficulty, runtime, catalogOverride, pinned,
                     riskClass = null, policyMode = 'adaptive', floorBaseline = null })
```

적용 순서 (기존 순서 유지 + floor 2단계 삽입):

```
baselineTiers(규모) → applyDifficulty(±1) → [신규] applyPolicyFloor(riskClass)
  → [신규] applyFloorBaseline(floorBaseline) → pin 처리(기존, 최우선 유지)
```

- `applyPolicyFloor(tiers, riskClass)`: phase ∈ {research, implement, test}에 대해 `tiers[phase] = maxTier(tiers[phase], TIER_CATALOG[PROFILE_BY_CLASS[riskClass]][phase])`. `maxTier`는 `tierIndex` 비교 — **비-tier 값(`main`)은 불변**(기존 `shiftTier`와 동일 가드).
- `applyFloorBaseline(tiers, floorBaseline)` (**M1 해소 — 단조성의 함수 레벨 강제**): `floorBaseline`은 이전 라우팅 호출이 적용한 유효 floor 스냅샷(`{ research?, implement?, test? }`, tier 어휘만 유효 — 비-tier 값은 무시)이다. `tiers[phase] = maxTier(tiers[phase], floorBaseline[phase])`. 이로써 authoritative 재라우팅이 provisional보다 **낮은** class로 재분류돼도 함수 출력이 이미 적용된 floor 밑으로 내려갈 수 없다 — 단조성이 호출자 규율이 아니라 시그니처+구현으로 보장된다. CLI 플래그는 `--floor-baseline '<json>'`(§5.4-4).
- **상향 전용**: 두 floor 모두 tier를 올릴 수만 있다. lean(light×3)이 baseline(standard)보다 낮아도 낮추지 않는다(§2 Non-goals — 하향은 v6.13 관찰 후).
- pin은 기존대로 최종 우선 — 사용자 명시 override가 policy floor보다 강하다. 단 concrete/tier pin으로 floor 미만이 되면 `meta.policy.floor_overridden_by_pin[phase]=true`를 기록하고, **risk class가 high/critical이면 스킬이 init/research 요약에 ⚠️ 경고 1줄을 표면화**한다(m5 — 기록만으로 침묵하지 않는다. 차단은 하지 않음 — 사용자 명시 선택 존중).
- `policyMode: 'adaptive'|'shadow'` — `shadow`면 두 floor 모두 적용하지 않고 v6.11 동작 그대로(관찰만). 플래그 `--policy=shadow`로 노출(§7.1).
- `riskClass`·`floorBaseline` 둘 다 부재/무효 → floor 미적용, 기존 v6.10 경로와 **동일 결과**. 이때 `meta.policy`·`meta.efforts` 키는 **생략한다(null로도 쓰지 않는다)**(m1) — meta shape가 v6.10/v6.11과 동일해 "기존 테스트 무수정" 보장이 성립한다. **동일성의 테스트 계약 (plan 리뷰 PF7 반영)**: `meta.decided_at`이 매 호출 `new Date()`(`model-routing-runtime.js:185`)이므로 문자 그대로의 바이트 비교는 불가능하다 — `decideModelRouting`에 optional `now` 주입 입력을 추가하고(기본값 현재 동작 유지), 회귀 테스트는 고정 clock 주입 시 **완전 동일**, 무주입 시 `decided_at` 제외 canonical projection 동일로 검증한다.
- meta 확장(risk/floor 입력이 있을 때만): `meta.policy = { risk_class, profile, mode, floors_applied: { <phase>: {from, to} }, floors_effective: { <phase>: <tier> }, floor_overridden_by_pin }`. `floors_effective`는 이번 호출이 적용한 유효 floor 전체(= max(policy floor, floorBaseline) per phase)로, **다음 라우팅 호출의 `floorBaseline` 입력이 되는 정본**이다(§5.2, §7.2에 영속).

### 5.2 세션 내 적용 시점과 단조성

- **init (orchestrator)**: §1-8.5/§1-8.6 순서를 재배열한다 — (1) `risk-profile-cli --stage provisional --risk-only`(§5.4)로 class 산출 → (2) `model-routing-cli --risk-class <class>` → (3) 기존 `--stage provisional` 호출로 policy snapshot + routing_diff 기록(§5.4의 유효 입력 재사용으로 3중 스캔 방지).
- **Research Exit Gate (deep-research)**: authoritative class 확정 후 `model-routing-cli --risk-class <auth_class> --floor-baseline '<methodology_policy_json.floors_effective>'`를 재실행해 implement/test 라우팅을 갱신한다. `--floor-baseline`에는 init 시점에 영속된 `methodology_policy_json.floors_effective`(§5.1/§7.2)를 그대로 전달한다 — **세션 내 floor 단조 증가가 §5.1 `applyFloorBaseline`으로 함수 레벨에서 보장**되므로(M1), authoritative가 더 낮은 class로 재분류돼도 이미 적용된 floor 밑으로 내려가지 않는다(하향 비활성, §2). 재라우팅 결과의 새 `floors_effective`로 `methodology_policy_json`을 갱신하고, class 변화는 기존 `history`에 기록.
- **per-slice (deep-implement)**: 신규 헬퍼 `sliceModelTierWithRisk(sessionTier, size, sliceRiskClass)` = `maxTier(sliceModelTier(sessionTier, size), TIER_CATALOG[PROFILE_BY_CLASS[sliceRiskClass]].implement)` (sliceRiskClass 부재 시 기존 함수와 동일). 입력은 v6.11 `slice_risk_shadow_json`의 slice class — plan.md 포맷 무변경.

### 5.3 Effort routing — 기록은 항상, 적용은 능력 게이트

- `decideModelRouting()` meta에 `efforts` 블록 추가: `meta.efforts = { research: {role, effort}, implement: {role, effort}, test: {role, effort} }` — role 매핑은 research→author, implement/test→implementer (v6.11 routing_diff의 role 매핑과 동일 규칙). 리뷰어 effort는 리뷰 plan(§4.1)이 EFFORT_CATALOG에서 직접 가져간다.
- **적용 채널 (v6.12에서 실제 effort가 전달되는 곳):**
  1. **codex-cli 채널 리뷰어** — adversarial/executability 리뷰의 codex CLI 호출에 `-c model_reasoning_effort=<mapped>`를 전달한다. **내부 effort 어휘 → codex 값 매핑은 부록 B.3의 표가 설계 시점 정본**이다(M5). round-2 Codex 실측(`codex debug models --bundled`) 기준: codex effort 도메인은 `minimal|low|medium|high|xhigh`이며 **`xhigh`는 직접 지원**된다 — 클램프하지 않는다. `max`는 gpt-5.6 계열 모델 한정(model-gated)이므로 대상 모델이 gpt-5.6 계열이면 `max` 그대로, 아니면 `xhigh`로 클램프+`effort_clamped:true` 기록. 구현 시 프로브는 이 도메인의 **재확인**이며(불일치 발견 시 B.3 표 갱신 + fixture 갱신이 필요한 설계 변경으로 취급 — 조용한 폴백 금지), 프로브 실패/미지원 시에만 플래그 없이 재시도하고 `effort_applied:false` 기록.
  2. **subagent(Claude) 채널** — Claude Code Task tool에는 effort 파라미터가 없다. effort를 파라미터로 위장하지 않는다. `effort_applied:false, effort_channel:'unsupported-host'`로 **기록만** 한다. (프롬프트 문구로 effort를 흉내 내는 것은 금지 — 관측 불가능한 가짜 적용을 만들지 않는다.)
- receipt/state 기록: `review_execution_json`(§7.2)과 slice receipt에 reviewer별 `{model, effort, effort_applied}` 기록 — DoD "effort capability mismatch 시 safe fallback"의 검증 표면.
- **런타임 교차 유출 금지**: effort 값은 provider-중립 어휘(`medium|high|xhigh|max`)만 저장하고 concrete 모델명과 분리 저장한다. 기존 cross-leak 회귀 테스트에 effort 축 추가.

### 5.4 CLI 확장 — `risk-profile-cli` 3건 + `model-routing-cli` 1건 (인계 (b) 해소 포함)

1. `--risk-only` (신규): risk profile만 계산·기록하고 policy 컴파일을 생략한다 — init 재배열(§5.2)의 1단계용. 유효 입력 artifact는 기존과 동일하게 보존.
2. `--reuse-input <artifact>` (신규): 이전 단계가 보존한 유효 입력 artifact에서 **signals만** 재사용해 재수집을 생략한다 — init 3단계 호출이 저장소를 3중 스캔하지 않게 한다. **PF5 반영 계약**: (a) artifact는 자기 `input_digest`를 내장(self-embed)하며 CLI가 재사용 전 내용-digest 일치를 검증한다(불일치 시 fail-open 재수집+경고) — **digest preimage는 `input_digest` 필드 자신을 제외한 canonical JSON**(R2-M1: 자기참조 순환 차단 — 검증 시 필드 제거 후 재-canonicalize·재digest하여 내장값과 비교), (b) 재사용 대상은 signals 스냅샷에 한정된다 — `--risk-only` stage-1 artifact에는 routing 블록이 없으므로, policy 컴파일 단계 호출은 `model_routing`/`tiers`/`pinned`를 **입력 JSON으로 반드시 신선하게 공급**해야 하고, CLI는 policy 컴파일 시 routing 입력 부재를 감지하면 조용한 공집합 `routing_diff` 대신 구조화 error를 출력에 기록한다(공집합 위양성 재현 차단).
3. **`--state-file <path>` (신규, 인계 (b)의 해소)**: authoritative 단계에서 `model_routing`/`model_routing_meta.tiers`/`pinned`를 **CLI가 state 파일에서 직접 결정론 추출**한다. **정본 carrier와 추출기 (M3 해소, plan 리뷰 PF1 반영):**
   - **문제의 실체 (plan 리뷰 blocker PF1로 확정)**: nested `model_routing_meta:` YAML 블록은 **결정론 writer가 없다** — 결정론 Node writer `buildSessionState`(`runtime/session-store.js:136-148`)는 model_routing을 아예 쓰지 않고, `formatScalar`(`frontmatter.js:87`)는 object에 throw하므로 mutation 경로가 블록을 쓸 수 없으며, `parseFrontmatter`(`frontmatter.js:66-68`)는 nested 라인에서 throw하므로 세션 리더(`session-store.js:388`)가 nested state를 읽지 못한다. nested 블록은 orchestrator prose의 LLM heredoc 서술에만 존재하는 **비결정론 표현**이다.
   - **v6.12 정본 carrier는 신규 frontmatter JSON-string 스칼라 2종**이다: `model_routing_json`(routing 블록 한 줄 JSON — `runtime/slice-runtime.js:172`의 legacy migration 필드와 동명이며 v6.12에서 engine-authored 정본으로 승격·의미 통합, 승격 시 legacy reader 회귀 테스트 필수)과 `model_routing_meta_json`(meta 블록 한 줄 JSON). 인코딩·리더 계약은 `risk_profile_json`(v6.11 §5.1)과 동일 — `formatScalar`/`parseFrontmatter`가 **그대로 통과**하므로 결정론 writer/reader가 성립한다. T9(orchestrator/deep-resume 배선)가 §1-9에서 이 스칼라 2종을 기록하고, 기존 nested 블록 서술은 LLM 가독용 legacy 표현으로만 유지한다(리더 우선순위: 스칼라 → legacy).
   - 추출기 `extractRoutingState(rawStateText)`: **1차 — `parseFrontmatter` + 스칼라 2종 `JSON.parse`** (정본 경로, 결정론). **2차 fallback — legacy state**(스칼라 부재 또는 parseFrontmatter throw) 시 raw 라인 스캔(선례: `scripts/migrate-model-routing.js:31`)으로 top-level `model_routing:`/`model_routing_meta:` 블록의 제한 부분집합(들여쓴 `key: scalar` + 1단 `tiers:`/`pinned:`)을 best-effort 파싱하고 `extraction_mode:'legacy-scan'`을 결과에 표기한다.
   - **acceptance (PF1)**: T0 fixture 중 신규-form fixture는 `parseFrontmatter` 전체 파싱 + `session-store` 세션 리더 경유를 **통과**해야 하며, 추출 결과가 CLI 재계산과 digest 일치해야 한다. legacy-form fixture는 fallback 경로로만 검증한다.
   - **소비자 리더 전수 전환 (R2-B1 ① — round-3 전수 확장)**: 스칼라 carrier 전환은 `model_routing`/`model_routing_meta`를 직접 접근하는 **모든 스킬/reference 리더의 decode 규칙 전환을 동반**해야 한다 — 대상 전수(8곳): `deep-implement`(:167-180), `deep-status`(:143-152), `deep-resume`(:122-136), `deep-test`(:21-54), `deep-finish`(:207), **`deep-research`(:160/167/187/194/200 — research phase 자체 Agent spawn의 `state.model_routing.research` 초기 소비)**, **`deep-report`(:131)**, **`skills/shared/references/implementation-guide.md`(:135 — 호출부 `deep-implement`:576)**, 그리고 규칙 정의처 `model-routing-guide.md`. 공통 decode 규칙("스칼라 `model_routing_json`/`model_routing_meta_json`을 `JSON.parse` → 부재 시 legacy nested 블록 읽기 fallback")을 shared reference 스니펫 1곳에 정의하고 각 리더가 참조한다. **전환의 증명은 참조 존재가 아니라 direct-access 부재다** — contract test는 각 대상 파일에서 nested 직접 접근 패턴이 decode 규칙 경유 없이 잔존하지 않음을 negative assert로 검증한다. 전환 누락 리더가 있으면 §1-9가 스칼라만 기록하는 순간 해당 스킬이 라우팅을 읽지 못한다 — 이 목록이 T9 스코프의 정본이다.
   - **legacy migration clobber 가드 (R2-B1 ②)**: `runtime/slice-runtime.js:172-183` `migrateModelRouting`은 `model_routing_json`의 `main`→`sonnet` 치환을 **engine-authored guard 없이** 수행하고, `scripts/migrate-model-routing.js:31`의 guard는 nested `model_routing_meta:` 블록만 감지한다 — v6.12 스칼라 carrier가 fail-safe `main`을 기록하면 legacy migration이 이를 `sonnet`으로 **clobber**한다. 두 migration 모두 **canonical meta 존재 guard**(스칼라 `model_routing_meta_json` **또는** nested `model_routing_meta:` 블록 존재 시 migration skip)를 추가해야 한다.
   - `skills/deep-research/SKILL.md:261-293`의 LLM 추출 절차(:270 "미확정 후보 필드명" 주석 포함)는 삭제하고 state 경로 전달로 대체한다. 추출 실패는 `risk_profile_json.errors`에 `{stage:'authoritative', message}` 기록(현재는 경고 1줄뿐 — 위양성 공집합 diff의 관측 불가 문제 해소).
4. **`--floor-baseline '<json>'` (신규)**: `model-routing-cli.js`에 추가 — §5.1 `floorBaseline` 입력의 CLI 표면. 값은 직전 `methodology_policy_json.floors_effective`의 한 줄 JSON. 파싱 실패/비-tier 값은 해당 항목 무시 + 경고(fail-open — floor가 없던 것으로 동작하며 세션을 막지 않는다).

### 5.5 evaluator_model의 지위

`evaluator_model`은 **사용자 override 전용**으로 강등한다. 값이 state에 명시돼 있으면 리뷰 plan의 reviewer tier 해석을 그 concrete 모델로 대체(기존 호환), 없으면 `compileReviewPlan`의 tier를 `resolveTier`로 해석한 모델을 쓴다. deep-phase-review Step 4의 "default: sonnet"과 phase-review-gate §2의 `model:"opus"` 하드코딩은 모두 이 경로로 대체된다(§3.2 라우팅 엔진 우회 해소).

---

## 6. Unified Review — 소비처 배선

### 6.1 문서 리뷰 (research.md / plan.md) — 이중 리뷰 제거

- **단일 진입점**: 각 phase 스킬의 §Phase Review Gate가 `compileReviewPlan({artifactKind:'document', ...})`을 호출해 나온 plan대로만 리뷰를 실행한다.
- `review-approval-workflow.md` §2의 자동 리뷰(경로B — `Agent(deep-review:code-reviewer)`+`Agent(codex:rescue)`)는 **삭제**한다. workflow 문서에는 §4-6의 사용자 승인 UX + `*_approved_hash` 기록만 남는다(§6.3 shim). 이로써 (i) 문서 phase의 code-diff 리뷰어 사용 모순, (ii) 같은 문서 2회 리뷰가 함께 사라진다.
- 문서 dual(strict/critical)의 구성: `structural`(required) + `semantic`(subagent, tier=deep) + `executability`(codex-cli 가용 시) — round 1 blind. Low/lean은 structural 단독(§부록 B.1) — **"Low task 불필요 dual review 감소" exit criteria의 구현 지점.**

### 6.2 slice / cross-slice 리뷰

- deep-implement §C-2: Stage1(Spec)/Stage2(Quality)의 실행 구조는 유지하되, (i) 리뷰 강도·차단 규칙을 `compileReviewPlan({artifactKind:'slice-diff', sliceRiskClass})`에서 받고, (ii) finding을 정규화 스키마로 `$WORK_DIR/reviews/slice-SLICE-NNN-round<N>-findings.json`에 보존하며(현행 pass/fail만 기록 문제 해소), (iii) **High/Critical slice에서 Stage2 blocker는 차단** — 현행 "Critical finding max 1 retry 후 무조건 진행"은 Low/Medium 전용으로 강등한다. 차단 시 fix 루프 재진입, fix 소진 시 needs-human. **exit criteria "High fail-closed"의 slice 구현 지점.**
- **Stage ↔ role 크로스워크 (m2, 정본)**: Stage1(Spec, required) = `semantic` role(계약 준수·의도 일치 관점), Stage2(Quality) = `executability` role(dual 구성 시 codex-cli 채널, 단일 구성/CLI 부재 시 subagent). `structural` role은 document artifactKind 전용으로 slice-diff에는 배정되지 않는다. `compileReviewPlan`의 slice-diff reviewers는 이 매핑으로 Stage 실행에 사상된다.
- delegate 경로(implement-slice-worker): worker는 Task tool이 없으므로(§3.2) worker 인라인 리뷰의 강도·기록 계약만 동일하게 적용하고, dual 필요 시 **부모(deep-implement)가 워커 완료 후 executability 리뷰를 추가 실행**한다(worker 계약 무변경 — frontmatter tools 확장은 하지 않는다).
- **위임 dual의 blind 의미 (m4)**: worker 인라인 Stage1 → 부모 executability는 시간상 순차이므로, blind는 동시성 요건이 아니라 **입력 격리 요건**으로 정의한다 — 부모 executability 리뷰어 프롬프트에는 diff·slice 계약·receipt만 포함하고 worker 인라인 리뷰의 finding/판정을 포함하지 않는다. 두 결과는 `verdictFromFindings` 단계에서만 합쳐진다. round 1 blind의 문서 리뷰 정의(§4.1)와 동일한 원칙의 순차 형태다.
- deep-test 4-1/4-2: 리뷰어 선택·severity를 통합 런타임으로 교체(4-1 required/4-2 advisory라는 **gate 지위는 무변경** — §2 Non-goals). 단 High/Critical 세션의 4-2에서 blocker finding이 나오면 advisory라도 사용자 표면화를 required로 한다(차단이 아니라 가시화 — gate 재편은 v6.13).

### 6.3 기존 문서 shim 전환 규칙

| 문서 | 남는 것 (shim) | 이동하는 것 |
|---|---|---|
| `review-gate.md` | §1 structural 차원 정의·auto-fix 스냅샷 계약(§4.4에서 참조됨), §4-1 사용자 UX | §3 adversarial 실행·§3 degraded 분류·§5 blocking·§6 re-review cap → 런타임 |
| `phase-review-gate.md` | 진입 안내 1페이지 + adaptive-review-protocol 링크 | §1 fallback 사다리·§2 Opus 하드코딩·§7 dual-write → 런타임/protocol (line17 규칙은 §4.1 channel 상수로 승격) |
| `review-approval-workflow.md` | §4-6 승인 UX·`*_approved_hash` | §2 자동 리뷰 → 삭제(§6.1) |
| `deep-phase-review/SKILL.md` | 진입점·args 파서 | 리뷰 실행 본문 → 런타임 호출 |

shim 문서 머리에 `> v6.12: 실행 계약은 adaptive-review-protocol.md + review-policy-runtime.js가 정본` 배너를 명시한다. state의 `phase_review.{phase}`/`review_results.{phase}` dual-write는 **유지**(reader 호환) — writer만 통합 런타임 경유로 일원화.

### 6.4 Critical human-gate와 외부 변경 잠금 (M9)

B.1/B.2가 요구하는 Critical의 human ack를 실장으로 명세한다:

- **게이트 지점**: Critical profile의 각 리뷰 point에서 `evaluateReviewExecution`이 `human_gate.required=true`를 반환한다. 스킬은 attended 세션에서 AskUserQuestion으로 사람 확인을 받고 `review_execution_json.points[point].human_ack = { required: true, at, actor: 'human' }`를 기록한 뒤에만 진행한다. **unattended/headless 세션에서는 자동 승인 경로가 없다 — pause(fail-closed)**.
- **외부 변경 잠금**: Critical 세션은 init 시 `review_execution_json.external_change_lock = true`로 시작한다. 모든 required point의 `human_ack`가 기록되면 스킬이 `false`로 해제한다. **판정은 pure 함수가 소유한다 (R2-M2)**: `review-policy-runtime.js`에 `finishGateAllowed(reviewExecutionJson) → { allowed, blocking: { external_change_lock, missing_acks: [...] } }`를 두고, deep-finish 스킬은 이 함수의 결과로만 차단/진행을 결정한다 — `external_change_lock === true`이면 PR/merge/push 제안 단계에서 차단하고 `missing_acks`를 표면화한다(수정: `skills/deep-finish/SKILL.md` — session receipt emit 전 호출. `verify-receipt-core.js` 8-check는 무수정 유지). 이 함수가 §10-3의 단위 테스트 대상(oracle)이다.
- `--risk`/`--review` 하향 override로도 이 잠금은 해제되지 않는다(§7.1의 "High/Critical slice blocker 차단 미해제"와 동일 원칙).

---

## 7. Flags / State / Receipt

### 7.1 플래그 (`scripts/parse-deep-work-flags.js`)

| 플래그 | 값 | 의미 |
|---|---|---|
| `--policy` | `adaptive`(기본)｜`shadow` | shadow면 v6.11 동작(floor·리뷰 강도 미적용, 기록만) |
| `--risk` | `low|medium|high|critical` | risk class 수동 override. **상향은 즉시 적용. 하향은 confirm + `risk_acceptances` 기록 필수**(제안서 §13.3). High/Critical→Low/Medium 하향 시에도 §6.2의 slice blocker 차단은 해제되지 않는다 |
| `--review` | `auto`(기본)｜`single`｜`dual` | 리뷰 mode override. High/Critical에서 `single` 하향은 risk acceptance 기록 필수 |

**배선 (M8 — 파서→state→소비 지점 전 구간 명세):**

1. **파싱**: `runtime/flags-runtime.js`에 `policy`/`risk`/`review` 필드를 추가한다(현재는 skip_* 계열만 존재 — 미매칭 토큰이 task text로 새는 현행 동작 때문에 파서 추가 없이는 플래그가 조용히 무시된다). `scripts/parse-deep-work-flags.js` 표면도 동일 계약으로 노출.
2. **state 기록**: orchestrator init이 파싱 결과를 (a) `--policy` → `methodology_policy_json.mode`, (b) `--risk` → risk override로 §5.2 흐름의 riskClass 입력 대체(+하향이면 `review_execution_json.risk_acceptances` 기록), (c) `--review` → `methodology_policy_json.review_mode_override`로 영속한다.
3. **소비 전달**: 스킬은 라우팅 호출에 `--policy-mode <mode>`(model-routing-cli — §5.1 `policyMode`), 리뷰 컴파일에 `policyMode`/`reviewModeOverride`(§4.1 시그니처 — M8로 추가됨)를 state에서 읽어 전달한다. resume(deep-resume) 시에도 동일 state 필드에서 복원되므로 세션 중간 유실이 없다.

### 7.2 State (모두 optional frontmatter JSON-string 스칼라 — v6.11 §5.1 인코딩 승계)

| 필드 | 내부 구조 |
|---|---|
| `methodology_policy_json` (신규) | `{ schema_version: 1, mode: 'adaptive'|'shadow', risk_class, profile, based_on, floors_applied, floors_effective, floor_overridden_by_pin, efforts, decided_at }` — **실제 적용된** 정책. `floors_effective`는 다음 라우팅 호출의 `--floor-baseline` 입력 정본(§5.1-M1). shadow 관찰용 `policy_shadow_json`과 분리(관찰 데이터 연속성 유지) |
| `review_execution_json` (신규) | `{ schema_version: 1, channels: { subagent, codex_cli, gemini_cli, deep_review }, points: { "<point>": { mode, reviewers: [{role, channel, model, effort, effort_applied, effort_clamped?, required, status: 'completed'|'failed'|'timeout'|'skipped', fallback_used, report_ref}], rounds, degraded_events: [], execution_decision, human_ack: { required, at, actor } | null, verdict } }, external_change_lock: bool, risk_acceptances: [{from, to, reason, at, scope}] }` — `channels`는 §4.1 `detectReviewChannels` 결과(M7), `execution_decision`은 §4.1 `evaluateReviewExecution` 판정(M6), `human_ack`/`external_change_lock`은 Critical human-gate(M9) |
| 기존 `risk_profile_json`/`policy_shadow_json`/`slice_risk_shadow_json` | 무변경 (shadow 관찰 연속) |

리더 계약·직렬화·round-trip은 v6.11 §5.2-5.3과 동일 패턴(`parseStoredObject` + `JSON.parse`, fail-open `{}`).

### 7.3 Session receipt (optional, forward-compatible)

payload에 optional 블록 2개 추가 — 기존 `methodology_shadow`는 무변경 유지:

```yaml
methodology_policy:
  schema_version: 1
  mode: adaptive
  risk_class: high
  profile: strict
  floors_applied: { implement: { from: standard, to: deep } }
review_execution:
  schema_version: 1
  points_summary: { design: {mode: dual, completed: 2, failed: 0, rounds: 2, verdict: PASS}, ... }
  reviewer_failures: [{ point, role, channel, reason, fallback_used }]
  degraded_events: []
  risk_acceptances: []
```

- **exit criteria "reviewer failure와 fallback이 receipt에 기록"의 구현 지점.** slice receipt에도 optional `review` 확장(`findings_ref`, reviewer 실패/fallback, effort_applied)을 추가한다 — `verify-receipt-core.js` 8-check는 무수정(optional 필드 무시 확인 테스트만 추가).
- payload optional 추가는 forward-compatible — 스키마 registry 새 minor 불필요(CLAUDE.md 규칙), suite placeholder 갱신은 merge 후 별도.

---

## 8. 인계 3건의 해소 설계

### 8.1 (a) hard trigger cross-field 표면 (fail-safe 방향)

`runtime/risk-runtime.js:142`의 `corpusWithPaths`(모든 changed_paths를 공백 연접한 단일 문자열에 거리-캡 정규식 실행)를 **폐기**하고, 3부 매칭으로 대체한다.

- **(i) textCorpus 매칭** — taskText+keywords+side_effects의 기존 cross-field 분산 evidence 매칭은 그대로 보존한다.
- **(ii) 경로별 개별 매칭** — 각 changed_path를 **단독 문자열**로 검사한다. 단일 경로 안의 인접 토큰(예: `drop-tables-migration.sql`)은 계속 발화하고, 서로 다른 파일명이 연접되어 오발화하는 표면(§3.4a)만 사라진다.
- **(iii) 구조화 text×path 결합 규칙 (M4 해소 1 — text↔path 분산 false-negative 차단)** — (i)+(ii)만으로는 taskText와 changed_path에 **분산된** 진양성이 사라진다(예: task "drop the legacy records" + `db/schema.sql` — 기존 corpusWithPaths는 `drop.{0,20}schema`로 Critical 발화). 경로 의존 critical trigger 2종(`destructive-migration`, `external-destructive-action`)에 한해 **필드-구조 기반 결합 규칙**을 추가한다: trigger의 destructive-측 토큰 집합이 textCorpus에 매칭 **AND** 대상-측 토큰 집합이 **어느 한** changed_path에 매칭이면 발화하고, `matched`에 두 필드의 근거를 함께 기록한다. 인접 연접이 아니라 필드별 독립 매칭의 conjunction이므로 §3.4a의 인접 오탐은 재도입되지 않는다. **토큰 파티션(m7 — 완전 열거, fixture로 고정)**: `destructive-migration` = destructive-측 `(drop|delete|destroy|truncate|삭제|파괴)` × 대상-측 `(migration|schema|스키마|마이그레이션)`; `external-destructive-action` = destructive-측 `(delete|destroy|revoke|terminate|삭제|해지|파기)` × 대상-측 `(원격|remote|prod|production|외부|external|배포)`. 이 파티션이 정본이며 구현 시 상수로 내장한다.
- **(iv) db-context path×path 결합 규칙 (M4 해소 2 — path↔path 분산 false-negative 차단)** — round-2 Codex 지적: destructive 토큰과 대상 토큰이 **서로 다른 changed_path에** 있고 taskText는 무관한 경우(예: `db/drop.js` + `db/schema.json`), (ii)·(iii) 어느 쪽도 발화하지 않는다. 이를 위해 **db-context 경로 분류**를 도입한다: 경로가 `db/`·`migrations/`·`prisma/` 세그먼트 하위이거나 basename이 `*.sql`/`schema.*`/`*migration*`이면 db-context로 분류한다. **db-context로 분류된 changed_path 부분집합 안에서** destructive-측 토큰이 어느 한 경로에, 대상-측 토큰이 어느 한 경로에 각각 매칭되면 `destructive-migration`을 발화한다(집합 수준 conjunction — 문자열 연접 없음). 비-db-context 경로는 이 규칙에 참여하지 않으므로 round-1의 FP 케이스(루트 `drop-handler.js` + 루트 `schema.json`)는 발화하지 않는다 — `schema.json`은 basename 규칙(`schema.*`)상 db-context로 분류되지만, destructive-측 토큰을 가진 `drop-handler.js`가 비-db-context여서 db-context 부분집합 안에 destructive-측 매칭이 없어 conjunction이 성립하지 않기 때문이다.
- **false-negative/positive 분석 fixture로 고정**: (FN-보존/text×path) "drop the legacy records" + `db/schema.sql` → Critical **유지**, (FN-보존/path×path) taskText 무관 + `["db/drop.js","db/schema.json"]` → Critical **발화**(iv), (FP-제거) taskText 무관 + 루트 `["drop-handler.js","schema.json"]` → **미발화**, (단일 경로 TP) `drop-tables-migration.sql` → 발화(ii). 26종 matrix의 destructive-migration 케이스가 수정 후에도 보존됨을 별도 검증 항목으로 명시한다.
- `PATH_PATTERNS`의 `\|auth` 대안은 경로 세그먼트 경계 매칭(`(^|/)auth` 상당)으로 교정 — `oauth.js`/`author.js` 오탐 제거, `auth/`·`auth.js` 진양성 유지.
- fixture 영향: 26종 matrix 중 결과가 바뀌는 항목은 **의도된 수정으로 개별 문서화**하고 기대값을 갱신한다 + 위 분석 fixture 신규 추가. "기존 테스트 무수정 원칙"의 문서화된 예외 #1.

### 8.2 (b) routing_diff 신뢰도 — §5.4-3 `--state-file` 결정론 추출로 해소

리허설(관찰) 대신 근본 해소를 택한다: 추출 주체를 LLM→CLI로 이동, 실패를 `errors`에 기록. deep-research SKILL의 해당 절차는 CLI 호출 1줄로 축소된다.

### 8.3 (c) `validate-receipt.sh` summary JSON

- `:186` `const [,, result, ...]` → `const [, result, ...]` (앞 1개만 스킵 — `node -e`의 argv 규약).
- 조기반환 emitter(`:100`)와 `node` 실패 fallback echo(`:192`)에 `errors`/`warnings` 키를 일관 포함.
- `tests/methodology-shadow-receipt.test.js:55-56`의 "신뢰 불가" 우회를 제거하고 summary JSON 필드(`result`/`passed`/`total`/`errors`/`warnings`)를 직접 assert하도록 강화. 문서화된 예외 #2.

---

## 9. 에러 처리 원칙

| 상황 | 동작 |
|---|---|
| risk 계산 실패/부재 | 라우팅 floor 미적용(v6.10 동일) + 리뷰는 `source:'default'` 표준 강도. **fail-open — 세션을 막지 않는다** (v6.11 §7 승계) |
| High/Critical에서 required dual reviewer 실패 | **fail-closed** — pause + 사용자 표면화. self-review 단독 자동 통과 금지 (부록 B.2) |
| codex/gemini CLI effort 플래그 미지원 | 플래그 없이 재시도 + `effort_applied:false` 기록 (리뷰 자체는 진행) |
| `--reuse-input` digest 불일치 | 재수집 + 경고 (fail-open) |
| review plan 컴파일 자체 실패 · riskClass **부재/무효** | `source:'default'` 표준 강도 + `degraded_events` 기록 — 리뷰 생략으로 폴백하지 않는다 |
| review plan 컴파일 자체 실패 · riskClass가 **high/critical로 이미 확정** | **fail-closed** — pause + 사용자 표면화 + `degraded_events` 기록. default 강도로 폴백하지 않는다 (M2 — 알려진 고위험에서 컴파일 실패가 "고위험 조용한 통과"를 재현하는 것 차단. 부록 B.2와 동일 원칙) |

핵심 비대칭: **관찰·계산 실패는 fail-open, 고위험 리뷰 게이트 실패는 fail-closed.** 이 비대칭이 v6.12의 안전 모델이다.

## 10. 테스트 전략

1. **라우팅**: floor 적용/미적용 결정론 fixture (risk class×scale×difficulty×pin 조합), 상향-전용 property(어떤 입력에서도 floor가 tier를 낮추지 않음), **단조성 property(M1): 임의의 (provisional class, authoritative class) 쌍에 대해 `floorBaseline` 경유 2회 호출 결과가 1회차 유효 floor 밑으로 내려가지 않음**, `main` 불변, pin 최우선, riskClass·floorBaseline 부재 시 기존 결과 동일 회귀(**고정 clock 주입 시 완전 동일, 무주입 시 decided_at 제외 canonical projection 동일 — PF7**; meta 신규 키 생략 확인 — m1), meta.policy/efforts shape 고정, cross-leak(모델명·effort 축) 회귀.
2. **slice**: `sliceModelTierWithRisk` 결정론 + 세션/slice class max 규칙.
3. **review plan**: 부록 B.1/B.2 매트릭스 전 셀 fixture(risk×artifactKind×availableChannels), **`evaluateReviewExecution` oracle fixture(M6): High dual에서 required 리뷰어 1개 `timeout`/`failed` → `pause` 반환, Low → `degraded-proceed`, Medium → `needs-human`, Critical → `human_gate.required` + ack 전 `needs-human` 유지(M9)**, **컴파일 예외 fail-closed(M2): riskClass=high/critical에서 `compileReviewPlan` throw 시 default 폴백이 아니라 pause 신호 반환**, rounds_max 2, document에 deep-review channel 비배정 property, `policyMode:'shadow'`/`reviewModeOverride` 전달 경로(M8), `detectReviewChannels` 프로브 결정론(M7).
4. **finding**: severity 매핑 표 고정, blocker 자격 미달 강등, dedupe, verdict 판정, round-trip.
5. **state/receipt**: 신규 스칼라 2종 round-trip(기존 패턴), receipt optional 블록 forward-compat(기존 리더군 무영향 — v6.11 §6.2 리더 목록 재사용), `verify-receipt-core.js` 8-check 무영향.
6. **인계 3건**: §8.1 negative/positive fixture, §8.2 추출 실패 errors 기록, §8.3 summary JSON 필드 직접 assert.
7. **기존 테스트**: 전체 green. 무수정 원칙의 문서화된 예외는 §8.1(트리거 fixture 기대값)·§8.3(validate-receipt 테스트 강화)·버전 bump의 기계적 동반 수정(`tests/integration/v6.4.0-smoke.test.js:230`의 `pkg.version === '6.11.0'` assert 갱신 — plan E3) **3건**이다.

## 11. 릴리스 처리

- `.claude-plugin/plugin.json` · `.codex-plugin/plugin.json` · `package.json` → `6.12.0` + CHANGELOG 양언어 엔트리, 같은 PR.
- deep-suite 동기화(marketplace sha, payload-registry placeholder, README)는 merge 후 별도 (CLAUDE.md CRITICAL 규칙).
- `docs/`는 gitignore — 본 스펙과 plan 문서는 `git add -f`로 커밋.

## 12. Exit criteria (제안서 §17 v6.12 + 인계)

- [ ] Low/lean 문서 리뷰가 structural 단독으로 축소 — dual/adversarial 미호출 (fixture)
- [ ] High/strict에서 required dual 누락·실패 시 fail-closed pause — 자동 통과 경로 0 (fixture)
- [ ] 리뷰 라운드 상한 2 — 런타임 강제 (fixture)
- [ ] reviewer failure/fallback/degraded가 state+session receipt에 기록 (round-trip fixture)
- [ ] High/Critical에서 research/implement tier floor 보장, risk 부재 시 v6.10 바이트 동일 (property+회귀)
- [ ] effort가 기록되고, 능력 없는 채널에서 `effort_applied:false` 안전 폴백 (fixture)
- [ ] **codex-cli 가용 fixture에서 high/critical 리뷰어 최소 1개가 `effort_applied:true`** — effort routing이 폴백만으로 통과하는 장식 기능이 되지 않음을 증명 (M5)
- [ ] **`evaluateReviewExecution`이 required 리뷰어 실패를 pause로 판정** — fail-closed가 finding 판정과 독립된 실행 판정 oracle로 단위 테스트됨 (M6)
- [ ] **Critical human-gate**: ack 미기록 시 `needs-human` 유지 + `external_change_lock`이 deep-finish PR/merge 제안을 차단 (M9)
- [ ] 인계 3건 각각 회귀 테스트로 고정
- [ ] `npm test` 전체 green (문서화된 예외 3건 — §10-7 — 외 기존 테스트 무수정)

---

## 부록 B — Normative 매트릭스 (v6.12 정본)

v6.11 부록 A(PROFILE_BY_CLASS / EFFORT_CATALOG / TIER_CATALOG)는 **정본 지위 그대로 승계**되며 여기 중복 게재하지 않는다.

### B.1 리뷰 강도 매트릭스 — `compileReviewPlan` 내장 상수

| risk(profile) | document | slice-diff | cross-slice / session-final |
|---|---|---|---|
| low (lean) | structural 단독 (required) | Stage1만 (Stage2 skip) | single (tier standard) |
| medium (standard) | structural + semantic single (tier standard) | Stage1 + Stage2 advisory (현행 유지) | single strong (tier deep) |
| high (strict) | structural + **blind dual** (semantic tier deep·effort xhigh + executability codex-cli·effort high) | dual + **Stage2 blocker 차단** | blind dual |
| critical | strict 구성 + adjudication + human ack | dual + blocker 차단 + human gate | dual + human ack |

리뷰어 tier·effort의 정본은 EFFORT_CATALOG·부록 B.1이며, `evaluator_model` state 값이 있으면 concrete override(§5.5).

### B.2 Degraded 매트릭스 (제안서 §9.8 채택)

| risk | required 리뷰어 부분 실패 | 전원 실패 |
|---|---|---|
| low | 성공분+기록으로 진행 | structural만으로 진행 + 기록 |
| medium | 사용자 표면화 후 진행 여부 확인 | 사용자 확인 필수 |
| high | **pause (fail-closed)** | pause |
| critical | pause + 외부 변경 금지 | pause + 외부 변경 금지 |

모든 degraded 이벤트는 `review_execution_json.degraded_events` + receipt에 기록된다.

### B.3 effort 적용 채널 allowlist (구현 시 프로브로 확정)

| channel | effort 전달 | 실패 시 |
|---|---|---|
| codex-cli | `-c model_reasoning_effort=<mapped>` — 매핑 표(아래)가 정본, 프로브는 재확인 | 플래그 제거 재시도 + `effort_applied:false` |
| subagent (Claude Task tool) | 없음 — `effort_applied:false` 고정 기록 | — |
| gemini-cli | v6.12 미적용 (`effort_applied:false`) | — |
| deep-review | deep-review 자체 계약에 위임 (deep-work가 주입하지 않음) | — |

**내부 effort 어휘 → codex `model_reasoning_effort` 매핑 (M5 정본 — round-2 실측 도메인 `minimal|low|medium|high|xhigh`, `max`는 gpt-5.6 계열 model-gated):**

| 내부 | codex 값 | 기록 |
|---|---|---|
| medium | medium | `effort_applied:true` |
| high | high | `effort_applied:true` |
| xhigh | **xhigh (직접 지원 — 클램프 없음)** | `effort_applied:true` |
| max | 대상 모델이 gpt-5.6 계열이면 max, 아니면 xhigh (클램프) | `effort_applied:true` (클램프 시 `effort_clamped:true` 추가) |

구현 시 프로브가 이 도메인과 불일치를 발견하면 표·fixture 갱신이 필요한 **설계 변경**으로 취급한다(조용한 폴백 금지).
