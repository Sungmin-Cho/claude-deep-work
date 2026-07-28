# Active-session detection and WORK_DIR extraction

> Reference for `${CLAUDE_PLUGIN_ROOT}/skills/deep-resume/SKILL.md`. The `--session=` → env var → pointer file → registry → legacy fallback chain, multi-session selection, and how WORK_DIR is resolved from the chosen state file.

---

### 1. Detect active session & extract WORK_DIR (multi-session aware)

> **게이트 순서**: 어느 분기로 세션이 결정되든 §1.5 Worktree restoration으로 **직접 점프하지 않는다**.
> 세션 확정 후에는 진입 파일의 §1-1(`session authority validate` — v7 policy-bound 세션에서
> 실패 시 resume 중단), §1.4(State 스키마 마이그레이션), §1.5(Worktree restoration) 순서를
> 그대로 거친다. authority 게이트는 worktree 복원과 phase dispatch보다 **먼저** 통과해야 한다.

Resolve the session to resume using the following priority:

#### 1a-0. Explicit `--session=<id>`

`${CLAUDE_PLUGIN_ROOT}/scripts/parse-deep-work-flags.js` parses `--session=<id>` and rejects anything outside
`[A-Za-z0-9.-]` with a warning. When a valid value is present it wins over every source
below — read `.claude/deep-work.<id>.md` directly. If that file does not exist, report it
and stop rather than silently falling through to another session.

#### 1a. Direct session ID (env var)

If `DEEP_WORK_SESSION_ID` environment variable is set:
- Read `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md` directly
- If the file exists and `current_phase` is not `idle`: §1c(state 추출)로 계속한 뒤, **진입 파일의 §1-1 → §1.4 → §1.5 순서로 복귀**한다
- If the file doesn't exist or phase is `idle`: fall through to 1b

#### 1a-2. Pointer file

If neither of the above resolved, read `.claude/deep-work-current-session` — a single
line holding the session ID. This is the same pointer the hooks fall back to
(`${CLAUDE_PLUGIN_ROOT}/hooks/scripts/utils.sh`, `phase-guard.sh`, `session-end.sh`), so honouring it here
keeps the skill and the hooks pointed at one session. If it names a session whose
state file is missing or `idle`, fall through to 1b.

#### 1b. Registry-based session discovery

Read the registry (`.claude/deep-work-sessions.json`). Filter to sessions where `current_phase` is NOT `idle`.

**If no active sessions in registry:**
- Check for legacy fallback: read `.claude/deep-work.local.md`
  - If exists and `current_phase` is NOT `idle` and NOT empty: use this file as the state file. Display:
    ```
    ℹ️ 레거시 세션을 감지했습니다. 이 세션을 재개합니다.
    ```
    §1c(state 추출)로 계속한 뒤, **진입 파일의 §1-1 → §1.4 → §1.5 순서로 복귀**한다.
  - Otherwise:
    ```
    ℹ️ 활성 세션이 없습니다.

    새 세션을 시작하려면: /deep-work <작업 설명>
    ```
    Stop here.

**If exactly 1 active session in registry:**
- Auto-select this session
- Update the pointer file: `write_session_pointer SESSION_ID`
- Read `.claude/deep-work.${SESSION_ID}.md`
- §1c(state 추출)로 계속한 뒤, **진입 파일의 §1-1 → §1.4 → §1.5 순서로 복귀**한다

**If 2+ active sessions in registry:**
- Present selection UI using AskUserQuestion:

```
재개할 세션을 선택하세요:

  1. [SESSION_ID] [task_description] ([current_phase], [last_activity])
  2. [SESSION_ID] [task_description] ([current_phase], [last_activity])
  ...
```

- After user selects a session:
  - Update the pointer file: `write_session_pointer SELECTED_SESSION_ID`
  - Read `.claude/deep-work.${SELECTED_SESSION_ID}.md`
  - §1c(state 추출)로 계속한 뒤, **진입 파일의 §1-1 → §1.4 → §1.5 순서로 복귀**한다

#### 1c. Extract state

From the resolved state file, extract `current_phase`, `work_dir`, `task_description`, `started_at`, `team_mode`, `plan_approved`, `test_retry_count`, `max_test_retries`, `preset`, `evaluator_model`, `assumption_adjustments`, `skipped_phases`, `plan_review_retries`, and `auto_loop_enabled` from the YAML frontmatter.

Set `$WORK_DIR` to the value of `work_dir` (used in all subsequent steps).

**If `current_phase` is `idle` or empty:**

```
ℹ️ 완료된 세션입니다.

리포트 확인: `/deep-status --report` · 재생성: `/deep-report`
새 세션 시작: /deep-work <작업 설명>
```

Stop here.

