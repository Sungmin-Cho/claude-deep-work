---
name: deep-cleanup
description: "Use when the user wants to scan and clean up stale deep-work git worktrees (`dw/*` branches) plus fork worktrees. Triggers on `/deep-cleanup`, \"clean worktrees\", \"stale worktree\", \"worktree 정리\", \"fork 정리\", \"deep-work 정리\". Scans `git worktree list`, classifies stale/active, offers per-worktree or batch deletion via AskUserQuestion, handles dirty trees with extra confirmation, and prunes `.claude/deep-work-sessions.json` registry for idle fork sessions."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-cleanup [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-cleanup", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) | Stale worktree 스캔 → AskUserQuestion 분기 |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


> **Utility (v6.2.4)** — standalone 명령. `/deep-work` init이 stale 세션 일부를 감지하지만, `git worktree list` 스캔·stale/active 분류·dirty 트리 삭제 확인·fork worktree 및 registry 정리는 이 커맨드가 유일한 경로입니다.
> 향후 기능 이관 후 삭제 예정 (spec §7 follow-up).

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
   - Read the current session's state file (`$STATE_FILE`, resolved via env var → pointer → legacy)
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

### 7. Fork Worktree 정리 (v5.6)

기존 worktree 스캔 로직(Step 1-6)에 추가로 fork 세션 정리를 수행한다.

#### 7-1. Fork 세션 스캔

레지스트리(`.claude/deep-work-sessions.json`)에서 `fork_parent`가 있는 세션 중 `current_phase`가 `idle`인 것을 식별한다.

```bash
# 레지스트리에서 idle fork 세션 추출
node -e '
  const fs = require("fs");
  const reg = JSON.parse(fs.readFileSync(".claude/deep-work-sessions.json", "utf8"));
  const forks = Object.entries(reg.sessions)
    .filter(([_, s]) => s.fork_parent && s.current_phase === "idle")
    .map(([id, s]) => ({ id, parent: s.fork_parent, worktree: s.worktree_path }));
  console.log(JSON.stringify(forks));
' 2>/dev/null
```

해당 세션의 `worktree_path`가 있으면 정리 대상에 포함한다.

#### 7-2. 배치 정리 제안

부모와 모든 fork 자식이 전부 idle이면 배치 정리를 제안한다:

```
부모 세션 {parent_id}와 모든 fork 세션이 완료되었습니다. 전체 정리하시겠습니까?

1. 전체 정리 — 부모 + 모든 fork worktree 삭제
2. Fork만 정리 — fork worktree만 삭제, 부모 유지
3. 개별 선택
4. ❌ 취소
```

#### 7-3. Fork 정리 실행

각 fork worktree에 대해:

1. `git worktree remove {worktree_path}` 실행
2. 관련 branch 삭제: `git branch -D {fork_branch}`
3. 레지스트리에서 해당 세션 제거 (unregister)
4. 부모 상태 파일의 `fork_children`에서도 해당 항목 제거

#### 7-4. Fork 정리 Summary

```
Fork Cleanup 완료
   삭제: [N]개 fork worktree
   유지: [M]개 fork worktree (active 또는 사용자 선택)
   레지스트리 정리: [K]개 세션 제거
```
