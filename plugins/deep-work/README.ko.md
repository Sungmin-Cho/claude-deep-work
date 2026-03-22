[English](./README.md) | **한국어**

# Deep Work Plugin

AI 코딩 도구 사용 시 **기획과 코딩의 철저한 분리**를 강제하는 4단계 워크플로우 플러그인.

<p align="center">
  <img src="./demo.gif" alt="Deep Work Plugin 데모 — 4단계 워크플로우 + 3계층 Quality Gate" width="800">
</p>

## 문제

AI 코딩 도구가 복잡한 작업을 수행할 때 흔히 발생하는 문제:
- 기존 아키텍처를 무시하고 새로운 패턴을 도입
- 이미 존재하는 유틸리티를 중복 구현
- 코드베이스를 충분히 이해하기 전에 구현 시작
- 요청하지 않은 "개선"을 추가하여 버그 유발
- 구현 후 검증 없이 완료 처리

## 해결책

**Research → Plan → Implement → Test** 4단계 워크플로우로 분석, 계획, 구현, 검증을 엄격히 분리합니다.

- **Phase 1 (Research)**: 코드베이스를 깊이 분석하여 문서화
- **Phase 2 (Plan)**: 분석 결과를 바탕으로 상세 구현 계획 작성, 사용자 승인
- **Phase 3 (Implement)**: 승인된 계획을 기계적으로 실행 (승인 시 자동 시작)
- **Phase 4 (Test)**: 자동 테스트/린트/타입체크 실행, 실패 시 구현으로 복귀

Phase 1, 2, 4에서는 **코드 파일 수정이 물리적으로 차단**됩니다 (PreToolUse 훅). Phase 3에서는 **파일 변경이 자동 추적**됩니다 (PostToolUse 훅).

## 사용법

```bash
# 1. 세션 시작 (Solo/Team, 기존/제로베이스, Research/Plan 시작점 선택)
/deep-work "JWT 기반 사용자 인증 구현"

# 2. 코드베이스 분석
/deep-research

# 3. 연구 결과 검토 후 계획 작성
/deep-plan

# 4. 계획서 리뷰 → 채팅으로 피드백 → plan.md 자동 수정 → 반복
#    만족스러우면 "승인" → 구현 자동 시작 → 테스트 자동 실행 → 리포트 자동 생성

# 부분 리서치 재실행 (특정 영역만)
/deep-research --scope=api,data

# 증분 리서치 (변경된 부분만 재분석)
/deep-research --incremental

# 리포트 조회/재생성
/deep-report

# 상태 및 세션 히스토리 확인
/deep-status

# 두 세션 비교
/deep-status --compare
```

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/deep-work <task>` | 세션 초기화, 작업별 폴더 생성, 옵션 선택 |
| `/deep-research` | Phase 1: 코드베이스 분석 → `research.md` |
| `/deep-plan` | Phase 2: 구현 계획 작성 → `plan.md`, 승인 시 자동 구현 |
| `/deep-implement` | Phase 3: 계획 실행 (수동 실행도 가능) |
| `/deep-test` | Phase 4: 통합 테스트 실행, 실패 시 implement 복귀 |
| `/drift-check` | Plan 대비 구현 정합성 검증 (독립 실행 또는 내장 게이트) |
| `/solid-review` | SOLID 디자인 원칙 리뷰 (독립 실행 또는 advisory 게이트) |
| `/deep-insight` | 코드 메트릭, 복잡도, 의존성 분석 (독립 실행 또는 Insight 게이트) |
| `/deep-report` | 세션 리포트 생성 또는 조회 |
| `/deep-status` | 현재 상태, 진행률, Phase별 소요 시간, 세션 히스토리 |

## 산출물

각 세션의 산출물은 `deep-work/<작업폴더>/`에 저장됩니다:

| 파일 | 생성 시점 | 설명 |
|------|----------|------|
| `research.md` | Phase 1 완료 | 코드베이스 분석 결과 (Executive Summary 먼저) |
| `plan.md` | Phase 2 완료 | 상세 구현 계획 (Plan Summary 먼저) |
| `plan.v{N}.md` | Plan 재작성 시 | 이전 Plan 버전 백업 |
| `test-results.md` | Phase 4 완료 | 검증 결과 (시도별 누적) |
| `report.md` | 세션 완료 | 전체 세션 리포트 (Phase별 소요 시간 포함) |
| `quality-gates.md` | Phase 4 완료 | Quality Gate 결과 상세 (required/advisory) |
| `drift-report.md` | Phase 4 완료 | Plan 정합성 검증 결과 |
| `solid-review.md` | Phase 4 완료 | SOLID 설계 리뷰 스코어카드 및 제안 |
| `insight-report.md` | Phase 4 완료 | 코드 메트릭, 복잡도, 의존성 분석 |
| `file-changes.log` | Phase 3 진행 중 | PostToolUse 훅 자동 파일 변경 추적 |
| `plan-diff.md` | Plan 재작성 시 | Plan 버전 간 구조적 변경 비교 |

## 세션 상태

`.claude/deep-work.local.md`에 YAML frontmatter로 저장:

| 필드 | 설명 |
|------|------|
| `current_phase` | 현재 단계 (research / plan / implement / test / idle) |
| `work_dir` | 작업 폴더 경로 |
| `task_description` | 작업 설명 |
| `team_mode` | 작업 모드 (solo / team) |
| `project_type` | 프로젝트 타입 (existing / zero-base) |
| `git_branch` | 생성된 Git 브랜치명 |
| `test_retry_count` | 테스트 재시도 횟수 |
| `test_passed` | 최종 테스트 통과 여부 |
| `*_started_at`, `*_completed_at` | Phase별 시작/완료 타임스탬프 |
| `model_routing` | Phase별 모델 설정 (research/plan/implement/test) |
| `notifications` | 알림 설정 (채널 목록, 활성화 여부) |
| `last_research_commit` | 마지막 리서치 시점의 git commit hash |
| `quality_gates_passed` | Quality Gate 전체 통과 여부 |
| `plan_approved_at` | Plan 승인 시점 타임스탬프 (Drift Detection 기준) |

## 워크플로우 상세

### Phase 1: Research

코드베이스를 6개 영역으로 체계적으로 분석합니다:

1. **Architecture & Structure** — 프로젝트 구조, 아키텍처 패턴, 모듈 경계
2. **Code Patterns & Conventions** — 네이밍 컨벤션, 에러 처리, 테스팅 패턴
3. **Data Layer** — ORM/DB 스키마, 마이그레이션, 캐싱 전략
4. **API & Integration** — API 구조, 인증/인가, 외부 서비스 연동
5. **Shared Infrastructure** — 공통 유틸리티, 설정 관리, 빌드 시스템
6. **Dependencies & Risks** — 의존성 충돌, 호환성, 보안 리스크

**v3.0 신규 기능:**
- **Executive Summary 먼저 제시** — 피라미드 원칙: 결론 → 근거 → 세부사항
- **제로베이스 모드** — 기술 스택 선정, 스캐폴딩 설계 등 새 프로젝트용 Research
- **부분 재실행** — `/deep-research --scope=api,data`로 특정 영역만 재분석
- **Research 캐싱** — 이전 세션 Research를 베이스라인으로 활용, 변경 영역만 재분석
- **Team 모드 진행 알림** — 에이전트 완료 시 `[2/3] pattern-analyst 완료 ✅` 표시

**v3.1 신규 기능:**
- **증분 리서치** — `/deep-research --incremental`로 git diff 기반 변경 영역만 재분석 (시간 60~80% 절감)
- **모델 라우팅** — Research Phase를 sonnet 모델 Agent에 위임하여 토큰 절감

### Phase 2: Plan

연구 결과를 바탕으로 구체적인 구현 계획을 작성합니다:

- Plan Summary (접근법, 변경 범위, 리스크, 핵심 결정) 먼저 제시
- 변경할 파일 목록과 각 파일의 구체적 변경 내용
- 코드 스케치, 실행 순서, 트레이드오프 분석, 롤백 전략
- 태스크 체크리스트

**v3.0 신규 기능:**
- **대화형 Plan 리뷰** — 채팅으로 "3번 항목 변경해줘" → plan.md 자동 수정
- **Plan 템플릿** — API 엔드포인트, UI 컴포넌트, DB 마이그레이션 등 6종
- **Plan 변경 이력** — 재작성 시 `plan.v{N}.md`로 백업, Change Log 추가
- **모드 전환 제안** — Plan 분석 결과에 따라 Team↔Solo 전환 추천
- **"승인" 입력 시 구현이 자동으로 시작됩니다.**

**v3.1 신규 기능:**
- **Plan Diff 시각화** — Plan 재작성 시 태스크/파일/아키텍처/리스크 변경을 `plan-diff.md`로 자동 비교

### Phase 3: Implement

승인된 계획을 기계적으로 실행합니다:

- 체크리스트의 태스크를 순서대로 하나씩 실행
- 각 태스크 완료 후 체크 표시 (`- [x]`)
- 문제 발생 시 즉시 중단하고 문서화 (임의 해결 금지)
- **구현 완료 후 자동으로 Test 단계 진입**

**v3.0 신규 기능:**
- **체크포인트 (재개 지원)** — 중단 후 재실행 시 완료된 태스크 스킵
- **Team 모드 진행 알림** — 에이전트별 완료 상태 실시간 표시

### Phase 4: Test

구현 결과를 자동으로 검증합니다:

- 프로젝트 설정 파일에서 테스트/린트/타입체크 명령어 자동 감지
- 순차 실행 후 결과 기록 (`test-results.md`)
- **모두 통과**: 세션 완료 → 리포트 자동 생성
- **실패 시**: implement 단계로 복귀 → 수정 → 재테스트 (최대 3회)
- 재시도 횟수 초과 시 루프 중단, 수동 개입 요청

```
implement → test → (통과) → idle + report
                 → (실패) → implement → test → ...
```

**v3.1 신규 기능:**
- **Quality Gate 시스템** — plan.md에 게이트 정의 (required ✅ / advisory ⚠️), `quality-gates.md` 산출물
- **모델 라우팅** — Test Phase를 haiku 모델 Agent에 위임하여 비용 최소화

**v3.2 신규 기능:**
- **3계층 Quality Gate 시스템** — Required (차단) / Advisory (경고) / Insight (정보)
- **Plan Alignment (Drift Detection)** — 내장 Required 게이트. Plan 대비 구현 정합성 자동 검증. 미구현 항목, 범위 초과, 설계 이탈 감지. `drift-report.md` 산출물.
- **SOLID Design Review** — Advisory 게이트. SRP, OCP, LSP, ISP, DIP 기준 설계 품질 리뷰. 파일별 스코어카드, Top 5 리팩토링 제안. `solid-review.md` 산출물.

**v3.3 신규 기능:**
- **Insight 계층 Quality Gate** — `/deep-insight` 커맨드 및 내장 Insight 게이트. 파일 메트릭, 복잡도 지표, 의존성 그래프, 변경 요약 분석. `insight-report.md` 산출물. 워크플로우 차단 없음.
- **PostToolUse 파일 추적** — Implement 단계에서 파일 수정을 자동으로 `file-changes.log`에 기록. `/deep-report`와 `/deep-insight`에서 활용.
- **Stop 훅** — CLI 세션 종료 시 활성 deep-work 세션이 있으면 알림 메시지 출력 및 알림 전송.

### Session Report

세션 완료 후 자동 생성되는 리포트:

- **Session Overview** — 작업명, 모드, 프로젝트 타입, Git 브랜치
- **Phase Duration** — 각 Phase별 소요 시간
- **Research/Plan Summary** — 핵심 분석 결과, 접근법
- **Implementation Results** — 태스크별 실행 결과
- **Verification Results** — 테스트/린트/타입체크 결과
- **Test Retry History** — 시도별 결과 이력

### Model Routing (v3.1)

Phase별 최적 모델을 배정하여 토큰 비용을 30~40% 절감합니다:

| Phase | 기본 모델 | 방식 | 근거 |
|-------|----------|------|------|
| Research | sonnet | Agent 위임 | 탐색/분석에 충분 |
| Plan | 메인 세션 | 직접 실행 | 대화형 피드백 필요 |
| Implement | sonnet | Agent 위임 | 코드 작성에 충분 |
| Test | haiku | Agent 위임 | 테스트 실행만 수행 |

`/deep-work` 초기화 시 커스터마이징 가능 (sonnet, haiku, opus 선택).

### Multi-Channel Notifications (v3.1)

Phase 완료 시 알림을 전송합니다:

| 채널 | 방식 | 설정 |
|------|------|------|
| Local | OS 네이티브 (macOS/Linux/Windows) | 기본 |
| Slack | Incoming Webhook | URL 입력 |
| Discord | Webhook | URL 입력 |
| Telegram | Bot API | Token + Chat ID |
| Custom Webhook | HTTP POST/GET/PUT | URL + Headers + Body Template |

커스텀 Webhook의 `body_template`은 `{{phase}}`, `{{status}}`, `{{message}}`, `{{timestamp}}`, `{{task}}` 변수 치환을 지원합니다.

### Quality Gates (v3.1)

plan.md에 Quality Gates를 정의하면 Test Phase에서 자동 실행됩니다:

```markdown
## Quality Gates

| Gate | 명령어 | 필수 | 임계값 |
|------|--------|------|--------|
| Type Check | `npx tsc --noEmit` | ✅ | — |
| Coverage | `npm test -- --coverage` | ⚠️ | ≥80% |
```

- **✅ 필수(required)**: 실패 시 implement 복귀
- **⚠️ 권고(advisory)**: 경고만 기록, 차단 없음
- **ℹ️ 인사이트(insight)**: 결과 기록만 (v3.3)
- 미정의 시 기존 auto-detection 유지

## 다국어 지원 (v3.2.2)

모든 커맨드가 사용자의 언어를 자동으로 감지하여 해당 언어로 메시지를 출력합니다. 별도 설정 불필요.

- **한국어**: 기본 참조 템플릿
- **영어**: 자동 번역
- **기타 언어**: 일본어, 중국어 등 Claude가 지원하는 모든 언어

사용자 메시지 또는 Claude Code `language` 설정에서 언어를 감지합니다.

## Hooks

세션 라이프사이클을 관리하는 3개의 훅:

| 훅 | 스크립트 | 트리거 | 용도 |
|-----|--------|--------|------|
| PreToolUse | `phase-guard.sh` | Write/Edit/MultiEdit | Research/Plan/Test 단계에서 코드 수정 차단 |
| PostToolUse | `file-tracker.sh` | Write/Edit/MultiEdit | Implement 단계에서 파일 변경 추적 |
| Stop | `session-end.sh` | CLI 세션 종료 | 활성 세션 알림 및 노티피케이션 |

### Phase Guard

| 단계 | 코드 수정 | 문서 수정 | 파일 추적 |
|------|----------|----------|----------|
| Research | ❌ 차단 | ✅ 허용 | — |
| Plan | ❌ 차단 | ✅ 허용 | — |
| Implement | ✅ 허용 | ✅ 허용 | ✅ 추적 |
| Test | ❌ 차단 | ✅ 허용 | — |
| Idle | ✅ 허용 | ✅ 허용 | — |

## 세션 초기화 옵션

`/deep-work` 실행 시 다음 옵션을 선택합니다:

| 옵션 | 선택지 | 설명 |
|------|--------|------|
| 작업 모드 | Solo / Team | 에이전트 병렬 실행 여부 |
| 프로젝트 타입 | 기존 코드 / 제로베이스 | 새 프로젝트 여부 |
| 시작 단계 | Research / Plan | 익숙한 코드면 Research 생략 가능 |
| Git 브랜치 | 생성 / 건너뜀 | 세션용 브랜치 자동 생성 |
| 모델 라우팅 | 기본값 / 커스텀 | Phase별 모델 배정 |
| 알림 | 없음 / 로컬 / 외부 | Phase 완료 시 알림 |

## Solo vs Team 모드

| 항목 | Solo | Team |
|------|------|------|
| Research | 단일 에이전트 분석 | 3명 병렬 분석 (arch/pattern/risk) |
| Plan | 단일 에이전트 작성 | 단일 에이전트 작성 (동일) |
| Implement | 순차 실행 | 파일 소유권 기반 병렬 실행 + 크로스 리뷰 |
| Test | 동일 | 동일 |
| 요구사항 | 없음 | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |

Team 모드 활성화:
```json
// ~/.claude/settings.json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## 복잡도별 사용 가이드

| 복잡도 | 권장 워크플로우 | 기준 |
|--------|---------------|------|
| 높음 | Research → Plan → Implement → Test | 5+ 파일, 아키텍처 변경, 낯선 코드베이스 |
| 중간 | Plan → Implement → Test (Research 생략) | 2-4 파일, 익숙한 영역의 확장 |
| 낮음 | 워크플로우 불필요 | 단일 파일 수정, 설정 변경 |

## 설치 (v3.3.0)

Claude Code 설정에 마켓플레이스를 추가합니다:

```json
// ~/.claude/settings.json
{
  "extraKnownMarketplaces": {
    "claude-deep-work": {
      "source": {
        "source": "git",
        "url": "https://github.com/Sungmin-Cho/claude-deep-work.git"
      }
    }
  }
}
```

그 후 설치:

```bash
claude plugin install deep-work
```

### 기타 설치 방법

#### npm

```bash
npm install @claude-deep-work/deep-work
```

#### 로컬 (개발용)

이 저장소를 `~/.claude/plugins/deep-work/`에 클론합니다.
Claude Code가 자동으로 플러그인을 감지합니다.

## 라이선스

MIT
