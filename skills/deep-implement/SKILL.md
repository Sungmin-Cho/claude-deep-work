---
name: deep-implement
version: "6.4.0"
description: "Phase 3 — Implement: slice-based TDD execution of approved plan"
---

> [!IMPORTANT]
> **Skill body echo 금지**
>
> 이 SKILL.md 본문을 사용자에게 echo하거나 요약하여 출력하지 마라.
>
> - Section 1 (state 로드, Plan 로드+Slice 파싱, Resume Detection, 완료-marker 감지)는 silent 내부 처리.
> - 첫 사용자-가시 주 동작은 Section 2의 **First Action: 첫 slice TDD RED 개시**.
> - Section 3 완료 메시지는 plan.md 모든 slice의 TDD cycle, sensor 검증, Slice Review, Phase Review Gate를 **실제로 수행**한 뒤에만 출력.
> - Implement phase 산출물은 코드 자체이다. 본 문서의 "Red Flags" 표나 TDD protocol 설명을 응답으로 출력하지 마라.

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
7. Parse `--exec=<mode>` from `$ARGUMENTS`:
   - If `$ARGUMENTS` contains `--exec=inline` → set local `args_exec = "inline"`
   - If `$ARGUMENTS` contains `--exec=delegate` → set local `args_exec = "delegate"`
   - Otherwise → `args_exec = null`
   - After Section 1.5 pre-routing, if `args_exec != null`, persist to state:
     `state.execution_override = args_exec` (written via Edit on the state file
     YAML frontmatter, matching the existing pattern used for other CLI-overridable fields).

This persistence ensures:
  - Resume uses the override even without re-passing --exec.
  - CLI args > state precedence is automatic (args parsed first, state written last).

## Plan 로드 + Slice 파싱

Read `$WORK_DIR/plan.md` → **Slice Checklist** 파싱. 각 slice:
- id, goal, files, failing_test, verification_cmd, expected_output
- spec_checklist, contract, acceptance_threshold, size, steps

인라인 plan (state `skipped_phases` includes "plan"): SLICE-001만 존재, failing_test/contract 최소화 가능.

## Resume Detection

완료된 slice (`- [x]`) 존재 시 → 미완료 slice부터 이어서 진행.

## 완료-Marker 감지 (Phase-level resume — F1)

`implement_completed_at` 필드가 state에 이미 있고 모든 slice receipt가 `status: "complete"`이며 `$ARGUMENTS`에 `--force-rerun`이 없으면:
- "Phase 3 (Implement)은 이미 완료되었습니다. Exit Gate를 재표시합니다." 출력
- Orchestrator §3-4로 제어 반환 (Exit Gate 재실행)
- Section 2/3 진입 금지

**주의**: Slice 단위 resume (일부 slice만 완료)은 위의 Resume Detection이 처리. 본 branch는 **Phase 전체 완료 후 Exit Gate에서 일시정지한 경우에만** 발동.

## Section 1.5: Pre-routing — Inline Escape Hatches (v6.4.0)

Section 1 전체 완료 후 (state 로드 + Plan 파싱 + Slice 파싱 + Resume Detection + 완료-marker 감지가 모두 끝난 뒤), Section 2 First Action 진입 **전에** 실행 모드를 결정한다.

### decide_execution_mode

```
def decide_execution_mode(state, args):
    # B. 명시적 override 우선순위: CLI args > state (W-4.2 fix)
    #    예전 버전: `args.exec == "inline" or state.execution_override == "inline"`
    #    → state=inline + CLI=delegate 일 때 state가 이기는 버그.
    #    수정: CLI가 지정된 경우 무조건 CLI가 이긴다.
    if args.exec is not None:       # CLI 명시 → 무조건 우선
        return args.exec            # "inline" or "delegate"
    if state.execution_override is not None:  # state override 있음
        return state.execution_override

    # A. 자동 heuristic (CLI도 state도 없을 때만)
    if state.tdd_mode == "spike":
        return "inline"
    if ("plan" in state.skipped_phases
        and len(plan.slices) == 1
        and plan.slices[0].size == "S"):
        return "inline"

    # 기본
    return "delegate"
```

### 자동 inline 알림

자동 heuristic inline 결정 시 1회 메시지:
```
[auto-inline] tdd_mode=spike — main session에서 구현합니다.
              (subagent 위임을 강제하려면 --exec=delegate 사용)
```

### 명시적 override

- CLI `--exec=<mode>` → state의 `execution_override` 필드 (값: `inline | delegate | null`)
- state.execution_override는 resume 시에도 유지
- **CLI args > state**: resume 시 `/deep-resume --exec=X`가 기존 state 값을 덮어씀

### Section 1.5 출력

Section 2 진입 시 메모리에 보유 + state YAML에 persist:
- `execution_mode`: "inline" | "delegate" (메모리만)
- `delegation_snapshot`: `git rev-parse HEAD` (delegate 모드 진입 직전에 기록)
  — **state YAML에도 `delegation_snapshot: <hash>` 로 Edit tool로 기록** (C-1.1 fix).
  이 persist가 있어야 verify-receipt fail 후 세션이 interrupted 되어도 `/deep-resume`이
  state에서 기준 hash를 읽어 Rollback Protocol을 재표시할 수 있다.
  verify-receipt가 pass하면 Section 2.3 말미에서 `delegation_snapshot: null` 로 clear.

상세는 spec §5.5a, §7.5 참조.

# Section 2: Phase 실행

## First Action (즉시 실행 — 건너뛰기 금지)

Section 1 state 로드, Plan 파싱, Resume Detection, 완료-marker 감지가 silent하게 끝난 뒤 **즉시** 다음 메시지를 출력한다:

> "Implement 단계를 시작합니다. plan.md의 첫 미완료 slice부터 TDD 사이클(RED→GREEN→REFACTOR)을 개시합니다."

이어서:
1. 첫 미완료 slice의 test target 파일 경로 확인
2. RED: 실패 테스트 작성 (Write)
3. RED 검증: Bash로 테스트 실행 → FAIL 확인
4. GREEN: 최소 구현
5. GREEN 검증
6. REFACTOR
7. Sensor 검증
8. Slice Review
9. Receipt 생성

"시작할까요?" 같은 추가 확인 금지.

**금지**: 이 선언과 RED 테스트 Write 전에 plan 요약, slice 목록, 완료 메시지를 출력하지 마라.

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

## Section 2.1: Delegate Solo Path (v6.4.0)

`execution_mode == "delegate"` AND `team_mode == "solo"` 인 경우.

### Slice Cluster 추출

File-ownership 기반:
- 동일 파일을 수정하는 slice는 같은 cluster
- 파일 overlap 없는 slice는 독립 cluster

Solo는 **모든 cluster를 단일 agent에 순차 위임**:

```
Agent(
  subagent_type="deep-work:implement-slice-worker",
  model=state.model_routing.implement,   // default "sonnet"
  prompt="cluster_ids=[C1,C2,...,Cn]; sequential;" +
         "work_dir=<$WORK_DIR>; plan_path=<$WORK_DIR/plan.md>;" +
         "delegation_snapshot=<hash>;" +
         "tdd_mode=<state.tdd_mode>;" +
         "evaluator_model=<state.evaluator_model>"
)
```

### Union scope

Agent의 out-of-scope guardrail은 "union of all assigned clusters' declared scopes" (spec §5.3). Solo는 cluster_ids 의 모든 cluster.files 의 union이 허용 범위.

### 반환 처리

Agent 반환 후 §Section 2.3 (verify-receipt + Rollback Protocol)으로 이동.

## Solo Slice Loop

각 미완료 slice (`- [ ]`)에 대해:

### Step A: Activate Slice

1. `git_before_slice` = `git rev-parse HEAD`  (v6.4.0: renamed from `git_before` for consistency with delegate path — spec §5.3, N1)
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

per-slice diff: `git diff $git_before_slice -- [slice files]`

**Stage 1 — Spec Compliance** (Required):
- Agent(evaluator_model): diff + spec_checklist + contract 검증
- FAIL → 수정 + GREEN 확인 + 센서 재실행 (max 2 retries)

**Stage 2 — Code Quality** (Advisory):
- Agent(evaluator_model): diff + Architecture Decision 검증
- Critical finding → 수정 (max 1 retry)

### Step D: Receipt 수집

slice 종료 직전 (spec 검증 + slice review 완료 후):
- `git_after_slice` = `git rev-parse HEAD`

`$WORK_DIR/receipts/SLICE-NNN.json` 생성 — 필수 필드 (v6.4.0 per-slice baseline schema):
- **status** (필수): "complete" | "blocked"
- **tdd**:
  - `state_transitions`: ["PENDING", "RED_VERIFIED", "GREEN", "SENSOR_CLEAN"] 등
  - **`red_verification_output`** (v6.4.0 필수, N1/W8): RED 단계 verification_cmd의 FAIL 출력 전문. "ok"/"pass" 같은 trivial 값 금지
- **git_before_slice**, **git_after_slice** (v6.4.0 필수, F1): 이 slice만의 baseline pair
- **changes.git_diff**: `git diff git_before_slice..git_after_slice` 출력
- sensor_results, spec_compliance, slice_review, harness_metadata
- slice_confidence: done | done_with_concerns + concerns 배열

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

## Section 2.2: Delegate Team Path (v6.4.0)

`execution_mode == "delegate"` AND `team_mode == "team"` 인 경우.

### env var check + AskUserQuestion

```bash
env_var=$(echo "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-}")
```

- env_var 비어있음 → AskUserQuestion 생략, 안내 메시지 후 복수 Subagent 경로로 자동 진입:
  ```
  [info] CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 미설정 —
         Agent Team 대신 복수 Subagent 병렬 위임으로 진행합니다.
  ```
- env_var 설정됨 → **AskUserQuestion tool invocation** (W3 — concrete API format):

```json
AskUserQuestion({
  "questions": [{
    "question": "Implement team 위임 방식을 선택하세요.",
    "header": "Team mode",
    "multiSelect": false,
    "options": [
      {
        "label": "Agent Team",
        "description": "TeamCreate + TaskCreate 기반 (shared task list, SendMessage). env var 활성 시에만 선택 가능."
      },
      {
        "label": "복수 Subagent",
        "description": "Agent tool N번 parallel 호출. 각 subagent는 독립 컨텍스트. 권장."
      }
    ]
  }]
})
```

(N-R3 fix: header "Team mode" = 9 chars, 12자 제약 충족. 기존 "Team exec mode"는 14자로 위반했음. label 길이 1-5 단어 준수.)

### Branch A: Agent Team (env var 활성 + 사용자 선택)

기존 v6.3.x의 TeamCreate 분기를 그대로 유지 (C8 — concrete inline). 현재
`skills/deep-implement/SKILL.md:195-201`의 로직:

```
1. Cluster: file 소유권 기반 slice 그룹화 (겹침 → sequential, 독립 → parallel)
   — 이 logic은 Task 9 Section 2.1의 cluster 추출과 동일한 code path 재사용.
2. Dispatch: TeamCreate "deep-implement"
   - team_name: "deep-implement-v640"
   - 각 cluster마다 TaskCreate 생성 (subject: "Implement cluster C{n}",
     description: cluster의 slice_ids + files + TDD 규칙 + Slice Review 규칙)
   - 그룹별 Agent 스폰 — **full worker contract 필수** (CA3 fix):
       Agent(subagent_type="deep-work:implement-slice-worker",
             model=state.model_routing.implement,
             mode="bypassPermissions",  // hook이 team agent에 미적용 → Receipt 중심 검증
             prompt="cluster_id=<Ci>; cluster_ids=[slice_ids of Ci];" +
                    "work_dir=<$WORK_DIR>; plan_path=<$WORK_DIR/plan.md>;" +
                    "delegation_snapshot=<hash>;" +
                    "tdd_mode=<state.tdd_mode>;" +
                    "evaluator_model=<state.evaluator_model>")
3. Collect: 모든 Task 완료 알림 수신 → 모든 receipt 수집
   - Section 2.3 verify-delegated-receipt.sh가 precondition으로 실행.
4. Shutdown: SendMessage shutdown_request → TeamDelete.
```

중요: Agent Team의 agent에도 hook 미적용이므로, verify-delegated-receipt는 Branch B와 동일하게 Section 2.3 precondition으로 실행됨. regression 없음.

### Branch B: 복수 Subagent (기본 경로)

1. Cluster 독립성 map 계산:
   - 독립 cluster 쌍 → parallel Agent 호출
   - 의존 cluster 쌍 → sequential (같은 agent에 묶거나 순차)
2. 각 independent cluster에 대해 Agent 호출을 단일 메시지에 parallel 실행.
   **full worker contract 필수** (CA3 fix — Section 2.1 Solo와 동일 구조):
   ```
   Agent(subagent_type="deep-work:implement-slice-worker",
         model=state.model_routing.implement,
         prompt="cluster_id=<Ci>; cluster_ids=[slice_ids of Ci];" +
                "work_dir=<$WORK_DIR>; plan_path=<$WORK_DIR/plan.md>;" +
                "delegation_snapshot=<hash>;" +
                "tdd_mode=<state.tdd_mode>;" +
                "evaluator_model=<state.evaluator_model>")
   Agent(subagent_type="deep-work:implement-slice-worker", ...)  // same contract for each independent cluster
   ```
3. 모든 Agent 완료 후 Section 2.3 로 이동.

### Partial failure (W4)

일부 agent timeout/fail 시 §7.1 "Parallel subagent의 partial timeout" 규칙:
- AskUserQuestion: 실패한 cluster만 / 전체 / 수동 / abort.

## Section 2.3: verify-receipt + Rollback Protocol (v6.4.0)

### 전제

Sections 2.1 (solo delegate) 또는 2.2 (team delegate) 완료 직후. Phase Review Gate 진입 **직전** precondition으로 실행.

### verify-delegated-receipt.sh 실행

```bash
state_file=".claude/deep-work.${SESSION_ID}.md"
receipts_dir="${WORK_DIR}/receipts"
plan_path="${WORK_DIR}/plan.md"

bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/verify-delegated-receipt.sh" \
     "$state_file" "$receipts_dir" "$plan_path"
rc=$?
```

### Pass 경로

`rc == 0` → state의 `delegation_snapshot`을 null로 clear (Edit tool로 해당 라인만 교체; C-1.1 fix) → Phase Review Gate 진입 → state 업데이트 → Exit Gate.

### Fail 경로 (§5.6a Rollback Protocol)

`rc != 0` → AskUserQuestion:

```
options = [
  "재위임 (git reset --hard <delegation_snapshot>, receipts 제거 후 재위임)",
  "수동 수정 (rollback 없이 main session이 해당 cluster 인계 — inline takeover)",
  "abort (아무 정리 없이 세션 종료)"
]
```

#### "재위임" 선택 시

hash는 **state YAML에 기록된** `delegation_snapshot`에서 읽는다 (C-1.1 — 메모리 only가 아닌 persist 된 값이므로 resume 후에도 정확한 값 확보):

```bash
snapshot_hash=$(awk '/^delegation_snapshot:/ {gsub(/["'\'']/, "", $2); print $2; exit}' "$state_file")
git reset --hard "$snapshot_hash"
rm -f "${WORK_DIR}/receipts"/SLICE-*.json
```

그 후 Section 2.1 또는 2.2 경로로 재진입. (새 delegation은 새로 capture한 snapshot을 다시 state에 기록하므로 idempotent.)

#### "수동 수정" 선택 시 (inline takeover)

- `active_cluster_takeover: "<cluster_id>"` state 필드 기록 (중단 후 resume 대비)
- main session이 Solo Slice Loop 로직으로 해당 cluster 구현 (TDD hook 정상)
- 완료 후 `active_cluster_takeover` clear, 다음 cluster는 다시 decide_execution_mode 결과에 따름

#### "abort" 선택 시

세션 종료. state의 `delegation_snapshot`은 **그대로 남긴다** (W-5.3 fix) — 그 값이 non-null이면 `/deep-resume` 시 Section 2.3 Resume 분기가 Rollback Protocol AskUserQuestion을 다시 표시한다. 사용자는 worktree 상태를 수동 검토 후 resume 할 수 있다.

(abort가 state를 완전히 clean하게 두면 resume이 verify 결과를 잃어버려 무한 루프에 빠짐 — delegation_snapshot을 pending signal로 유지해 명시적으로 재진입 가능.)

### inline 경로에서의 부분 verify-receipt

Section 1.5 `execution_mode == "inline"` 경로도 Phase Review Gate 직전에 verify-delegated-receipt를 실행하되, **item 5/6/7/8만 precondition**으로 평가 (item 1-4는 hook이 real-time으로 강제). 구현: Task 5의 runner JS에 `--skip-items=1,2,3,4` 플래그 추가, 그리고 inline 경로에서 해당 플래그로 스크립트 호출:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/verify-delegated-receipt.sh" \
  --skip-items=1,2,3,4 \
  "$state_file" "$receipts_dir" "$plan_md_path"
```

item 별 역할:
- item 5: out-of-scope 편집 탐지 (hook의 edit 차단 이외 이중 안전망)
- item 6: baseline chain — inline Solo Slice Loop이 `git_before_slice`/`git_after_slice` 기록 필수 (Task 7.5)
- item 7: red_verification_output 기록 필수
- item 8: 기록된 verification_output vs expected_output 비교 (shell 실행 없음)

### Resume with `--exec` override 또는 takeover 분기 (C4, C-1.1)

`/deep-resume` 시 Section 1.5 진입 전에 다음 순서로 체크:

```
# 최우선: delegation_snapshot이 set되어 있고 implement가 미완료 → verify-receipt fail 후 interrupt된 케이스
if state.delegation_snapshot is not null and state.implement_completed_at is null:
    # C-1.1 fix — Rollback Protocol AskUserQuestion을 재표시
    # (재위임 / 수동 수정 / abort 중 선택, §2.3 Fail 경로와 동일)
    re_present_rollback_askuserquestion(state.delegation_snapshot)
    # 사용자 선택에 따라 Section 2.1/2.2 재진입 or inline takeover or abort

elif state.active_cluster_takeover != null:
    # 이전 세션이 debug takeover 도중 중단
    # → 해당 cluster를 inline으로 이어 진행 (TDD hook 정상)
    execute_cluster_inline(state.active_cluster_takeover)
    state.active_cluster_takeover = null  # 완료 후 clear
    # 다음 cluster는 다시 decide_execution_mode에 따름

elif receipts_dir has complete receipts from prior session:
    # 완료된 slice는 item 5/6/7/8만 부분 검증 (이미 수용된 산출물)
    # 미완료 slice만 새 경로(현재 execution_mode)로 실행
    verify-delegated-receipt.sh --skip-items=1,2,3,4 --only-completed
    delegate_or_inline_remaining_slices()
```

구현 세부:
- Task 5의 runner에 `--only-completed` 플래그 추가 — `status: "complete"` 만 골라 검증.
- deep-implement Section 1의 Resume Detection 이 `delegation_snapshot` / `active_cluster_takeover` 필드를 읽어 분기 우선순위 결정.
- `delegation_snapshot`은 delegate 진입 직전에 state에 persist, verify-receipt pass 시 null로 clear. 따라서 resume 시 이 필드가 non-null이면 "fail 후 interrupt" 신호.

## Phase Review Gate

> **Precondition (v6.4.0)**: Section 2.3 verify-receipt가 pass해야 이 단계에 도달한다. Fail 시 §5.6a Rollback Protocol이 이 단계를 우회한다.

모든 slice 완료 후, Test 전환 전:
Read("../shared/references/phase-review-gate.md") — 프로토콜 실행:
- Phase: implement
- Document: 구현된 코드 전체 (git diff)
- Self-review: 계획 충실도, 크로스 슬라이스 일관성, 미구현 항목

상세: Read("../shared/references/implementation-guide.md")

# Section 3: 완료

> **실행 순서 안전장치**: 이 섹션은 plan.md의 모든 slice(또는 spike 모드의 의도된 subset)의 TDD cycle, sensor 검증, Slice Review, Phase Review Gate를 **모두 실제로 수행**한 뒤에만 실행한다.

1. 모든 receipt 검증: `$WORK_DIR/receipts/SLICE-*.json` 존재 확인
2. State 업데이트:
   - `implement_completed_at`: current ISO timestamp
   - `phase_review.implement`: `{reviewed, reviewers, self_issues, external_issues, resolved}`
   - `review_state: completed`
   - **`current_phase`는 변경하지 않는다.** Orchestrator가 Exit Gate "진행" 분기에서 `test`로 전환.
3. 완료 메시지:
   ```
   구현 완료! 테스트 단계로 진입합니다.
   완료 slice: N/N
   TDD 준수율: [strict: N, relaxed: N, override: N, spike: N]
   Receipt 완성: N/N
   ```
4. 알림: `notify.sh "$STATE_FILE" "implement" "completed"`
