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

현재 단계: [Phase name with emoji]
   Phase 0 (Brainstorm): [✅ 완료 / ⏳ 진행중 / ⬜ 대기 / ⏭️ 생략]
   Phase 1 (Research):   [✅ 완료 / ⏳ 진행중 / ⬜ 대기]
   Phase 2 (Plan):       [✅ 승인됨 / ⏳ 진행중 / ⬜ 대기] (Auto-Loop: [plan_review_retries]/[plan_review_max_retries])
   Phase 3 (Implement):  [✅ 완료 / ⏳ 진행중 / ⬜ 대기]
   Phase 4 (Test):       [✅ 통과 / ⏳ 진행중 / ⬜ 대기 / ❌ 실패(N회)]

구현 진행률: [N/M 완료 (XX%)]
   ████████░░ XX%

Phase별 소요 시간:
   Brainstorm: [duration or "N/A" or "생략"]
   Research: [duration or "N/A"]
   Plan: [duration or "N/A"]
   Implement: [duration or "N/A"]
   Test: [duration or "N/A"]
Quality Gates: [통과 ✅ / 실패 ❌ / 미정의 ⬜]
리뷰 현황:
   Brainstorm: [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Research: [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Plan (Structural): [N/10 (N회) ✅ / 미실행 ⬜ / 스킵 ⏭️]
   Plan (Adversarial): [Claude N/10, Codex N/10 — Consensus N, Conflicts N, Waivers N / 미실행 / 도구 미설치]
크로스 모델: [codex ✅ + gemini ❌ / 모두 미설치 / 비활성화]
Assumption 조정: [N]건 적용됨
건너뛴 단계: [brainstorm, research, plan]

센서 상태:
   생태계: [ecosystem, e.g. typescript (eslint ✅, tsc ✅, stryker ❌)] [or "감지 안됨 ⬜" if no sensor data]
   Sensor Clean Rate: [N]/[total] ([N]%) [or "N/A ⬜" if no sensor data in receipts]
   Mutation Score: [N]% ([Phase 4 실행됨 / 미실행 ⬜ / not_applicable ⏭️])

Health Check:
   드리프트: dead-export {N}건 ⚠️ | coverage {+/-N}%p ✅ | vuln {N}건 🔴 | stale {N}건 ✅
   Fitness:  {N}/{M} 통과 ✅ | required_missing: {N}건

산출물:
   - $WORK_DIR/brainstorm.md: [존재함 ✅ / 없음 ⬜ / 생략 ⏭️]
   - $WORK_DIR/research.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/plan.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/test-results.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/report.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/quality-gates.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/insight-report.md: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/file-changes.log: [존재함 ✅ / 없음 ⬜]
   - $WORK_DIR/plan-diff.md: [존재함 ✅ / 없음 ⬜]

다음 행동: [안내 메시지]
```

Adjust the "다음 행동" based on the current phase:
- **brainstorm**: `자동 흐름이 brainstorm을 진행합니다. /deep-work로 시작하세요.`
- **research**: `자동 흐름이 research를 진행 중입니다.`
- **plan**: `plan 승인을 기다리고 있습니다.` (or "plan 수정이 필요하면 /deep-plan을 사용하세요" if plan exists)
- **implement**: `자동 흐름이 구현을 진행 중입니다.`
- **test**: `자동 흐름이 테스트를 진행 중입니다.` (or "자동 수정 루프가 진행 중입니다 (시도 N/3)" if test_retry_count > 0)
- **idle**: `세션이 완료되었습니다. /deep-status --report로 리포트를 확인하세요. 새 세션: /deep-work <작업>`

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

