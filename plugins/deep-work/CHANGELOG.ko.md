[English](./CHANGELOG.md) | **한국어**

# Changelog

All notable changes to the Deep Work plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.2] - 2026-03-21

### Added
- **다국어 지원 (i18n)**: 9개 커맨드 파일 모두 사용자의 메시지 또는 Claude Code `language` 설정에서 언어를 감지하여 해당 언어로 모든 사용자 대면 메시지를 출력. 한국어 템플릿을 참조 포맷으로 유지하며 Claude가 사용자 언어에 맞게 자연스럽게 번역. 영어, 일본어, 중국어 등 모든 언어 사용자 지원.
- SKILL.md에 Internationalization 섹션 추가.

## [3.2.1] - 2026-03-21

### Fixed
- **SKILL.md description 축소**: ~1,500자 → ~450자 (권장치의 3배 초과 해소). 하위 기능 트리거 키워드 제거하여 매칭 정확도 향상 및 매 대화마다 소모되는 프롬프트 예산 절감.
- **SKILL.md changelog 중복 제거**: 본문과 중복되던 v3.1.0/v3.2.0 Features 섹션(~400단어) 삭제. 비표준 `compatibility` frontmatter 필드를 본문 Compatibility 섹션으로 이동.
- **deep-research.md 섹션 번호 정리**: 0, 0-1, 0-2 → 1-1, 1-2, 1-3으로 논리적 실행 순서에 맞게 변경.
- **deep-test.md allowed-tools 수정**: Phase Guard가 코드 수정을 차단하는 Test phase에서 `Edit` 도구 제거.
- **커맨드 description 언어 통일**: `drift-check.md`, `solid-review.md`의 description을 한국어에서 영문으로 변경 (나머지 7개 커맨드와 일치).
- **notify.sh JSON 안전성**: JSON 보간 전 `MESSAGE` 변수의 쌍따옴표/백슬래시 이스케이프 추가하여 잘못된 페이로드 방지.
- **Phase Guard 경로 참조**: SKILL.md에 `hooks/scripts/phase-guard.sh` 명시적 경로 추가.

### Added
- `.gitignore` 파일 추가 (`.npmignore` 패턴 반영). 상태 파일 및 세션 아티팩트의 실수 커밋 방지.

## [3.2.0] - 2026-03-18

### Added
- **3계층 Quality Gate 시스템**: Quality Gate를 3계층으로 분리 — Required (차단), Advisory (경고), Insight (정보, v3.3 예정).
- **Plan Alignment / Drift Detection**: `/drift-check` 커맨드 및 `/deep-test` 내장 Required 게이트. plan.md 항목과 실제 git diff를 자동 비교하여 미구현 항목, 범위 초과, 설계 이탈을 감지. `drift-report.md` 산출물.
- **SOLID Design Review**: `/solid-review` 커맨드 및 Advisory Quality Gate. 5가지 SOLID 원칙(SRP, OCP, LSP, ISP, DIP) 기준 코드 설계 품질 리뷰. 파일별 스코어카드, 종합 판정, Top 5 리팩토링 제안. `solid-review.md` 산출물.
- **solid-guide.md**: 프레임워크 무관 SOLID 리뷰 체크리스트 (심각도 기준 + KISS 균형)
- **solid-prompt-guide.md**: AI 도구에 SOLID 준수 코드를 요청하고 AI 출력물을 검증하는 가이드

### Changed
- `/deep-test`에서 plan.md 존재 시 다른 Quality Gate 이전에 Plan Alignment 검사를 자동 실행 (설정 불필요)
- SKILL.md 구조 개선: Plan Alignment, SOLID Review, Session Report를 "Quality Gates & Utilities" 섹션으로 분리 (기존 "The Four Phases" 하위에서 이동)
- SKILL.md description 최적화: ~40개 세부 트리거 키워드를 ~10개 대표 키워드로 통합 (신호 대 잡음비 개선)
- SKILL.md에 v3.2.0 Features 섹션 추가 (영어 일관성 유지)
- State 스키마에 `plan_approved_at` 필드 추가 (선택적, Drift Detection 비교 기준)

## [3.1.0] - 2026-03-17

### Breaking Changes
- **저장소 구조 개편**: 루트 플러그인에서 `plugins/deep-work/` 서브디렉토리 패턴으로 전환. 기존 사용자는 재설치 필요.

### Added
- **모델 라우팅 (F1)**: Phase별 최적 모델 배정 (Research=sonnet, Plan=main, Implement=sonnet, Test=haiku). Agent 위임 패턴으로 토큰 30~40% 절감.
- **멀티채널 알림 (F2)**: Phase 완료 시 OS 네이티브 + Slack/Discord/Telegram/커스텀 Webhook 알림. Fire-and-forget 패턴.
- **증분 리서치 (F3)**: `/deep-research --incremental` — git diff 기반 변경 영역만 재분석. 시간 60~80% 절감.
- **Quality Gate 시스템 (F4)**: plan.md에 Quality Gates 정의 → required/advisory 게이트 실행. `quality-gates.md` 산출물.
- **Plan Diff 시각화 (F5)**: Plan 재작성 시 구조적 변경 사항 자동 시각화. `plan-diff.md` 산출물.
- **model-routing-guide.md**: 모델 라우팅 설정 가이드
- **notification-guide.md**: 알림 채널 설정 가이드

### Changed
- `/deep-work` 초기화에 모델 라우팅/알림 설정 옵션 추가
- `/deep-status`에 모델 라우팅, 알림, Quality Gate 상태 표시
- `/deep-report`에 Quality Gate 결과, Plan Diff 요약 섹션 추가
- State 스키마에 `model_routing`, `notifications`, `last_research_commit`, `quality_gates_passed` 필드 추가
- marketplace.json source 경로 `"./"` → `"./plugins/deep-work"` 변경

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
