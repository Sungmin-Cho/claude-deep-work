---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
description: "Slice management — view status, activate, deactivate slices"
---

# Slice Management (v4.0)

Manage slices within a Deep Work implementation session.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. Output ALL user-facing messages in the detected language.

## Usage

- `/deep-slice` — Show slice status dashboard
- `/deep-slice activate SLICE-NNN` — Manually activate a specific slice
- `/deep-slice spike SLICE-NNN` — Enter spike mode for a specific slice
- `/deep-slice reset SLICE-NNN` — Reset a slice to PENDING

## Slice Status Dashboard

Read `.claude/deep-work.local.md` and `$WORK_DIR/plan.md` to display:

```
📊 Slice Status Dashboard

SLICE-001 [GREEN] ██████ tests:5/5 spec:3/3 receipt:✅
SLICE-002 [RED]   ███░░░ tests:2/5 spec:1/3 receipt:⏳
SLICE-003 [PEND]  ░░░░░░ tests:0/3 spec:0/2 receipt:—
SLICE-004 [SPIKE] ▓▓▓▓░░ tests:—   spec:—   receipt:⚠️

진행률: 1/4 완료 | Active: SLICE-002
TDD 모드: strict | 디버깅: 0회
```

For each slice, read the receipt JSON from `$WORK_DIR/receipts/SLICE-NNN.json` to get:
- TDD state (PENDING/RED/RED_VERIFIED/GREEN_ELIGIBLE/GREEN/REFACTOR/SPIKE)
- Test pass count (from verification output)
- Spec checklist completion
- Receipt status (✅ complete, ⏳ in_progress, ⚠️ spike, — pending)

## Activate Command

`/deep-slice activate SLICE-NNN`:

1. Verify the target slice exists in plan.md
2. Verify it's not already completed (`- [x]`)
3. Update state file:
   - `active_slice: SLICE-NNN`
   - `tdd_state: PENDING` (reset for new slice)
4. Display:
   ```
   🔷 SLICE-NNN 활성화: [Goal]
      파일: [file1, file2]
      이전 활성 slice: [previous or none]
   ```

## Spike Command

`/deep-slice spike SLICE-NNN`:

1. Set the slice's TDD state to SPIKE
2. Update state: `tdd_state: SPIKE`
3. Display:
   ```
   ⚡ SLICE-NNN spike 모드 진입
      TDD 강제가 해제되었습니다. 자유롭게 코딩하세요.
      ⚠️ spike 코드는 merge 대상이 아닙니다.
      종료 시 /deep-slice reset SLICE-NNN 으로 TDD로 복귀하세요.
   ```

## Reset Command

`/deep-slice reset SLICE-NNN`:

1. If slice was in SPIKE mode:
   - Stash current changes: `git stash push -m "spike: SLICE-NNN"`
   - Reset slice status to unchecked in plan.md
2. Update state:
   - `tdd_state: PENDING`
   - `active_slice: SLICE-NNN`
3. Reset receipt to initial state
4. Display:
   ```
   🔄 SLICE-NNN 리셋
      TDD 상태: PENDING (처음부터 시작)
      spike 코드: git stash에 보관됨
   ```
