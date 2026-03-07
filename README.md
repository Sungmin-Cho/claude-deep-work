# Deep Work Plugin

AI 코딩 도구 사용 시 **기획과 코딩의 철저한 분리**를 강제하는 3단계 워크플로우 플러그인.

## 문제

AI 코딩 도구가 복잡한 작업을 수행할 때 흔히 발생하는 문제:
- 기존 아키텍처를 무시하고 새로운 패턴을 도입
- 이미 존재하는 유틸리티를 중복 구현
- 코드베이스를 충분히 이해하기 전에 구현 시작
- 요청하지 않은 "개선"을 추가하여 버그 유발

## 해결책

**Research → Plan → Implement** 3단계 워크플로우로 분석, 계획, 구현을 엄격히 분리합니다.

- **Phase 1 (Research)**: 코드베이스를 깊이 분석하여 문서화
- **Phase 2 (Plan)**: 분석 결과를 바탕으로 상세 구현 계획 작성, 사용자 승인
- **Phase 3 (Implement)**: 승인된 계획을 기계적으로 실행 (승인 시 자동 시작)

Phase 1, 2에서는 **코드 파일 수정이 물리적으로 차단**됩니다 (PreToolUse 훅).

## v2.0.0 주요 변경사항

### 1. 작업별 폴더 히스토리
세션마다 고유한 작업 폴더가 생성되어 이전 세션의 산출물이 보존됩니다.

```
deep-work/
├── 20260307-143022-jwt-기반-인증/
│   ├── research.md
│   ├── plan.md
│   └── report.md
├── 20260306-091500-api-리팩토링/
│   ├── research.md
│   ├── plan.md
│   └── report.md
```

폴더 이름은 `YYYYMMDD-HHMMSS-<작업-slug>` 형식으로 자동 생성됩니다. 한글 작업 설명도 slug에 포함됩니다.

### 2. 승인 → 자동 구현
`/deep-plan`에서 계획을 승인하면 `/deep-implement`를 별도로 실행할 필요 없이 구현이 자동으로 시작됩니다.

### 3. 세션 리포트
구현 완료 후 전체 세션에 대한 리포트(`report.md`)가 자동 생성됩니다. `/deep-report` 커맨드로 언제든 리포트를 조회하거나 재생성할 수 있습니다.

## 사용법

```bash
# 1. 세션 시작 (Solo/Team 모드 선택, 작업 폴더 자동 생성)
/deep-work "JWT 기반 사용자 인증 구현"

# 2. 코드베이스 분석
/deep-research

# 3. 연구 결과 검토 후 계획 작성
/deep-plan

# 4. 계획서 검토 → 피드백 → /deep-plan 재실행 → 반복
#    만족스러우면 "승인" 입력 → 구현 자동 시작 → 리포트 자동 생성

# 리포트 조회/재생성 (아무 때나)
/deep-report

# 상태 및 세션 히스토리 확인 (아무 때나)
/deep-status
```

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/deep-work <task>` | 세션 초기화, 작업별 폴더 생성 |
| `/deep-research` | Phase 1: 코드베이스 분석 → `research.md` |
| `/deep-plan` | Phase 2: 구현 계획 작성 → `plan.md`, 승인 시 자동 구현 |
| `/deep-implement` | Phase 3: 계획 실행 (수동 실행도 가능) |
| `/deep-report` | 세션 리포트 생성 또는 조회 |
| `/deep-status` | 현재 상태, 진행률, 세션 히스토리 확인 |

## 산출물

각 세션의 산출물은 `deep-work/<작업폴더>/`에 저장됩니다:

| 파일 | 생성 시점 | 설명 |
|------|----------|------|
| `research.md` | Phase 1 완료 | 코드베이스 분석 결과 (아키텍처, 패턴, 리스크 등) |
| `plan.md` | Phase 2 완료 | 상세 구현 계획 (체크리스트, 실행 순서, 롤백 전략) |
| `report.md` | Phase 3 완료 | 전체 세션 리포트 (요약, 결과, 검증, 이슈) |

세션 상태는 `.claude/deep-work.local.md`에 저장됩니다:
- `current_phase`: 현재 단계 (research / plan / implement / idle)
- `work_dir`: 작업 폴더 경로
- `task_description`: 작업 설명
- `research_complete`: 연구 완료 여부
- `plan_approved`: 계획 승인 여부
- `team_mode`: 작업 모드 (solo / team)
- `iteration_count`: 계획 반복 횟수
- `started_at`: 세션 시작 시간

## 워크플로우 상세

### Phase 1: Research

코드베이스를 6개 영역으로 체계적으로 분석합니다:

1. **Architecture & Structure** — 프로젝트 구조, 아키텍처 패턴, 모듈 경계
2. **Code Patterns & Conventions** — 네이밍 컨벤션, 에러 처리, 테스팅 패턴
3. **Data Layer** — ORM/DB 스키마, 마이그레이션, 캐싱 전략
4. **API & Integration** — API 구조, 인증/인가, 외부 서비스 연동
5. **Shared Infrastructure** — 공통 유틸리티, 설정 관리, 빌드 시스템
6. **Dependencies & Risks** — 의존성 충돌, 호환성, 보안 리스크

Team 모드에서는 3명의 전문 에이전트(arch-analyst, pattern-analyst, risk-analyst)가 병렬로 분석합니다.

### Phase 2: Plan

연구 결과를 바탕으로 구체적인 구현 계획을 작성합니다:

- 변경할 파일 목록과 각 파일의 구체적 변경 내용
- 코드 스케치 (의사코드 또는 실제 코드 스니펫)
- 실행 순서 (의존성 고려)
- 트레이드오프 분석
- 롤백 전략
- 태스크 체크리스트

사용자는 파일에 직접 메모(`> [!NOTE]`, `<!-- HUMAN: -->`)를 추가하거나 채팅으로 피드백할 수 있습니다. `/deep-plan` 재실행 시 피드백이 반영됩니다.

**"승인" 입력 시 구현이 자동으로 시작됩니다.**

### Phase 3: Implement

승인된 계획을 기계적으로 실행합니다:

- 체크리스트의 태스크를 순서대로 하나씩 실행
- 각 태스크 완료 후 체크 표시 (`- [x]`)
- 문제 발생 시 즉시 중단하고 문서화 (임의 해결 금지)
- 타입 체크, 린트, 테스트 검증
- **구현 완료 후 세션 리포트 자동 생성**

Team 모드에서는 파일 소유권 기반으로 작업을 에이전트에게 분배하고, 구현 후 크로스 리뷰를 수행합니다.

### Session Report

구현 완료 후 자동으로 생성되는 리포트에는 다음이 포함됩니다:

- **Session Overview** — 작업명, 시작/완료 시간, 모드, 반복 횟수
- **Research Summary** — 핵심 분석 결과 요약
- **Plan Summary** — 선택한 접근법, 핵심 결정사항
- **Implementation Results** — 태스크별 실행 결과 테이블
- **Files Changed** — 생성/수정/삭제된 파일 목록
- **Verification Results** — 타입 체크, 린트, 테스트, 빌드 결과
- **Issues & Notes** — 발생한 이슈와 참고사항

## Phase Guard

`hooks/scripts/phase-guard.sh`가 Write/Edit 도구 호출을 감시합니다:

- **Research/Plan 단계**: 작업 폴더 내 문서와 상태 파일만 수정 허용
- **Implement 단계**: 모든 파일 수정 허용
- **세션 비활성**: 제한 없음

## Solo vs Team 모드

| 항목 | Solo | Team |
|------|------|------|
| Research | 단일 에이전트 분석 | 3명 병렬 분석 (arch/pattern/risk) |
| Plan | 단일 에이전트 작성 | 단일 에이전트 작성 (동일) |
| Implement | 순차 실행 | 파일 소유권 기반 병렬 실행 + 크로스 리뷰 |
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
| 높음 | Research → Plan → Implement | 5+ 파일, 아키텍처 변경, 낯선 코드베이스 |
| 중간 | Plan → Implement (Research 생략) | 2-4 파일, 익숙한 영역의 확장 |
| 낮음 | 워크플로우 불필요 | 단일 파일 수정, 설정 변경 |

## 설치

### 방법 1: GitHub Marketplace (권장)

```bash
# 1. 마켓플레이스 추가
/plugin marketplace add Sungmin-Cho/sseocho-plugins

# 2. 플러그인 설치
/plugin install deep-work@sseocho
```

### 방법 2: npm

```bash
npm install @sseocho/claude-deep-work
```

### 방법 3: 로컬 (개발용)

이 저장소를 `~/.claude/plugins/deep-work/`에 클론합니다.
Claude Code가 자동으로 플러그인을 감지합니다.

## 라이선스

MIT
