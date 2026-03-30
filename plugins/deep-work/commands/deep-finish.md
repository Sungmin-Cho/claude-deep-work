---
allowed-tools: Read, Write, Edit, Bash, Glob, AskUserQuestion
description: "Finish a deep work session — merge, PR, keep, or discard the branch"
---

# Deep Work Session Completion (v4.1)

Finish the current Deep Work session with an explicit branch completion workflow.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Instructions

### 1. Verify session exists

Read `.claude/deep-work.local.md`. If the file doesn't exist or `current_phase` is `idle` or empty:

```
ℹ️ 활성화된 Deep Work 세션이 없습니다.
   새 세션을 시작하려면: /deep-work <작업 설명>
```

Extract: `work_dir`, `task_description`, `worktree_enabled`, `worktree_path`, `worktree_branch`, `worktree_base_commit`.

### 2. Read all receipts and generate session receipt

Scan `$WORK_DIR/receipts/` for all `SLICE-*.json` files. For each:
- Count completed (status: "complete") vs total
- Aggregate TDD compliance (strict/relaxed/coaching/override/spike counts)
- Aggregate model usage (haiku/sonnet/opus counts)
- Sum estimated_cost across slices

**Generate `$WORK_DIR/session-receipt.json`** (derived cache — canonical source is slice receipts):

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
  "deep_work_version": "5.1.1"
}
```

### 3. Display session summary

```
Deep Work 세션 요약
   Task: [task_description]
   Branch: [worktree_branch or current branch]
   Slices: [completed]/[total] 완료
   TDD: [strict_count] strict, [override_count] override, [spike_count] spike
   Model: haiku×[n] sonnet×[n] opus×[n]
   Quality gates: [PASS/FAIL summary]
```

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
6. Update session receipt: `outcome: "merge"`

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
6. Update session receipt: `outcome: "pr"`, `outcome_ref: [PR URL]`

#### Option: Keep

1. Update session receipt: `outcome: "keep"`
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
4. Update session receipt: `outcome: "discard"`

### 8. Finalize state

Update `.claude/deep-work.local.md`:
- `current_phase: "idle"`
- `finished_at: [now ISO]`

Display:

```
✅ Deep Work 세션이 완료되었습니다.
   결과: [merge/PR/keep/discard]
   Receipt: [work_dir]/session-receipt.json
```
