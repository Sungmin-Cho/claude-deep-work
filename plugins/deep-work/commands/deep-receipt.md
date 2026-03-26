---
allowed-tools: Read, Write, Bash, Grep, Glob
description: "Receipt management — view, dashboard, export receipts"
---

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

## Prerequisites

Read `.claude/deep-work.local.md` and extract `work_dir`.
Receipts are stored in `$WORK_DIR/receipts/SLICE-NNN.json`.

## Dashboard

Scan `$WORK_DIR/receipts/` directory for all receipt JSON files. For each receipt, display:

```
Receipt Dashboard

┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ Slice    │ TDD      │ Tests    │ Spec     │ Review   │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│ SLICE-001│ ✅ GREEN │ 5/5 PASS │ 3/3 ✅   │ PASS     │
│ SLICE-002│ 🟡 RED_V │ 2/5 FAIL │ 1/3 ⏳   │ —        │
│ SLICE-003│ ⬜ PEND  │ —        │ —        │ —        │
│ SLICE-004│ SPIKE    │ —        │ —        │ ⚠️       │
└──────────┴──────────┴──────────┴──────────┴──────────┘

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

Code Review:
  결과: [PASS/WARN]
  Findings: [N] (critical: [N], important: [N])

Debug Log:
  [None / RC-NNN: root cause description]
```

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
    "debug_count": N
  },
  "slices": [ ...all receipt objects... ]
}
```

Display: `Exported: $WORK_DIR/receipts-export.json`

## Export — Markdown

`/deep-receipt export --format=md`:

Generate a markdown summary suitable for PR descriptions. Write to `$WORK_DIR/receipts-export.md`:

```markdown
## Evidence Summary

| Slice | Goal | TDD | Tests | Spec | Review |
|-------|------|-----|-------|------|--------|
| SLICE-001 | [goal] | ✅ strict | 5/5 | 3/3 | PASS |
| SLICE-002 | [goal] | ✅ strict | 3/3 | 2/2 | PASS |

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
