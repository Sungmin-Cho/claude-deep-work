---
name: deep-research
version: "6.4.0"
description: "Phase 1 — Research: exhaustively analyze the codebase"
---

> [!IMPORTANT]
> **Skill body echo 금지**
>
> 이 SKILL.md 본문을 사용자에게 echo하거나 요약하여 출력하지 마라.
>
> - Section 1 (state 로드, 완료-marker 감지)의 조용한 내부 처리는 silent. Pre-checks(`--scope` / `--incremental` / previous research cache)와 Cross-Plugin Context의 명시적 사용자 상호작용은 허용된 예외.
> - 첫 사용자-가시 주 동작은 Section 2의 **First Action: 코드베이스 매핑 선언 + 즉시 Glob 실행**이다.
> - Section 3 완료 메시지는 Section 2의 6개 영역 분석과 research.md 작성을 **실제로 수행**한 뒤에만 출력.
> - 본 문서의 markdown 블록·표는 지침이다. 응답으로 출력하지 마라.

# Section 1: State 로드 (필수 — 건너뛰기 금지)

1. Session ID 결정
   - $ARGUMENTS에 --session=ID → 사용
   - 없으면 → .claude/deep-work-sessions.json에서 active session 탐색
2. State 파일 읽기: `.claude/deep-work.{SESSION_ID}.md`
3. 조건 변수 확인:
   - worktree_path — $ARGUMENTS 우선, 없으면 state에서
   - team_mode — $ARGUMENTS 우선, 없으면 state에서 (없으면 solo)
   - cross_model — $ARGUMENTS 우선, 없으면 state에서
4. `work_dir`, `task_description`, `project_type` 추출 → `$WORK_DIR` 설정 (기본: deep-work)
5. `current_phase`가 "research"인지 확인 — 아니면 오류
6. `research_started_at` 기록 (ISO timestamp)

## 완료-Marker 감지 (resume 경로 — F1, NC1, NW5)

`research_approved: true` 필드가 state에 이미 있고 `$ARGUMENTS`에 `--force-rerun` / `--scope=` / `--incremental`이 없으면 paused-after-approval 복귀 후보 경로이다. 단, Orchestrator §3-2가 이미 integrity check(sha256 비교)를 수행하여 stale approval 시 skill을 직접 재호출하므로, 본 branch는 Orchestrator dispatch를 통한 정상 경로 이외에는 도달하지 않는다. 진입 시:
- "Phase 1 (Research)는 이미 승인·완료되었습니다. Exit Gate를 재표시합니다." 출력
- Orchestrator §3-2로 제어 반환 (review+approval 거치지 않고 바로 Exit Gate 재실행)
- Section 2/3 진입 금지

**중요 (NC1)**: `research_completed_at` / `research_complete: true`만 있고 `research_approved`가 없으면 이 branch를 발동시키지 말 것 — skill completion과 review+approval 사이에 세션이 중단된 상태이며, resume 시 review+approval을 다시 거쳐야 한다.

**중요 (NW5)**: Resume fast-path의 integrity check는 Orchestrator §3-2가 우선 담당. 본 branch는 `research_approved: true`만 감지하나, Orchestrator가 hash 불일치 감지 시 approval을 invalidate하고 skill을 `--force-rerun`과 함께 호출하므로 이 branch는 out-of-band 편집 케이스에서 우회됨.

## Critical Constraints

- DO NOT write any code or modify source files
- ONLY research, analyze, and document findings in `$WORK_DIR/`

## Pre-checks

### Partial re-run (--scope)
$ARGUMENTS에 `--scope=` 포함 시: 기존 research.md의 지정 영역만 재분석 → Section 3으로 건너뜀.
Valid scopes: architecture, patterns, data, api, infrastructure, dependencies

### Incremental mode (--incremental)
$ARGUMENTS에 `--incremental` 포함 시: `last_research_commit` 기준 git diff → 변경 영역만 재분석.
`--scope`가 `--incremental`보다 우선.

### Previous research cache
`.deep-work/` 내 이전 세션 research.md 발견 시 → 베이스라인 활용 여부를 사용자에게 질문.

## Cross-Plugin Context

Phase 1 Research 시작 시 외부 플러그인 데이터를 참조한다. 이 데이터는 "참고" 수준이며, 현재 작업과 관련 없으면 무시한다.

### Harnessability Context

`.deep-dashboard/harnessability-report.json`이 존재하면:
1. 파일 읽기 및 freshness 확인:
   - `generated_at` 필드가 있으면 현재 시점과 비교
   - 7일 이상 경과한 리포트는 "stale harnessability report — skip" 경고 후 건너뜀
   - `generated_at` 필드가 없으면 그대로 사용 (하위 호환)
2. 점수가 낮은 차원(< 5.0)을 research context에 포함:
   ```
   이 프로젝트의 harnessability 진단 결과:
   - <dimension>: <score>/10 → <suggestion>
   이 작업에서 관련 영역을 개선할 수 있으면 함께 고려.
   ```
3. 이 정보는 이후 Section 2의 Topology Detection에서 참조 가능. 여기서는 research context에 텍스트로만 포함.

### Evolve Insights Context

`.deep-evolve/evolve-insights.json`이 존재하면:
1. 파일 읽기
2. `insights_for_deep_work` 항목을 research context에 포함:
   ```
   deep-evolve 메타 아카이브 기반 인사이트:
   - <pattern>: <evidence> → <suggestion>
   ```
3. 이 인사이트는 "참고" 수준 — 현재 작업과 관련 없으면 무시

# Section 2: Phase 실행

## First Action (즉시 실행 — 건너뛰기 금지)

Section 1 state 로드와 완료-marker 감지가 끝나면 **즉시** 다음 메시지를 출력한 뒤 별도 확인 없이 Glob 실행으로 진입한다:

> "코드베이스 분석을 시작합니다. 주요 디렉토리부터 매핑합니다."

이어서 Glob 도구로 `**/*.{md,json,ts,tsx,js,py,sh,go,rs}` 등 프로젝트 주요 확장자 또는 topology-detector 결과에 따른 디렉토리 매핑을 수행한다. "시작할까요?" 같은 추가 확인 금지 — Exit Gate는 Section 3 완료 후 Orchestrator가 처리.

**금지**: 이 선언과 Glob 호출 전에 template, 완료 메시지, 6개 영역 bullet list를 사용자에게 출력하지 마라.

## 모드 분기 — delegation 기반 (v6.4.0)

Research 단계는 **항상 subagent에 위임**한다. 메인 세션은 오케스트레이터 역할만 수행.

1. `project_type` 확인:
   - `zero-base` → `deep-work:research-zerobase-worker`
   - 그 외 → `deep-work:research-codebase-worker`
2. `team_mode` 확인:
   - `solo` → 단일 Agent() 호출 (area=full)
   - `team` → 3개 Agent() 병렬 호출 (area는 project_type별로 다름)
3. 모든 Agent 호출 시 `model=state.model_routing.research` call-site override 적용 (spec §5.8).

### Solo path (team_mode=solo)

```
Agent(
  subagent_type="deep-work:research-{codebase|zerobase}-worker",
  model=state.model_routing.research,   // default "sonnet"
  prompt="area=full; work_dir=<$WORK_DIR>; task=<task_description>;" +
         "re_run_area=<--scope value or null>;" +
         "incremental_since=<--incremental value or null>"
)
```

Agent가 `$WORK_DIR/research.md`를 **직접 작성**한다. 부모는 refinement protocol을 수행하지 않는다 (spec §6.2).

### Team path (team_mode=team)

3개 영역 정의 (project_type별):
- codebase: `architecture`, `patterns`, `risks`
- zero-base: `tech-stack`, `conventions`, `data-model`

단일 메시지에 3개 Agent 호출을 parallel하게 실행. **각 호출은 Solo path와 동일한 prompt 계약을 유지** (area만 다름). work_dir/task/re_run_area/incremental_since 모두 전달 필요 — 생략 시 worker가 output path 결정 불가 (CA2 fix):

```
Agent(
  subagent_type="deep-work:research-{codebase|zerobase}-worker",
  model=state.model_routing.research,
  prompt="area=architecture; work_dir=<$WORK_DIR>; task=<task_description>;" +
         "re_run_area=<--scope value or null>;" +
         "incremental_since=<--incremental value or null>"
)
Agent(
  subagent_type="deep-work:research-{codebase|zerobase}-worker",
  model=state.model_routing.research,
  prompt="area=patterns; work_dir=<$WORK_DIR>; task=<task_description>;" +
         "re_run_area=<--scope or null>; incremental_since=<--incremental or null>"
)
Agent(
  subagent_type="deep-work:research-{codebase|zerobase}-worker",
  model=state.model_routing.research,
  prompt="area=risks; work_dir=<$WORK_DIR>; task=<task_description>;" +
         "re_run_area=<--scope or null>; incremental_since=<--incremental or null>"
)
```

(zero-base 경우 area 값은 `tech-stack` / `conventions` / `data-model`. subagent_type은 `research-zerobase-worker`.)

각 Agent가 `$WORK_DIR/research-{area}.md` 부분 파일을 작성. 완료 후 부모가 3개 파일을 Read → Document Refinement Protocol (Apply / Deduplicate / Prune) → `$WORK_DIR/research.md` 로 merge.

### Parallel partial timeout (spec §7.1 W4)

3개 중 일부만 성공하고 일부 timeout/fail 시:
- AskUserQuestion: (a) 실패한 area만 재위임 / (b) 전체 재위임 / (c) 수동 수정 / (d) abort
- 성공한 부분 파일은 보존 (재위임 시 agent가 overwrite)

### TeamCreate / env var 경로 제거

v6.3.x의 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` precheck과 TeamCreate+TaskCreate+3 Agent 분기는 제거. Agent tool의 parallel 호출로 3-way 병렬을 달성.

# Section 3: 완료

> **실행 순서 안전장치**: 이 섹션은 Section 2의 Solo/Team/Zero-base mode 전체 실행과 research.md 작성을 **실제로 수행**한 뒤에만 실행한다. Section 2를 건너뛰고 완료 메시지만 출력하는 것은 실패 모드이다.

## Document Refinement Protocol

연구 업데이트 시 항상 적용:
1. **Apply** — 새 분석 삽입
2. **Deduplicate** — 중복 제거
3. **Prune** — 무효화된 내용 제거
4. Refinement log 추가: `<!-- v[N]: [summary] — deduped: N, pruned: M -->`

## Research Quality Checklist (자체 검증)

- [ ] 모든 관련 디렉토리 탐색 완료
- [ ] 패턴에 파일 경로 참조 포함
- [ ] 잠재적 충돌/리스크 식별
- [ ] Executive Summary + Key Findings가 문서 상단
- [ ] [RF-NNN] / [RA-NNN] 태그 포함
- [ ] 각 상세 섹션에 코드 스니펫 포함
- [ ] 테스팅 패턴(프레임워크, assertion, 파일 네이밍) 문서화

## Phase Review Gate

Read("../shared/references/phase-review-gate.md") — 프로토콜 실행:
- Phase: research
- Document: `$WORK_DIR/research.md`
- Self-review checklist — **project_type에 따라 분기** (W-4.1 fix):
  - 기존 codebase (`project_type != zero-base`): 아키텍처 분석 완성도, 패턴 식별, 리스크 누락
  - 신규 프로젝트 (`project_type == zero-base`): tech-stack 선정 근거 (대안 비교 + URL 출처), conventions 완결성, data-model 적정성

## State 업데이트

- `research_complete: true`
- `research_completed_at`: ISO timestamp
- `last_research_commit`: `git rev-parse HEAD`
- `review_state: completed`
- `phase_review.research` + `review_results.research` 업데이트

**NOTE: `current_phase`를 변경하지 않는다.** Orchestrator가 리뷰+승인 후 변경.

## 완료 메시지

```
Research 단계가 완료되었습니다!
연구 결과: $WORK_DIR/research.md
분석 요약: [3-5줄]
```

Team 모드 시 부분 결과 파일도 표시.

## Notification

```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$STATE_FILE" "research" "completed" "Research 완료" 2>/dev/null || true
```
