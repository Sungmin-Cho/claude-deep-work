---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Phase 3: Implement the approved plan using slice-based TDD execution"
---

# Phase 3: Deep Implementation (v4.0 Evidence-Driven Protocol)

You are in the **Implementation** phase of a Deep Work session.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Critical Constraints

✅ **Follow the plan EXACTLY. Do not deviate.**
✅ **TDD is mandatory**: Write failing test BEFORE production code (unless exempt or spike mode).
🚫 **Do NOT add features not in the plan.**
🚫 **Do NOT modify files outside the active slice's scope** (warning or block depending on config).
⚠️ **If you encounter a bug, enter debug mode** — do NOT guess at fixes.

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

## Instructions

### 1. Verify prerequisites

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `$STATE_FILE`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` and verify:
- `current_phase` is "implement"
- `plan_approved` is true

Extract `work_dir`, `team_mode`, `tdd_mode`, `active_slice`, `tdd_state` from state file.
Defaults: `work_dir=deep-work`, `team_mode=solo`, `tdd_mode=strict`, `active_slice=""`, `tdd_state=PENDING`.

**Record start time**: Update `implement_started_at` in the state file.

### 2. Load plan and parse slices

Read `$WORK_DIR/plan.md` and parse the **Slice Checklist** section. Each slice has:

```
- [ ] SLICE-NNN: [Goal]
  - files: [file1, file2]
  - failing_test: [test file — test description]
  - verification_cmd: [command to verify]
  - expected_output: [optional — what success looks like]
  - spec_checklist: [req1, req2]
  - contract: [criterion1, criterion2]
  - acceptance_threshold: all
  - size: S/M/L
  - steps: [optional — execution guidance for M/L slices]
```

Build a list of slices with their metadata. New fields (`expected_output`, `steps`) are optional for backward compatibility with older plan formats.

**Inline slice handling (v5.1)**: If the plan was generated inline (state file `skipped_phases` includes "plan"):
- The plan will have a single SLICE-001 with potentially empty `failing_test`
- `failing_test` can be determined during implementation — the TDD cycle will prompt for it
- Contract and spec_checklist may be minimal — proceed without contract negotiation

### 3. Resume detection

Check for already completed slices (`- [x]`). If any exist:

```
이전 구현 진행 상황 감지:
   완료: [N]개 / 전체: [M]개
   마지막 완료: SLICE-[K]: [description]
   미완료 slice부터 이어서 진행합니다.
```

### 4. Model routing check

Read `model_routing.implement` from state file (default: "auto").

**Routing modes:**

**If "main"**: Use the current conversation's model (no subagent delegation). Proceed with inline execution below.

**If a specific model name** (e.g., "sonnet", "haiku", "opus"): Use that model for ALL slices. Skip to Agent delegation below.

**If "auto"** (v4.1 default — size-based routing):

1. For each slice, read its `size` field from plan.md (default if unspecified: `M`).

2. Look up the routing table. Default table (customizable via preset `routing_table`):

   | Slice Size | Model | Rationale |
   |-----------|-------|-----------|
   | S (Small) | haiku | Simple config, 1-2 files, boilerplate |
   | M (Medium) | sonnet | Standard feature, 3-5 files |
   | L (Large) | sonnet | Complex feature, 5+ files |
   | XL (Extra-Large) | opus | Architecture change, 10+ files |

   **Size 결정 주체**: `/deep-plan`에서 사용자가 직접 지정. 미지정 시 기본값 `M`.

3. Check for user override: if the state file has `model_override` for the active slice, use that instead.

4. Validate model name: if the resolved model name is not one of `haiku`, `sonnet`, `opus`, warn and fallback to `sonnet`.

5. Display:
   ```
   모델 자동 선택: [model] (슬라이스 크기: [size])
      Override: /deep-slice model SLICE-NNN [model]
   ```

**Agent delegation** (for non-"main" modes):

If `team_mode` is "solo" and model is not "main":
- Spawn delegated Agent with `model` parameter and `mode: "bypassPermissions"`
- **CRITICAL**: Include TDD rules in the agent prompt (hooks don't apply to delegated agents):
  ```
  ⚠️ TDD 강제 규칙 (반드시 준수):
  1. 각 slice에서 반드시 failing test를 먼저 작성하세요
  2. test가 실패하는 것을 확인한 후에만 production 코드를 수정하세요
  3. production 코드 수정 후 test가 통과하는 것을 확인하세요
  4. receipt 데이터를 $WORK_DIR/receipts/SLICE-NNN.json에 기록하세요
  5. exempt 파일 (*.yml, *.md, *.json)은 TDD 없이 수정 가능합니다
  6. receipt에 harness_metadata를 포함하세요 (model_id, rework_count, tests_passed_first_try, bugs_caught_in_red_phase 등)

  ⚠️ Slice Review 강제 규칙 (반드시 준수):
  7. 각 slice GREEN + sensor 통과 후, self-review를 실행하세요:
     - Spec Review: git diff $git_before -- [files]를 읽고, spec_checklist/contract 항목을
       하나씩 검증. 미충족 발견 시 수정 후 재검증 (최대 2회).
     - Quality Review: 같은 diff를 읽고 error handling, naming, DRY, type safety, test quality 검증.
       Critical 발견 시 수정 (최대 1회).
  8. Review 결과를 receipt의 slice_review 필드에 기록하세요.
     slice_review.mode는 "self"로 설정하세요 (independent subagent가 아닌 self-review임을 표시).
  9. Slice 시작 전 Pre-flight: files 존재, verification_cmd 실행 가능 여부 확인.
     문제 발견 시 done_with_concerns로 기록하거나, 심각하면 즉시 보고하세요.
  10. Slice 완료 시 slice_confidence 판정: done / done_with_concerns.
     concerns가 있으면 반드시 구체적 사유를 기록하세요.
  ```
- Set 10-minute timeout per slice. On timeout: abort, rollback slice to PENDING, warn user.
- After Agent completion: validate receipt JSON structure. If corrupt, warn and mark slice for re-execution.
- Record in slice receipt: `model_used`, `model_auto_selected: true/false`, `model_override_reason`
- After all slices: verify receipts and plan.md integrity
- Skip to [Final: Transition to Test](#final-transition-to-test)

If "main": proceed with inline execution below.

---

### Topology Guides

Before each slice implementation, load the session's detected topology template and inject `guides.phase3` as implementation guidelines. These are **Advisory** — inform the agent's decisions but do not block.

If topology was detected in Phase 1, the guides are available in session state. Otherwise, run detection: `node templates/topology-detector.js <project-root>`

Example:
```
[TOPOLOGY GUIDES] Next.js App Router:
  - Minimize 'use client' — prefer Server Components by default
  - Use Server Actions for mutations over API routes
  - Keep layout.tsx and page.tsx focused — extract shared logic to lib/
```

---

## Slice Execution Loop (Solo Mode)

For each unchecked slice (`- [ ]`), execute the following cycle:

### Step A: Activate Slice

1. Capture `git_before` hash: `git rev-parse HEAD 2>/dev/null`
2. Update `$STATE_FILE`:
   - `active_slice: SLICE-NNN`
   - `tdd_state: PENDING`
3. Read worktree state: if `worktree_enabled` is true, set `worktree_branch` for receipt
4. Determine model: if routing mode is "auto", lookup slice size from plan.md
5. Display:
   ```
   🔷 SLICE-NNN 시작: [Goal]
      파일: [file1, file2]
      TDD 모드: [strict/relaxed/coaching/spike]
      Contract: [N]개 항목 (threshold: [all/majority])
   ```

### Step A-2: Pre-flight Check

Before starting TDD, verify this slice's prerequisites are met:

1. Check each file in the slice's `files` list:
   - The slice checklist does not always encode Create/Modify explicitly. Heuristic: if the file exists → treat as Modify (OK). If the file does not exist → treat as Create (OK, skip check). Only flag an issue if a file path looks malformed or its parent directory does not exist and cannot be created.
2. Check `failing_test` path: if non-empty, verify the test file's parent directory exists or can be created. Empty `failing_test` (e.g., inline plans) is allowed — skip this check.
3. Check `verification_cmd`: extract the first token (command name) and verify it's executable with `command -v [first_token]`. Do NOT run the full command or use `--help`/`--version` (may produce false failures with commands like `npm test -- --grep`).

**All checks pass** → proceed to Step B (no log, no message, completely transparent).

**Any check fails** → AskUserQuestion:

```
⚠️ SLICE-NNN Pre-flight 이슈:
   - [구체적 문제: e.g., "src/auth/oauth.ts가 존재하지 않습니다"]

선택:
1. 계속 진행 (문제를 인지하고 구현 시도)
2. Plan 수정 필요 (implement 중단)
```

**선택 1**: Record `preflight.user_override: true` in receipt, set `slice_confidence: "done_with_concerns"` (reserved), proceed to Step B.
**선택 2**: Set `current_phase: plan` in state file. Display "Plan 단계로 복귀합니다." and stop implementation.

> 참고: 이전 슬라이스와의 전제 충돌 감지는 자동화가 어려우므로 Pre-flight에서 제외. 이 문제는 Slice Review Stage 1에서 per-slice diff를 통해 간접적으로 감지된다.

### Step B: TDD Cycle (RED → GREEN → REFACTOR)

**If `tdd_mode` is "strict" or "coaching":**

#### B-1. RED: Write Failing Test

1. Read the slice's `failing_test` field. If it contains actual test code (M/L slices may include function signatures or complete test bodies), use that code directly instead of writing from scratch.
2. If the slice has a `steps` field, follow the step sequence — but the TDD state machine (RED→GREEN→REFACTOR) always takes precedence over step ordering.
3. Create or update the test file with a test that should FAIL
4. Run the test: execute `verification_cmd`
5. **Verify it fails for the RIGHT reason** (feature missing, not syntax error)
5. Capture the failing test output (last 200 lines)
6. **[필수] State file 업데이트**: `tdd_state: RED_VERIFIED`
   ⚠️ 이 업데이트를 수행하지 않으면 phase guard가 이후 모든 production 코드 편집을 차단한다.
   State file(`.claude/deep-work.*.md`)은 `.md` 파일이므로 phase guard의 config 파일 예외에 해당하여 항상 편집 가능하다.
7. Update receipt: `tdd.failing_test_output` + `tdd.failing_test_timestamp`

```
🔴 RED: Failing test 작성 완료
   테스트: [test description]
   결과: FAIL ✓ (올바른 이유로 실패)
```

**Coaching mode addition**: If `tdd_mode` is "coaching":
```
좋습니다! failing test를 먼저 작성했습니다.
   이제 최소한의 코드로 이 테스트를 통과시켜 보세요.
   팁: 불필요한 코드를 추가하지 말고, 테스트를 통과시키는 데 필요한 것만 작성하세요.
```

#### B-2. GREEN: Write Minimal Production Code

1. Implement the change — **minimal code to pass the test**
2. Only modify files listed in the slice's `files` field
3. Run `verification_cmd` again
4. **Verify ALL tests pass** (not just the new one). If the slice has an `expected_output` field, compare the actual output against it to confirm the tests pass for the right reason (not a false positive).
5. Capture passing test output
6. **[필수] State file 업데이트**: `tdd_state: GREEN`
   ⚠️ 이 업데이트를 수행하지 않으면 다음 slice 시작 시 phase guard가 차단한다.
7. Update receipt: `tdd.passing_test_output` + `tdd.passing_test_timestamp`

```
🟢 GREEN: 테스트 통과!
   통과: [N]/[N] tests
```

#### B-3. SENSOR_RUN: Computational Sensor Verification

> **Mode gate**: spike mode → skip entirely (proceed to B-4). All other modes: execute.

After GREEN, check `sensor_pending` flag in state file. If set:

**B-3 Pre-check**: Read sensor detection cache from session state. If empty or `sensor_cache_valid=false`, re-run detection:
```bash
node "$PLUGIN_DIR/sensors/detect.js" "$PROJECT_ROOT"
```
Cache results in session state.

**B-3 Sensor selection**: From `file-changes.log`, identify changed file extensions. Select only matching ecosystems' sensors.

**B-3 Execution order** (fast-fail):

1. **Linter** (timeout: 30s):
   ```bash
   node "$PLUGIN_DIR/sensors/run-sensors.js" "<lint_cmd>" "<parser>" "lint" "required" 30
   ```
2. **Type checker** (timeout: 60s):
   ```bash
   node "$PLUGIN_DIR/sensors/run-sensors.js" "<typecheck_cmd>" "<parser>" "typecheck" "required" 60
   ```
3. **Coverage**: parse piggybacked `--coverage` output from GREEN test run (advisory only — does not block)

**On required sensor failure** → enter B-3a SENSOR_FIX.
**On all sensors pass** → update `tdd_state: SENSOR_CLEAN`, clear `sensor_pending`, record `sensor_results` in receipt.
**On all sensors not_applicable** (no sensors installed) → skip directly to B-4 REFACTOR.

**Mode-specific behavior**:
- **strict / coaching**: required sensors block progression (normal path above)
- **relaxed**: SENSOR_RUN executes but required sensor failures are treated as advisory (no blocking; log and continue)
- **spike**: SENSOR_RUN is skipped entirely — GREEN → B-4 REFACTOR directly

#### B-3a. SENSOR_FIX: Self-Correction Loop

1. Update `tdd_state: SENSOR_FIX`
2. Present agent-readable FIX feedback (from `formatFeedback`):
   ```
   [SENSOR_FIX] Round <N>/3 — <sensor_type> failures detected
   FILE: <path>:<line>
     RULE: <rule_id>
     MESSAGE: <message>
     FIX: <suggestion>
   ```
3. Agent fixes code → re-runs tests → verifies GREEN → re-runs sensors
4. Increment `sensor_correction_round` counter (max 3)
5. **If fix breaks tests** → set `tdd_state: RED` → restart TDD from B-1
6. **If 3 rounds exceeded** → record remaining errors in receipt under `sensor_results.unresolved`, emit warning, set `tdd_state: SENSOR_CLEAN`, proceed to B-4

### Sensor Pipeline (Extended with review-check)

After GREEN, run sensors in order. Each sensor has an **independent 3-round correction limit**:

1. **lint** — shell command via `run-sensors.js runSensor`. Rounds: 0/3
2. **typecheck** — shell command via `run-sensors.js runSensor`. Rounds: 0/3
3. **review-check** — JS function via `review-check.js`. Rounds: 0/3

review-check is a JS function, not a shell command. Execute it by running:
```bash
node -e "
  const { runReviewCheck, formatReviewCheckFeedback } = require('./sensors/review-check.js');
  const result = runReviewCheck(process.cwd(), { topology: 'DETECTED_TOPOLOGY' });
  if (result.status === 'completed' && result.violations.length > 0) {
    console.log(formatReviewCheckFeedback(result, 'SLICE_NAME'));
    process.exit(result.hasRequired ? 1 : 0);
  }
  console.log(JSON.stringify({ status: result.status, violations: 0 }));
"
```

**Per-sensor round tracking:**
- When a sensor fails → SENSOR_FIX → agent corrects → re-run ALL sensors from start
- Only the failing sensor's counter increments
- After 3 failures for a sensor → mark exhausted, skip to next
- SENSOR_CLEAN when all pass or all exhausted

**review-check behavior:**
- If required violations → exit 1 → SENSOR_FIX
- If advisory only → log feedback, proceed (exit 0)
- If disabled/not_applicable → skip, proceed

#### B-4. REFACTOR (optional)

1. If code can be improved while keeping tests green — refactor
2. Run `verification_cmd` after each refactor to ensure tests still pass
3. Update state: `tdd_state: REFACTOR`

**If `tdd_mode` is "relaxed":**
- Skip B-1 (RED). Implement directly, then run verification.
- Still capture test output for receipt.

**If `tdd_mode` is "spike":**
- No TDD enforcement. Implement freely.
- Mark receipt with `tdd_state: SPIKE`
- **⚠️ Spike code is NOT merge-eligible** — displayed in receipt dashboard

### Step C: Spec Checklist Verification

After GREEN (or after implementation in relaxed/spike mode):

1. Go through each item in the slice's `spec_checklist`
2. Verify each requirement is met
3. Update receipt: `spec_compliance.checklist` with true/false per item

```
Spec Checklist:
   ✅ [requirement 1]
   ✅ [requirement 2]
   ❌ [requirement 3] — [reason]
```

If any spec item fails: fix it (another RED→GREEN cycle if in strict mode).

### Step C-1: Contract Verification (v5.1)

If the active slice has a `contract` field:

1. Go through each contract item
2. Verify each item is satisfied by the implementation
3. Update receipt: `contract_compliance.items` with true/false per item
4. Display:
   ```
   Contract:
      ✅ "POST /login → 200 + { token: string }" — PASS
      ✅ "invalid token → 401" — PASS
      ❌ "expired token → 401" — FAIL (returns 500)
   ```
5. If `acceptance_threshold` is `all` and any item fails: fix it (another RED→GREEN cycle)
6. If `acceptance_threshold` is `majority` and > 50% pass: proceed with warning

### Step C-2: Slice Review (Built-in 2-Stage Independent Review)

> **Mode gate**: spike mode → skip entirely (set `slice_review.skipped: true`, `skip_reason: "spike_mode"`, `slice_confidence: "done_with_concerns"`, `concerns: ["spike mode — no slice review performed"]`). relaxed mode → Stage 1 only, skip Stage 2.

After sensor pipeline passes (SENSOR_CLEAN) and spec/contract checklist verification (Step C/C-1), run independent 2-stage review.

#### Per-Slice Diff

Slice Review uses **per-slice diff** against the working tree (not `..HEAD`, since slices are not committed mid-loop). Capture using `git_before` from Step A:

```bash
# Slice-scoped diff (for spec/quality review)
git diff $git_before -- [slice files]

# Scope creep detection (all files changed during this slice)
git diff $git_before --name-only
```

The slice-scoped diff is the primary input for Stage 1/2 reviewers. The full `--name-only` list is compared against the slice's declared `files` to detect out-of-scope changes (scope creep). Any file not in the slice's `files` list is flagged as potential scope creep and included in the Stage 1 prompt.

#### Stage 1: Spec Compliance Review

Read `evaluator_model` from state file (default: "sonnet"). Spawn a fresh Agent (slice-spec-reviewer):

- **Model**: evaluator_model
- **Input**: plan.md slice definition (goal, spec_checklist, contract) + per-slice diff + tdd.passing_test_output from receipt + out-of-scope file list (from scope creep detection)
- **Prompt**:
  ```
  You are reviewing whether a single slice implementation matches its specification.

  CRITICAL: Do Not Trust the implementer's claims. Read the actual code (git diff)
  and verify independently against the spec_checklist and contract items.

  Check:
  - Missing requirements: spec_checklist items not reflected in code
  - Extra work: changes not in spec (scope creep). Also check the out-of-scope
    file list — any file changed but not in the slice's declared files is a red flag.
  - Misunderstandings: correct feature but wrong approach

  Return JSON: {
    result: "PASS" | "FAIL",
    missing: ["unmet spec items"],
    extra: ["out-of-scope changes"],
    misunderstandings: ["wrong interpretations"]
  }
  ```

**판정:**
- PASS → proceed to Stage 2
- FAIL → fix code within Step C-2 (do NOT return to Step B):
  1. Apply reviewer's feedback to production code
  2. Re-run `verification_cmd` to confirm GREEN still holds
  3. If GREEN breaks → set `tdd_state: RED`, return to Step B (full TDD restart)
  4. If GREEN holds → re-run sensor pipeline (code changes may break lint/typecheck)
  5. Re-run Stage 1 (max 2 retries)
  6. After 2 retries still FAIL → set `slice_confidence: "done_with_concerns"`, record concerns, proceed

**Subagent failure/timeout fallback:**
- Set `slice_review.skipped: true`, `skip_reason: "subagent_failed: [error]"`
- Set `slice_confidence: "done_with_concerns"`, `concerns: ["slice_review_spec_failed: [reason]"]`
- Skip Stage 2 as well. Proceed to Step D.

Display:
```
Slice Review Stage 1 — Spec Compliance:
   ✅ PASS: spec 3/3, contract 4/4
```
or:
```
Slice Review Stage 1 — Spec Compliance:
   ❌ FAIL: missing [item], extra [item]
   → 수정 후 재검증 (시도 1/2)
```

#### Stage 2: Code Quality Review

Spawn a fresh Agent (slice-quality-reviewer):

- **Model**: evaluator_model
- **Input**: per-slice diff + plan.md Architecture Decision + research.md Relevant Patterns
- **Prompt**:
  ```
  Review this slice's code diff for quality issues.

  Check: error handling, naming clarity, DRY violations, type safety,
  test quality (real behavior vs mock behavior), pattern consistency
  with the Architecture Decision and Relevant Patterns provided.

  Return JSON: {
    result: "PASS" | "WARN",
    findings: [{
      severity: "critical" | "important" | "suggestion",
      file: "path",
      issue: "description",
      fix: "recommendation"
    }]
  }
  ```

**판정:**
- PASS → proceed to Step D
- WARN (no critical findings) → record findings in receipt `slice_review.code_quality.findings`, proceed
- Critical finding → fix code, re-run GREEN check, re-run sensors, re-run Stage 2 (max 1 retry)
- 1 retry exceeded → set `slice_confidence: "done_with_concerns"`, record concerns, proceed

**Subagent failure/timeout fallback:**
- Same as Stage 1: skip, mark `done_with_concerns`, proceed.

Display:
```
Slice Review Stage 2 — Code Quality:
   ✅ PASS: Critical 0 | Important 1 | Suggestions 3
```

#### Slice Review Receipt Fields

Update receipt with `slice_review` namespace (separate from Phase 4's `spec_compliance`/`code_review`):

```json
{
  "slice_review": {
    "spec_compliance": {
      "result": "PASS",
      "missing": [],
      "extra": [],
      "misunderstandings": [],
      "retries": 0
    },
    "code_quality": {
      "result": "PASS",
      "findings": [],
      "retries": 0
    },
    "skipped": false,
    "skip_reason": null,
    "mode": "independent"
  }
}
```

`mode` is `"independent"` for inline execution (main model) or `"self"` for agent delegation.

#### Step D-1: Confidence Judgment

Automatically determine `slice_confidence` based on the completed slice's execution history (no user interaction):

| slice_confidence | Condition |
|-----------------|-----------|
| `done` | spec PASS + quality PASS/WARN + no pre-flight issues + no TDD override + sensor fix rounds < 3 |
| `done_with_concerns` | Any of: spec review retried 2+ times, quality review had critical finding, pre-flight user_override, TDD override used, sensor fix 3 rounds exhausted, slice_review skipped (fallback) |

Update the receipt's `slice_confidence` and `concerns` fields accordingly. If `done_with_concerns`, populate `concerns` array with specific reason strings.

**spike mode default**: `slice_confidence: "done_with_concerns"`, `concerns: ["spike mode — no slice review performed"]`

#### deep-review 슬라이스 리뷰 제안 (선택적)

deep-review 플러그인 설치 확인:
```bash
ls "$HOME/.claude/plugins/cache/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null || \
  ls "$HOME/.claude/plugins/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null
```
설치되지 않은 경우 이 섹션을 건너뜀 (silent skip).

**설치된 경우:** `.deep-review/contracts/SLICE-{현재 슬라이스 NNN}.yaml`이 존재하면:
- 사용자에게 제안: "✅ SLICE-{NNN} Slice Review 완료. 추가 심층 리뷰가 필요하면 /deep-review --contract SLICE-{NNN}를 실행할까요?"
- 수락 시: `/deep-review --contract SLICE-{NNN}` 실행
- 거부 시: 다음 슬라이스로 진행
- deep-review 미설치 또는 contract 미존재: 건너뜀 (silent skip)

이 제안은 비용이 발생하므로 (Opus 서브에이전트) 항상 사용자 확인을 받는다.

### Step D: Collect Receipt

Update `$WORK_DIR/receipts/SLICE-NNN.json`:

```json
{
  "schema_version": "1.0",
  "slice_id": "SLICE-NNN",
  "goal": "[slice goal from plan.md]",
  "status": "complete",
  "tdd_state": "GREEN",
  "tdd_mode": "[strict/relaxed/coaching/spike]",
  "model_used": "[haiku/sonnet/opus/main]",
  "model_auto_selected": true,
  "model_override_reason": null,
  "estimated_cost": null,
  "worktree_branch": "[dw/slug or empty]",
  "git_before": "[commit hash before slice]",
  "git_after": "[commit hash after slice]",
  "tdd": {
    "failing_test_output": "[last 200 lines]",
    "failing_test_timestamp": "[ISO]",
    "passing_test_output": "[last 200 lines]",
    "passing_test_timestamp": "[ISO]"
  },
  "changes": {
    "git_diff": "[output of git diff for slice files]",
    "files_modified": ["file1", "file2"],
    "lines_added": N,
    "lines_removed": N
  },
  "verification": {
    "lint_output": "[if available]",
    "typecheck_output": "[if available]",
    "full_test_suite": "PASS (N/N)"
  },
  "sensor_results": {
    "lint": { "status": "pass|fail|not_applicable|timeout", "errors": 0, "warnings": 0 },
    "typecheck": { "status": "pass|fail|not_applicable|timeout", "errors": 0, "warnings": 0 },
    "coverage": { "status": "pass|advisory|not_applicable", "pct": null },
    "sensor_correction_rounds": 0,
    "unresolved": []
  },
  "spec_compliance": {
    "checklist": { "req1": true, "req2": true },
    "reviewer_result": null
  },
  "code_review": { "reviewer_result": null, "findings": [] },
  "debug": null,
  "harness_metadata": {
    "model_id": "[model identifier, e.g. claude-opus-4-6]",
    "assumption_overrides": [
      {"assumption_id": "[id from assumptions.json]", "action": "override", "reason": "[reason]"}
    ],
    "rework_count": 0,
    "tests_passed_first_try": true,
    "review_defects_found": 0,
    "research_references_used": 0,
    "cross_model_unique_findings": 0,
    "bugs_caught_in_red_phase": 0
  },
  "slice_confidence": "done",
  "concerns": [],
  "preflight": {
    "passed": true,
    "issues": [],
    "user_override": false
  },
  "timestamp": "[ISO]"
}
```

Capture git diff and `git_after` hash:
```bash
git diff $git_before -- [file1] [file2]
git rev-parse HEAD 2>/dev/null  # → git_after
```

**Collect `harness_metadata`** (v5.0 — optional, backward-compatible):

Populate `harness_metadata` by aggregating data from the current slice execution. If a field cannot be determined, use the default value. Old receipts without `harness_metadata` remain valid.

| Field | How to collect | Default |
|-------|---------------|---------|
| `model_id` | Model identifier used for this slice (from model routing or `"main"` if inline) | `"unknown"` |
| `assumption_overrides` | Array of overrides during this slice. Each TDD override (Step B skip) → `{"assumption_id": "tdd_required_before_implement", "action": "override", "reason": "[config_change\|untestable\|urgent_fix]"}`. Empty array if no overrides. | `[]` |
| `rework_count` | Number of times this slice returned to RED after a failed GREEN attempt (Step B-2 failure → Debug Sub-Mode → re-enter TDD cycle) | `0` |
| `tests_passed_first_try` | `true` if verification_cmd passed on the first GREEN attempt (no rework, no debug sub-mode entry) | `true` |
| `review_defects_found` | Count of findings from `code_review.findings` array for this slice | `0` |
| `research_references_used` | Count of research findings from `$WORK_DIR/research.md` explicitly referenced during implementation of this slice | `0` |
| `cross_model_unique_findings` | Count of unique issues found by cross-model review (from `{phase}-review.json` if it exists) for this slice | `0` |
| `bugs_caught_in_red_phase` | Count of real bugs discovered because the RED test failed for the right reason (test exposed a pre-existing defect, not just "feature not implemented yet") | `0` |

**Note**: `session-receipt.json`은 `/deep-finish`에서 생성됩니다 (derived cache — slice receipts가 canonical source).

### Step E: Mark Complete & Advance

1. Update plan.md: `- [ ] SLICE-NNN` → `- [x] SLICE-NNN`
2. Update state: `active_slice: ""`, `tdd_state: PENDING`
3. Update receipt: `slice_receipts.SLICE-NNN: complete`
4. Display:
   ```
   ✅ SLICE-NNN 완료: [Goal]
      TDD: RED → GREEN ✓
      Receipt: receipts/SLICE-NNN.json ✓
      진행률: [completed]/[total] slices
   ```
5. Proceed to next unchecked slice

---

## TDD Override (차단 시 대화형 건너뛰기)

**조건**: `model_routing.implement`이 "main"이고, `tdd_mode`가 "strict" 또는 "coaching"일 때만 적용.
Agent 위임 모드에서는 이 섹션을 건너뛰세요 (hook이 적용되지 않으므로 override 불필요).

TDD 강제로 인해 Write/Edit가 차단된 경우 (hook이 차단 메시지를 반환한 경우):

### 1. 차단 감지

hook 차단 메시지에 "TDD 강제" 또는 "TDD 코칭"이 포함되어 있으면 이 섹션을 따릅니다.

### 2. 사용자에게 질문

AskUserQuestion을 호출하여 사용자의 선택을 받습니다:

```
TDD가 이 수정을 차단했습니다.
파일: [차단된 파일 경로]
TDD 상태: [현재 tdd_state]

어떻게 진행할까요?
```

선택지:
- A) 테스트 먼저 작성 (권장) — TDD 사이클대로 진행
- B) TDD 건너뛰기 - config/설정 파일 수정
- C) TDD 건너뛰기 - 테스트 작성이 불가능한 코드
- D) TDD 건너뛰기 - 긴급 수정

### 3. 선택에 따른 처리

**A) 테스트 먼저 작성**: TDD 사이클(Step B)로 돌아가서 정상 진행.

**B/C/D) TDD 건너뛰기**:

1. `$STATE_FILE`의 `tdd_override` 필드를 현재 `active_slice` 값으로 설정:
   ```yaml
   tdd_override: "SLICE-NNN"
   ```

2. 선택한 사유를 기록 (B=config_change, C=untestable, D=urgent_fix)

3. 차단되었던 Edit/Write를 재시도 — hook이 override를 확인하고 허용

4. Slice 구현이 완료되면 (Step E) override를 해제:
   ```yaml
   tdd_override: ""
   ```

5. Receipt에 override 기록:
   ```json
   {
     "tdd_override": true,
     "tdd_override_reason": "config_change|untestable|urgent_fix",
     "tdd_override_timestamp": "[ISO]"
   }
   ```
   Also add to `harness_metadata.assumption_overrides`:
   ```json
   {"assumption_id": "tdd_required_before_implement", "action": "override", "reason": "[chosen reason]"}
   ```

### 4. 주의사항

- Override는 현재 활성 slice 범위 내에서만 유효합니다
- 다음 slice로 전환 시 override는 자동 해제됩니다
- Override된 slice는 receipt 대시보드에서 경고(override) 표시됩니다
- Override는 merge를 차단하지 않지만, TDD 없이 구현되었음을 명시합니다

---

## Debug Sub-Mode

If a test fails unexpectedly during Step B-2 (GREEN) or a previously passing test regresses:

1. Display:
   ```
   Debug 모드 진입: 예기치 않은 테스트 실패 감지
      실패 테스트: [test name]
      예상: PASS, 실제: FAIL
   ```
2. Update state: `debug_mode: true`
3. Follow the systematic debugging process (see `/deep-debug`):
   - **Investigate**: Read error output, check recent changes
   - **Analyze**: Compare with working state, identify the exact change that broke it
   - **Hypothesize**: Form ONE hypothesis about root cause
   - **Fix**: Apply minimal fix, verify
4. Record root cause in receipt: `debug.root_cause_note`
5. Update state: `debug_mode: false`
6. Resume TDD cycle

**Iron Rule**: Do NOT guess at fixes. If 3 fix attempts fail, **STOP and ask the user**.

---

## Spike Mode Guard

When exiting spike mode (switching `tdd_mode` from "spike" to "strict" or "relaxed"):

1. Stash spike code: `git stash push -m "spike: SLICE-NNN"`
2. Reset slice to PENDING: `tdd_state: PENDING`
3. Display:
   ```
   Spike 종료 — TDD 모드로 전환
      spike 코드가 git stash에 보관되었습니다.
      이제 TDD 사이클로 다시 시작하세요.
      stash 확인: git stash list
      stash 참조: git stash show -p stash@{0}
   ```

---

### Team Mode Pre-check

Before proceeding with team implementation, validate that Agent Teams is still available:

```bash
echo "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-not_set}"
```

If the result is `not_set` or empty:
```
⚠️ Agent Teams 환경변수가 비활성화되었습니다. Solo 모드로 전환합니다.
```
- Update `team_mode: solo` in `$STATE_FILE`
- Fall back to the Solo implementation flow above
- Do NOT proceed to Team Mode Implementation below

## Team Mode Implementation

For `team_mode: team`, the slice execution is distributed across agents:

### T-1. Cluster slices by file ownership
- Group slices where `files` overlap → sequential group (no parallel)
- Independent slices → parallel execution

### T-2. Create team and dispatch
- Use `TeamCreate` with team_name `deep-implement`
- Spawn agents per independent group
- Each agent gets its assigned slices + TDD rules in prompt (critical: delegated agents bypass hooks)

### T-3. Monitor, cross-review, collect receipts
- Same cross-review loop as v3.3.3
- After completion: verify all receipts exist in `$WORK_DIR/receipts/`

---

### Phase Review Gate (전체 구현 완료 후)

모든 슬라이스가 완료된 후, Test 전환 전에 Phase Review Gate를 실행한다.

> **Note:** 이 리뷰는 per-slice Slice Review(Section C-2)와 별개이다. Slice Review는 개별 슬라이스의 spec 준수를 검증하고, Phase Review Gate는 전체 구현의 계획 충실도와 크로스 슬라이스 일관성을 검증한다.

Read `references/phase-review-gate.md` and follow the protocol with:
- **Phase**: `implement`
- **Document**: 구현된 코드 전체 (git diff 기준)
- **Self-review checklist**: 계획 충실도, 크로스 슬라이스 일관성, 미구현 항목

**Phase 3 Fallback 체인 적용:**
1. deep-review 플러그인 설치 시: `/deep-review` + 셀프 리뷰 (병렬)
2. codex/gemini 설치 시: 크로스 모델 리뷰 + 셀프 리뷰 + Opus 서브에이전트 (병렬)
3. 둘 다 미설치: 셀프 리뷰 + Opus 서브에이전트 (병렬)

**사용자 확인 후:**
- "자동 수정 후 진행" 또는 "현재 상태로 진행" → Test로 자동 전환
- "상세 보기" → 항목별 수정/스킵 후 전환

**상태 업데이트:**
`phase_review.implement` 및 `review_results.implement` 필드를 모두 업데이트한다 (phase-review-gate.md Section 7 dual-write 참조).
`review_state: completed` 로 설정한다.

---

## Final: Transition to Test

After all slices are complete:

1. **Verify all receipts**: Check `$WORK_DIR/receipts/SLICE-*.json` exist for all slices
2. **Record completion**: Update `implement_completed_at`
3. **Update state**: `current_phase: test`
4. **Display**:
   ```
   ✅ 구현이 완료되었습니다. 테스트 단계로 진입합니다.

   구현 결과:
     - 완료 slice: N/N
     - TDD 준수율: [strict: N, relaxed: N, override: N, spike: N]
     - Receipt 완성: N/N
     - 디버깅 횟수: N회
     - Harness 메타데이터: [N/N receipts with harness_metadata]
   ```
5. **Send notification**
6. **Auto-execute Test phase**: Read `/deep-test` and follow all steps.

## Implementation Quality Rules

- **One slice at a time**: Complete each slice's TDD cycle fully before moving on
- **No scope creep**: If you notice something outside the plan, add to `## Issues Encountered`
- **Faithful execution**: The plan was reviewed and approved. Respect it.
- **Evidence-driven**: Every slice produces a receipt. No receipt = not done.
- **Debug, don't guess**: Unexpected failures → systematic debugging, not trial-and-error
