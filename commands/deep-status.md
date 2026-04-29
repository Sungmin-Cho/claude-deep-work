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

#### Fork 자동 감지 (v5.6)

인자 없이 `--compare`만 사용하면 fork 관계를 자동 감지:
- 현재 세션의 상태 파일에서 `fork_info`가 있으면 → 부모 세션과 비교
- 현재 세션의 상태 파일에서 `fork_children`이 있으면 → 가장 최근 fork 자식과 비교
- fork 관계가 없으면 → 아래의 기존 수동 선택 플로우로 진행

Fork 관계로 자동 감지된 비교인 경우 출력에 라벨 추가:
```
📊 Session Comparison (fork relationship)
```

#### 기존 비교 플로우

1. List all session folders in `.deep-work/` directory
2. If fewer than 2 sessions exist, inform the user:
   ```
   ℹ️ 비교할 세션이 부족합니다. 최소 2개의 세션이 필요합니다.
   ```
3. Present the session list and ask the user to select 2 sessions to compare
4. Read research.md, plan.md, and report.md from both sessions
5. Display a comparison summary:
   ```
   세션 비교

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

### 0-1. Parse flags

Parse `$ARGUMENTS` for the following flags. If multiple flags are provided, execute each in order.

| Flag | Effect |
|------|--------|
| `--receipts` | Show receipt dashboard |
| `--receipts SLICE-NNN` | Show specific slice receipt detail |
| `--receipts --export=json` | Export all receipts as single JSON |
| `--receipts --export=md` | Export as markdown (for PR descriptions) |
| `--receipts --export=ci` | Export CI bundle |
| `--history` | Show cross-session trends |
| `--report` | Show/generate session report |
| `--assumptions` | Show assumption health report |
| `--assumptions --verbose` | Per-signal per-session breakdown |
| `--assumptions --rebuild` | Regenerate JSONL from receipts, then show report |
| `--badge` | Generate shields.io badge markdown |
| `--tree` | Fork relationship tree visualization (v5.6) |
| `--all` | Show all sessions dashboard (multi-session) + all flags |
| `--compare` | Compare two sessions (existing, handled in Section 0) |

If no flags are provided (and no `--compare`), show the default view only (Steps 1-5).
If a flag is provided, execute the corresponding section after the default view.

### 1. Check if a session exists (multi-session aware)

Resolve the current session using the following priority:

1. **Environment variable**: If `DEEP_WORK_SESSION_ID` is set → read `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. **Pointer file**: If `.claude/deep-work-current-session` exists → read session ID → read `.claude/deep-work.${SESSION_ID}.md`
3. **Legacy fallback**: Read `.claude/deep-work.local.md`

If none of the above resolves to an existing state file, display:

```
ℹ️ 활성화된 Deep Work 세션이 없습니다.

새 세션을 시작하려면: /deep-work <작업 설명>
```

If flags were provided (`--history`, `--assumptions`, `--receipts`, `--report`, `--all`):
- Skip the default view (Steps 2-4) but still execute the corresponding flag handler sections (Steps 6-10). These features can work without an active session by reading historical data from `.deep-work/` directory.

If no flags were provided:
- Skip to [Step 5: Show session history](#5-show-session-history).

### 2. Read state and artifacts

Read the resolved state file (from Step 1) to get session state.

Extract `work_dir` from the state file. If missing, default to `deep-work` (backward compatibility).
Set `WORK_DIR` to this value.

Read `model_routing` from the state file. If missing, show defaults (Research=sonnet, Plan=현재 세션, Implement=sonnet, Test=haiku for model routing).

Read `evaluator_model`, `assumption_adjustments`, `skipped_phases`, `plan_review_retries`, and `plan_review_max_retries` from the state file. If missing, default to: evaluator_model="없음", assumption_adjustments=[] (empty), skipped_phases=[] (empty), plan_review_retries=0, plan_review_max_retries=3.

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

### 2-1. Read sensor data

If receipts directory exists (`$WORK_DIR/receipts/`):
- Read all `SLICE-NNN.json` receipt files
- For each receipt, extract `sensor_results` if present
- Count slices where all sensor statuses are `pass` or `not_applicable` → Sensor Clean Rate numerator
- Count total slices with sensor data → Sensor Clean Rate denominator
- Read `mutation_testing` from the state file for mutation score

If no receipt files have `sensor_results`, show "N/A ⬜" for sensor status.

### 2-2. Read health check data

Read `health_report` from the session state file. If present, extract:
- **Drift metrics**: `health_report.drift.dead_exports.count`, `health_report.drift.coverage_trend.delta`, `health_report.drift.dependency_vuln.critical`, `health_report.drift.dependency_vuln.high`, `health_report.drift.stale_config.count`
- **Fitness metrics**: `health_report.fitness.passed`, `health_report.fitness.total_rules`, `health_report.fitness.required_missing`
- **Required status**: `unresolved_required_issues` count, `acknowledged_required_issues` presence

If `health_report` is absent from the state file, show "N/A ⬜" for Health Check status.

### 3. Calculate progress

From `$WORK_DIR/plan.md`, count:
- Total tasks: number of lines matching `- [ ]` or `- [x]`
- Completed tasks: number of lines matching `- [x]`
- Progress percentage: completed / total * 100

### 4. Display status

Show a comprehensive status report. If the `team_mode` field is missing from the state file, treat it as "Solo" (backward compatibility).

**Conditional v5.1 fields:**
- `평가자 모델`: Always show the evaluator_model value (or "없음" if not set).
- `Assumption 조정`: Only show if `assumption_adjustments` is non-empty. Display the count of adjustments.
- `건너뛴 단계`: Only show if `skipped_phases` is non-empty. Display the list of skipped phase names.
- `Auto-Loop` on Phase 2 line: Only show the parenthetical if `plan_review_retries` > 0 or `auto_loop_enabled` is true.

```
Deep Work 세션 상태
━━━━━━━━━━━━━━━━━━━━━━━━━━

작업: [task description]
작업 폴더: [work_dir]
시작: [started_at]
반복 횟수: [iteration_count]
작업 모드: [Solo / Team]
프로젝트 타입: [Existing / Zero-Base]
Git 브랜치: [git_branch or "없음"]
모델 라우팅: Research=[model], Plan=main (현재 세션), Implement=[model], Test=[model]
평가자 모델: [evaluator_model] (v5.1)

### Fork 관계 표시 (v5.6)

상태 파일에서 `fork_info`가 있으면:
```
Fork: {SESSION_ID} (forked from {fork_info.parent_session} at {fork_info.parent_phase_at_fork} → {fork_info.restart_phase})
Mode: {fork_info.fork_mode} | Generation: {fork_info.fork_generation}
```

상태 파일에서 `fork_children`이 있으면:
```
Fork children:
  - {child.session_id} ({child.restart_phase}) {child.status || "active"}
```

fork_info도 fork_children도 없으면 이 섹션을 생략한다.

현재 단계: [Phase name with emoji]
   Phase 0 (Brainstorm): [✅ 완료 / ⏳ 진행중 / ⬜ 대기 / ⏭️ 생략]
   Phase 1 (Research):   [✅ 완료 / ⏳ 진행중 / ⬜ 대기]
   Phase 2 (Plan):       [✅ 승인됨 / ⏳ 진행중 / ⬜ 대기] (Auto-Loop: [plan_review_retries]/[plan_review_max_retries])
   Phase 3 (Implement):  [✅ 완료 / ⏳ 진행중 / ⬜ 대기]
   Phase 4 (Test):       [✅ 통과 / ⏳ 진행중 / ⬜ 대기 / ❌ 실패(N회)]

구현 진행률: [N/M 완료 (XX%)]
   ████████░░ XX%

Phase별 소요 시간:
   Brainstorm: [duration or "N/A" or "생략"]
   Research: [duration or "N/A"]
   Plan: [duration or "N/A"]
   Implement: [duration or "N/A"]
   Test: [duration or "N/A"]
Quality Gates: [통과 ✅ / 실패 ❌ / 미정의 ⬜]
리뷰 현황:
   Brainstorm: [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Research: [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Plan (Structural): [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Plan (Adversarial): [Claude N/10, Codex N/10 — Consensus N, Conflicts N, Waivers N / 미실행 / 도구 미설치]
크로스 모델: [codex ✅ + gemini ❌ / 모두 미설치 / 비활성화]
Assumption 조정: [N]건 적용됨 (v5.1)
건너뛴 단계: [brainstorm, research, plan]

센서 상태:
   생태계: [ecosystem, e.g. typescript (eslint ✅, tsc ✅, stryker ❌)] [or "감지 안됨 ⬜" if no sensor data]
   Sensor Clean Rate: [N]/[total] ([N]%) [or "N/A ⬜" if no sensor data in receipts]
   Mutation Score: [N]% ([Phase 4 실행됨 / 미실행 ⬜ / not_applicable ⏭️])

Health Check:
   드리프트: dead-export {N}건 ⚠️ | coverage {+/-N}%p ✅ | vuln {N}건 🔴 | stale {N}건 ✅
   Fitness:  {N}/{M} 통과 ✅ | required_missing: {N}건

산출물:
   - $WORK_DIR/brainstorm.md: [존재함 ✅ / 없음 ⬜ / 생략 ⏭️]
   - $WORK_DIR/research.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/plan.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/test-results.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/report.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/quality-gates.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/insight-report.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/file-changes.log: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/plan-diff.md: [존재함 ✅ / 없음 ⬜]

다음 행동: [안내 메시지]
```

Adjust the "다음 행동" based on the current phase:
- **brainstorm**: `자동 흐름이 brainstorm을 진행합니다. /deep-work로 시작하세요.`
- **research**: `자동 흐름이 research를 진행 중입니다.`
- **plan**: `plan 승인을 기다리고 있습니다.` (or "plan 수정이 필요하면 /deep-plan을 사용하세요" if plan exists)
- **implement**: `자동 흐름이 구현을 진행 중입니다.`
- **test**: `자동 흐름이 테스트를 진행 중입니다.` (or "자동 수정 루프가 진행 중입니다 (시도 N/3)" if test_retry_count > 0)
- **idle**: `세션이 완료되었습니다. /deep-status --report로 리포트를 확인하세요. 새 세션: /deep-work <작업>`

### 5. Show session history

List previous session folders by scanning `.deep-work/` directory for subdirectories:

```bash
ls -d .deep-work/*/  2>/dev/null
```

If subdirectories exist, display:

```
세션 히스토리:
   - .deep-work/20260307-143022-jwt-기반-인증/ [report.md 존재 여부]
   - .deep-work/20260306-091500-api-리팩토링/ [report.md 존재 여부]
   ...

TIP: /deep-status --compare 로 두 세션을 비교할 수 있습니다.
```

For each folder, check if `report.md` exists and show:
- `(완료 - 리포트 있음)` if report.md exists
- `(산출물만 보존)` if report.md doesn't exist

If no subdirectories exist and no flat files (research.md, plan.md) exist in `.deep-work/`, skip the history section.

### 6. --receipts: Receipt Dashboard

If `$ARGUMENTS` contains `--receipts`:

Read the `/deep-receipt` command file and follow its display logic inline.

If a specific slice ID follows `--receipts` (e.g., `--receipts SLICE-001`):
- Show detailed receipt for that slice (equivalent to `/deep-receipt view SLICE-NNN`)

If `--export=FORMAT` is present:
- `json`: Export all receipts as single JSON file (equivalent to `/deep-receipt export --format=json`)
- `md`: Export as markdown for PR descriptions (equivalent to `/deep-receipt export --format=md`)
- `ci`: Export CI bundle — session-receipt + all slice receipts (equivalent to `/deep-receipt export --format=ci`)

Otherwise (bare `--receipts`):
- Show the ASCII receipt dashboard (equivalent to `/deep-receipt dashboard`)

### 7. --history: Cross-Session Trends

If `$ARGUMENTS` contains `--history`:

Read the `/deep-history` command file and follow its display logic inline.

If insufficient session data (fewer than 2 completed sessions in `.deep-work/harness-history/harness-sessions.jsonl`):
```
ℹ️ 세션 이력이 부족합니다 (최소 2개 완료된 세션 필요).
   /deep-work로 세션을 시작하고 완료하면 이력이 기록됩니다.
```

**Quality Score Trend (v5.3)**: After displaying the existing session history, also show the quality score trend:

1. Read `.deep-work/harness-history/harness-sessions.jsonl` (shared path)
2. Filter to entries with `status: "finalized"` and `quality_score` not null
3. If fewer than 2 qualifying sessions, display: `ℹ️ Quality trend는 2개 이상의 완료 세션이 필요합니다.`
4. Otherwise, invoke the assumption engine and display the ASCII quality trend chart:

```
📈 Quality Trend (최근 [N] 세션)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
100|
 80|    *  *     *  *  *
 60| *        *
 40|
 20|
   +──────────────────
    #1 #2 #3 #4 #5 #6 #7

Average: [N]/100  Trend: [↑/↓] ([+/-N])
Best: #[N] ([score])  Worst: #[N] ([score])
```

### 8. --report: Session Report

If `$ARGUMENTS` contains `--report`:

Read the `/deep-report` command file and follow its logic:
- If `$WORK_DIR/report.md` exists: display its contents
- If not: generate the report following `/deep-report`'s structure, then display

### 9. --assumptions: Assumption Health

If `$ARGUMENTS` contains `--assumptions`:

Read the `/deep-assumptions` command file and follow its logic.

Sub-flags:
- `--verbose`: Show per-signal per-session breakdown (equivalent to `/deep-assumptions report --verbose`)
- `--rebuild`: Regenerate JSONL from receipt files, then show report (equivalent to `/deep-assumptions --rebuild`)
- No sub-flag: Show default health report (equivalent to `/deep-assumptions report`)

### 10. --all: All Sessions Dashboard + Everything

If `$ARGUMENTS` contains `--all`:

#### 10a. Multi-session dashboard

Read the registry (`.claude/deep-work-sessions.json`). If the registry exists and has sessions:

Display a table of all registered sessions:

```
📋 전체 세션 대시보드
━━━━━━━━━━━━━━━━━━━━━━━━━━

| 세션 ID | 작업 | Phase | 최근 활동 | 상태 | 소유 파일 |
|---------|------|-------|----------|------|----------|
| s-a3f7b2c1 | JWT 인증 구현 | implement | 5분 전 | ✅ 활성 | src/auth/**, src/middleware/jwt.ts |
| s-b8e2d4f0 | API 리팩토링 | plan | 2시간 전 | ⚠️ stale? | src/api/** |
| s-c1d3e5f7 | 테스트 추가 | idle | 1일 전 | 💤 완료 | — |

현재 세션: [current SESSION_ID or "없음"]
총 활성: [N]개 / 총 등록: [M]개
```

For each session:
- **상태**: Check PID liveness (`kill -0 PID 2>/dev/null`)
  - PID alive → `✅ 활성`
  - PID dead → `⚠️ stale?`
  - Phase is `idle` → `💤 완료`
- **최근 활동**: Relative time from `last_activity` field
- **소유 파일**: Abbreviated `file_ownership` list (max 3 items, then `+N more`)

If registry doesn't exist or has no sessions:
```
ℹ️ 등록된 세션이 없습니다.
```

#### 10b. Standard views

Then execute Steps 4 (default view for current session), 5 (session history), 6 (receipts dashboard), 7 (history trends), 8 (report), 9 (assumptions), 11 (tree), 12 (badge) in sequence.

### 11. --tree: Fork Relationship Tree (v5.6)

If `$ARGUMENTS` contains `--tree`:

레지스트리(`.claude/deep-work-sessions.json`)에서 모든 세션을 읽고, `fork_parent` 관계로 트리를 구성한다.

**구현 방법:**
1. 레지스트리에서 모든 세션을 읽는다
2. `fork_parent`가 없는 세션을 루트 노드로 식별
3. `fork_parent`로 부모-자식 관계를 트리로 구성
4. DFS로 트리를 순회하며 UTF-8 트리 문자(├── └──)로 출력
5. 각 노드: `{session_id} [{phase}] "{task_description}"`
6. Fork 세션이면: `fork @ {restart_phase} → {task_description}`

**트리 표시 형식:**

```
🌳 Fork Relationship Tree
━━━━━━━━━━━━━━━━━━━━━━━━━━

s-aaa11111 [implement] "JWT auth feature"
├── s-bbb22222 [implement] fork @ plan → GraphQL approach
└── s-ccc33333 [plan] fork @ research → microservice approach
    └── s-ddd44444 [research] fork @ brainstorm → serverless approach

s-eee55555 [idle] "Refactor API"  (no forks)
```

현재 세션은 `◀` 표시로 강조:
```
s-aaa11111 [implement] "JWT auth feature" ◀ current
```

레지스트리가 없거나 세션이 없으면:
```
ℹ️ 등록된 세션이 없습니다.
```

### 12. --badge: Quality Badge (v5.3)

If `$ARGUMENTS` contains `--badge`:

1. Read `harness-sessions.jsonl` from `.deep-work/harness-history/` (shared path)
2. Calculate average quality score, session count, and average fidelity from finalized sessions
3. Generate shields.io badge markdown:

```
📛 Badges (copy to README.md):

![Deep Work Quality](https://img.shields.io/badge/deep--work-quality%20[score]%2F100-[color])
![Sessions](https://img.shields.io/badge/sessions-[count]-blue)
![Plan Fidelity](https://img.shields.io/badge/plan%20fidelity-[pct]%25-[color])
```

Color thresholds:
- 80+: brightgreen
- 60-79: green
- 40-59: yellow
- <40: red

If no finalized sessions exist:
```
ℹ️ Badge 생성을 위해 최소 1개의 완료된 세션이 필요합니다.
   /deep-work로 세션을 시작하고 완료하면 badge가 생성됩니다.
```
