---
name: deep-receipt
description: "Use when the user wants to view, dashboard, or export deep-work slice receipts (`receipts/SLICE-*.json`). Triggers on `/deep-receipt`, `/deep-status --receipts`, \"receipt dashboard\", \"slice receipt\", \"리시트 보기\", \"리시트 대시보드\", \"에비던스 리시트\". Default subcommand is `dashboard` (ASCII visual of all slice receipts). Also: `view SLICE-NNN`, `export`, `validate`. Sub-page of the deep-status hub."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-receipt [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-receipt", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) / `dashboard` | ASCII visual dashboard of all slice receipts |
| `view SLICE-NNN` | 특정 slice 의 receipt 상세 |
| `export` | JSON / Markdown export |
| `validate` | 8-item 검증 (verify-delegated-receipt-runner) |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Hub-spoke 관계**: 본 skill 은 `deep-status` hub 의 sub-page 입니다 — `/deep-status --<flag>` 가 본문 로직을 inline Read 하여 실행하는 것이 주 경로이며, 직접 호출도 동일하게 지원됩니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


> **Internal (v6.3.0)** — `/deep-status --receipts`가 이 파일의 display logic을 `Read`하여 실행합니다. 자동 호출이 주 경로이며, 직접 호출도 지원됩니다.
> 참조처: `skills/deep-status/SKILL.md` §6 (`Read skills/deep-receipt/SKILL.md and follow its display logic inline`).

# Receipt Management (v4.0)

View, export, and manage evidence receipts from the implementation phase.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. Output ALL user-facing messages in the detected language.

## Usage

- `/deep-receipt` — Show receipt dashboard (same as `/deep-receipt dashboard`)
- `/deep-receipt dashboard` — ASCII visual dashboard of all slice receipts
- `/deep-receipt view SLICE-NNN` — Show detailed receipt for a specific slice
- `/deep-receipt export --format=json` — Export all receipts as single JSON file
- `/deep-receipt export --format=md` — Export as markdown (for PR descriptions)
- `/deep-receipt export --format=ci` — Export CI bundle (session-receipt + all slice receipts in one JSON, for GitHub Actions validation)

## Runtime Setup

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `.claude/deep-work.local.md`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` and extract `work_dir`.
Receipts are stored in `$WORK_DIR/receipts/SLICE-NNN.json`.

**Envelope-aware reads (v6.5.0)**: deep-work 6.5.0 부터 SLICE-*.json 과
`session-receipt.json` 는 M3 cross-plugin envelope (`{schema_version: "1.0",
envelope: {...}, payload: {...}}`) 로 emit 된다 (cf.
`claude-deep-suite/docs/envelope-migration.md` §1). 본 명령의 모든 receipt
read 단계에서 다음 unwrap 규칙을 적용한다:

1. JSON 파싱 후 root 가 envelope 형태이면 (`schema_version === "1.0"`,
   `envelope` 객체, `payload` 키 모두 존재) identity guard 검증:
   `envelope.producer === "deep-work"` ∧
   `envelope.artifact_kind ∈ {slice-receipt, session-receipt}` ∧
   `envelope.schema.name === envelope.artifact_kind`. 위 조건을 모두 통과하면
   `payload` 객체를 사용 (legacy receipt body). 한 항목이라도 어긋나면
   "foreign envelope at <path>" 경고 후 receipt 무시 (handoff §4 round-4
   identity guard).
2. Legacy(non-envelope) JSON 이면 그대로 사용 (forward-compat).
3. `/deep-receipt export --format=ci` 같은 bundle export 는 envelope wrapping
   을 그대로 유지한 채 묶어 외부 CI 에 전달한다 (envelope 의 run_id chain 이
   audit 용).

## Dashboard

Scan `$WORK_DIR/receipts/` directory for all receipt JSON files. For each receipt, display:

```
Receipt Dashboard

┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ Slice    │ TDD      │ Tests    │ Spec     │ Contract │ Review   │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ SLICE-001│ ✅ GREEN │ 5/5 PASS │ 3/3 ✅   │ 4/4 PASS │ PASS     │
│ SLICE-002│ 🟡 RED_V │ 2/5 FAIL │ 1/3 ⏳   │ 1/3 FAIL │ —        │
│ SLICE-003│ ⬜ PEND  │ —        │ —        │ —        │ —        │
│ SLICE-004│ SPIKE    │ —        │ —        │ —        │ ⚠️       │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘

요약:
  완료: 1/4 (25%)
  TDD 준수: 1 strict, 0 relaxed, 0 override, 1 spike
  총 변경: +142 -23 (8 files)
```

TDD state icons:
- ✅ GREEN/REFACTOR — TDD cycle complete
- 🔴 RED — failing test written, not yet green
- 🟡 RED_VERIFIED — verified failing test, implementation pending
- 🟢 GREEN_ELIGIBLE — production code written, verification pending
- ⬜ PENDING — not started
- SPIKE — spike mode (not merge-eligible)
- override — TDD skipped by user (merge-eligible with warning)
- 🔍 SENSOR_RUN — Computational sensor running
- 🔧 SENSOR_FIX — Fixing sensor errors (self-correction loop active)
- ✅ SENSOR_CLEAN — All sensors passed

## Health Check Display

When displaying any receipt (dashboard or view), if the session state file contains `health_report`, include the Health Check section:

```
### Health Check (Phase 1 진단)
- 🔍 드리프트: dead-export {count}건 | coverage {delta}%p | vuln {critical+high}건 | stale {count}건
- 📐 Fitness: {passed}/{total} 통과 | 위반 delta: {delta}건
- ⚠️ Required: {acknowledged ? "acknowledged" : "미해결 N건"}
```

**Steps**:
1. Read `health_report` from the session state file
2. Extract drift metrics: `health_report.drift.dead_exports.count`, `health_report.drift.coverage_trend.delta`, `health_report.drift.dependency_vuln.critical + health_report.drift.dependency_vuln.high`, `health_report.drift.stale_config.count`
3. Extract fitness metrics: `health_report.fitness.passed`, `health_report.fitness.total_rules`, `health_report.fitness.required_missing`
4. Extract required status: check `acknowledged_required_issues` in the state file
5. If `health_report` is absent from the state file, skip this section silently

## View

`/deep-receipt view SLICE-NNN`:

Read `$WORK_DIR/receipts/SLICE-NNN.json` and display formatted:

```
Receipt: SLICE-NNN — [Goal from plan.md]

TDD Cycle:
  🔴 RED:   [timestamp] — [test name]
  🟢 GREEN: [timestamp] — [N tests passing]

Changes:
  Files: [file1, file2]
  Diff:  +[N] -[N] lines

Spec Compliance:
  ✅ [requirement 1]
  ✅ [requirement 2]
  ❌ [requirement 3]

Contract Compliance:
  ✅ [contract item 1]
  ✅ [contract item 2]
  ❌ [contract item 3]
  Threshold: [all/majority]
  Result: [PASS/FAIL]

Code Review:
  결과: [PASS/WARN]
  Findings: [N] (critical: [N], important: [N])

Sensor Results:
  생태계: [ecosystem, e.g. typescript]
  Lint ([tool]): [pass|fail|not_applicable] — errors: [N], warnings: [N], correction_rounds: [N]
  Typecheck ([tool]): [pass|fail|not_applicable] — errors: [N], correction_rounds: [N]
  Coverage ([tool]): [pass|fail|not_applicable] — line: [N]%, branch: [N]%

Debug Log:
  [None / RC-NNN: root cause description]
```

If `sensor_results` is absent from the receipt, skip the Sensor Results block silently.

## Export — JSON

`/deep-receipt export --format=json`:

Read all receipt files, combine into a single JSON array, and write to `$WORK_DIR/receipts-export.json`:

```json
{
  "session": {
    "task": "[task_description]",
    "branch": "[git_branch]",
    "timestamp": "[ISO]",
    "tdd_mode": "[strict/relaxed/spike]"
  },
  "summary": {
    "total_slices": N,
    "completed": N,
    "tdd_compliance": { "strict": N, "relaxed": N, "override": N, "spike": N },
    "total_changes": { "added": N, "removed": N, "files": N },
    "debug_count": N,
    "contract_compliance": {
      "total_items": N,
      "passed": N,
      "failed": N,
      "pass_rate": "N%"
    }
  },
  "slices": [
    {
      "...other receipt fields...",
      "contract_compliance": {
        "items": { "item1": true, "item2": true, "item3": false },
        "threshold": "all",
        "result": "FAIL"
      }
    }
  ]
}
```

Display: `Exported: $WORK_DIR/receipts-export.json`

## Export — Markdown

`/deep-receipt export --format=md`:

Generate a markdown summary suitable for PR descriptions. Write to `$WORK_DIR/receipts-export.md`:

```markdown
## Evidence Summary

| Slice | Goal | TDD | Tests | Spec | Contract | Review |
|-------|------|-----|-------|------|----------|--------|
| SLICE-001 | [goal] | ✅ strict | 5/5 | 3/3 | 4/4 PASS | PASS |
| SLICE-002 | [goal] | ✅ strict | 3/3 | 2/2 | 3/3 PASS | PASS |

### TDD Compliance
- Strict mode: N/N slices (100%)
- Average RED→GREEN time: [Nm]

### Changes
- Total: +[N] -[N] lines across [N] files
- Debug sessions: [N] (root causes documented)

### Spec Compliance
- All requirements met: [N/N] slices
```

Display: `Exported: $WORK_DIR/receipts-export.md`

Copy to clipboard suggestion:
```
PR 디스크립션에 붙여넣으려면:
   cat $WORK_DIR/receipts-export.md | pbcopy
```

## Receipt Schema: Sensor Fields

These fields are written by the sensor infrastructure during Phase 3 (implement) and are consumed by deep-test Quality Gates (Section 4-6/4-7) and deep-review integration.

### Per-slice sensor_results

```json
{
  "ecosystem": "typescript",
  "lint": {
    "tool": "eslint",
    "status": "pass|fail|not_applicable|timeout",
    "errors": 0,
    "warnings": 0,
    "correction_rounds": 0
  },
  "typecheck": {
    "tool": "tsc",
    "status": "pass|fail|not_applicable|timeout",
    "errors": 0,
    "correction_rounds": 0
  },
  "coverage": {
    "tool": "jest",
    "status": "pass|fail|not_applicable|timeout",
    "line_pct": 87.3,
    "branch_pct": 72.1
  }
}
```

### Session mutation_testing

Written to the session state file after Phase 4 Mutation Score gate (Section 4-7).

```json
{
  "tool": "stryker",
  "status": "completed|not_applicable",
  "total_mutants": 45,
  "killed": 39,
  "survived": 4,
  "equivalent": 2,
  "score": 90.7,
  "auto_fix_rounds": 2,
  "remaining_survived": [
    {
      "file": "src/auth/jwt.ts",
      "line": 42,
      "mutator": "ConditionalExpression",
      "tag": "possibly_equivalent"
    }
  ]
}
```
