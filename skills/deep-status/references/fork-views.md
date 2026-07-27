# Fork relationship display and `--tree`

> Reference for `skills/deep-status/SKILL.md`. The fork-relationship block inside the default status display, and the `--tree` relationship visualization.

---

### Fork 관계 표시

상태 파일에서 `fork_info`가 있으면:
```
Fork: {SESSION_ID} (forked from {fork_info.parent_session} at {fork_info.parent_phase_at_fork} → {fork_info.restart_phase})
Mode: {fork_info.fork_mode} | Generation: {fork_info.fork_generation}
```

상태 파일에서 `fork_children`이 있으면:
```
Fork children:
  - {child.session_id} ({child.restart_phase}) {child.status || "active"}
```

fork_info도 fork_children도 없으면 이 섹션을 생략한다.

---

### 11. --tree: Fork Relationship Tree

If `$ARGUMENTS` contains `--tree`:

레지스트리(`.claude/deep-work-sessions.json`)에서 모든 세션을 읽고, `fork_parent` 관계로 트리를 구성한다.

**구현 방법:**
1. 레지스트리에서 모든 세션을 읽는다
2. `fork_parent`가 없는 세션을 루트 노드로 식별
3. `fork_parent`로 부모-자식 관계를 트리로 구성
4. DFS로 트리를 순회하며 UTF-8 트리 문자(├── └──)로 출력
5. 각 노드: `{session_id} [{phase}] "{task_description}"`
6. Fork 세션이면: `fork @ {restart_phase} → {task_description}`

**트리 표시 형식:**

```
🌳 Fork Relationship Tree
━━━━━━━━━━━━━━━━━━━━━━━━━━

s-aaa11111 [implement] "JWT auth feature"
├── s-bbb22222 [implement] fork @ plan → GraphQL approach
└── s-ccc33333 [plan] fork @ research → microservice approach
    └── s-ddd44444 [research] fork @ brainstorm → serverless approach

s-eee55555 [idle] "Refactor API"  (no forks)
```

현재 세션은 `◀` 표시로 강조:
```
s-aaa11111 [implement] "JWT auth feature" ◀ current
```

레지스트리가 없거나 세션이 없으면:
```
ℹ️ 등록된 세션이 없습니다.
```

