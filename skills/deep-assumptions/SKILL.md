---
name: deep-assumptions
description: "Use when the user wants to inspect deep-work's assumption health report — Wilson Score-based per-assumption confidence, verdict (justified / loosen / drop), model-aware split, and decay history. Triggers on `/deep-assumptions`, `/deep-status --assumptions`, \"assumption health\", \"rule justification\", \"loosen enforcement\", \"어썸션 헬스\", \"규칙 정당화\", \"가정 검증\". Reads session evidence to decide whether deep-work's hook denylist + receipt validation rules are still justified. Sub-page of the deep-status hub."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-assumptions [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-assumptions", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) / `report` | Default — per-assumption confidence + Wilson Score + verdict + model-aware split |
| `report --verbose` | Per-signal per-session breakdown |
| `history` | ASCII confidence evolution timeline (requires 5+ sessions) |
| `export --format=badge` | shields.io 호환 JSON badge 출력 |
| `--rebuild` | Receipt 파일에서 JSONL 재생성 후 report 표시 |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Hub-spoke 관계**: 본 skill 은 `deep-status` hub 의 sub-page 입니다 — `/deep-status --<flag>` 가 본문 로직을 inline Read 하여 실행하는 것이 주 경로이며, 직접 호출도 동일하게 지원됩니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


> **Internal (v6.3.0)** — `/deep-status --assumptions`가 이 파일의 로직을 `Read`하여 실행합니다. 자동 호출이 주 경로이며, 직접 호출도 지원됩니다.
> 참조처: `skills/deep-status/SKILL.md` §9 (`Read skills/deep-assumptions/SKILL.md and follow its logic`).

# Assumption Health Report (v5.0)

Analyze deep-work's enforcement assumptions against session history to determine which rules are justified by evidence and which should be loosened.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Usage

- `/deep-assumptions` — Show assumption health report (default: `report`)
- `/deep-assumptions report` — Per-assumption confidence with Wilson Score, verdict, model-aware split
- `/deep-assumptions report --verbose` — Per-signal per-session breakdown
- `/deep-assumptions history` — ASCII confidence evolution timeline (requires 5+ sessions)
- `/deep-assumptions export --format=badge` — shields.io JSON badge output
- `/deep-assumptions --rebuild` — Regenerate JSONL from receipts, then show report

## Runtime Setup

### 1. Read state and paths

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `.claude/deep-work.local.md`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` and extract `work_dir`. If the state file doesn't exist, default `work_dir` to `deep-work`.

Set paths:
```
PLUGIN_DIR = <directory containing this command file>/../hooks/scripts
REGISTRY_PATH = <directory containing this command file>/../assumptions.json
WORK_DIR = $PROJECT_ROOT/<work_dir from state or "deep-work">
HISTORY_PATH = $WORK_DIR/harness-history/harness-sessions.jsonl
```

### 2. Parse subcommand

From `$ARGUMENTS`, determine the subcommand:

| Input | Action |
|-------|--------|
| (empty), `report` | Report (default) |
| `report --verbose` | Verbose report |
| `history` | Timeline |
| `export --format=badge` | Badge export |
| `--rebuild` | Rebuild JSONL, then report |

## Subcommand: `--rebuild`

Regenerate `harness-sessions.jsonl` from receipt files. This repairs corrupted or missing history.

Run via Bash:
```bash
echo '{"action":"rebuild","workDir":"<WORK_DIR>"}' | node "<PLUGIN_DIR>/assumption-engine.js"
```

Parse the JSON result. If `sessions` array is non-empty, write each session as a line to `$HISTORY_PATH` (creating `harness-history/` directory first with `mkdir -p`).

Display:
```
JSONL 재생성 완료
   소스: $WORK_DIR/receipts/
   세션 수: [N] entries rebuilt
   파일: $HISTORY_PATH
```

Then proceed to the default `report` subcommand.

## Subcommand: `report` (default)

### Step 1: Cold start / new model detection

Read `model_primary` from state file (or `"unknown"`).

Run via Bash:
```bash
echo '{"action":"detect-model","historyPath":"<HISTORY_PATH>","model":"<model_primary>"}' | node "<PLUGIN_DIR>/assumption-engine.js"
```

Parse JSON result. If `isNew` is true and `totalSessions` > 0:
```
⚠️ 새 모델 감지: <model_primary>
   이 모델의 세션 이력이 없습니다. 이전 모델(<totalSessions> sessions)의 데이터를 기반으로 보고합니다.
   해석 시 모델 차이를 고려하세요.
```

If `totalSessions` is 0:
```
ℹ️ 세션 이력이 없습니다.
   deep-work 세션을 실행하면 assumption 검증 데이터가 수집됩니다.
   최소 5회 세션 후 유의미한 분석이 가능합니다.
```
Stop here.

### Step 2: Generate report

Determine options based on arguments:
- Default: `{"splitByModel": true}`
- With `--verbose`: `{"splitByModel": true, "verbose": true}`

Run via Bash:
```bash
echo '{"action":"report","registryPath":"<REGISTRY_PATH>","historyPath":"<HISTORY_PATH>","options":{"splitByModel":true}}' | node "<PLUGIN_DIR>/assumption-engine.js"
```

Parse JSON result containing `text`, `data`, and `warnings`.

### Step 3: Display report

Display the `text` field from the engine result. This contains the formatted report:

```
ASSUMPTION HEALTH REPORT ([N] sessions analyzed)
========================================================

1. phase_guard_blocks_edits
   Hypothesis: Blocking edits during non-implement phases improves quality
   Evidence:   8 supporting / 1 weakening / 3 neutral
   Confidence: HIGH (0.82)
   Verdict:    KEEP at current level (block)

2. tdd_required_before_implement
   Hypothesis: RED-GREEN-REFACTOR produces fewer bugs
   Evidence:   5 supporting / 4 weakening / 3 neutral
   Confidence: MEDIUM (0.56)
   Verdict:    CONSIDER loosening to "coaching"
   [claude-opus-4-6]: HIGH (0.78) — 5S/1W/8 sessions
   [claude-sonnet-4-6]: LOW (0.32) — 0S/3W/4 sessions

3. research_required_before_plan
   ...

PROPOSED CONFIG CHANGES (for manual application):
  tdd_required_before_implement: strict -> coaching
  (no other changes recommended at this time)

Auto-adjustment is active (v5.1). Adjustments are applied at session start.
To override: /deep-work --tdd=strict [task]
```

After displaying the engine report text, check the state file for `assumption_adjustments`:

If `assumption_adjustments` is non-empty, display:
```
ACTIVE AUTO-ADJUSTMENTS (this session):
  - tdd_mode: strict → coaching (score 0.42)
  - receipt_depth: full → minimal (score 0.28)

These adjustments were applied at session start based on accumulated evidence.
User override (--tdd=X) takes precedence over auto-adjustments.
```

### Step 4: Verbose details (if `--verbose`)

If `--verbose` was specified, additionally display per-signal per-session breakdown from the `data` array.

For each assumption in `data`:
```
─── [assumption.id] 상세 분석 ───
Signal                                    | Type       | Sessions Triggered
────────────────────────────────────────────────────────────────────────────
test_pass_rate > threshold                | supporting | 2026-03-28, 2026-03-25
high_override_rate                        | weakening  | 2026-03-30
zero_rework_after_override                | weakening  | (none)
model_passes_all_tests_first_try          | supporting | 2026-03-28
```

To produce this, re-evaluate each assumption against each session:
- For each assumption in `data`, iterate over its signals from `assumptions.json`
- For each session, check if the signal was triggered (from the per-session evaluated details)
- Display the session_id (date portion) for triggered sessions, or "(none)"

### Step 5: Display warnings

If `warnings` array is non-empty, display at the bottom:
```
⚠️ Warnings:
   - [warning message 1]
   - [warning message 2]
```

### Step 6: Staleness tags

For any assumption with a "STALE" verdict in the report, append a staleness tag:
```
🕐 Stale assumptions detected. Run more sessions with varied configurations to refresh evidence.
```

## Subcommand: `history`

### Step 1: Check minimum sessions

Run the report action first to get session count. If fewer than 5 sessions:
```
ℹ️ 타임라인을 표시하려면 최소 5회 세션이 필요합니다.
   현재: [N]회
```
Stop here.

### Step 2: Generate timelines

Run via Bash:
```bash
echo '{"action":"timeline","registryPath":"<REGISTRY_PATH>","historyPath":"<HISTORY_PATH>","options":{"windowSize":3,"width":40,"height":10}}' | node "<PLUGIN_DIR>/assumption-engine.js"
```

Parse JSON result containing `timelines` object (keyed by assumption ID).

### Step 3: Display timelines

For each assumption, display its ASCII timeline chart:

```
Assumption Confidence Timeline
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[phase_guard_blocks_edits] Confidence Timeline
──────────────────────────────────────────────
1.0 |
0.7 |████████-----
    |████████████
0.4 |████████████-----
    |████████████████
    |████████████████
0.0 |████████████████
    +────────────────
     oldest    newest

[tdd_required_before_implement] Confidence Timeline
──────────────────────────────────────────────
1.0 |
0.7 |████----------
    |████████
0.4 |████████------
    |████████████
    |████████████
0.0 |████████████████
    +────────────────
     oldest    newest

─── Legend ───
█ = confidence at session window
- = threshold marker (HIGH=0.7, MEDIUM=0.4)
Each column = window of 3 sessions
```

## Subcommand: `export --format=badge`

### Step 1: Generate badge

Run via Bash:
```bash
echo '{"action":"badge","registryPath":"<REGISTRY_PATH>","historyPath":"<HISTORY_PATH>"}' | node "<PLUGIN_DIR>/assumption-engine.js"
```

### Step 2: Display and save

Parse JSON result (shields.io format). Display:

```
Harness Health Badge (shields.io endpoint format):

{
  "schemaVersion": 1,
  "label": "harness health",
  "message": "78%",
  "color": "brightgreen"
}

README.md에 추가:
  ![Harness Health](https://img.shields.io/badge/harness_health-78%25-brightgreen)

또는 endpoint badge로 사용하려면 위 JSON을 파일로 저장 후 shields.io endpoint URL을 설정하세요.
```

Write the badge JSON to `$WORK_DIR/harness-history/badge.json`.

## Error Handling

- If `assumptions.json` is missing: show "Registry not found. Ensure deep-work v5.0 is installed."
- If `harness-sessions.jsonl` is missing or empty: show the cold start message from Step 1.
- If `node` is not available: show "Node.js is required to run the assumption engine."
- If the engine returns an `error` field: display it as a warning and stop.
