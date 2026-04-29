---
allowed-tools: Skill, Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
---

# /deep-work

Evidence-Driven Development Protocol — Brainstorm → Research → Plan → Implement → Test 자동 진행.

Skill("deep-work-orchestrator", args="$ARGUMENTS")

## ARGUMENTS / Flags

Flag parsing is handled by `scripts/parse-deep-work-flags.js` (§1-3-1). All flags below are
parsed by that helper — the orchestrator calls it directly, so no extraction is needed here.

### `--exec=<mode>` (v6.4.0)

Implement 단계 실행 방식 override. Parsed by flag parser → stored as `state.execution_override`.

| 값 | 동작 |
|----|------|
| `inline` | team_mode 무관하게 main session에서 inline 실행. 자동 heuristic 무시 |
| `delegate` | spike/trivial 상황에서도 subagent 위임 강제 |
| (미지정) | decide_execution_mode(state, args) heuristic 따름 (§5.5a) |

값은 state의 `execution_override` 필드에 저장되며 resume 시에도 유지.

### Other flags

| 플래그 | 동작 |
|--------|------|
| `--no-ask` | interactive ask loop 전체 skip — defaults 그대로 적용 |
| `--recommender=MODEL` | recommender 모델 override (haiku\|sonnet\|opus) |
| `--no-recommender` | recommender sub-agent 비활성화 |
| `--profile=NAME` | preset 명시 선택 (영문/숫자/-/_ 한정) |
| `--team` | team_mode 강제 |
| `--skip-brainstorm` | Phase 0 skip |
| `--skip-research` | Phase 1 skip |
| `--skip-to-implement` | Phase 0-2 skip → Phase 3 직행 |
| `--setup` | 설정 마법사 호출 |
