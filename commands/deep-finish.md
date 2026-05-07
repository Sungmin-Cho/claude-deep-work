---
allowed-tools: Read, Write, Edit, Bash, Glob, AskUserQuestion
description: "Finish a deep work session — merge, PR, keep, or discard the branch"
---

> **Internal (v6.3.0)** — orchestrator가 이 파일의 로직을 참조합니다. 자동 호출이 주 경로이며, 수동 호출도 공식 경로입니다(특히 test 통과 후 세션 완료 시).
> 참조처: `skills/deep-work-orchestrator/SKILL.md` Step 3-6 (`Read "/deep-finish"`). `skills/deep-test/SKILL.md`가 test pass 후 수동 호출을 안내.

# Deep Work Session Completion (v4.1)

Finish the current Deep Work session with an explicit branch completion workflow.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Instructions

### 1. Verify session exists

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `.claude/deep-work.local.md`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE`. If the file doesn't exist:

```
ℹ️ 활성화된 Deep Work 세션이 없습니다.
   새 세션을 시작하려면: /deep-work <작업 설명>
```

`current_phase` 분기 (v6.3.0):
- `current_phase`가 empty → 위와 동일 "세션 없음" 메시지.
- `finished_at` 필드 **존재** → 이미 종료된 세션. "ℹ️ 이 세션은 이미 종료되었습니다 (finished_at: <값>). 새 세션을 시작하려면 `/deep-work <작업>`을 실행하세요." → exit 0. (v6.3.0 review W-R2 — `--skip-integrate` 분기가 finalized 세션을 재실행하지 않도록 최상위 가드)
- `current_phase == "idle"` + `phase5_completed_at` 필드 **존재** → Phase 5 완료 상태로 간주하고 **정상 진행** (Section 1a, 2, 3... 계속).
- `current_phase == "idle"` + `phase5_completed_at` **부재**:
  - `phase5_entered_at` 존재:
    - `$ARGUMENTS`에 `--skip-integrate` 있음 → **정상 진행**. Phase 5가 에러/사용자 요청으로 중단되어 orchestrator가 강제 finish를 호출한 경로.
      **v6.3.0 review RC-2 defensive guard**: 아래 `WORK_DIR` resolve(Section 1 말미) 이후 Section 2로 진입하기 전에 Section 1c를 실행하여 `integrate-loop.json`의 `terminated_by`를 `"error"`로 defensively 기록한다. 이 로직은 Section 1a(Phase 5 힌트) **다음**, Section 2 **이전**에 배치한다.
    - `--skip-integrate` 없음 → **Phase 5가 중단된 상태**. 메시지: "Phase 5 Integrate 루프가 중단되었습니다. `/deep-integrate`로 재진입하거나 `--skip-integrate`와 함께 `/deep-finish`를 다시 실행하세요." → exit 0.
  - `phase5_entered_at` 부재 → 기존 "세션 없음" 메시지.
- 그 외 (`brainstorm`/`research`/`plan`/`implement`/`test`) → 정상 진행.

Extract: `work_dir`, `task_description`, `worktree_enabled`, `worktree_path`, `worktree_branch`, `worktree_base_commit`.

Resolve `$WORK_DIR` (used by Section 1a below):

```bash
WORK_DIR="${PROJECT_ROOT}/$(read_frontmatter_field "$STATE_FILE" work_dir)"
```

### 1a. Phase 5 Integrate 힌트 (v6.3.0, 선택적)

`$WORK_DIR/integrate-loop.json` 존재 여부 확인:
- 존재 & `terminated_by != null` → 정상 진행 (Section 2로).
- 존재 & `terminated_by == null`:
  - **v6.3.0 review Codex P2**: `$ARGUMENTS`에 `--skip-integrate` 있음 → prompt 없이 Section 1c로 진행 (orchestrator auto-flow가 질문에 막히지 않도록).
  - `--skip-integrate` 없음 → **Phase 5 루프가 중단된 상태** (Ctrl-C 또는 재진입 대기). AskUserQuestion:

    ```
    ⚠️ Phase 5 Integrate 루프가 중단된 상태입니다.
       (1) /deep-integrate로 재진입 (권장)
       (2) 강제로 건너뛰고 finish 진행 (--skip-integrate 없이도)
    ```
    - (1) 선택 → "exit 후 /deep-integrate 실행하세요" + exit 0.
    - (2) 선택 → 기존 절차 계속.

- 부재 & `$ARGUMENTS`에 `--skip-integrate` 없음 → AskUserQuestion:

  ```
  ℹ️ Phase 5 Integrate를 아직 실행하지 않았습니다.
     `/deep-integrate`로 AI의 다음 단계 추천을 받을 수 있습니다.

     (1) /deep-integrate 먼저 실행 (권장)
     (2) Phase 5 건너뛰고 바로 finish 진행
  ```

- (1) 선택 → "exit 후 /deep-integrate 실행하세요" 안내 + exit 0.
- (2) 선택 → 기존 절차 계속.
- `$ARGUMENTS`에 `--skip-integrate` 있음 → 힌트 스킵하고 바로 Section 2.

### 1c. Phase 5 defensive error marker (v6.3.0 review RC-2 + W3-1 + RC4-2)

`$ARGUMENTS`에 `--skip-integrate`가 있고 Section 1의 분기에서 `phase5_entered_at`이 있으나 `phase5_completed_at`이 없어 이 Section에 도달한 경우에만 실행한다. 이 시점에는 Section 1 말미에서 `$WORK_DIR`가 이미 resolve되었으므로 아래 helper 호출이 유효하다.

**LLM은 아래 명령을 그대로 Bash tool로 단일 호출한다** (compound 연산자·shell metacharacter 없이 단일 명령이어야 Phase 5 guard helper exception 적용, RC4-1/RC5-1):

```bash
bash skills/deep-integrate/phase5-record-error.sh <ABSOLUTE_WORK_DIR>
```

**중요 (v6.3.0 review W5-1)**: Claude Code의 Bash tool은 매 호출마다 새 shell을 spawn하므로 이전 단계에서 export한 `$WORK_DIR` 같은 변수가 persist하지 않는다. LLM은 state file에서 `work_dir`을 먼저 읽어 `<ABSOLUTE_WORK_DIR>` 자리에 실제 절대경로를 치환 후 호출한다. literal `"$WORK_DIR"`를 그대로 전달하면 empty string으로 확장되어 helper가 usage 에러로 fail한다.

또한 helper는 state file의 `phase5_work_dir_snapshot`을 읽어 인자와 일치하는지 검증하므로(RC5-3), 올바른 세션 work_dir이어야 실행된다.

이 helper가 `integrate-loop.json`의 `terminated_by`를 atomically `"error"`로 교체하거나, 파일 부재 시 최소 구조로 생성한다.

`session-end.sh` Stop hook의 `terminated_by=interrupted` 마킹은 여전히 belt-and-suspenders로 남아있어, finish가 실행되지 않고 세션이 Ctrl-C로 종료된 경우에도 evidence가 남는다.

### 2. Read all receipts and generate session receipt

Scan `$WORK_DIR/receipts/` for all `SLICE-*.json` files. For each:
- Count completed (status: "complete") vs total
- Aggregate TDD compliance (strict/relaxed/coaching/override/spike counts)
- Aggregate model usage (haiku/sonnet/opus counts)
- Sum estimated_cost across slices

**Generate `$WORK_DIR/session-receipt.json`** (derived cache — canonical source
is slice receipts) **wrapped in the M3 cross-plugin envelope** (deep-work
v6.5.0; cf. `claude-deep-suite/docs/envelope-migration.md` §1).

> **Two-step protocol (v6.5.0)**: the legacy session-receipt body ("payload")
> is built first into a temp file; quality fields (Section 2-1) and
> outcome/outcome_ref (Section 7) are appended to that **same payload temp
> file**; only at the end of Section 7 does the wrap helper produce the final
> envelope-wrapped `session-receipt.json` with a single `run_id`. This avoids
> re-generating ULIDs as outcome data lands.

#### Step 2.1 — write the session-receipt payload to a temp file

Use the `Write` tool to emit the **payload** (legacy session-receipt body) to a
temp path, e.g. `$WORK_DIR/.session-receipt.payload.json`:

```json
{
  "schema_version": "1.0",
  "canonical": false,
  "derived_from": "receipts/SLICE-*.json",
  "session_id": "dw-[timestamp]",
  "task_description": "[from state]",
  "started_at": "[from state]",
  "finished_at": "[now ISO]",
  "worktree_branch": "[from state or empty]",
  "worktree_base_commit": "[from state or empty]",
  "outcome": null,
  "outcome_ref": null,
  "slices": {
    "total": N,
    "completed": N,
    "spike": N
  },
  "tdd_compliance": {
    "strict": N, "relaxed": N, "override": N, "spike": N, "coaching": N
  },
  "model_usage": {
    "haiku": N, "sonnet": N, "opus": N, "main": N
  },
  "total_estimated_cost": null,
  "total_files_changed": N,
  "total_tests": N,
  "total_tests_passed": N,
  "quality_gates": {
    "receipt_completeness": "PASS/FAIL",
    "verification_evidence": "PASS/FAIL"
  },
  "evaluation": {
    "evaluator_model": "sonnet",
    "plan_review_retries": 0,
    "test_retry_count": 0,
    "assumption_adjustments": []
  },
  "contract_compliance": {
    "total_contracts": 0,
    "contracts_met": 0
  },
  "deep_work_version": "6.5.0"
}
```

`schema_version` MUST be the literal string `"1.0"`. Section 2-1 will add
`quality_score`, `quality_breakdown`, and `quality_diagnostics` to this same
payload temp file. Section 7's option-specific blocks update
`outcome`/`outcome_ref` on the same temp file. The final envelope wrap is
performed by Section 7-Z below — exactly once per session.

### 2-1. Calculate Session Quality Score (v5.8 — 5-component system)

Calculate a quality score (0-100) using the 5-component weighted system with not_applicable proportional redistribution.

**Data collection** — read these values from the state file and session artifacts:

1. **Test Pass Rate** (weight: 25%): Read `test_retry_count` from state. If 0 retries (passed first try) → 100. If 1 retry → 70. If 2 retries → 40. If 3+ retries → 10.
2. **Rework Cycles** (weight: 20%): Same as test_retry_count for this metric. Score: 0 retries → 100, 1 → 75, 2 → 50, 3+ → 20.
3. **Plan Fidelity** (weight: 25%): Read `fidelity_score` from state file (written by deep-test drift-check). If not present, default to 80 (assume reasonable fidelity when drift-check wasn't run).
4. **Sensor Clean Rate** (weight: 15%): Read all slice receipts' `sensor_results`. Count slices where all sensors are `pass` or `not_applicable`. Score: (clean_slices / total_slices_with_sensor_data) * 100. If all slices have `sensor_results` absent or all statuses are `not_applicable` → mark as `not_applicable` (exclude from denominator).
5. **Mutation Score** (weight: 15%): Read `mutation_testing.score` from state file (written by deep-test Section 4-7). If `status: "not_applicable"` or field absent → mark as `not_applicable` (exclude from denominator).

**Core Score formula (with not_applicable proportional redistribution)**:
```
applicable_weights = sum of weights for components that are NOT not_applicable
score = Σ (component_score × component_weight) / applicable_weights × 100
```

Round to the nearest integer. Clamp to 0-100.

Examples:
- All 5 applicable: score = (tpr×0.25 + rw×0.20 + fp×0.25 + sc×0.15 + ms×0.15)
- Sensor+Mutation not_applicable: score = (tpr×0.25 + rw×0.20 + fp×0.25) / 0.70 × 100

**Diagnostic Metrics** (informational only — NOT included in core score):

1. **Code Efficiency**: Read `$WORK_DIR/file-changes.log` to count total lines changed. Count total plan items from plan.md. Ratio = lines_changed / plan_items. Score: <50 lines/item → 100, 50-100 → 80, 100-200 → 60, 200+ → 40.
2. **Phase Balance**: Calculate (research_duration + plan_duration) / total_session_duration. Score: 20-50% → 100, 10-20% or 50-70% → 70, <10% or >70% → 40.

**Display**:
```
📈 Session Quality Score: [score]/100
   Test Pass Rate:    [N]/100 ([detail]) — weight: 25%
   Rework Cycles:     [N]/100 ([detail]) — weight: 20%
   Plan Fidelity:     [N]/100 — weight: 25%
   Sensor Clean Rate: [N]/100 ([N]/[total] slices) — weight: 15% [or: N/A (not_applicable)]
   Mutation Score:    [N]/100 ([N]%) — weight: 15% [or: N/A (not_applicable)]

   Diagnostics (참고용):
     Code Efficiency: [N]/100 ([detail])
     Phase Balance:   [N]/100 ([detail])
```

**Persist to session receipt**: Add `quality_score`, `quality_breakdown`
(object with all 5 component scores + not_applicable flags), and
`quality_diagnostics` (the 2 diagnostic metrics) to the
**`$WORK_DIR/.session-receipt.payload.json` temp file** generated in Step 2.1.
The final envelope wrap (Section 7-Z) consumes this payload as-is, so any
field placed here ends up under `envelope.payload` in the wrapped receipt.

**Authoritative JSONL write**: After calculating the quality score, write the finalized session record to `harness-sessions.jsonl`. This is the authoritative write — it includes the `quality_score` field and `status: "finalized"`.

**Read assumption snapshot**: Read `assumption_snapshot` from the state file (written at session init by deep-work.md — see Task 7). Include it in the JSONL entry.

**JSONL path**: Use the shared path `.deep-work/harness-history/harness-sessions.jsonl` (NOT the per-session folder). This matches all consumers (deep-status, deep-assumptions, deep-report).

**Upsert logic** — use Bash to perform atomic upsert with lock:

```bash
# Variables: SESSION_ID, ENTRY (the full JSON line), JSONL_FILE
JSONL_FILE=".deep-work/harness-history/harness-sessions.jsonl"
LOCKDIR="${JSONL_FILE}.lock.d"

# Acquire lock (consistent with session-end.sh pattern)
RETRIES=3
while [ "$RETRIES" -gt 0 ]; do
  if mkdir "$LOCKDIR" 2>/dev/null; then
    break
  fi
  RETRIES=$((RETRIES - 1)); sleep 0.1
done

# Upsert: remove provisional line if exists, then append finalized
if [ -f "$JSONL_FILE" ] && grep -qF "\"session_id\":\"$SESSION_ID\"" "$JSONL_FILE" 2>/dev/null; then
  # Replace: filter out old line, append new
  grep -vF "\"session_id\":\"$SESSION_ID\"" "$JSONL_FILE" > "${JSONL_FILE}.tmp" 2>/dev/null
  echo "$ENTRY" >> "${JSONL_FILE}.tmp"
  mv "${JSONL_FILE}.tmp" "$JSONL_FILE"
else
  # Append new
  echo "$ENTRY" >> "$JSONL_FILE"
fi

# Release lock
rmdir "$LOCKDIR" 2>/dev/null || true
```

The entry JSON includes all existing fields from session-end.sh PLUS: `quality_score`, `quality_breakdown`, `status: "finalized"`, and `assumption_snapshot`.

### 3. Display session summary

```
Deep Work 세션 요약
   Task: [task_description]
   Branch: [worktree_branch or current branch]
   Slices: [completed]/[total] 완료
   TDD: [strict_count] strict, [override_count] override, [spike_count] spike
   Model: haiku×[n] sonnet×[n] opus×[n]
   Quality gates: [PASS/FAIL summary]
   Quality Score: [score]/100
```

If any slice has `slice_confidence: "done_with_concerns"`:

```
   Slice Confidence:
      ✅ done: [N]개
      ⚠️ done_with_concerns: [N]개

   Concerns:
      SLICE-NNN: [concern 1], [concern 2]
      SLICE-MMM: [concern 1]
```

If all slices are `done`, skip this section.

### 4. Partial session check

If `slices.completed < slices.total`:

```
⚠️ [completed]/[total] 슬라이스만 완료되었습니다.
   미완료 슬라이스가 있는 상태에서 진행합니다.
```

The session receipt will include `"partial": true`.

### 5. Check gh CLI availability

```bash
which gh 2>/dev/null
```

If `gh` is not available, the PR option will be marked as unavailable.

### 6. Present completion options

Use AskUserQuestion:

**If `worktree_enabled` is `true`:**

```
세션을 어떻게 마무리할까요?

1. Merge — 베이스 브랜치로 병합
2. PR 생성 — Pull Request 만들기 [gh 미설치시: (unavailable — gh CLI 필요)]
3. 브랜치 유지 — 나중에 /deep-finish로 다시 정리
4. 삭제 — 브랜치와 worktree 삭제
```

**If `worktree_enabled` is `false`:**

```
세션을 어떻게 마무리할까요?

1. PR 생성 — Pull Request 만들기 [gh 미설치시: (unavailable)]
2. 현재 상태 유지 — 세션만 종료
```

(Merge와 Discard는 worktree가 없으면 위험하므로 비활성화)

### 7. Execute chosen option

#### Option: Merge

1. Check for uncommitted changes in worktree:
   ```bash
   git -C [worktree_path] status --porcelain
   ```
   If dirty:
   ```
   ⚠️ Worktree에 커밋되지 않은 변경이 있습니다.
      먼저 변경사항을 커밋하거나 stash 하세요.
   ```
   Ask: A) 변경사항 커밋 후 진행 B) 취소
2. Get base branch from state: `worktree_base_branch` (stored at worktree creation time)
3. Switch to base: `cd [project_root] && git checkout [worktree_base_branch]`
4. Merge: `git merge [worktree_branch]`
4. **Merge conflict handling**: If merge fails:
   ```
   ⚠️ 충돌이 발생했습니다. 충돌 파일:
   [list conflict files]

   수동으로 충돌을 해결한 후 /deep-finish를 다시 실행하세요.
   ```
   Abort: `git merge --abort`. Stop here.
5. On success: `git worktree remove [worktree_path]` + `git branch -d [worktree_branch]`
6. Update session-receipt **payload**: set `outcome: "merge"` in
   `$WORK_DIR/.session-receipt.payload.json` (Edit tool — preserve existing
   fields). The envelope wrap happens in Section 7-Z.

#### Option: PR

1. Check `gh` is available. If not:
   ```
   ⚠️ gh CLI가 필요합니다: https://cli.github.com/
      설치 후 `gh auth login`으로 인증하세요.
   ```
   Stop here.
2. Check `gh auth status`. If not authenticated:
   ```
   ⚠️ gh 인증이 필요합니다: `gh auth login`
   ```
   Stop here.
3. Push branch: `git push -u origin [worktree_branch]`
   - If no remote:
     ```
     ⚠️ 원격 저장소가 없습니다. `git remote add origin <url>`로 추가하세요.
     ```
     Stop here.
4. Create PR with session receipt summary as body:
   ```bash
   gh pr create --title "deep-work: [task_description]" --body "$(cat <<'EOF'
   ## Deep Work Session Receipt

   - **Slices**: [completed]/[total]
   - **TDD compliance**: [summary]
   - **Model usage**: [summary]
   - **Quality gates**: [summary]

   Full receipt: `[work_dir]/session-receipt.json`
   EOF
   )"
   ```
5. Worktree is **NOT** removed (PR review 중 추가 작업 가능)
6. Update session-receipt **payload**: set `outcome: "pr"`,
   `outcome_ref: [PR URL]` in `$WORK_DIR/.session-receipt.payload.json` (Edit
   tool — preserve existing fields). The envelope wrap happens in Section 7-Z.

#### Option: Keep

1. Update session-receipt **payload**: set `outcome: "keep"` in
   `$WORK_DIR/.session-receipt.payload.json`. The envelope wrap happens in
   Section 7-Z.
2. Display:
   ```
   브랜치가 유지됩니다: [worktree_branch]
      나중에 /deep-finish로 다시 정리할 수 있습니다.
   ```

#### Option: Discard

1. Confirm with AskUserQuestion:
   ```
   ⚠️ 정말 삭제하시겠습니까?
      브랜치: [worktree_branch]
      변경사항이 모두 삭제됩니다.

   1. 네, 삭제합니다
   2. 아니오, 취소
   ```
2. If worktree has uncommitted changes:
   ```
   ⚠️ 커밋되지 않은 변경이 있습니다. 강제로 삭제하시겠습니까?
   1. 강제 삭제
   2. 취소
   ```
3. On confirm: `git worktree remove --force [worktree_path]` + `git branch -D [worktree_branch]`
4. Update session-receipt **payload**: set `outcome: "discard"` in
   `$WORK_DIR/.session-receipt.payload.json`. The envelope wrap happens in
   Section 7-Z.

### 7-Z. Envelope wrap (v6.5.0 — runs once, after outcome is decided)

Now that the payload temp file has all fields (Section 2 base + Section 2-1
quality + Section 7 outcome), wrap it in the M3 envelope and write the final
`session-receipt.json`. Use the `Bash` tool with the helper script:

> **Important — failure semantics**: the snippet uses `set -euo pipefail` so
> that any sub-command failure aborts before `rm -f` runs. The cleanup is
> gated with `&&` so that on helper failure the payload temp file is
> **preserved** for retry. To re-attempt a failed wrap, simply re-execute
> Section 7-Z (Section 2/2-1/7 do not re-run; the same payload is used).

```bash
set -euo pipefail

# Resolve session_id with the same fallback chain as Section 1: env var →
# .claude/deep-work-current-session pointer file (omit flag if neither
# resolves rather than passing the empty string — handoff §4 W2).
SESSION_ID="${DEEP_WORK_SESSION_ID:-}"
if [ -z "$SESSION_ID" ] && [ -f "$PROJECT_ROOT/.claude/deep-work-current-session" ]; then
  SESSION_ID="$(tr -d '\n\r' < "$PROJECT_ROOT/.claude/deep-work-current-session" || true)"
fi

EVOLVE_PATH=""
if [ -f "$PROJECT_ROOT/.deep-evolve/current.json" ]; then
  EVOLVE_SID=$(node -e '
    try {
      const raw = require("fs").readFileSync(process.argv[1], "utf8");
      const obj = JSON.parse(raw);
      const v = (obj && typeof obj === "object" && typeof obj.session_id === "string")
        ? obj.session_id : "";
      console.log(v);
    } catch (_) { console.log(""); }
  ' "$PROJECT_ROOT/.deep-evolve/current.json" || true)
  if [ -n "$EVOLVE_SID" ] && [ -f "$PROJECT_ROOT/.deep-evolve/$EVOLVE_SID/evolve-insights.json" ]; then
    EVOLVE_PATH="$PROJECT_ROOT/.deep-evolve/$EVOLVE_SID/evolve-insights.json"
  fi
fi

HARN_PATH=""
if [ -f "$PROJECT_ROOT/.deep-dashboard/harnessability-report.json" ]; then
  HARN_PATH="$PROJECT_ROOT/.deep-dashboard/harnessability-report.json"
fi

WRAP_ARGS=(
  --artifact-kind session-receipt
  --payload-file "$WORK_DIR/.session-receipt.payload.json"
  --output "$WORK_DIR/session-receipt.json"
  --source-artifacts-glob "$WORK_DIR/receipts/SLICE-*.json"
)
[ -n "$SESSION_ID" ] && WRAP_ARGS+=(--session-id "$SESSION_ID")
[ -n "$EVOLVE_PATH" ] && WRAP_ARGS+=(--source-evolve-insights "$EVOLVE_PATH")
[ -n "$HARN_PATH" ] && WRAP_ARGS+=(--source-harnessability "$HARN_PATH")

# Cleanup payload temp file ONLY on helper success — preserve on failure for
# retry (round-1 deep-review C2 lesson). The `set -e` guarantees abort if the
# helper exits non-zero before this line runs.
if node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/wrap-receipt-envelope.js" "${WRAP_ARGS[@]}"; then
  rm -f "$WORK_DIR/.session-receipt.payload.json"
else
  echo "wrap helper failed — preserving $WORK_DIR/.session-receipt.payload.json for retry; re-run Section 7-Z to retry." >&2
  exit 1
fi
```

The helper:
- Generates `envelope.run_id` (ULID), sets `producer = "deep-work"`,
  `artifact_kind = "session-receipt"`, `schema.name = "session-receipt"`.
- Sets `envelope.parent_run_id` from the consumed evolve-insights envelope's
  `run_id` (handoff §3.3 cross-plugin chain) when `--source-evolve-insights`
  is passed and the file is itself an envelope.
- Adds slice receipts' `run_id` (when envelope-wrapped) plus
  `harnessability-report.json`'s `run_id` to `provenance.source_artifacts[]`
  (intra-plugin chain + multi-source aggregation).

### 8. Finalize state

Update `$STATE_FILE`:
- `current_phase: "idle"`
- `finished_at: [now ISO]`

#### 8a. Unregister session from registry

If the session has a `session_id` field in the state file:

```bash
unregister_session "$SESSION_ID"
```

Delete the pointer file if it points to this session:
```bash
CURRENT_POINTER=$(read_session_pointer)
if [ "$CURRENT_POINTER" = "$SESSION_ID" ]; then
  rm -f "$PROJECT_ROOT/.claude/deep-work-current-session"
fi
```

Display:

```
✅ Deep Work 세션이 완료되었습니다.
   결과: [merge/PR/keep/discard]
   Receipt: [work_dir]/session-receipt.json
```
