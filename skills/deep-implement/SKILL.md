---
name: deep-implement
version: "6.3.0"
description: "Phase 3 — Implement: slice-based TDD execution of approved plan"
---

# Section 1: State 로드 (필수 — 건너뛰기 금지)

1. Session ID 결정
   - $ARGUMENTS에 --session=ID → 사용
   - 없으면 → .claude/deep-work-sessions.json에서 active session 탐색
2. State 파일 읽기: `.claude/deep-work.{SESSION_ID}.md`
3. 조건 변수 확인:
   - worktree_path — $ARGUMENTS 우선, 없으면 state에서
   - team_mode — $ARGUMENTS 우선, 없으면 state에서
   - tdd_mode — $ARGUMENTS에 --tdd=MODE 우선, 없으면 state에서 (기본: strict)
4. 추출: `work_dir`, `active_slice`, `tdd_state`, `model_routing.implement`, `evaluator_model`
5. Verify: `current_phase` = "implement", `plan_approved` = true
6. `implement_started_at` 기록 (ISO timestamp)

## Plan 로드 + Slice 파싱

Read `$WORK_DIR/plan.md` → **Slice Checklist** 파싱. 각 slice:
- id, goal, files, failing_test, verification_cmd, expected_output
- spec_checklist, contract, acceptance_threshold, size, steps

인라인 plan (state `skipped_phases` includes "plan"): SLICE-001만 존재, failing_test/contract 최소화 가능.

## Resume Detection

완료된 slice (`- [x]`) 존재 시 → 미완료 slice부터 이어서 진행.

# Section 2: Phase 실행

## Critical Constraints

- **Follow the plan EXACTLY. Do not deviate.**
- **TDD mandatory** (strict/coaching): failing test → production code → refactor
- **Do NOT add features not in the plan**
- **Do NOT modify files outside the active slice's scope**
- **Bug → debug mode** — do NOT guess at fixes

## Red Flags — 이 생각이 들면 멈추세요

| 합리화 시도 | 현실 |
|------------|------|
| "이건 너무 단순해서 TDD 안 해도 돼" | 단순 코드도 깨진다. RED는 30초면 된다. |
| "테스트는 나중에 추가하지" | 나중에 쓴 테스트는 즉시 통과한다 — 아무것도 증명하지 않는다. |
| "일단 고쳐보고 안 되면 조사하자" | 추측 수정은 3회 연속 실패로 끝난다. Root cause 먼저. |
| "Plan에는 없지만 이것도 같이 하면 좋겠다" | Scope creep. Issues Encountered에 기록하고 넘어가라. |
| "이 파일도 살짝 리팩토링하면…" | 슬라이스 scope 밖이다. 다음 세션에서 하라. |
| "mock으로 빠르게 테스트하자" | Mock은 mock을 테스트한다. 실제 동작을 검증하라. |
| "GREEN인데 refactor는 건너뛰자" | 기술 부채가 다음 슬라이스에서 복리로 돌아온다. |
| "센서 경고는 무시해도 되겠지" | Advisory도 기록된다. 무시한 경고가 Phase 4에서 차단으로 돌아온다. |
| "이미 수동으로 테스트했으니까" | 수동 테스트는 증거가 아니다. Receipt에 남지 않는다. |
| "비슷한 코드를 복사해서 수정하면 빠르겠다" | Plan의 code sketch를 따르라. 복사한 코드는 컨텍스트가 다르다. |

**이 중 하나라도 해당되면**: 현재 작업을 멈추고, 해당 Red Flag의 "현실" 컬럼을 따르세요.

## Model Routing

State에서 `model_routing.implement` 확인 (기본: "sonnet").

- **"main"**: 현재 대화 모델로 inline 실행 → 아래 Solo Slice Loop 진행
- **특정 모델명** (sonnet/haiku/opus): 해당 모델로 Agent 위임
- **"auto"**: slice size에 따라 모델 자동 선택 (S→haiku, M→sonnet, L→sonnet, XL→opus)

Agent 위임 시: `mode: "bypassPermissions"`, TDD 규칙 + Slice Review 규칙을 프롬프트에 포함 (hook이 delegated agent에 미적용), slice당 10분 timeout.
상세: Read("../shared/references/model-routing-guide.md")

## Solo Slice Loop

각 미완료 slice (`- [ ]`)에 대해:

### Step A: Activate Slice

1. `git_before` = `git rev-parse HEAD`
2. State 업데이트: `active_slice: SLICE-NNN`, `tdd_state: PENDING`
3. Pre-flight: files 존재, verification_cmd 실행 가능 확인 → 실패 시 AskUserQuestion

### Step B: TDD Cycle (strict/coaching)

#### B-1. RED: Failing Test 작성
1. slice의 `failing_test`/`steps` 기반으로 테스트 작성
2. `verification_cmd` 실행 → **올바른 이유로 FAIL 확인**
3. **[필수] State**: `tdd_state: RED_VERIFIED` (미수행 시 phase guard가 production 코드 편집 차단)

#### B-2. GREEN: Minimal Production Code
1. 테스트 통과에 필요한 최소 코드만 구현 (slice `files` 범위 내)
2. `verification_cmd` 실행 → **모든 테스트 PASS 확인**
3. `expected_output` 필드가 있으면 출력 대조
4. **[필수] State**: `tdd_state: GREEN`

#### B-3. SENSOR_RUN: Computational Sensor
> spike mode → skip. 나머지 모드:

GREEN 후 센서 실행 (fast-fail 순서): lint → typecheck → review-check
각 센서 독립 3-round correction limit. 실패 → SENSOR_FIX 진입 (코드 수정 → 테스트 재확인 → 센서 재실행).
3 round 소진 → unresolved 기록, 진행.
모두 pass → `tdd_state: SENSOR_CLEAN`

#### B-4. REFACTOR (optional)
테스트 유지하며 코드 개선. 매 refactor 후 `verification_cmd` 실행.

**relaxed mode**: RED 건너뜀, 직접 구현 후 검증.
**spike mode**: TDD 없이 자유 구현. Receipt에 `tdd_state: SPIKE`. **merge 불가**.

### Step C: Spec/Contract 검증

1. `spec_checklist` 항목별 검증 → 미충족 시 추가 RED→GREEN cycle
2. `contract` 항목별 검증 → `acceptance_threshold`(all/majority) 적용

### Step C-2: Slice Review (2-Stage Independent Review)

> spike → skip. relaxed → Stage 1 only.

per-slice diff: `git diff $git_before -- [slice files]`

**Stage 1 — Spec Compliance** (Required):
- Agent(evaluator_model): diff + spec_checklist + contract 검증
- FAIL → 수정 + GREEN 확인 + 센서 재실행 (max 2 retries)

**Stage 2 — Code Quality** (Advisory):
- Agent(evaluator_model): diff + Architecture Decision 검증
- Critical finding → 수정 (max 1 retry)

### Step D: Receipt 수집

`$WORK_DIR/receipts/SLICE-NNN.json` 생성:
- **status: "complete"** (필수 — deep-test의 Receipt Completeness gate가 이 필드를 검증)
- tdd, changes (git diff), sensor_results, spec_compliance, slice_review
- harness_metadata (model_id, rework_count, tests_passed_first_try 등)
- slice_confidence: done / done_with_concerns + concerns 배열

### Step E: Mark Complete

1. plan.md: `- [ ]` → `- [x]`
2. State: `active_slice: ""`, `tdd_state: PENDING`
3. 다음 미완료 slice로 진행

## TDD Override

main 모드 + strict/coaching에서 hook 차단 시:
AskUserQuestion → 테스트 먼저 / config 변경 / 테스트 불가 / 긴급 수정 선택.
override 선택 시: `tdd_override: "SLICE-NNN"` → hook 통과 허용.
slice 완료 시 override 자동 해제. Receipt에 override 기록.

## Debug Sub-Mode

GREEN 단계에서 예기치 않은 테스트 실패 시:
1. `debug_mode: true` → 체계적 조사 (Read error → Analyze → Hypothesize → Fix)
2. 3회 실패 시 **STOP → 사용자에게 질문**
3. Root cause를 receipt `debug.root_cause_note`에 기록

## Team Mode

`team_mode: team`이고 Agent Teams 환경변수 활성 시:

1. **Cluster**: file 소유권 기반 slice 그룹화 (겹침 → sequential, 독립 → parallel)
2. **Dispatch**: TeamCreate "deep-implement" → 그룹별 Agent 스폰 (TDD + Slice Review 규칙 포함)
3. **Collect**: 완료 후 모든 receipt 수집 + 무결성 검증

## Phase Review Gate

모든 slice 완료 후, Test 전환 전:
Read("../shared/references/phase-review-gate.md") — 프로토콜 실행:
- Phase: implement
- Document: 구현된 코드 전체 (git diff)
- Self-review: 계획 충실도, 크로스 슬라이스 일관성, 미구현 항목

상세: Read("../shared/references/implementation-guide.md")

# Section 3: 완료

1. 모든 receipt 검증: `$WORK_DIR/receipts/SLICE-*.json` 존재 확인
2. State 업데이트:
   - `implement_completed_at`: current ISO timestamp
   - `phase_review.implement`: `{reviewed, reviewers, self_issues, external_issues, resolved}`
   - `review_state: completed`
   - **`current_phase: test`**
3. 완료 메시지:
   ```
   구현 완료! 테스트 단계로 진입합니다.
   완료 slice: N/N
   TDD 준수율: [strict: N, relaxed: N, override: N, spike: N]
   Receipt 완성: N/N
   ```
4. 알림: `notify.sh "$STATE_FILE" "implement" "completed"`
