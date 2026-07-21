---
name: deep-research
description: "This skill should be used during deep-work Phase 1 to research an existing codebase (architecture/patterns/risks) via research-codebase-worker, or to investigate a zero-base project's tech stack/conventions/data-model via research-zerobase-worker (using WebSearch + Context7 for up-to-date library docs). Consumes evolve-insights and harnessability M3 envelopes as context. Triggered by 'start research phase', 'analyze codebase', /deep-research slash, cross-platform Skill({ skill: \"deep-work:deep-research\", args: \"...\" }), or orchestrator dispatch after brainstorm approval. Solo/Team mode automatic based on project size."
user-invocable: true
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

### Harnessability Context (envelope-aware v6.5.0)

`.deep-dashboard/harnessability-report.json`이 존재하면:
1. 파일 읽기 및 envelope 감지:
   - 파일이 M3 envelope 형태(`{schema_version: "1.0", envelope: {...}, payload: {...}}`)이면 identity guard를 적용:
     `envelope.producer === "deep-dashboard"` ∧ `envelope.artifact_kind === "harnessability-report"` ∧ `envelope.schema.name === envelope.artifact_kind` 가 모두 참인 경우에만 `payload`를 사용. 하나라도 어긋나면 "foreign envelope at harnessability-report path — skip" 경고 후 건너뜀.
   - Legacy(non-envelope) 파일이면 root 객체를 그대로 사용 (forward-compat).
2. Freshness 확인 (envelope이면 `envelope.generated_at`을 우선, 없으면 payload root의 `generated_at`):
   - 7일 이상 경과한 리포트는 "stale harnessability report — skip" 경고 후 건너뜀
   - `generated_at` 필드가 없으면 그대로 사용 (하위 호환)
3. 점수가 낮은 차원(< 5.0)을 research context에 포함 — `dimensions[]` / `total` 등의 필드는 envelope 모드/legacy 모드 모두에서 동일하게 payload root 또는 객체 root에서 읽는다:
   ```
   이 프로젝트의 harnessability 진단 결과:
   - <dimension>: <score>/10 → <suggestion>
   이 작업에서 관련 영역을 개선할 수 있으면 함께 고려.
   ```
4. 이 정보는 이후 Section 2의 Topology Detection에서 참조 가능. 여기서는 research context에 텍스트로만 포함.

### Evolve Insights Context (envelope-aware v6.5.0)

`.deep-evolve/evolve-insights.json`(또는 `.deep-evolve/<session>/evolve-insights.json`)이 존재하면:
1. 파일 읽기 및 envelope 감지:
   - M3 envelope 이면 `envelope.producer === "deep-evolve"` ∧ `envelope.artifact_kind === "evolve-insights"` ∧ `envelope.schema.name === envelope.artifact_kind` 검증 후 `payload`를 사용. mismatch는 skip.
   - Legacy 파일이면 root 객체 그대로 사용.
2. `insights_for_deep_work` 항목을 research context에 포함 (envelope 모드/legacy 모드 모두 payload/root 에서 직접 접근):
   ```
   deep-evolve 메타 아카이브 기반 인사이트:
   - <pattern>: <evidence> → <suggestion>
   ```
3. 이 인사이트는 "참고" 수준 — 현재 작업과 관련 없으면 무시
4. 향후 (Phase 5 deep-integrate) 에서 session-receipt 의 `envelope.parent_run_id` 가 이 evolve-insights 의 `envelope.run_id` 로 채워진다 (cross-plugin chain).

### Deep-Memory Brief Context (v6.9.0+, consumer of `deep-memory` plugin)

`.deep-memory/latest-brief.md`가 프로젝트 루트(`git rev-parse --show-toplevel`을 `$WORK_DIR`에서 실행한 결과 — non-git worktree에서는 `$WORK_DIR`의 가장 가까운 ancestor 중 `.git/` 디렉토리가 있는 위치 — R1-I2)에 존재하면 cross-project semantic operational memory를 Research 컨텍스트로 인용한다. **자동 호출 금지** — brief 파일이 이미 materialize 되어 있는 경우(사용자가 명시적으로 `/deep-memory-brief`를 호출한 결과)에만 인용한다. 자세한 spec은 `docs/deep-memory-integration-handoff.md` §2 참조.

처리 순서:

1. **존재 확인** — `.deep-memory/latest-brief.md` 파일 stat. **부재 시 `research.md`에 아무것도 쓰지 않는다** — research artifact 는 brief 가 있을 때만 deep-memory 인지하게 한다 (R1-Y2 — opt-in 없는 사용자의 artifact에 deep-memory 권유가 leak 되지 않도록). 단 runtime Research context 에는 한 줄 안내만 emit: "No `.deep-memory/latest-brief.md` found. Run `/deep-memory-brief \"<task>\"` first if you want cross-project recall." 이후 §5 State 필드는 모두 부재 기본값으로 채우고 종료.
2. **Stale 가드** — 파일 mtime이 현재 시각보다 14일 이상 오래되면 "brief is stale — re-run /deep-memory-brief" 경고를 함께 출력하되 인용은 계속 진행한다 (사용자가 brief를 materialize한 시점에 이미 opt-in 한 것이므로 차단하지 않음).
3. **Verbatim 인용** — brief markdown 본문 전체를 `research.md`의 **새 `## Cross-project Memory` 섹션** (이때 비로소 생성) 아래에 그대로 삽입한다. brief의 heading hierarchy는 두 단계 들여쓴다 (`# Deep-Memory Brief — ...` → `### Deep-Memory Brief — ...`, `## <idx>. <type> — ...` → `#### <idx>. ...`). 이는 deep-memory의 redaction(3-pass) + 포맷팅을 보존하기 위함이다 — re-rendering 금지.
4. **Provenance 추출** — brief markdown 본문에서 정규식 `` /\bmem-[0-9A-HJKMNP-TV-Z]{26}\b/g `` (Crockford base32 ULID, **uppercase-only** — I/L/O/U 제외; deep-memory의 `memory_id` 는 uppercase 만 emit. 향후 lowercase 도입 시 provenance silently drop 되지 않도록 명시 — R1-I1) 으로 모든 `memory_id` 토큰을 추출하여 state에 `cross_project_memory.cited_memory_ids` 배열로 기록한다. 빈 배열도 유효 (인용 자체가 빈 brief일 수 있음).
5. **State 필드** (frontmatter, 부재 시 모두 null/[]):
   - `cross_project_memory.brief_path` — `.deep-memory/latest-brief.md` 또는 null
   - `cross_project_memory.brief_mtime` — ISO 8601 또는 null
   - `cross_project_memory.brief_stale` — boolean (mtime 기준 > 14d)
   - `cross_project_memory.cited_memory_ids` — `mem-<ULID>` 배열

**Privacy 불변식**:
- 본 skill은 `/deep-memory-brief`를 **호출하지 않는다**. 오직 이미 존재하는 brief 파일을 읽기만 한다.
- 본 skill은 `.deep-memory/` 하위에 **쓰지 않는다**. brief 파일은 read-only.
- 인용 후 feedback hook(memory 평가)은 향후 Phase 4+ PR에서 양쪽 동시 도입 — 현재 PR은 spec만 명시 (`docs/deep-memory-integration-handoff.md` §4).

# Section 2: Phase 실행

## First Action (즉시 실행 — 건너뛰기 금지)

Section 1 state 로드와 완료-marker 감지가 끝나면 **즉시** 다음 메시지를 출력한 뒤 별도 확인 없이 Glob 실행으로 진입한다:

> "코드베이스 분석을 시작합니다. 주요 디렉토리부터 매핑합니다."

이어서 Glob 도구로 `**/*.{md,json,ts,tsx,js,py,sh,go,rs}` 등 프로젝트 주요 확장자 또는 topology-detector 결과에 따른 디렉토리 매핑을 수행한다. "시작할까요?" 같은 추가 확인 금지 — Exit Gate는 Section 3 완료 후 Orchestrator가 처리.

**금지**: 이 선언과 Glob 호출 전에 template, 완료 메시지, 6개 영역 bullet list를 사용자에게 출력하지 마라.

## Health Engine Preflight (부모 세션 소유)

First Action의 디렉토리 매핑 직후, Agent 위임 전에 부모 세션이 Health Engine 진단을 수행한다. 이 단계는 조용히 실행하고, 결과만 research context와 state에 반영한다.

1. Topology 감지:
   - `node ${CLAUDE_PLUGIN_ROOT}/templates/topology-detector.js "$WORK_DIR"` 또는 동등한 Node module 호출로 topology를 감지한다.
   - 감지 결과를 state frontmatter/body의 `topology` 필드에 기록한다.
2. Fitness rules 준비:
   - `$WORK_DIR/.deep-review/fitness.json` 존재 여부를 확인한다.
   - 없으면 `health/fitness/fitness-generator.js`의 `generateFitnessRules($WORK_DIR)`로 rules 후보를 생성하고, 자동 적용하지 말고 research context에 "fitness.json proposal available" 또는 명시적 skip 사유를 기록한다.
   - 있으면 그대로 사용한다. CLI 경로에서는 `health/health-check.js --fitness "$WORK_DIR/.deep-review/fitness.json"`을 사용할 수 있다.
3. Health Check 실행:
   - `node ${CLAUDE_PLUGIN_ROOT}/health/health-check.js "$WORK_DIR" --skip-audit` 또는 `runHealthCheck($WORK_DIR, { fitnessPath })` 동등 호출을 실행한다.
   - 결과 전체를 state의 `health_report`에 기록한다.
4. Phase 4 baseline 기록:
   - `fitness_baseline`: `health_report.fitness.required_missing`, `health_report.fitness.failed`, `health_report.fitness.violations`의 Phase 1 snapshot.
   - `unresolved_required_issues`: `health_report.fitness.required_missing` 및 `health_report.drift.dependency_vuln.critical/high`에서 required gate로 남은 항목 목록 또는 count.
5. Research context 삽입:
   - Agent prompt의 context에 `topology`, `health_report` 요약, `fitness_baseline`, `unresolved_required_issues`를 포함한다.
   - Health Check 실행 실패 시 실패 메시지와 skip 사유를 state에 남기고 Research 자체는 계속 진행한다.

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
- [ ] (brief 있을 때만) `## Cross-project Memory` 섹션 포함 + `cited_memory_ids` 추출 — 부재 시 이 항목 skip (research.md 는 deep-memory-agnostic 유지)

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
- `cross_project_memory`: `{brief_path, brief_mtime, brief_stale, cited_memory_ids[]}` — Cross-Plugin Context의 Deep-Memory Brief Context 처리 결과 (부재 시 `{null, null, false, []}`)

### Shadow risk — authoritative (v6.11.0, 관찰 전용)

research.md 완성 직후, Orchestrator 복귀 전에 수행한다. **실패해도 Research Exit Gate에 영향 없음** — 경고 1줄 + errors 기록 후 계속 (fail-open).

1. research.md 소견에서 구조화 evidence JSON을 작성한다 (스킬이 추출, 입력 전문은 CLI가 artifact로 보존):
   - `changed_paths`: 변경(예정) 파일 경로 목록
   - `keywords`: 위험 관련 키워드 (lease/lock/retry/auth/migration 등 원문 그대로)
   - `side_effects`: 외부 side effect 서술 목록
   - `evidence_refs`: `research.md#<앵커>` 목록
2. state에서 `model_routing`/`tiers`/`pinned`를 인코딩-무관하게 추출한다 (라우팅 필드는 세션 생성 경로에 따라 `model_routing_json`/`model_routing_meta_json` JSON-string 스칼라로 존재할 수도, `model_routing:`/`model_routing_meta:` YAML 블록으로 존재할 수도 있다 — `runtime/slice-runtime.js`의 `migrateModelRouting`은 전자를, orchestrator §1-9 서술은 후자를 쓴다. **`model_routing_meta_json`은 repo 전수 grep 기준 미확정 후보 필드명이다 — 구현 착수 전 실제 세션 state 실물(샘플 세션 파일 또는 세션 생성 경로의 실제 persist 코드)에서 `model_routing_meta`가 저장되는 실제 필드명을 먼저 확인하고, 아래 판별 순서를 확인된 실제 필드명 기준으로 적용한다.** 실제 필드명은 세션 생성 경로별로 다를 수 있으므로 아래 순서로 판별한다):
   - (a) state에 `model_routing_json`/`model_routing_meta_json`(위에서 확인한 실제 필드명) 스칼라가 있으면 `JSON.parse`로 `model_routing`/`tiers`(`.tiers`)/`pinned`(`.pinned`, 없으면 `{}`)를 추출한다.
   - (b) 없으면 `model_routing:`/`model_routing_meta:` YAML 블록을 스킬(LLM)이 직접 읽어 동일하게 `model_routing`/`tiers`/`pinned`를 추출한다. **§5.1 원리상 frontmatter 중첩 블록은 정상 세션에서 드묾 — state 본문 등 다른 위치에 있을 수 있어 스킬이 파일 전문에서 탐색한다.**
   - (c) `tiers` 또는 `pinned`를 끝내 얻지 못한 모든 경우(둘 다 결측이거나, `model_routing`만 있고 `model_routing_meta`가 부재해 `tiers`/`pinned`만 부분결측인 경우 포함) — 얻지 못한 값은 `{}`로 채워 진행하되 **가시 경고 1줄을 반드시 출력**한다: `model routing 정보를 찾지 못해 routing_diff가 전 phase 제외 처리됩니다`(부분결측 시에도 동일 경고 문구를 사용한다). 이 경우 `risk_profile_json.errors`에는 기록하지 않는다 (위험도 계산 자체는 성공 — routing_diff만 공집합이 됨).
   - `risk_profile_json`의 `provisional.class` → `prior_profile: {"class": "<값>"}`.
   - `difficulty`: state `recommendations`의 `task_difficulty.value`(부재 시 null). `runtime`: 위에서 추출한 `model_routing_meta`의 `runtime` 값(부재 시 키 생략 — CLI가 'unknown' 처리). (Task 7 리뷰 I2 — provisional이 가진 문맥을 authoritative에서도 유지)
3. 입력 JSON `{task_text, evidence, model_routing, tiers, pinned, difficulty, runtime, prior_profile}`을 임시 파일로 저장 후 실행:

```bash
# 이 스킬 컨텍스트에는 PROJECT_ROOT가 정의되어 있지 않다 — line 98 관례와 동일하게 명시 설정
# (미설정 시 CLI가 cwd로 fallback해 signals를 오수집: Task 7 리뷰 W1)
PROJECT_ROOT="$(git -C "$WORK_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
RISK_IN=$(mktemp)
# (1~2에서 구성한 입력 JSON을 $RISK_IN에 기록)
RISK_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/risk-profile-cli.js" \
  --stage authoritative --root "$PROJECT_ROOT" --work-dir "$WORK_DIR" --input-file "$RISK_IN")
rm -f "$RISK_IN"
```

4. 성공 시 state 갱신 (기존 JSON을 읽어 병합 후 한 줄 JSON 문자열로 재기록). **`risk_profile_json` 필드 자체가 없으면(v6.11 이전 legacy/resume 세션 — v6.11 orchestrator는 §1-8.6이 provisional을 항상 기록) `{"schema_version":1,"history":[],"errors":[]}` skeleton을 먼저 생성한 뒤 병합한다** (Task 8과 동일 규칙, Task 7 리뷰 I1):
   - `risk_profile_json`: `authoritative` 키에 `{...RISK_OUT.risk_profile, "input_ref": RISK_OUT.input_ref, "evidence_refs": <evidence_refs>}` 추가. `RISK_OUT.risk_profile.transition`이 null이 아니면 `history`에 `{from, to, stage: "authoritative", reason, at: <decided_at>}` append (스펙 §4.1 — append는 호출자 책임).
   - `policy_shadow_json`: `authoritative` 키에 `RISK_OUT.policy_snapshot` 추가 — **`provisional` 키는 덮어쓰지 않고 보존** (스펙 §6).
5. 실패 시(`risk_profile: null`): `risk_profile_json.errors`에 `{stage: "authoritative", message, at}` append (필드 부재 시 위 4의 skeleton 규칙 적용), 경고 1줄, 계속 진행.
6. 요약 1줄: `Shadow risk: <provisional class> → <authoritative class> (profile 추천: <profile>)`

**NOTE: `current_phase`를 변경하지 않는다.** Orchestrator가 리뷰+승인 후 변경.

## 완료 메시지

```
Research 단계가 완료되었습니다!
연구 결과: $WORK_DIR/research.md
분석 요약: [3-5줄]
```

Team 모드 시 부분 결과 파일도 표시.
