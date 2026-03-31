---
allowed-tools: Read, Bash, AskUserQuestion
description: "Clean up stale deep-work worktrees — scan and delete old worktrees"
---

> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.

# Deep Work Worktree Cleanup (v4.1)

Scan for stale deep-work worktrees and offer cleanup options.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. Output ALL user-facing messages in the detected language.

## Instructions

### 1. Scan for deep-work worktrees

```bash
git worktree list 2>/dev/null
```

If not a git repo or no worktrees exist:
```
ℹ️ Git worktree가 없습니다.
```
Stop here.

Filter for worktrees with `dw/` in the branch name (deep-work convention).

### 2. Check each worktree

For each deep-work worktree:

1. Get the worktree path and branch name
2. Check age: `stat -f "%Sm" -t "%Y-%m-%d" [path]` (macOS) or `stat -c "%y" [path]` (Linux)
3. Check if it has an active session:
   - Read `.claude/deep-work.local.md` in the current project root
   - If `worktree_path` matches this worktree AND `current_phase` is not `idle` → **active**
4. Check for uncommitted changes: `git -C [path] status --porcelain`

### 3. Display worktree list

```
Deep Work Worktrees

┌────────┬──────────────────────┬──────────┬──────────┬───────────┐
│ #      │ Branch               │ Age      │ Status   │ Changes   │
├────────┼──────────────────────┼──────────┼──────────┼───────────┤
│ 1      │ dw/add-model-routing │ 3 days   │ active   │ clean     │
│ 2      │ dw/fix-receipt-bug   │ 12 days  │ stale    │ dirty     │
│ 3      │ dw/old-feature       │ 30 days  │ stale    │ clean     │
└────────┴──────────────────────┴──────────┴──────────┴───────────┘

stale = 7일 이상 + 활성 세션 없음
active = 현재 활성 세션의 worktree (삭제 불가)
```

If no stale worktrees:
```
✅ 모든 worktree가 활성 상태이거나 7일 이내입니다. 정리할 것이 없습니다.
```
Stop here.

### 4. Offer cleanup

Use AskUserQuestion:

```
stale worktree를 정리할까요?

1. clean stale 삭제 — 변경사항 없는 stale worktree만 삭제
2. 모든 stale 삭제 — dirty 포함 모든 stale worktree 삭제
3. 개별 선택 — 하나씩 선택하여 삭제
4. ❌ 취소
```

### 5. Execute cleanup

For each worktree to delete:

1. **Skip active worktrees** — never delete a worktree with an active session
2. If dirty (uncommitted changes), show extra confirmation:
   ```
   ⚠️ [branch]에 커밋되지 않은 변경이 있습니다. 강제 삭제?
   ```
3. Delete:
   ```bash
   git worktree remove [path]          # clean
   git worktree remove --force [path]  # dirty (after confirmation)
   git branch -D [branch]              # remove the branch too
   ```
4. Display per-worktree: `[branch] 삭제 완료`

### 6. Summary

```
Cleanup 완료
   삭제: [N]개 worktree
   유지: [M]개 worktree (active 또는 사용자 선택)
```
