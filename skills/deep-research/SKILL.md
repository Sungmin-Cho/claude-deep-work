---
name: deep-research
version: "6.2.3"
description: "Phase 1 — Research: exhaustively analyze the codebase"
---

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

## 모드 분기

- `project_type: zero-base` → Read("skills/shared/references/zero-base-guide.md") 후 Zero-Base Research 수행
- `team_mode: solo` → Solo Mode
- `team_mode: team` → Team Mode

---

## Solo Mode

### Health Check (자동)

1. `node "$CLAUDE_PLUGIN_DIR/health/health-check.js" "$PROJECT_ROOT"` 실행
2. fitness.json 미존재 시 → 생성 제안 (AskUserQuestion)
3. Health Report를 research context에 주입

### Topology Detection

`node templates/topology-detector.js <project-root>` → topology 결과를 세션에 저장

### Model Routing Check

State에서 `model_routing.research` 확인 (기본: "sonnet"):
- "main" 아님 → Agent(model=해당값)로 연구 위임, research.md 작성 후 Section 3으로
- "main" → 현재 세션에서 직접 실행

### Codebase 분석 (6개 영역)

상세 분석 방법론: Read("skills/shared/references/research-guide.md")

1. **Architecture & Structure** — 디렉토리, 패턴, 모듈 경계, 진입점
2. **Code Patterns & Conventions** — 네이밍, 에러 처리, 로깅, 테스팅, import 규칙
3. **Data Layer** — ORM/스키마, 마이그레이션, 검증, 캐싱
4. **API & Integration** — API 구조, 인증, 외부 서비스, 미들웨어
5. **Shared Infrastructure** — 유틸리티, 설정, 환경, 빌드
6. **Dependencies & Risks** — 주요 의존성, 충돌 위험, breaking change

### research.md 작성

Write `$WORK_DIR/research.md`:
```markdown
# Research: [Task Title]
## Executive Summary          ← 3-5줄 핵심 결론
## Key Findings               ← [RF-NNN] 태그 포함 불릿 리스트
## Risk & Blockers
---
## 1. Architecture & Structure
### Key Interfaces & Signatures  ← [RA-NNN] 태그
## 2. Relevant Patterns       ← 코드 스니펫 포함
## 3. Data Layer              ← 코드 스니펫 포함
## 4. API & Integration       ← 코드 스니펫 포함
## 5. Shared Infrastructure
## 6. Dependencies & Risk Assessment
## Key Files (table)
## Dependencies Map
## Constraints
## Testing Patterns
```

**Tag 규칙**: RF/RA 태그는 단조 증가. 증분 리서치 시 기존 태그 보존. 삭제 전 plan.md 참조 여부 확인.

---

## Team Mode

### Pre-check
```bash
echo "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-not_set}"
```
비활성 → `team_mode: solo`로 전환, Solo Mode로 fallback.

### 실행 흐름

1. **TeamCreate**: team_name=`deep-research`
2. **TaskCreate x 3**: 각 에이전트에 분석 영역 배분

   | Agent | 분석 영역 | Output |
   |-------|----------|--------|
   | arch-analyst | Architecture, structure, data, API | `$WORK_DIR/research-architecture.md` |
   | pattern-analyst | Patterns, conventions, infra, testing | `$WORK_DIR/research-patterns.md` |
   | risk-analyst | Dependencies, risks, security | `$WORK_DIR/research-dependencies.md` |

3. **Agent x 3 스폰**: model=`model_routing.research` (기본: sonnet)
4. **진행 모니터링**: TaskList로 진행 확인 + 완료 표시
5. **합성**: 3개 부분 결과 → 단일 `$WORK_DIR/research.md`로 통합 (위 포맷)
6. **정리**: SendMessage shutdown_request → TeamDelete

### Session Relevance Detection

사용자 추가 입력이 현재 세션 범위 밖이면 → AskUserQuestion (포함/분리/백로그)

# Section 3: 완료

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

Read("skills/shared/references/phase-review-gate.md") — 프로토콜 실행:
- Phase: research
- Document: `$WORK_DIR/research.md`
- Self-review checklist: 아키텍처 분석 완성도, 패턴 식별, 리스크 누락

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
