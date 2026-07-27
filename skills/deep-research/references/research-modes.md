# Solo and team research dispatch

> Reference for `skills/deep-research/SKILL.md`. Mode selection by delegation, the solo single-agent path, the three-way parallel team path, parallel partial-timeout handling, and why the TeamCreate/env-var path was removed.

---

## 모드 분기 — delegation 기반

Research 단계는 **항상 subagent에 위임**한다. 메인 세션은 오케스트레이터 역할만 수행.

> **호스트 조건부**: `Agent` 도구가 없는 호스트(Codex)에서는 아래 Agent 호출 대신 `agents/research-{codebase|zerobase}-worker.md`의
> 프로토콜을 **호출 스킬 안에서 인라인 실행**한다. 입력·산출 경로·산출물 소유권 계약은 동일하다.
> 규칙 정본은 `AGENTS.md` §Host differences.

1. `project_type` 확인:
   - `zero-base` → `deep-work:research-zerobase-worker`
   - 그 외 → `deep-work:research-codebase-worker`
2. `team_mode` 확인:
   - `solo` → 단일 Agent() 호출 (area=full)
   - `team` → 3개 Agent() 병렬 호출 (area는 project_type별로 다름)
3. 먼저 Read(`${CLAUDE_PLUGIN_ROOT}/skills/shared/references/model-routing-guide.md#model-routing-state-decode-v612`)의
   scalar-first 규칙으로 `decodedRouting`/`decodedRoutingMeta`를 만든다. 모든 Agent 호출은
   `model=decodedRouting.research` call-site override를 적용한다.

### Solo path (team_mode=solo)

```
Agent(
  subagent_type="deep-work:research-{codebase|zerobase}-worker",
  model=decodedRouting.research,   // decode 실패 시 default "sonnet"
  prompt="area=full; work_dir=<$WORK_DIR>; task=<task_description>;" +
         "re_run_area=<--scope value or null>;" +
         "incremental_since=<--incremental value or null>"
)
```

Agent가 `$WORK_DIR/research.md`를 **직접 작성**한다. 부모는 refinement protocol을 수행하지 않는다.

### Team path (team_mode=team)

3개 영역 정의 (project_type별):
- codebase: `architecture`, `patterns`, `risks`
- zero-base: `tech-stack`, `conventions`, `data-model`

단일 메시지에 3개 Agent 호출을 parallel하게 실행. **각 호출은 Solo path와 동일한 prompt 계약을 유지** (area만 다름). work_dir/task/re_run_area/incremental_since 모두 전달 필요 — 생략 시 worker가 output path 결정 불가:

```
Agent(
  subagent_type="deep-work:research-{codebase|zerobase}-worker",
  model=decodedRouting.research,
  prompt="area=architecture; work_dir=<$WORK_DIR>; task=<task_description>;" +
         "re_run_area=<--scope value or null>;" +
         "incremental_since=<--incremental value or null>"
)
Agent(
  subagent_type="deep-work:research-{codebase|zerobase}-worker",
  model=decodedRouting.research,
  prompt="area=patterns; work_dir=<$WORK_DIR>; task=<task_description>;" +
         "re_run_area=<--scope or null>; incremental_since=<--incremental or null>"
)
Agent(
  subagent_type="deep-work:research-{codebase|zerobase}-worker",
  model=decodedRouting.research,
  prompt="area=risks; work_dir=<$WORK_DIR>; task=<task_description>;" +
         "re_run_area=<--scope or null>; incremental_since=<--incremental or null>"
)
```

(zero-base 경우 area 값은 `tech-stack` / `conventions` / `data-model`. subagent_type은 `research-zerobase-worker`.)

각 Agent가 `$WORK_DIR/research-{area}.md` 부분 파일을 작성. 완료 후 부모가 3개 파일을 Read → Document Refinement Protocol (Apply / Deduplicate / Prune) → `$WORK_DIR/research.md` 로 merge.

### Parallel partial timeout

3개 중 일부만 성공하고 일부 timeout/fail 시:
- AskUserQuestion: (a) 실패한 area만 재위임 / (b) 전체 재위임 / (c) 수동 수정 / (d) abort
- 성공한 부분 파일은 보존 (재위임 시 agent가 overwrite)

### TeamCreate / env var 경로 제거

v6.3.x의 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` precheck과 TeamCreate+TaskCreate+3 Agent 분기는 제거. Agent tool의 parallel 호출로 3-way 병렬을 달성.

