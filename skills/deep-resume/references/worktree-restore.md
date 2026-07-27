# Worktree context restoration

> Reference for `skills/deep-resume/SKILL.md`. Restoring the session's worktree, handling a missing or moved worktree path, and the `--worktree=<path>` override.

---

### 1.5. Worktree restoration

If `worktree_enabled` is `true` in the state file:

1. Read `worktree_path` from state file
2. Check if the worktree still exists on disk:
   ```bash
   [ -d "[worktree_path]" ] && echo "exists" || echo "missing"
   ```
3. **If exists**: Set working directory context to the worktree path.
   - All subsequent Bash calls should prepend `cd [absolute_worktree_path] &&`
   - Display:
     ```
     Worktree 복원: [worktree_branch]
        Path: [worktree_path]
     ```

4. **If missing** (user manually deleted the worktree):
   - Display warning:
     ```
     ⚠️ Worktree가 삭제되었습니다: [worktree_path]
        현재 브랜치에서 계속 진행합니다.
        Worktree 재생성은 지원하지 않습니다 — /deep-finish로 세션을 정리하세요.
     ```
   - Update state: `worktree_enabled: false`
   - Continue with current directory as working directory

