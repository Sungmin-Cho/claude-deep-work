# v6.12 Adaptive Routing & Unified Review — 설계 스펙 독립 리뷰

- **리뷰 대상:** `docs/design/v6-12-adaptive-routing-unified-review.md` (draft, 기준 v6.11.0 @ `aed7bb9`)
- **리뷰 일자:** 2026-07-21
- **리뷰어:** deep-loop 독립 checker 세션 (maker와 컨텍스트 비공유 — 블라인드 리뷰)
- **정본 기준:** 코드베이스 (설계의 파일:라인 주장을 실물과 대조)

> 본 리포트는 finding만 낸다. 설계 문서를 포함한 어떤 저장소 파일도 수정하지 않았다.

---

## (a) 리뷰 실행 메타

| 채널 | 모델/도구 | 관점 | 라운드 |
|---|---|---|---|
| Claude semantic/architecture | Opus 4.8 (1M), 최대 추론 | 아키텍처 정합성 · 안전 모델 · 코드 대조 검증 | 1 |
| Codex executability/verification | gpt-5.x (codex CLI 0.144.6), high effort | 구현 가능성 · CLI/state 배선 · DoD 검증력 | 1 (codex-rescue 위임) |
| Explore (흐름 추적) | 코드베이스 fan-out | 이중 리뷰 흐름 · init 순서 · shadow 소비처 | 1 |

- 리뷰 방식: `deep-review:deep-review-loop`는 git diff/PR 코드 리뷰 머신러리(mutation-protocol, base-commit, snapshot-reports)에 특화되어 독립 설계 **문서** 리뷰에는 부적합 → 팀리드가 명시한 escape hatch에 따라 Claude 직접 코드 대조 + Codex(codex-rescue) 문서 executability 리뷰로 cross-model을 구성.
- 코드 대조 검증: 설계의 현재-상태 사실 주장 약 30건을 파일:라인으로 직접 대조 (§c 표 참조).

---

## (b) Finding 목록

severity: **blocker** (구현 차단/보증 붕괴) · **major** (구현 전 해소 필요) · **minor** (개선 권장) · **info**.

### MAJOR

#### M1 — 라우팅 floor 단조성이 함수 시그니처로 강제 불가 (§5.1 ↔ §5.2)

- **위치:** 설계 §5.1(`decideModelRouting` 확장), §5.2(세션 내 floor 단조 증가). 코드: `runtime/model-routing-runtime.js:151-188`.
- **근거:** §5.1이 추가하는 입력은 `riskClass`, `policyMode` 둘뿐이다. 그러나 §5.2는 "세션 내 floor는 단조 증가 — effective floor = max(provisional floor, authoritative floor)"를 요구하고 Research Exit Gate에서 `model-routing-cli --floor-baseline <provisional_floor>`를 호출한다고 명시한다. `decideModelRouting`은 매 호출 `baselineTiers(규모)`에서 재계산하므로(`:155`), authoritative 단계에서 authoritative `riskClass`만으로 `applyPolicyFloor`를 적용하면 **이전에 적용된 provisional floor 정보가 함수에 없다**. `--floor-baseline`는 §5.1의 시그니처에도, §5.4의 신규 플래그 목록(`--risk-only`/`--reuse-input`/`--state-file`)에도 정의돼 있지 않다.
- **실패 시나리오:** provisional=High(floor deep) 적용 후, authoritative=Medium으로 재분류 → Research Exit Gate에서 `decideModelRouting({riskClass:'medium'})` 호출 → baseline+medium floor로 재계산 → implement tier가 이미 적용된 deep보다 **낮게** 산출 → 단조성 위반, 세션 중간에 tier가 조용히 하향. §2 Non-goals("하향 비활성")와도 실질 모순.
- **수정 방향:** `decideModelRouting`에 `floorBaseline`(또는 `priorFloors`) 입력을 추가하고 `applyPolicyFloor` 뒤에 `maxTier(result, floorBaseline)` 단계를 명시하거나, 단조 max를 CLI/호출자 레벨에서 수행함을 §5.1에 못박는다. `--floor-baseline`를 §5.4 신규 플래그로 정식 정의한다.

#### M2 — review plan 컴파일 실패의 default 폴백이 고위험 세션에서 fail-open (§9)

- **위치:** 설계 §9 표 마지막 행("review plan 컴파일 자체 실패 → `source:'default'` 표준 강도"), §9 결론("고위험 리뷰 게이트 실패는 fail-closed"), 부록 B.2.
- **근거:** riskClass ∈ {high, critical}로 **이미 알려진** 세션에서 `compileReviewPlan`이 예외를 던지면, §9는 `source:'default'`(standard 상당, single-strong)로 폴백한다. 이는 dual + adjudication + human gate를 잃는 것으로, §9가 천명한 "고위험 리뷰 게이트 실패는 fail-closed" 원칙 및 B.2(high/critical → pause)와 직접 모순이다. §9 1행("risk 계산 실패/부재 → default, fail-open")은 riskClass **부재** 케이스로 정당하지만, 마지막 행은 riskClass가 known-high인데 컴파일만 실패한 케이스를 구분하지 않는다.
- **실패 시나리오:** Critical 세션에서 `compileReviewPlan` 입력 조립 버그로 예외 발생 → standard single-strong 리뷰로 진행 → 설계가 없애려던 바로 그 "고위험 조용한 통과"가 재현.
- **수정 방향:** 컴파일 실패 폴백을 risk-aware로: riskClass가 high/critical로 알려졌으면 pause(fail-closed) + `degraded_events` 기록, riskClass 부재/무효일 때만 default 강도. §8.1의 "관찰 실패 fail-open"과 "게이트 실패 fail-closed" 비대칭을 컴파일 실패에도 일관 적용.

#### M3 — 인계(b) 해소가 존재하지 않는 파서에 의존 (§8.2 / §5.4-3)

- **위치:** 설계 §5.4-3, §8.2. 코드: `runtime/session-store.js`(파서 부재), `skills/deep-work-orchestrator/SKILL.md:335`, `skills/deep-implement/SKILL.md:179`, `runtime/slice-runtime.js:172-182`.
- **근거:** §5.4-3은 "`runtime/session-store.js`의 기존 파서 재사용"으로 `model_routing`/`tiers`/`pinned`를 결정론 추출한다고 한다. 그러나 `session-store.js`에는 `model_routing`/`tiers`/`pinned` 참조가 **0곳**(grep count 0)이다. 실제 tiers/pinned 보관처는 `model_routing_meta` **YAML 블록**이며 orchestrator §1-9(`SKILL.md:335`)가 기록하고 deep-implement가 `state.model_routing_meta.tiers`(`SKILL.md:179`)로 읽는다. 설계와 deep-research 주석이 후보로 든 `model_routing_meta_json` **스칼라**는 코드 어디에도 존재하지 않는다(`slice-runtime.js:172`가 다루는 것은 `model_routing_json` 스칼라 — legacy main→sonnet migration 전용, tiers/pinned 미포함).
- **실패 시나리오:** 구현자가 "기존 파서"를 찾다 없어서 혼란하거나, deep-research 주석의 `model_routing_meta_json` 후보명으로 파서를 만들면 정본 필드(`model_routing_meta` 블록)를 못 읽어 **(b)가 고치려던 추출 불신뢰가 그대로 재현** — routing_diff 공집합 위양성이 CLI 경로로 이전될 뿐.
- **수정 방향:** 정본 소스를 `model_routing_meta`(YAML 블록, 근거: orchestrator §1-9 / deep-implement:179)로 못박고, session-store.js가 아닌 실제 frontmatter-블록 추출기를 명시. 필드명 확정(어느 세션 생성 경로가 어떤 키로 persist하는지)을 구현 착수 **전** 완료해야 함을 §5.4-3에 명시. (설계 자체가 §3.4b에서 "미확정 후보 필드명 — 실물 확인 필요"라고 인정한 문제를 CLI로 옮기기만 하고 해소하지 못함.)

#### M4 — §8.1 hard trigger 수정이 destructive-migration false-negative를 유발 (안전 회귀)

- **위치:** 설계 §8.1. 코드: `runtime/risk-runtime.js:134-149`(`detectHardTriggers`), `:71`(destructive-migration 패턴), `:76-92`(`textCorpus`).
- **근거:** §8.1은 `corpusWithPaths`를 폐기하고 (i) `textCorpus`(taskText+keywords+side_effects) + (ii) **경로별 개별 매칭**의 합집합으로 전환한다. 이때 taskText↔changed_paths 사이에 **분산된** 거리-캡 매칭이 사라진다. `migration`/`schema` 토큰이 changed_paths에만 있고 taskText·keywords에 없으면, `drop`(taskText) + `schema.sql`(path)로 이전에는 발화하던 `destructive-migration`(**critical**) 하드트리거가 더 이상 발화하지 않는다. §8.1은 false-**positive** 제거만 분석하고 이 false-**negative** 도입은 다루지 않는다.
- **실패 시나리오:** task "drop the legacy records" + changed_paths `["db/schema.sql"]`, LLM이 keywords에 `schema`/`migration`을 넣지 않은 경우 → 기존 corpusWithPaths는 `drop.{0,20}schema` 매칭으로 Critical → 수정 후 텍스트 단독(migration/schema 없음)·경로 단독(drop 없음) 모두 미발화 → 위험도 과소 분류. dimension 경로(`PATH_PATTERNS` schema→irreversibility+1)로 점수는 일부 오르나 Critical 하드트리거 보장은 상실.
- **수정 방향:** false-negative 표면을 명시 분석하고 (a) 경로별 매칭 시 taskText의 destructive 키워드를 교차 참조하거나, (b) keywords가 경로 파생 토큰(migration/schema)을 신뢰성 있게 담도록 deep-research 추출 계약을 강화하거나, (c) 위험을 명시 수용하고 "intended-positive 무회귀"를 fixture로 증명. 최소한 §8.1의 26 matrix 회귀 시 destructive-migration 케이스 보존을 별도 검증.

#### M5 — effort 어휘가 codex CLI 실제 값 도메인과 어긋날 위험 + DoD 검증력 부족 (§5.3 / B.3 / §12)

- **위치:** 설계 §5.3, 부록 B.3, §12 exit criteria. 코드: `runtime/policy-runtime.js:8-13`(EFFORT_CATALOG: medium/high/xhigh/max).
- **근거:** effort 어휘가 `medium|high|xhigh|max`인데, B.3은 codex CLI의 정확한 플래그·유효값을 "구현 시 프로브로 확정"으로 전면 연기한다. codex(gpt-5) reasoning effort 도메인이 좁으면(예: low/medium/high) `xhigh`/`max`는 폴백(플래그 제거 재시도)되어 **strict/critical 리뷰어 effort가 항상 미적용**된다 — effort routing이 정작 고위험 케이스에서 no-op가 된다. §12 exit criteria("effort가 기록되고 능력 없는 채널에서 `effort_applied:false` 안전 폴백")는 effort가 **단 한 번도 실제 적용되지 않아도** 통과 가능하다 → DoD가 기능 동작을 증명하지 못한다.
- **실패 시나리오:** 릴리스된 effort routing이 모든 high/critical 리뷰에서 `effort_applied:false`만 기록 → 관측상 "안전 폴백 정상"으로 보이나 실제 effort 상향은 0회 → 기능이 장식.
- **수정 방향:** 구현 **전** codex의 실제 effort 값 도메인을 확정하고 내부 `xhigh`/`max` → codex 최대 지원값으로 매핑. §12 DoD를 "codex 가용 high/critical fixture에서 최소 1개 리뷰어가 `effort_applied:true`"로 강화. (Codex executability 리뷰가 값 도메인 확인 중 — §d에 반영.)

### MINOR

#### m1 — "riskClass 부재 시 바이트 동일" 보장과 신규 meta 키의 정합 미명시 (§5.1/§5.3/§10)

- §5.1은 riskClass 부재 시 v6.10과 "바이트 동일"을 보장하나, §5.1은 `meta.policy`, §5.3은 `meta.efforts`를 추가한다. 자연스러운 구현(riskClass 부재 → profile 없음 → efforts 산출 불가 → 키 생략)은 바이트 동일을 유지하고, 전 저장소에 `decideModelRouting` meta를 deepEqual 스냅샷하는 테스트도 없어(검증됨) 실제 위험은 낮다. 다만 설계가 신규 meta 키를 riskClass 부재 시 **생략(null 채움 아님)**함을 한 문장으로 명시해야 "기존 테스트 무수정"(§12 exit criteria) 보장이 확실해진다.

#### m2 — Stage1/Stage2 ↔ structural/semantic/executability role 크로스워크 부재 (§6.2)

- deep-implement의 Stage1(Spec)/Stage2(Quality) 구조를 유지하되 강도를 `compileReviewPlan`의 role(structural/semantic/executability)에서 받는다는데, Stage↔role 매핑이 명시되지 않아 slice-diff dual 구성이 모호. 명시 크로스워크 필요.

#### m3 — `dedupeFindings`의 "요지 중복" 결정론성 (§4.2)

- `review-finding-runtime.js`를 "결정론"으로 규정하면서 dedupe 키를 "artifact+location+**요지**(gist) 중복"으로 둔다. gist 매칭은 의미적/비결정론적. dedupe 키를 구조적(artifact+location+`violated_contract`)으로 정의해 결정론 규정과 일관화.

#### m4 — 위임 경로에서 `blind_first_round` 계약 적용 불명 (§6.2)

- worker(Task/Agent tool 없음, 검증됨)는 인라인 리뷰만 하고 부모가 완료 후 executability를 추가 실행하는 구성은 **순차적**이라 §4.1의 blind round-1 독립 쌍과 매핑되지 않는다. 위임 dual에서 blind가 어떻게 적용/면제되는지 명시 필요.

#### m5 — Critical 세션에서 pin이 floor 미만으로 떨어질 때 관측만 (§5.1)

- concrete/tier pin이 Critical 세션의 implement tier를 안전 floor 미만으로 낮춰도 `meta.policy.floor_overridden_by_pin`만 기록하고 사용자 경고가 없다. high/critical에서 pin이 floor를 깨면 경고 표면화 권장.

#### m6 — §3.3 "test loop 상한 미명시"는 부정확 (사실 정확성)

- 설계 §3.3의 수렴 조건 열거 중 "test loop 상한 미명시"는 틀리다. deep-test는 `max_test_retries` 상한을 갖는다(`skills/deep-test/SKILL.md:25,172,182`). 문제 진술의 사소한 부정확 — 통합 취지(rounds_max:2)에는 영향 없으나 열거 근거를 정정.

### INFO / 강점

- **사실 근거가 이례적으로 견고**: 현재-상태 파일:라인 주장 약 30건이 대부분 정확(§c 표). 인계 3건(a/b/c) 진단은 코드와 정확히 일치.
- **fail-open/fail-closed 비대칭**(§9)은 M2를 제외하면 건전한 안전 모델.
- **provider-중립 effort 어휘 + subagent no-fake-effort**(§5.3.2): Claude Task tool에 effort가 없음을 인정하고 `effort_applied:false` 고정 — 관측 불가한 가짜 적용을 만들지 않는 정직한 설계.
- **문서/deep-review 모순의 구조적 해소**(§4.1): `phase-review-gate.md:17`("문서에 deep-review 미사용")과 review-approval 경로B(`deep-review:code-reviewer`를 문서에 호출)의 직접 모순을, 규칙을 런타임 channel 상수로 승격해 해소 — 깔끔.
- `slice_risk_shadow_json`은 deep-plan(`SKILL.md:185`)이 실제 기록하므로 §5.2 per-slice floor 입력이 실재(dead-code 아님) — 초기 우려 반박됨.

---

## (c) 코드 대조 검증 결과

### 확인 (설계 주장 = 코드 실물)

| 설계 주장 | 검증 위치 | 판정 |
|---|---|---|
| `compilePolicySnapshot` 반환 구조 | `runtime/policy-runtime.js:60-77` | ✅ 정확 |
| TIER_CATALOG/EFFORT_CATALOG/PROFILE_BY_CLASS + "표시·기록 전용" 주석 | `policy-runtime.js:5-20` | ✅ 정확 |
| EFFORT_CATALOG role 키 profile별 상이(lean/standard `reviewer`; strict/critical `semantic_reviewer`/`executability_reviewer`+`escalation`) | `policy-runtime.js:8-13` | ✅ 정확 |
| `decideModelRouting` 시그니처·순서(baseline→difficulty→pin), `meta.tiers`/`meta.pinned` | `model-routing-runtime.js:151-188` | ✅ 정확 |
| `sliceModelTier` + `main`/비-tier 불변 가드 | `model-routing-runtime.js:141-149` | ✅ 정확 |
| effort 개념이 라우팅 경로에 없음 | `model-routing-runtime.js` 전체 | ✅ 정확 |
| (a) `corpusWithPaths` 거리-캡 정규식, 무관 파일명 쌍으로 destructive-migration 오발화 | `risk-runtime.js:142-146`, `:71` | ✅ 정확(예: `drop-handler.js schema.json`→`drop.{0,20}schema` 매칭) |
| (a) `PATH_PATTERNS` `\|auth` substring 오탐(oauth/author) | `risk-runtime.js:57` | ✅ 정확 |
| (b) authoritative가 LLM으로 model_routing/tiers/pinned 추출, "미확정 후보 필드명" 주석, 실패 시 errors 미기록 | `skills/deep-research/SKILL.md:261-293` | ✅ 정확 |
| (c) `validate-receipt.sh` summary emitter 한 칸 밀림(`const [,, result...]`), exit code는 정상이라 미검출 | `hooks/scripts/validate-receipt.sh:185-191` | ✅ 정확(node -e argv 규약) |
| (c) 테스트가 "기존 결함으로 신뢰 불가" 명시 | `tests/methodology-shadow-receipt.test.js:55-56` | ✅ 정확 |
| implement-slice-worker에 Task/Agent tool 없음 | `agents/implement-slice-worker.md:17-26` | ✅ 정확 |
| phase-review-gate §2 `model:"opus"` 하드코딩 | `phase-review-gate.md:66-74` | ✅ 정확 |
| phase-review-gate:17 "문서에 deep-review 미사용" ↔ 경로B `deep-review:code-reviewer`를 문서(research.md/plan.md)에 호출 | `phase-review-gate.md:17`, `review-approval-workflow.md:15-19` | ✅ 모순 실재 |
| severity 5종 분기(critical/major/minor; high/med/low; binary 동의/비동의; Critical만; Required/Advisory/Insight) | review-gate:49 / phase-review-gate:73 / review-approval:29 / deep-implement:283 / deep-test:93,100,114 | ✅ 정확 |
| adversarial 파일명 불일치 `${phase}-cross-review.json` vs `adversarial-review.json` | review-gate:622, deep-phase-review:183 | ✅ 정확 |
| degraded 정책이 위험도 무관 동일 | `review-gate.md:274-277` | ✅ 정확 |
| Stage2 Critical finding max 1 retry 후 무조건 진행(Advisory) | `deep-implement/SKILL.md:281-283` | ✅ 정확 |
| evaluator_model 기본 sonnet, tier/risk 도출 없음 | `deep-phase-review/SKILL.md:112` | ✅ 정확 |
| deep-implement spawn 사이트(Solo/Team A/B) | `deep-implement/SKILL.md:212/423/446` | ✅ 정확(설계 L424/447은 ±1) |
| 현재 init 순서 §1-8.5(라우팅) → §1-8.6(risk provisional) | `orchestrator/SKILL.md:320,338,352` | ✅ 정확(§5.2 재배열 대상 실재) |
| `slice_risk_shadow_json` 기록처 | `deep-plan/SKILL.md:185` | ✅ 정확(§5.2 입력 실재) |
| verify-receipt-core 8-check가 unknown 필드 미거부 | `hooks/scripts/verify-receipt-core.js` | ✅ 정확(§7.3 무영향 성립) |
| deep-finish methodology_shadow 기록 전용 | `deep-finish/SKILL.md` §Optional | ✅ 정확 |

### 불일치 / 부정확

| 설계 주장 | 실물 | 판정 |
|---|---|---|
| §5.4-3 "session-store.js 기존 파서 재사용"으로 tiers/pinned 추출 | `session-store.js`에 model_routing/tiers/pinned 참조 0곳; 정본은 `model_routing_meta` 블록(orchestrator:335 / deep-implement:179) | ❌ 불일치 → **M3** |
| §3.3 "test loop 상한 미명시" | deep-test는 `max_test_retries` 상한 보유(`deep-test:25,172,182`) | ❌ 부정확 → **m6** |
| §5.1 "바이트 동일" vs §5.3 `meta.efforts` 무조건 추가 | 자연 구현은 동일 유지 가능하나 설계가 생략 규칙을 명시 안 함 | ⚠️ 미명시 → **m1** |

> Explore 에이전트(이중 리뷰 실제 실행 흐름 · init 순서 · shadow 소비 0곳)와 Codex(executability) 결과는 §d에 종합 반영한다.

---

## (d) Cross-model 종합 (Codex executability)

Codex(codex-cli 0.144.6, high effort) executability 리뷰를 codex 플러그인 job store에서 직접 회수했다(`~/.claude/plugins/data/codex-openai-codex/.../jobs/task-mru5jfvz-k3xgle.json`, status=completed, exit 0). Codex는 **round-1 원본 설계**를 리뷰했으므로, round-2가 해소한 항목과 아직 열린 항목을 분리해 종합한다. Codex 신규 주장은 전건 코드로 재검증했다.

**Codex ↔ Claude finding 대응:**

| Codex # | severity(Codex) | Claude 대응 | round-2 상태 |
|---|---|---|---|
| #1 floor 단조성 (floorBaseline 미입력·단일호출 테스트) | blocker | = M1 | **resolved** (round-2 `applyFloorBaseline`+2회 호출 property) |
| #3 컴파일 실패 fail-open | blocker | = M2 | **resolved** (round-2 §9 2행 분리) |
| #5 session-store 파서 미실재 | blocker | = M3 | **resolved** (round-2 `extractRoutingBlocks`; Codex가 `parseStoredObject:532`=객체clone/스칼라JSON만·파일/YAML 미독으로 **재확증**) |
| #2 effort 값 도메인 + 공허한 DoD | major | = M5 | **부분** — 아래 |
| #4 destructive-migration 분산 FN | major | = M4 | **부분** — 아래 |
| 6a review-execution reducer 부재 | blocker | **신규 M6** | 미해소 |
| 6b availableChannels 출처 오류 | major | **신규 M7** | 미해소 |
| 6c --policy/--risk/--review 미배선 | major | **신규 M8** | 미해소 |
| 6d Critical human-ack/외부변경잠금 부재 | major | **신규 M9** | 미해소 |

**M5 부분 미해소 (Codex #2 — 실측):** Codex가 `codex debug models --bundled`로 실측한 결과 codex CLI 0.144.6은 모든 bundled 모델에 `low|medium|high|xhigh`를 보고하고 `max`는 `gpt-5.6-sol|terra|luna`가 추가 지원한다. 따라서 round-2가 부록 B.3에 pin한 도메인 `minimal|low|medium|high` + `xhigh→high` 클램프는 **틀렸다** — `xhigh`가 실제 지원되므로 클램프는 strict/critical 리뷰어 effort를 **한 단계 낮춰 적용**(하향 손실)하고, `max`(critical escalation)는 model-gated인데 일괄 `high`로 뭉갠다. round-2가 세운 프로세스("프로브 불일치=설계 변경, 조용한 폴백 금지")는 옳으나, 그 프로세스가 지금 발동해야 한다: B.3 표를 `xhigh→xhigh`, `max→선택 모델의 advertised level에 게이트(미지원 시 xhigh)`로 정정해야 한다. DoD 추가(§12 positive fixture)는 Codex도 동의 — 유지.

**M4 부분 미해소 (Codex #4 — path×path 분산):** round-2 rule (iii)는 destructive-측 토큰이 **textCorpus**에 있고 대상-측 토큰이 **한 path**에 있는 text×path 분산을 복원한다(내 원 시나리오). 그러나 Codex 시나리오는 **path×path** 분산이다 — `db/drop.js`(drop이 path에) + `db/schema.json`(schema가 path에), taskText·keywords는 generic. rule (iii)는 destructive-측을 textCorpus에서만 찾으므로 이 경우 발화하지 않아 **false-negative가 잔존**한다. 설계는 "서로 다른 파일명 연접은 모두 spurious"로 단정했으나, Codex는 동일 변경집합 내 destructive-path + migration/schema-path 조합은 진양성일 수 있다고 지적한다(권고: bounded change-set 내 path 분류 기반 구조화 규칙 + positive fixture).

---

## Round 2 — 재검증 (M1-M5 · m1-m6 반영본)

- **대상:** `docs/design/v6-12-adaptive-routing-unified-review.md` (상태 표기 "round-1 리뷰 반영본"), round-2 계약: open finding ID와 그 수정 부분만 재검증.
- **방법:** 반영 위치를 재독하고, maker가 근거로 든 코드(특히 M3의 `frontmatter.js:66-68` throw, `migrate-model-routing.js:31` raw-regex 선례)를 직접 재검증. M4 결합 규칙의 FN/FP 판별 논리를 재도출.

### 근거 코드 재검증 (maker가 제시한 신규 근거)

| maker 근거 | 재검증 | 판정 |
|---|---|---|
| M3: `parseFrontmatter()`가 nested key에서 throw | `runtime/frontmatter.js:66-67` — top-level key 정규식 `^([A-Za-z_]...)`가 들여쓴 `tiers:` 라인에서 match 실패 → `:67` `fail('frontmatter-invalid')` throw. 빈 값 key는 `:73`에서 들여쓴 **리스트(`- `)** 만 흡수하고 nested **mapping**은 흡수 못 함 | ✅ 정확 (nested 블록 파싱 불가) |
| M3: raw-regex 선례 `migrate-model-routing.js:31` | `:31` `if (/^model_routing_meta:/m.test(src))` + `:35` "locate the model_routing: block by scanning line-by-line" 주석 — raw 라인 스캔 선례 실재 | ✅ 정확 |
| M3: `session-store.js`에 파서 0곳 | round-1에서 grep count 0 확인 | ✅ 정확 (설계가 이 사실을 명문화) |

### Finding별 판정

| ID | 해소 위치 | 판정 | 근거 |
|---|---|---|---|
| **M1** floor 단조성 시그니처 갭 | §5.1(`floorBaseline`+`applyFloorBaseline`), §5.2, §5.4-4, §7.2(`floors_effective`), §10-1 | **resolved** | 시그니처에 `floorBaseline` 추가(§5.1:174) + `applyFloorBaseline`가 `maxTier(tiers, floorBaseline)`를 **함수 레벨**에서 강제(:185). `floors_effective` 영속(§7.2) → 다음 호출 `--floor-baseline`로 스레딩(§5.2:195). 로직 검증: authoritative < provisional이어도 `applyFloorBaseline`이 init floor로 되올려 단조성 성립. §10-1 단조성 property 테스트 추가 |
| **M2** 컴파일 실패 fail-open | §9 표(2행 분리), §10-3 | **resolved** | §9 표를 riskClass 부재/무효(→default, fail-open)와 high/critical 확정(→**pause fail-closed** + degraded_events)으로 분리(:330-331). §10-3에 "riskClass=high/critical에서 throw 시 default 아닌 pause" 테스트. 안전 비대칭 원칙과 일관 |
| **M3** 인계(b) 파서 미실재 + 필드명 | §5.4-3(`extractRoutingBlocks`) | **resolved** | 허위 전제("session-store.js 기존 파서") 삭제; parseFrontmatter 사용 불가를 throw 근거와 함께 명시; 신규 좁은 추출기 + raw-regex 선례 제시; **정본 필드명/format 확정 + 실물 fixture 캡처를 구현 착수 전 plan 선행 태스크로 게이트**. 잔여(블록 vs 스칼라 persist 형태 미확정)를 정직하게 prerequisite로 스코핑 — 설계 문서에서 캡처 불가한 항목의 올바른 처리 |
| **M4** destructive-migration FN | §8.1(3부 매칭 + text×path conjunction + FN/FP fixture) | **부분(partial)** | text×path 분산(내 원 시나리오)은 rule (iii)로 **resolved**. 그러나 Codex #4의 **path×path** 분산(`db/drop.js`+`db/schema.json`, generic text)은 rule (iii)가 destructive-측을 textCorpus에서만 찾아 **여전히 false-negative**. 설계의 "path 연접=전부 spurious" 단정이 진양성 path 조합을 잃는다 → 구조화 path 분류 규칙 + positive fixture 필요(§d) |
| **M5** effort 값 도메인 + DoD | §5.3-1, 부록 B.3(매핑 표), §12 DoD | **부분(partial)** | DoD 강화(§12 positive fixture)는 **resolved**(Codex 동의). 그러나 round-2가 pin한 도메인 `minimal\|low\|medium\|high` + `xhigh`/`max`→`high` 클램프가 **Codex 실측(`codex debug models --bundled`: `xhigh` 지원, `max`는 gpt-5.6 모델 한정)과 불일치** → 클램프가 strict/critical effort를 하향 손실. 설계 자신의 "프로브 불일치=설계 변경" 규칙 발동: B.3를 `xhigh→xhigh`, `max→model-gated`로 정정 필요(§d) |
| **m1** 바이트 동일 vs meta 키 | §5.1(:189) | **resolved** | riskClass·floorBaseline 부재 시 `meta.policy`·`meta.efforts` 키 **생략(null도 금지)** 명시 → meta shape 문자 동일. §10-1에 생략 확인 |
| **m2** Stage↔role 크로스워크 | §6.2(:235) | **resolved** | Stage1(Spec)=`semantic`, Stage2(Quality)=`executability`, `structural`=document 전용 명시 |
| **m3** dedupe 결정론 | §4.2(:113) | **resolved** | dedupe 키를 구조 키(artifact, location, violated_contract) 완전 일치로 한정, "요지" 유사 병합 배제 |
| **m4** 위임 blind | §6.2(:237) | **resolved** | blind를 동시성 아닌 **입력 격리 요건**으로 재정의 — 부모 executability 프롬프트가 worker 인라인 finding 미포함, `verdictFromFindings`에서만 합류 |
| **m5** pin-below-floor 경고 | §5.1(:187) | **resolved** | high/critical에서 pin이 floor를 깨면 스킬이 ⚠️ 경고 1줄 표면화(차단은 않음 — 사용자 선택 존중) |
| **m6** §3.3 부정확 | §3.3(:69) | **resolved** | "test loop 상한 미명시" → "max_test_retries 상한을 갖되 상한 축이 서로 달라 계약 간 cap 미인지"로 정정 (사실 정확) |

### 신규 finding (Codex executability 종합 — round-2가 다루지 않음)

Codex 결과 회수로 드러난, round-2 반영 범위(M1-M5/m1-m6) **밖**의 신규 finding. 전건 코드로 재검증했다. 팀리드 지시("Codex 결과를 verdict에 반영")에 따라 verdict에 산입한다.

| ID | severity | 위치 | 근거(재검증) | 실패 시나리오 | 수정 방향 |
|---|---|---|---|---|---|
| **M6** review-execution reducer 부재 | **blocker** | §4.1/§4.2, §10-3 | `verdictFromFindings(findings, reviewPlan)`(§4.2)는 **finding만** 입력받는다 — reviewer 실행 상태(completed/failed/timeout)를 받지 않는다. `compileReviewPlan`은 정적 plan만 반환. required reviewer 실패→pause를 결정하는 **결정론 함수가 없음**. degraded 처리가 prose(§9/B.2)로만 존재. §10-3의 "High dual 1 실패→pause" fixture는 호출할 함수(oracle)가 없다 | High dual에서 executability가 timeout, semantic은 blocker 없음 → `verdictFromFindings`는 성공 finding만 보고 PASS 반환. compile fixture는 green. 필수 리뷰어 누락이 관측되지 않아 **fail-closed 보장이 조용히 붕괴** | `evaluateReviewExecution(plan, reviewerResults) → {decision: proceed\|pause\|needs-human, ...}` 결정론 함수를 §4에 추가하고 §10-3를 이 함수에 배선. review_execution_json의 reviewer status를 입력으로 |
| **M7** availableChannels 출처 오류 | major | §4.1(:98) | `compileReviewPlan.availableChannels`{subagent,codex_cli,gemini_cli,deep_review}가 "기존 detect-capability.js 신호 재사용"이라는데, `scripts/detect-capability.js`는 `recommender-runtime.detectCapability`(:14) 재export일 뿐 — 반환은 `{git_worktree, team_mode_available, is_git}`뿐(reviewer 채널 신호 **없음**). 실제 reviewer 가용성은 prose의 `which codex`/`which gemini`(phase-review-gate:20~) ad hoc | 구현자가 명세대로 detectCapability()를 재사용 → codex_cli/gemini_cli/deep_review 전부 undefined/false. plan이 가용 codex 리뷰어를 누락하거나 모든 High 리뷰를 pause. 손수 만든 availableChannels fixture는 green이라 결함 은폐 | 채널 탐지 신규 감지기(또는 detect-capability 확장) 명시. M3와 동종 — "기존 인프라 재사용" 과대 주장 |
| **M8** 리뷰 override 플래그 미배선 | major | §7.1, §4.1 | §7.1이 `--policy/--risk/--review`를 추가하나, `runtime/flags-runtime.js`엔 해당 필드 없음(skip_research/skip_review/... 만) — 미매칭 토큰은 task text로 라우팅. 게다가 `compileReviewPlan` 시그니처(§4.1:89-90)에 `policyMode`/`reviewMode` 파라미터 부재. §5.1이 decideModelRouting엔 policyMode를 넣었지만 리뷰 컴파일러엔 없음 → §7.1 "`--policy=shadow`면 리뷰 강도 미적용"이 받을 파라미터가 없다 | `--policy=shadow --review=single`이 현재는 task text로 분류. 부분 구현 시 파서는 파싱하나 compileReviewPlan에 전달 지점이 없어 실사용은 adaptive/auto로 동작. 컴파일러 직접 호출 unit fixture는 green | 파서에 3플래그 추가 + `compileReviewPlan`에 `policyMode`/`reviewMode` 입력 추가 + orchestrator/스킬 전달 배선 |
| **M9** Critical human-gate/외부변경잠금 미구현 | major | B.1/B.2, §7.2, §12 | B.1/B.2가 Critical에 human ack + "외부 변경 금지"를 normative로 요구하나, `review_execution_json`(§7.2)에 ack/external-change-lock 필드 없음, §12에 Critical human-gate 기준 없음, verify-receipt-core 8-check에 ack 검사 없음(재검증됨) | Critical slice가 리뷰 2건 성공 후 사용자 확인 없이 진행, 또는 전원 실패에도 외부 publish 진행 — 모든 fixture green(durable ack/외부잠금을 아무 테스트도 요구 안 함) | Critical ack + external-change-lock을 state 필드 + 강제 함수 + §12 DoD로 실장 |

**비차단 carry-forward:**
- **m7** §8.1 rule (iii): `external-destructive-action`의 destructive-측/대상-측 토큰 분할이 "등"으로 미열거 — 구현 시 fixture와 함께 파티션 확정.
- **M3 잔여**: `model_routing_meta`의 실제 persist form(nested 블록 vs 스칼라)은 실물 fixture 캡처(설계가 명시한 plan 선행 태스크)로 확정 필요 — `extractRoutingBlocks` 계약의 전제.

---

## (e) 최종 verdict (Round 1 기록)

설계는 사실 근거가 이례적으로 견고하고(현재-상태 주장 ~30건 검증 통과) 통합 방향도 건전하나, 구현 착수 전 해소해야 할 **major 5건**이 있다:

- **M1** 라우팅 floor 단조성이 시그니처로 강제 불가 — 함수가 stated 단조 보장을 못 함.
- **M2** review plan 컴파일 실패의 default 폴백이 고위험 세션에서 fail-open — §9 안전 원칙 자체 모순.
- **M3** 인계(b) 근본 해소가 존재하지 않는 파서에 의존 — 정본 필드 미확정 시 (b) 재현.
- **M4** §8.1 수정이 destructive-migration(critical) false-negative를 유발 — 미분석 안전 회귀.
- **M5** effort 어휘가 codex 실제 값 도메인과 어긋날 위험 + DoD가 기능 동작을 증명 못 함.

blocker는 없다(모두 구현 전 스펙 보정으로 해소 가능). 그러나 M1·M2·M4는 설계가 표방하는 **안전/정확성 보장**을 직접 훼손하므로 승인 전 반드시 반영해야 한다.

_Round 1 verdict: REQUEST_CHANGES_

---

## (f) 최종 verdict (Round 2)

round-1 REQUEST_CHANGES의 반영은 **부분적으로 성공**했다. Claude 재검증 + Codex executability 종합을 합산한 결과:

**해소 (7/11):** M1(floor 단조성 — `applyFloorBaseline`+2회 property, Codex #1 확인), M2(컴파일 실패 risk-aware 2행, Codex #3 확인), M3(허위 파서 전제 삭제 + `extractRoutingBlocks` + fixture 선행 게이트, Codex #5 재확증), m1-m6 전부. 각 해소를 코드 근거로 직접 재검증했다.

**부분 미해소 (2):**
- **M4** text×path 분산은 복원됐으나 Codex #4의 **path×path 분산**(`db/drop.js`+`db/schema.json`)은 여전히 false-negative — 안전 recall 회귀 잔존.
- **M5** DoD 강화는 유효하나 round-2가 pin한 codex effort 도메인이 Codex 실측과 불일치(`xhigh` 지원·`max` model-gated) — B.3 표를 정정해야 하며, 현행대로면 strict/critical effort가 하향 손실.

**신규 (Codex 회수로 발견, round-2 범위 밖):**
- **M6 (blocker)** required reviewer 실패→pause를 결정하는 결정론 reducer 함수 부재 — 설계 headline인 "High fail-closed"의 §10-3 fixture가 호출할 oracle이 없어 **안전 보장이 단위 테스트로 강제 불가**.
- **M7/M8/M9 (major)** availableChannels 출처 오류·리뷰 override 플래그 미배선·Critical human-gate 미구현 — 모두 코드로 재검증된 실장 갭.

**판정 근거:** M6은 진짜 신규 blocker다(설계의 핵심 안전 속성을 테스트 불가로 남김). 여기에 M4/M5 부분 미해소 + 신규 major 3건이 더해진다. round-1의 major 5건 중 3건(M1/M2/M3)은 견고히 해소됐고 사실 근거도 여전히 이례적으로 정확하나, blocker 1건이 열려 있으므로 승인할 수 없다. 다음 라운드에서 M4/M5 정정 + M6 reducer 함수 도입 + M7/M8/M9 배선 명세가 필요하다.

_Round 2 verdict: REQUEST_CHANGES_

---

## Round 3 — 재검증 (M4/M5·M6·M7/M8/M9·m7 반영본)

- **대상:** 상태 표기 "round-2 리뷰 반영본". round-3 계약: round-2의 **열린 finding 해소 여부만** 재검증.
- **방법:** 반영 위치(§4.1/§4.3/§5.3/§6.4/§7.1/§7.2/§8.1/§10-3/§12/B.3)를 재독하고 M4 rule (iv)의 db-context 분류와 M6 reducer의 실행 순서 계약 논리를 재도출.

### Finding별 판정 (round-2 열린 항목)

| ID | 해소 위치 | 판정 | 근거 |
|---|---|---|---|
| **M6** (blocker) review-execution reducer | §4.1(:95-97,:101), §4.3(:162), §10-3, §12 | **resolved** | `evaluateReviewExecution(plan, reviewerResults) → {decision, human_gate, degraded_events}` 신설. finding 판정(`verdictFromFindings`)과 **실행 판정**을 분리. B.2 결정론 인코딩(required 실패: low→degraded-proceed / medium→needs-human / high·critical→pause). **실행 순서 계약 명시**: reviewers→`evaluateReviewExecution`→(proceed 시에만)`verdictFromFindings` — 논리 재검증: executability timeout+semantic clean이면 reducer가 pause 반환 후 verdictFromFindings 미실행, "성공 finding만 보고 PASS" 구멍 폐쇄. §10-3 oracle fixture + §12 DoD 갖춤 |
| **M5** (부분→) effort 도메인 | §5.3-1(:211), B.3(:426-433) | **resolved** | Codex 실측대로 정정: 도메인 `minimal\|low\|medium\|high\|xhigh`, **`xhigh` 직접 지원(클램프 제거)**, `max`는 gpt-5.6 계열 model-gated(아니면 xhigh 클램프+`effort_clamped`). strict/critical effort 하향 손실 해소. §12 positive fixture 유지 |
| **M4** (부분→) path×path FN | §8.1 rule (iv)(:329), fixture(:330) | **resolved** | db-context 분류(`db/`·`migrations/`·`prisma/` 하위 또는 basename `*.sql`/`schema.*`/`*migration*`) 집합 수준 conjunction 신설. 논리 재검증: FN(`db/drop.js`+`db/schema.json`, 둘 다 db/ 세그먼트)→발화; FP(루트 `drop-handler.js`+`schema.json`)→**미발화**(destructive 토큰 보유 경로 drop-handler.js가 비-db-context라 db-subset 제외). FN/FP/단일TP 4종 fixture 고정 |
| **m7** rule (iii) 토큰 파티션 | §8.1(:328) | **resolved** | 두 trigger의 destructive-측/대상-측 토큰 집합 완전 열거 정본화(`destructive-migration`·`external-destructive-action` 각각), 구현 시 상수 내장 |
| **M7** (major) availableChannels 출처 | §4.1(:102), §7.2(:291), §10-3 | **resolved** | `detectReviewChannels({runtime,env})` 신설(detect-capability 재사용 불가 근거 명시). codex/gemini 실행 프로브·deep_review 설치 확인·subagent 호스트 능력. `review_execution_json.channels` 영속 + resume 재프로브. §10-3 프로브 결정론 fixture |
| **M8** (major) override 플래그 배선 | §4.1(:91,:100), §7.1(:280-284) | **resolved** | `compileReviewPlan` 시그니처에 `policyMode`/`reviewModeOverride` 추가. 배선 3단계 명세: flags-runtime.js 파싱→state 기록(`methodology_policy_json.mode`/`review_mode_override`)→소비 전달(라우팅/리뷰 컴파일)+resume 복원 |
| **M9** (major) Critical human-gate | §6.4(:260-268), §7.2(:291), §4.1(:101), §12(:385) | **resolved** | §6.4 신설: `evaluateReviewExecution` human_gate + AskUserQuestion ack 기록, **unattended→pause(자동승인 없음)**. `external_change_lock` state 필드 + deep-finish PR/merge/push 차단 게이트(ack 전원 기록 시 해제). §7.2 shape 확장 + §12 DoD |

### 새 이슈 스캔 (round-3 — 진짜 새 blocker만)

- **새 blocker 없음.** M6 reducer, rule (iv), B.3 정정, 배선 3단계, §6.4에서 새 blocker/회귀 미발견.
- (비차단, minor) **§4.1 내부 잔존 모순**: M7 정정 bullet(:102, "detect-capability.js 재사용 **불가**")과 구 bullet(:107, "availableChannels: … 기존 detect-capability.js 신호 **재사용**")이 같은 섹션에 공존. :102가 권위·상세하나 :107이 구 문구 그대로 남아 상충 — 구 라인 정리 권장(실장에는 :102가 정본).
- (비차단, minor) **M4 rule (iv) 근거 서술 부정확**: 설계는 FP 케이스의 루트 `schema.json`을 "db-context 아님"이라 하나, 자신의 basename 규칙(`schema.*`)상 `schema.json`은 db-context로 분류된다. **fixture 결과(미발화)는 여전히 옳다**(destructive 토큰 보유 경로 drop-handler.js가 비-db-context라 conjunction 미성립) — 서술만 부정확. 아울러 `db/drop-config.js`+`db/schema.json` 같은 db-context 내 destructive-substring 조합은 신규 FP 여지(bounded·수용 가능한 recall/precision 트레이드).
- (비차단 carry-forward, 유지) **M3 잔여**: `model_routing_meta` persist form(nested 블록 vs 스칼라) 실물 fixture 캡처 — 설계가 명시한 plan 선행 태스크.

---

## (g) 최종 verdict (Round 3)

round-2의 열린 finding **전건이 해소**되었다. blocker였던 **M6**는 `evaluateReviewExecution` reducer 신설 + **실행 순서 계약**(reducer→proceed 시에만 verdictFromFindings) + §10-3 oracle fixture + §12 DoD로 완결됐다 — "성공 finding만 보고 PASS"하던 fail-closed 구멍이 결정론 함수로 닫혔고, headline 안전 속성이 이제 단위 테스트로 강제된다. M5는 Codex 실측 도메인대로 정정(xhigh 클램프 제거·max model-gated), M4는 db-context 집합 conjunction으로 path×path FN을 잡되 FP를 재도입하지 않음(fixture 4종 고정), M7/M8/M9는 각각 detectReviewChannels·플래그 배선 3단계·Critical human-gate(unattended pause + external_change_lock)로 실장 경로가 완성됐다. m7 토큰 파티션도 정본 열거됐다.

3라운드에 걸쳐 major 9건·minor 7건이 모두 해소됐고, 설계의 현재-상태 사실 근거(~30건)는 일관되게 정확하며, 각 해소를 코드 근거로 직접 재검증했다. 남은 것은 비차단 문서 정리 2건(§4.1 :107 구 문구 정리, M4 근거 서술 정정)과 이미 plan 선행 태스크로 게이트된 M3 fixture 캡처뿐 — 어느 것도 구현 착수를 막지 않는다.

VERDICT: APPROVE
