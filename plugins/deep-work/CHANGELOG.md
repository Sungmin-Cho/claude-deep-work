# Changelog

All notable changes to the Deep Work plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-03-13

### Added

#### Phase 4: Test (`/deep-test`)
- **P-1**: 새로운 Test phase 추가 (`implement → test → idle`)
- 프로젝트 설정 파일에서 테스트/린트/타입체크 명령어 자동 감지 (package.json, pyproject.toml, Makefile, Cargo.toml, go.mod)
- 테스트 실패 시 implement 단계로 자동 복귀, 수정 후 재테스트 루프 (최대 3회)
- `test-results.md`에 시도별 검증 결과 누적 기록
- Test phase에서 코드 수정 차단 (Phase Guard)

#### 제로베이스 모드
- **P-3**: 새 프로젝트를 처음부터 설계하는 Zero-Base 모드 추가
- 기술 스택 선정, 코딩 컨벤션, 데이터 모델, API 설계, 스캐폴딩, 의존성 평가 6개 영역 Research
- Plan에서 "Files to Create" + "Project Structure" + "Setup Instructions" 제공
- `references/zero-base-guide.md` 신규 가이드 추가

#### 대화형 Plan 리뷰
- **A-7**: 채팅으로 피드백하면 plan.md 자동 수정 (파일 직접 편집 불필요)
- 수정 내용 하이라이트 표시 후 재리뷰 대기

#### Plan 기능 강화
- **A-6**: Plan 재작성 시 이전 버전을 `plan.v{N}.md`로 백업, Change Log 섹션 추가
- **A-11**: 작업 유형별 Plan 템플릿 6종 (API 엔드포인트, UI 컴포넌트, DB 마이그레이션, 리팩토링, 버그 수정, Full Stack 기능)
- **P-2**: Plan 승인 시 Team↔Solo 모드 전환 자동 제안 (태스크 수, 파일 수 기반)

#### Research 기능 강화
- **A-8**: 부분 리서치 재실행 — `/deep-research --scope=api,data`로 특정 영역만 재분석
- **A-9**: Research 캐싱 — 이전 세션의 research.md를 베이스라인으로 활용, git diff 기반 변경 영역만 재분석

#### Git 통합
- **A-10**: 세션 시작 시 `deep-work/[slug]` 브랜치 생성 제안
- 세션 완료(테스트 통과) 시 커밋 메시지 자동 생성 및 커밋 제안

#### Phase 스킵
- **A-1**: 세션 초기화 시 Research를 건너뛰고 Plan부터 시작 가능
- 익숙한 코드베이스에서 불필요한 Research 생략

#### Implement 체크포인트
- **A-4**: 구현 중 중단 후 재실행 시 완료된 태스크 자동 스킵, 미완료 태스크부터 재개

#### 시간 추적
- **A-12**: 모든 Phase의 시작/완료 타임스탬프 기록
- 세션 리포트에 Phase별 소요 시간 테이블 추가

#### Team 모드 진행 알림
- **A-13**: Team 모드에서 에이전트 태스크 완료 시 `[2/3] pattern-analyst 완료 ✅` 형식 진행 알림

#### 세션 비교
- **A-14**: `/deep-status --compare`로 두 세션의 접근법, 수정 파일, 검증 결과 비교

#### 신규 파일
- `commands/deep-test.md` — Test Phase 커맨드
- `references/testing-guide.md` — Test Phase 상세 가이드
- `references/plan-templates.md` — Plan 템플릿 모음
- `references/zero-base-guide.md` — 제로베이스 Research 가이드
- `CHANGELOG.md` — 변경 이력 파일

### Changed

#### 출력 형식 개선
- **P-5**: research.md에 Executive Summary, Key Findings, Risk & Blockers를 최상단에 배치 (피라미드 원칙)
- **P-5**: plan.md에 Plan Summary (접근법, 변경 범위, 리스크, 핵심 결정)를 최상단에 배치

#### Phase Guard 메시지 개선
- **A-2**: 차단 메시지에 Phase별 "다음 단계" 구체적 안내 추가
- Research: "→ /deep-plan 또는 /deep-research 실행"
- Plan: "→ 계획 승인 또는 /deep-plan 재실행"
- Test: "→ 테스트 통과/실패 시 자동 처리, test-results.md 참조"

#### Phase 흐름 변경
- `research → plan → implement → idle` → `research → plan → implement → test ⟲ → idle`
- Implement 완료 후 idle 대신 test phase로 자동 전환
- Test 실패 시 implement로 복귀하는 재시도 루프

#### 상태 파일 스키마 확장
- 신규 필드: `project_type`, `git_branch`, `test_retry_count`, `max_test_retries`, `test_passed`
- 신규 타임스탬프: `research_started_at/completed_at`, `plan_started_at/completed_at`, `implement_started_at/completed_at`, `test_started_at/completed_at`

#### 버전 통일
- **A-3**: `plugin.json`과 `package.json`의 버전을 3.0.0으로 통일

#### SKILL.md 업데이트
- 4-phase 워크플로우 반영
- 제로베이스 모드 트리거 키워드 추가 ("새 프로젝트 시작", "제로베이스", "zero-base", "from scratch")
- 신규 기능 설명 추가 (Research 캐싱, 부분 재실행, Plan 템플릿, 대화형 리뷰 등)

#### Reference 가이드 업데이트
- `research-guide.md` — Executive Summary/Key Findings 출력 형식 추가, 제로베이스 가이드 링크
- `planning-guide.md` — Plan Summary 출력 형식 추가, 템플릿 가이드 링크
- `implementation-guide.md` — 완료 후 Test phase 전환으로 Completion Protocol 변경

## [2.0.0] - 2026-03-07

### Added
- 작업별 폴더 히스토리 (`deep-work/YYYYMMDD-HHMMSS-slug/`)
- 승인 시 자동 구현 시작
- 세션 리포트 자동 생성 (`report.md`)
- `/deep-report` 커맨드 (리포트 조회/재생성)
- `/deep-status` 커맨드 (상태, 진행률, 세션 히스토리)
- Solo/Team 모드 선택
- Team 모드: 3명 병렬 Research, 파일 소유권 기반 병렬 Implement, 크로스 리뷰

### Changed
- 상태 파일에 `work_dir`, `team_mode`, `started_at` 필드 추가
- Phase Guard가 `deep-work/` 디렉토리 내 문서 수정은 허용

## [1.1.0] - 2026-03-01

### Added
- Phase Guard (PreToolUse hook) — Research/Plan 단계에서 코드 파일 수정 차단
- 상태 파일 기반 phase 관리

### Changed
- 기존 단순 프롬프트 기반에서 hook 기반 강제 분리로 전환

## [1.0.0] - 2026-02-15

### Added
- 초기 버전
- 3단계 워크플로우: Research → Plan → Implement
- `/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement` 커맨드
- `research.md`, `plan.md` 산출물 생성
- 반복적 Plan 리뷰 지원
