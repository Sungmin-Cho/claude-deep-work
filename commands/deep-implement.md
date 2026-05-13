---
allowed-tools: Skill, Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Phase 3 — Implement: slice 기반 TDD 실행 (RED → GREEN → REFACTOR), sensor + slice review, M3 envelope slice receipt emit"
---

# /deep-implement

Phase 3: TDD 기반 슬라이스 구현 — RED → GREEN → REFACTOR.

Skill("deep-implement", args="$ARGUMENTS")

## ARGUMENTS / Flags

### `--exec=<mode>` (v6.4.0)

Implement 단계 실행 방식 override.

| 값 | 동작 |
|----|------|
| `inline` | team_mode 무관하게 main session에서 inline 실행. 자동 heuristic 무시 |
| `delegate` | spike/trivial 상황에서도 subagent 위임 강제 |
| (미지정) | decide_execution_mode(state, args) heuristic 따름 (§5.5a) |

값은 state의 `execution_override` 필드에 저장되며 resume 시에도 유지. CLI args 재지정 시 state 덮어씀.
