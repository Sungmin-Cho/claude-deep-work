---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
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

## Instructions

### 1. Verify prerequisites

Read `.claude/deep-work.local.md` and verify:
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
  - spec_checklist: [req1, req2]
  - size: S/M/L
```

Build a list of slices with their metadata.

### 3. Resume detection

Check for already completed slices (`- [x]`). If any exist:

```
🔄 이전 구현 진행 상황 감지:
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
   🧠 모델 자동 선택: [model] (슬라이스 크기: [size])
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
  ```
- Set 10-minute timeout per slice. On timeout: abort, rollback slice to PENDING, warn user.
- After Agent completion: validate receipt JSON structure. If corrupt, warn and mark slice for re-execution.
- Record in slice receipt: `model_used`, `model_auto_selected: true/false`, `model_override_reason`
- After all slices: verify receipts and plan.md integrity
- Skip to [Final: Transition to Test](#final-transition-to-test)

If "main": proceed with inline execution below.

---

## Slice Execution Loop (Solo Mode)

For each unchecked slice (`- [ ]`), execute the following cycle:

### Step A: Activate Slice

1. Capture `git_before` hash: `git rev-parse HEAD 2>/dev/null`
2. Update `.claude/deep-work.local.md`:
   - `active_slice: SLICE-NNN`
   - `tdd_state: PENDING`
3. Read worktree state: if `worktree_enabled` is true, set `worktree_branch` for receipt
4. Determine model: if routing mode is "auto", lookup slice size from plan.md
5. Display:
   ```
   🔷 SLICE-NNN 시작: [Goal]
      파일: [file1, file2]
      TDD 모드: [strict/relaxed/coaching/spike]
   ```

### Step B: TDD Cycle (RED → GREEN → REFACTOR)

**If `tdd_mode` is "strict" or "coaching":**

#### B-1. RED: Write Failing Test

1. Read the slice's `failing_test` field
2. Create or update the test file with a test that should FAIL
3. Run the test: execute `verification_cmd`
4. **Verify it fails for the RIGHT reason** (feature missing, not syntax error)
5. Capture the failing test output (last 200 lines)
6. Update state: `tdd_state: RED_VERIFIED`
7. Update receipt: `tdd.failing_test_output` + `tdd.failing_test_timestamp`

```
🔴 RED: Failing test 작성 완료
   테스트: [test description]
   결과: FAIL ✓ (올바른 이유로 실패)
```

**Coaching mode addition**: If `tdd_mode` is "coaching":
```
💡 좋습니다! failing test를 먼저 작성했습니다.
   이제 최소한의 코드로 이 테스트를 통과시켜 보세요.
   팁: 불필요한 코드를 추가하지 말고, 테스트를 통과시키는 데 필요한 것만 작성하세요.
```

#### B-2. GREEN: Write Minimal Production Code

1. Implement the change — **minimal code to pass the test**
2. Only modify files listed in the slice's `files` field
3. Run `verification_cmd` again
4. **Verify ALL tests pass** (not just the new one)
5. Capture passing test output
6. Update state: `tdd_state: GREEN`
7. Update receipt: `tdd.passing_test_output` + `tdd.passing_test_timestamp`

```
🟢 GREEN: 테스트 통과!
   통과: [N]/[N] tests
```

#### B-3. REFACTOR (optional)

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
📋 Spec Checklist:
   ✅ [requirement 1]
   ✅ [requirement 2]
   ❌ [requirement 3] — [reason]
```

If any spec item fails: fix it (another RED→GREEN cycle if in strict mode).

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
  "spec_compliance": {
    "checklist": { "req1": true, "req2": true },
    "reviewer_result": null
  },
  "code_review": { "reviewer_result": null, "findings": [] },
  "debug": null,
  "timestamp": "[ISO]"
}
```

Capture git diff and `git_after` hash:
```bash
git diff -- [file1] [file2]
git rev-parse HEAD 2>/dev/null  # → git_after
```

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

## Debug Sub-Mode

If a test fails unexpectedly during Step B-2 (GREEN) or a previously passing test regresses:

1. Display:
   ```
   🐛 Debug 모드 진입: 예기치 않은 테스트 실패 감지
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
   🔄 Spike 종료 — TDD 모드로 전환
      spike 코드가 git stash에 보관되었습니다.
      이제 TDD 사이클로 다시 시작하세요.
      stash 확인: git stash list
      stash 참조: git stash show -p stash@{0}
   ```

---

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

## Final: Transition to Test

After all slices are complete:

1. **Verify all receipts**: Check `$WORK_DIR/receipts/SLICE-*.json` exist for all slices
2. **Record completion**: Update `implement_completed_at`
3. **Update state**: `current_phase: test`
4. **Display**:
   ```
   ✅ 구현이 완료되었습니다. 테스트 단계로 진입합니다.

   📊 구현 결과:
     - 완료 slice: N/N
     - TDD 준수율: [strict: N, relaxed: N, spike: N]
     - Receipt 완성: N/N
     - 디버깅 횟수: N회
   ```
5. **Send notification**
6. **Auto-execute Test phase**: Read `/deep-test` and follow all steps.

## Implementation Quality Rules

- **One slice at a time**: Complete each slice's TDD cycle fully before moving on
- **No scope creep**: If you notice something outside the plan, add to `## Issues Encountered`
- **Faithful execution**: The plan was reviewed and approved. Respect it.
- **Evidence-driven**: Every slice produces a receipt. No receipt = not done.
- **Debug, don't guess**: Unexpected failures → systematic debugging, not trial-and-error
