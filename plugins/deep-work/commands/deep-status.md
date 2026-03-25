---
allowed-tools: Read, Glob, Bash
description: "Check the current deep work session status and progress"
---

# Deep Work Status

Display the current state of the Deep Work session and session history.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Instructions

### 0. Check for compare mode

If `$ARGUMENTS` contains `--compare`:

1. List all session folders in `deep-work/` directory
2. If fewer than 2 sessions exist, inform the user:
   ```
   ℹ️ 비교할 세션이 부족합니다. 최소 2개의 세션이 필요합니다.
   ```
3. Present the session list and ask the user to select 2 sessions to compare
4. Read research.md, plan.md, and report.md from both sessions
5. Display a comparison summary:
   ```
   📊 세션 비교

   | 항목 | 세션 A | 세션 B |
   |------|--------|--------|
   | 작업 | [task A] | [task B] |
   | 접근법 | [approach A] | [approach B] |
   | 수정 파일 수 | [N] | [M] |
   | 검증 결과 | ✅/❌ | ✅/❌ |
   | 소요 시간 | [duration A] | [duration B] |

   ### 주요 차이점
   - **접근법 변화**: [description]
   - **수정 파일 차이**: [files only in A], [files only in B]
   - **검증 결과 차이**: [description]
   ```
6. Stop here (do not proceed to regular status display).

### 1. Check if a session exists

Look for `.claude/deep-work.local.md`. If it doesn't exist, display:

```
ℹ️ 활성화된 Deep Work 세션이 없습니다.

새 세션을 시작하려면: /deep-work <작업 설명>
```

Then skip to [Step 5: Show session history](#5-show-session-history).

### 2. Read state and artifacts

Read `.claude/deep-work.local.md` to get session state.

Extract `work_dir` from the state file. If missing, default to `deep-work` (backward compatibility).
Set `WORK_DIR` to this value.

Read `model_routing` and `notifications` from the state file. If missing, show defaults (Research=sonnet, Plan=현재 세션, Implement=sonnet, Test=haiku for model routing; "설정 없음" for notifications).

Read the following files if they exist:
- `$WORK_DIR/research.md` — check if it has content
- `$WORK_DIR/plan.md` — count checklist progress
- `$WORK_DIR/report.md` — check if it exists
- `$WORK_DIR/test-results.md` — check if it exists
- `$WORK_DIR/quality-gates.md` — check if it exists
- `$WORK_DIR/insight-report.md` — check if it exists
- `$WORK_DIR/file-changes.log` — check if it exists
- `$WORK_DIR/plan-diff.md` — check if it exists
- Read `review_state`, `cross_model_enabled`, and `review_results` from state file
- Read `$WORK_DIR/brainstorm-review.json`, `$WORK_DIR/research-review.json`, `$WORK_DIR/plan-review.json`, `$WORK_DIR/plan-cross-review.json` if they exist

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
🏗️ 프로젝트 타입: [Existing / Zero-Base]
🌿 Git 브랜치: [git_branch or "없음"]
🧠 모델 라우팅: Research=[model], Plan=main (현재 세션), Implement=[model], Test=[model]
🔔 알림: [설정 없음 / 로컬 / 로컬 + Slack + ...]

📍 현재 단계: [Phase name with emoji]
   🧠 Phase 0 (Brainstorm): [✅ 완료 / ⏳ 진행중 / ⬜ 대기 / ⏭️ 생략]
   🔬 Phase 1 (Research):   [✅ 완료 / ⏳ 진행중 / ⬜ 대기]
   📐 Phase 2 (Plan):       [✅ 승인됨 / ⏳ 진행중 / ⬜ 대기]
   🔨 Phase 3 (Implement):  [✅ 완료 / ⏳ 진행중 / ⬜ 대기]
   🧪 Phase 4 (Test):       [✅ 통과 / ⏳ 진행중 / ⬜ 대기 / ❌ 실패(N회)]

📈 구현 진행률: [N/M 완료 (XX%)]
   ████████░░ XX%

⏱️ Phase별 소요 시간:
   Brainstorm: [duration or "N/A" or "생략"]
   Research: [duration or "N/A"]
   Plan: [duration or "N/A"]
   Implement: [duration or "N/A"]
   Test: [duration or "N/A"]
📊 Quality Gates: [통과 ✅ / 실패 ❌ / 미정의 ⬜]
🔬 리뷰 현황:
   Brainstorm: [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Research: [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Plan (Structural): [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Plan (Adversarial): [Claude N/10, Codex N/10 — Consensus N, Conflicts N, Waivers N / 미실행 / 도구 미설치]
🔍 크로스 모델: [codex ✅ + gemini ❌ / 모두 미설치 / 비활성화]

📁 산출물:
   - $WORK_DIR/brainstorm.md: [존재함 ✅ / 없음 ⬜ / 생략 ⏭️]
   - $WORK_DIR/research.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/plan.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/test-results.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/report.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/quality-gates.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/insight-report.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/file-changes.log: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/plan-diff.md: [존재함 ✅ / 없음 ⬜]

👉 다음 행동: [안내 메시지]
```

Adjust the "다음 행동" based on the current phase:
- **brainstorm**: `/deep-brainstorm 명령을 실행하세요`
- **research**: `/deep-research 명령을 실행하세요`
- **plan**: `/deep-plan 명령을 실행하세요` (or "plan.md를 검토하고 승인하세요" if plan exists)
- **implement**: `/deep-implement 명령을 실행하세요`
- **test**: `/deep-test 명령을 실행하세요` (or "코드를 수정한 후 /deep-test 명령을 다시 실행하세요" if test_retry_count > 0)
- **idle**: `세션이 완료되었습니다. /deep-report 명령으로 리포트를 확인하세요. 새 세션: /deep-work <작업>`

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

💡 TIP: /deep-status --compare 로 두 세션을 비교할 수 있습니다.
```

For each folder, check if `report.md` exists and show:
- `(완료 - 리포트 있음)` if report.md exists
- `(산출물만 보존)` if report.md doesn't exist

If no subdirectories exist and no flat files (research.md, plan.md) exist in `deep-work/`, skip the history section.
