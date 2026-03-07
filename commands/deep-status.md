---
allowed-tools: Read, Glob, Bash
description: "Check the current deep work session status and progress"
---

# Deep Work Status

Display the current state of the Deep Work session and session history.

## Instructions

### 1. Check if a session exists

Look for `.claude/deep-work.local.md`. If it doesn't exist, display:

```
ℹ️  활성화된 Deep Work 세션이 없습니다.

새 세션을 시작하려면: /deep-work <작업 설명>
```

Then skip to [Step 5: Show session history](#5-show-session-history).

### 2. Read state and artifacts

Read `.claude/deep-work.local.md` to get session state.

Extract `work_dir` from the state file. If missing, default to `deep-work` (backward compatibility).
Set `WORK_DIR` to this value.

Read the following files if they exist:
- `$WORK_DIR/research.md` — check if it has content
- `$WORK_DIR/plan.md` — count checklist progress
- `$WORK_DIR/report.md` — check if it exists

### 3. Calculate progress

From `$WORK_DIR/plan.md`, count:
- Total tasks: number of lines matching `- [ ]` or `- [x]`
- Completed tasks: number of lines matching `- [x]`
- Progress percentage: completed / total * 100

### 4. Display status

Show a comprehensive status report. If the `team_mode` field is missing from the state file, treat it as "Solo" (backward compatibility).

```
📊 Deep Work 세션 상태
━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 작업: [task description]
📂 작업 폴더: [work_dir]
🕐 시작: [started_at]
🔄 반복 횟수: [iteration_count]
🤝 작업 모드: [Solo / Team]

📍 현재 단계: [Phase name with emoji]
   🔬 Phase 1 (Research): [✅ 완료 / ⏳ 진행중 / ⬜ 대기]
   📐 Phase 2 (Plan):     [✅ 승인됨 / ⏳ 진행중 / ⬜ 대기]
   🔨 Phase 3 (Implement):[✅ 완료 / ⏳ 진행중 / ⬜ 대기]

📈 구현 진행률: [N/M 완료 (XX%)]
   ████████░░ XX%

📁 산출물:
   - $WORK_DIR/research.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/plan.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/report.md: [존재함 ✅ / 없음 ⬜]

👉 다음 행동: [안내 메시지]
```

Adjust the "다음 행동" based on the current phase:
- **research**: `/deep-research 를 실행하세요`
- **plan**: `/deep-plan 을 실행하세요` (or "plan.md를 검토하고 승인하세요" if plan exists)
- **implement**: `/deep-implement 를 실행하세요`
- **idle**: `세션이 완료되었습니다. /deep-report 로 리포트를 확인하세요. 새 세션: /deep-work <작업>`

### 5. Show session history

List previous session folders by scanning `deep-work/` directory for subdirectories:

```bash
ls -d deep-work/*/  2>/dev/null
```

If subdirectories exist, display:

```
📂 세션 히스토리:
   - deep-work/20260307-143022-jwt-기반-인증/ [report.md 존재 여부]
   - deep-work/20260306-091500-api-리팩토링/ [report.md 존재 여부]
   ...
```

For each folder, check if `report.md` exists and show:
- `(완료 - 리포트 있음)` if report.md exists
- `(산출물만 보존)` if report.md doesn't exist

If no subdirectories exist and no flat files (research.md, plan.md) exist in `deep-work/`, skip the history section.
