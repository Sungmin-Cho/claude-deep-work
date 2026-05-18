---
name: deep-sensor-scan
description: "Use when the user wants to manually run computational sensors (linter, type checker, coverage) — works inside or outside a deep-work session. Triggers on `/deep-sensor-scan`, \"run sensors\", \"lint check\", \"type check\", \"coverage\", \"센서 실행\", \"린트 검사\", \"타입 검사\". Detects ecosystems via `sensors/detect.js`, runs per-tool with timeout, returns errors/warnings + FIX suggestions per file:line. Supports `--detect` (detection only), `--lint`, `--typecheck`, `--coverage` flags for selective runs."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-sensor-scan [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-sensor-scan", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) | Full sensor scan (detect + lint + typecheck + coverage) |
| `--detect` | Ecosystem detection 만 |
| `--lint` | Linter 만 |
| `--typecheck` | Type checker 만 |
| `--coverage` | Coverage 만 |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


# /deep-sensor-scan

Manual computational sensor scanning. Can be used inside or outside deep-work sessions.

## Usage

```
/deep-sensor-scan              # Full sensor scan (detect + run all)
/deep-sensor-scan --detect     # Show detected ecosystems only (no sensor execution)
/deep-sensor-scan --lint       # Run linter only
/deep-sensor-scan --typecheck  # Run type checker only
/deep-sensor-scan --coverage   # Run coverage measurement only
```

## How It Works

### Step 1: Ecosystem Detection

Run detection engine:
```bash
node "$PLUGIN_DIR/sensors/detect.js" "$PROJECT_ROOT"
```

Display detected ecosystems and tool availability. If `--detect` flag, stop here.

### Step 2: Sensor Execution

For each detected ecosystem with available tools, run sensors in order:

1. **Linter** (if available and not `--typecheck`/`--coverage` only):
   ```bash
   node "$PLUGIN_DIR/sensors/run-sensors.js" "<lint_cmd>" "<parser>" "lint" "required" 30
   ```

2. **Type checker** (if available and not `--lint`/`--coverage` only):
   ```bash
   node "$PLUGIN_DIR/sensors/run-sensors.js" "<typecheck_cmd>" "<parser>" "typecheck" "required" 60
   ```

3. **Coverage** (if available and not `--lint`/`--typecheck` only):
   Run test command with coverage flag appended.

### Step 3: Results Display

Show results in a clear format:
- Per-sensor: status (pass/fail/not_installed/timeout), error count, warning count
- Per-error: file:line, rule, message, FIX suggestion
- Summary: total errors, total warnings, ecosystems scanned
