---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Phase 3: Implement the approved plan mechanically"
---

# Phase 3: Deep Implementation

You are in the **Implementation** phase of a Deep Work session.

## Critical Constraints

✅ **Follow the plan EXACTLY. Do not deviate.**
🚫 **Do NOT add features not in the plan.**
🚫 **Do NOT refactor code not mentioned in the plan.**
🚫 **Do NOT make "improvements" beyond what was planned.**
⚠️ **If you encounter an issue, document it — do NOT improvise a fix.**

## Instructions

### 1. Verify prerequisites

Read `.claude/deep-work.local.md` and verify:
- `current_phase` is "implement"
- `plan_approved` is true

If not, inform the user which prerequisite step is missing.

Extract `work_dir` from the state file. If missing, default to `deep-work` (backward compatibility).
Set `WORK_DIR` to this value.

### 2. Load the plan and check mode

Read `$WORK_DIR/plan.md` and identify the **Task Checklist** section. Each item should be in the format:
```
- [ ] Task N: [File path] — [What to do] — [Why]
```

Read `team_mode` from `.claude/deep-work.local.md`. If missing, treat as `solo`.

- **`team_mode: solo`** → Continue with [Solo Mode Implementation](#solo-mode-implementation)
- **`team_mode: team`** → Continue with [Team Mode Implementation](#team-mode-implementation)

---

## Solo Mode Implementation

### 3-SOLO. Execute tasks sequentially

For each unchecked task (`- [ ]`):

1. **Announce** what you're about to do
2. **Read** the target file(s) first
3. **Implement** the change exactly as described in the plan
4. **Verify** the change (type check, lint, or basic sanity check if applicable)
5. **Mark complete** by updating `- [ ]` to `- [x]` in `$WORK_DIR/plan.md`
6. **Report** the result briefly

### 4-SOLO. Handle errors

If you encounter a problem during implementation:

**DO:**
- Stop the current task
- Document the issue in `$WORK_DIR/plan.md` under a new `## Issues Encountered` section
- Inform the user with specifics
- Wait for user guidance

**DO NOT:**
- Improvise a solution not in the plan
- Stack patches on top of broken code
- Skip the task and move on silently
- Add workarounds

If a rollback is needed, prefer:
```bash
git stash  # or
git checkout -- <file>  # for specific files
```

### 5-SOLO. Run verification

After all tasks are complete, run any applicable verification:
- Type checking (tsc, mypy, etc.)
- Linting (eslint, ruff, etc.)
- Tests related to the changed code
- Build verification

### 6-SOLO. Update state and summarize

Continue to [Final: Update state and summarize](#final-update-state-and-summarize).

---

## Team Mode Implementation

### 3-TEAM-1. Cluster tasks by file ownership

1. Parse the checklist items from `$WORK_DIR/plan.md` in the format `- [ ] Task N: [file path] — ...`
2. Group tasks by file path
3. Merge clusters where files import each other (to avoid conflicts)
4. Target 2–4 clusters. If total tasks are few (≤3), display a message and fall back to Solo:
   ```
   ℹ️ 태스크가 소규모라 Solo로 진행합니다.
   ```

### 3-TEAM-2. Create team

Use `TeamCreate` with team_name `deep-implement`.

### 3-TEAM-3. Create tasks

For each cluster, create a task with `TaskCreate`. Each task description MUST include:

```
⚠️ 파일 소유권: 수정 가능한 파일:
- [file1]
- [file2]
다른 파일은 절대 수정하지 마세요.

📋 체크리스트:
- [ ] Task N: [file] — [description]
- [ ] Task M: [file] — [description]

각 태스크 완료 후 $WORK_DIR/plan.md에서 해당 항목을 [x]로 변경하세요.
문제 발생 시 ## Issues Encountered에 기록하고 리더에게 메시지를 보내세요.

⚠️ 계획서를 정확히 따르세요. 이탈/추가 개선 금지.
```

### 3-TEAM-4. Spawn agents and assign

- Spawn `general-purpose` agents with names `impl-1`, `impl-2`, etc. (one per cluster)
- Each agent joins team `deep-implement`
- Use `TaskUpdate` to assign each task to the corresponding agent

### 3-TEAM-5. Monitor and coordinate

- Use `TaskList` to check progress periodically
- If an agent reports an issue via message, evaluate and provide guidance or escalate to the user
- If file dependency conflicts arise, coordinate execution order between agents

### 3-TEAM-6. Cross-Review (Iterative Loop)

After all implementation tasks are completed, proceed to a **cross-review phase** before final verification. Each agent reviews code written by **other** agents, not their own.

#### 6-1. Create cross-review tasks

Create new tasks with `TaskCreate` for each agent to review others' files:
- `impl-1` reviews files owned by `impl-2` and `impl-3`
- `impl-2` reviews files owned by `impl-1` and `impl-3`
- `impl-3` reviews files owned by `impl-1` and `impl-2`
- (Adjust based on actual number of agents)

Each cross-review task description:

```
🔍 크로스체크 리뷰

다음 파일들이 계획서($WORK_DIR/plan.md)에 맞게 올바르게 구현되었는지 검증하세요:
- [file1] (구현자: impl-X)
- [file2] (구현자: impl-X)

확인 항목:
1. plan.md의 해당 태스크 설명과 실제 구현이 일치하는지
2. 기존 코드 패턴/컨벤션을 따르는지
3. 타입 오류, 런타임 에러 가능성이 없는지
4. 다른 클러스터의 코드와 호환되는지 (import, 인터페이스 등)
5. 누락된 사항이 없는지

결과를 $WORK_DIR/plan.md의 ## Cross-Review Results 섹션에 다음 형식으로 작성:
- ✅ [file]: 이상 없음
- ❌ [file]: [문제 설명] — [수정 필요 사항]

⚠️ 리뷰만 수행하세요. 직접 코드를 수정하지 마세요.
```

#### 6-2. Collect cross-review results

After all cross-review tasks complete, read the `## Cross-Review Results` section from `$WORK_DIR/plan.md`:

- **All items ✅**: → Proceed to [3-TEAM-7 (Final Verification)](#3-team-7-final-verification)
- **Any ❌ items**: → Proceed to [6-3 (Fix Redistribution)](#6-3-fix-redistribution)

#### 6-3. Fix redistribution (Iteration)

1. Analyze ❌ items and create fix tasks for the **original file owner** (the agent who implemented the code)
2. Include the specific problems and required fixes from the cross-review in the task description
3. After fixes complete → **Return to 6-1** for another cross-review round

**Iteration termination conditions**:
- All cross-review items are ✅
- OR maximum 3 rounds reached — report remaining issues to the user

#### 6-4. Track iteration state

Record each round in `$WORK_DIR/plan.md`:

```
## Cross-Review Round 1
- impl-2 reviewed impl-1's files: ✅ all clear
- impl-1 reviewed impl-2's files: ❌ src/auth/types.ts — missing export
...

## Cross-Review Round 2 (fixes applied)
- impl-2 reviewed impl-1's files: ✅ all clear
- impl-1 reviewed impl-2's files: ✅ fixed
...
```

### 3-TEAM-7. Final verification

After cross-review passes:
- Verify all checklist items in `plan.md` are `[x]` and all cross-review items are ✅
- Run type checks, linting, tests, and build verification
- If all pass, declare **completion**

### 3-TEAM-8. Clean up and complete

- Send `shutdown_request` to all team members via `SendMessage`
- Wait for confirmations, then `TeamDelete`
- Continue to [Final: Update state and summarize](#final-update-state-and-summarize) with team info included

---

## Final: Update state and summarize

Update `.claude/deep-work.local.md`:
- Set `current_phase: idle`
- Add completion timestamp to progress log

Display:

```
✅ Deep Work 구현이 완료되었습니다!

📊 구현 결과:
  - 완료된 태스크: N/N
  - 수정된 파일: [list]
  - 신규 파일: [list]

🔍 검증 결과:
  - 타입 체크: ✅/❌
  - 린트: ✅/❌
  - 테스트: ✅/❌

📄 상세 내용: $WORK_DIR/plan.md (체크리스트 확인)
```

If Team mode was used, also display:
```
🤝 팀 구현 결과:
  - 에이전트 수: N명
  - 크로스체크 라운드: N회
  - 발견/수정된 이슈: N건
```

## Generate Session Report

After displaying the implementation summary, automatically generate the session report.

### Report generation steps

1. Read all session artifacts:
   - `.claude/deep-work.local.md` (session state and metadata)
   - `$WORK_DIR/research.md` (research findings)
   - `$WORK_DIR/plan.md` (plan and implementation results)

2. Write `$WORK_DIR/report.md` with the following structure:

```markdown
# Deep Work Session Report

## Session Overview
| Field | Value |
|-------|-------|
| Task | [task_description] |
| Work Directory | [work_dir] |
| Mode | Solo / Team |
| Started | [started_at] |
| Completed | [current timestamp] |
| Plan Iterations | [iteration_count] |

## Research Summary
[3-5 bullet points summarizing the key findings from research.md]

## Plan Summary
[Approach chosen, key architectural decisions, alternatives considered]

## Implementation Results
| # | Task | File | Status | Notes |
|---|------|------|--------|-------|
| 1 | [description] | [path] | ✅/❌ | [notes] |

## Files Changed
### Created
- [list of new files]

### Modified
- [list of modified files]

### Deleted
- [list of deleted files, if any]

## Verification Results
| Check | Result |
|-------|--------|
| Type Check | ✅ Pass / ❌ Fail / ⬜ N/A |
| Lint | ✅ Pass / ❌ Fail / ⬜ N/A |
| Tests | ✅ Pass / ❌ Fail / ⬜ N/A |
| Build | ✅ Pass / ❌ Fail / ⬜ N/A |

## Issues & Notes
[From plan.md ## Issues Encountered section, if any. "None" if no issues.]

## Team Mode Details (if applicable)
| Item | Value |
|------|-------|
| Agents | N |
| Cross-review Rounds | N |
| Issues Found/Fixed | N |
```

3. Display report confirmation:

```
📄 세션 리포트가 생성되었습니다: $WORK_DIR/report.md

👉 권장 다음 단계:
  1. 변경 사항을 검토하세요
  2. 테스트를 실행하세요
  3. 문제가 없으면 커밋하세요
  4. /deep-status 로 세션 요약을 확인할 수 있습니다
  5. /deep-report 로 리포트를 재생성할 수 있습니다
```

## Implementation Quality Rules

- **One task at a time**: Complete each task fully before moving to the next
- **No scope creep**: If you notice something that should be fixed but isn't in the plan, add it to `## Issues Encountered` instead of fixing it
- **Faithful execution**: The plan was reviewed and approved by the user. Respect their decisions.
- **Transparency**: If something doesn't work as planned, say so immediately
