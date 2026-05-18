---
name: deep-history
description: "Use when the user wants to view cross-session deep-work history — completed session list, TDD compliance rates, model usage (haiku/sonnet/opus/main), evaluator model usage, and aggregate trends. Triggers on `/deep-history`, `/deep-status --history`, \"session history\", \"deep-work history\", \"세션 이력\", \"이전 세션\", \"TDD 준수율 트렌드\". Scans `.deep-work/*/session-receipt.json` envelopes recursively, aggregates per-session stats, and displays trend indicators (recent-3 vs prior-3). Sub-page of the deep-status hub."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-history [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-history", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) | Default — 전체 세션 이력 + aggregate stats |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Hub-spoke 관계**: 본 skill 은 `deep-status` hub 의 sub-page 입니다 — `/deep-status --<flag>` 가 본문 로직을 inline Read 하여 실행하는 것이 주 경로이며, 직접 호출도 동일하게 지원됩니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


> **Internal (v6.3.0)** — `/deep-status --history`가 이 파일의 로직을 `Read`하여 실행합니다. 자동 호출이 주 경로이며, 직접 호출도 지원됩니다.
> 참조처: `skills/deep-status/SKILL.md` §7 (`Read skills/deep-history/SKILL.md and follow its display logic inline`).

# Deep Work Session History (v4.1)

View historical session data across all completed Deep Work sessions.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. Output ALL user-facing messages in the detected language.

## Instructions

### 1. Scan for session receipts

Search for `session-receipt.json` files in all deep-work output directories:

```bash
find . -path "*/.deep-work/*/session-receipt.json" -type f 2>/dev/null | sort -r
```

If no session receipts found:
```
ℹ️ 세션 이력이 없습니다.
   /deep-work로 세션을 시작하고 /deep-finish로 완료하면 이력이 기록됩니다.
```
Stop here.

### 2. Parse all session receipts

For each `session-receipt.json`, extract:
- `session_id`, `task_description`, `started_at`, `finished_at`
- `outcome` (merge/pr/keep/discard)
- `slices.total`, `slices.completed`
- `tdd_compliance` (strict/relaxed/override/spike/coaching counts)
- `model_usage` (haiku/sonnet/opus/main counts)
- `evaluation.evaluator_model` (haiku/sonnet/opus — the model used for plan/test evaluation)
- `total_estimated_cost`
- `deep_work_version`

### 3. Display session list

```
Deep Work Session History

┌────┬──────────────────────┬────────────┬────────┬──────────┬───────────┬───────────┐
│ #  │ Task                 │ Date       │ Slices │ Outcome  │ Model     │ Evaluator │
├────┼──────────────────────┼────────────┼────────┼──────────┼───────────┼───────────┤
│ 1  │ Add model routing    │ 2026-03-25 │ 4/4    │ PR #42   │ S1 H2 O1 │ sonnet    │
│ 2  │ Fix receipt bug      │ 2026-03-23 │ 2/2    │ merge    │ S2       │ haiku     │
│ 3  │ Worktree setup       │ 2026-03-20 │ 3/5    │ keep     │ S3       │ sonnet    │
└────┴──────────────────────┴────────────┴────────┴──────────┴───────────┴───────────┘

S=sonnet H=haiku O=opus M=main
Evaluator: evaluation.evaluator_model from session receipt (or "—" if not set)
```

### 4. Display aggregate statistics

```
Aggregate Stats (최근 [N]개 세션)

   TDD 준수율: strict [N]% | relaxed [N]% | override [N]% | spike [N]%
   모델 사용: haiku [N]회 | sonnet [N]회 | opus [N]회
   평가자 모델 사용: haiku [N]회 | sonnet [N]회 | opus [N]회
   완료율: [completed]/[total] 슬라이스 ([N]%)
   결과: merge [N] | PR [N] | keep [N] | discard [N]
```

If `estimated_cost` data is available:
```
   예상 비용: 총 $[N] (세션 평균 $[N])
```

### 5. Trend indicator

Compare the most recent 3 sessions to the 3 before that (if available):

```
트렌드 (최근 3 vs 이전 3)
   TDD strict 비율: [N]% → [N]% [↑/↓/→]
   완료율:          [N]% → [N]% [↑/↓/→]
   평균 슬라이스:    [N]개 → [N]개 [↑/↓/→]
```
