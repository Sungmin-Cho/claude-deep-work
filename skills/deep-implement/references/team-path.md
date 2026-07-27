# Delegate team path (§2.2)

> Reference for `skills/deep-implement/SKILL.md`. The env-var check plus AskUserQuestion, Branch A (Agent Team), Branch B (multiple subagents by cluster), and partial-failure handling. Read only when execution_mode=delegate and team_mode=team.

---

## Section 2.2: Delegate Team Path

`execution_mode == "delegate"` AND `team_mode == "team"` 인 경우.

### env var check + AskUserQuestion

```bash
env_var=$(echo "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-}")
```

- env_var 비어있음 → AskUserQuestion 생략, 안내 메시지 후 복수 Subagent 경로로 자동 진입:
  ```
  [info] CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 미설정 —
         Agent Team 대신 복수 Subagent 병렬 위임으로 진행합니다.
  ```
- env_var 설정됨 → **AskUserQuestion tool invocation**:

```json
AskUserQuestion({
  "questions": [{
    "question": "Implement team 위임 방식을 선택하세요.",
    "header": "Team mode",
    "multiSelect": false,
    "options": [
      {
        "label": "Agent Team",
        "description": "TeamCreate + TaskCreate 기반 (shared task list, SendMessage). env var 활성 시에만 선택 가능."
      },
      {
        "label": "복수 Subagent",
        "description": "Agent tool N번 parallel 호출. 각 subagent는 독립 컨텍스트. 권장."
      }
    ]
  }]
})
```

(header는 12자 이내여야 한다 — "Team mode"는 9자. label은 1-5 단어.)

### Branch A: Agent Team (env var 활성 + 사용자 선택)

기존 v6.3.x의 TeamCreate 분기를 그대로 유지. 현재
`skills/deep-implement/SKILL.md:195-201`의 로직:

```
1. Cluster: file 소유권 기반 slice 그룹화 (겹침 → sequential, 독립 → parallel)
   — 이 logic은 Task 9 Section 2.1의 cluster 추출과 동일한 code path 재사용.
2. Dispatch: TeamCreate "deep-implement"
   - team_name: "deep-implement-v640"
   - 각 cluster마다 TaskCreate 생성 (subject: "Implement cluster C{n}",
     description: cluster의 slice_ids + files + TDD 규칙 + Slice Review 규칙)
   - 그룹별 Agent 스폰 — **full worker contract 필수**:
       Agent(subagent_type="deep-work:implement-slice-worker",
             model=decodedRouting.implement,  // 자동 경로는 cluster 대표 tier를 resolve한 값으로 교체. pinned/legacy면 그대로.
             mode="bypassPermissions",  // hook이 team agent에 미적용 → Receipt 중심 검증
             prompt="cluster_id=<Ci>; cluster_ids=[slice_ids of Ci];" +
                    "work_dir=<$WORK_DIR>; plan_path=<$WORK_DIR/plan.md>;" +
                    "delegation_snapshot=<hash>;" +
                    "tdd_mode=<state.tdd_mode>;" +
                    "evaluator_model=<state.evaluator_model>")
3. Collect: 모든 Task 완료 알림 수신 → 모든 receipt 수집
   - Section 2.3 verify-delegated-receipt.sh가 precondition으로 실행.
4. Shutdown: SendMessage shutdown_request → TeamDelete.
```

중요: Agent Team의 agent에도 hook 미적용이므로, verify-delegated-receipt는 Branch B와 동일하게 Section 2.3 precondition으로 실행됨. regression 없음.

### Branch B: 복수 Subagent (기본 경로)

1. Cluster 독립성 map 계산:
   - 독립 cluster 쌍 → parallel Agent 호출
   - 의존 cluster 쌍 → sequential (같은 agent에 묶거나 순차)
2. 각 independent cluster에 대해 Agent 호출을 단일 메시지에 parallel 실행.
   **full worker contract 필수** (Section 2.1 Solo와 동일 구조):
   ```
   Agent(subagent_type="deep-work:implement-slice-worker",
         model=decodedRouting.implement,  // 자동 경로는 cluster 대표 tier를 resolve한 값으로 교체. pinned/legacy면 그대로.
         prompt="cluster_id=<Ci>; cluster_ids=[slice_ids of Ci];" +
                "work_dir=<$WORK_DIR>; plan_path=<$WORK_DIR/plan.md>;" +
                "delegation_snapshot=<hash>;" +
                "tdd_mode=<state.tdd_mode>;" +
                "evaluator_model=<state.evaluator_model>")
   Agent(subagent_type="deep-work:implement-slice-worker", ...)  // same contract for each independent cluster
   ```
3. 모든 Agent 완료 후 Section 2.3 로 이동.

### Partial failure

일부 agent timeout/fail 시 §7.1 "Parallel subagent의 partial timeout" 규칙:
- AskUserQuestion: 실패한 cluster만 / 전체 / 수동 / abort.

