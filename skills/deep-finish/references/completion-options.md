# Completion options and their execution

> Reference for `${CLAUDE_PLUGIN_ROOT}/skills/deep-finish/SKILL.md`. Sections 6 and 7: the AskUserQuestion completion menu and the per-choice execution procedure (merge / PR / keep branch / discard). Read after the finish gate passes and gh availability is known.

---

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
5. **Merge conflict handling**: If merge fails:
   ```
   ⚠️ 충돌이 발생했습니다. 충돌 파일:
   [list conflict files]

   수동으로 충돌을 해결한 후 /deep-finish를 다시 실행하세요.
   ```
   Abort: `git merge --abort`. Stop here.
6. On success: `git worktree remove [worktree_path]` + `git branch -d [worktree_branch]`
7. Update session-receipt **payload**: set `outcome: "merge"` in
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

