[English](./CHANGELOG.md) | **한국어**

# Changelog

All notable changes to the Deep Work plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.1.1] - 2026-03-30

### 수정
- **CRITICAL: Phase guard fail-closed** — `phase-guard-core.js`의 catch 블록이 내부 오류 시 allow 대신 block을 반환하도록 변경, TDD/단계 강제 우회 방지
- **CRITICAL: Receipt 원자적 쓰기** — Receipt JSON 업데이트가 temp 파일 + rename 패턴을 사용하여 동시 PostToolUse 훅의 데이터 손상 방지
- **HIGH: 명령어 체인 우회** — `detectBashFileWrite`가 체인된 명령어(`&&`, `||`, `;`, `|`)를 분리하여 각 하위 명령어를 독립 검증; safe prefix가 file-write suffix를 가리지 않음
- **HIGH: Bash TDD 대상 추출** — 새 `extractBashTargetFile()` 함수가 bash 명령어에서 실제 대상 파일을 추출하여 전체 명령어 문자열 대신 정확한 test/exempt 패턴 매칭
- **HIGH: Skipped phases 정확한 매칭** — 서브스트링 매칭을 쉼표 구분 정확 매칭으로 교체하여 오탐 방지
- **HIGH: Write/Edit file_path 미추출 시 차단** — 파일 경로를 추출할 수 없을 때 allow 대신 block으로 변경
- **MEDIUM: JSONL 히스토리 잠금** — `session-end.sh`가 동시 JSONL append에 mkdir 기반 잠금 사용
- **MEDIUM: 크로스 플랫폼 타임스탬프 파싱** — 기간 계산을 Node.js `Date.parse`로 교체 (macOS/GNU date 분기 제거)
- **MEDIUM: 알림 JSON 이스케이프** — 웹훅 페이로드가 `JSON.stringify`로 줄바꿈/유니코드 정상 이스케이프
- **MEDIUM: 경로 정규화** — `normalize_path`가 `..` 세그먼트를 `path.resolve`로 해결
- **MEDIUM: YAML 필드 추출** — `read_frontmatter_field`가 regex 인젝션 대신 리터럴 prefix 매칭 사용
- **MEDIUM: Receipt 초기 생성** — Heredoc을 `JSON.stringify`로 교체하여 slice ID 인젝션 방지

### 변경
- Assumption engine의 `SIGNAL_EVALUATORS`가 `{ scope, fn }` 형식 사용; session-scoped 신호는 세션당 1회, slice-scoped 신호는 any-true 집계
- `TEST_FILE_PATTERNS`에 Rust, Java, C#, Kotlin, Swift 패턴 추가
- phase-guard-core.js에 `splitCommands`, `extractBashTargetFile` 새 export 추가

## [5.1.0] - 2026-03-30

### 추가
- **자동 루프 검증**: Plan 리뷰와 테스트 단계에서 실패 시 자동 수정 + 재검증 (최대 3회)
- **계약 협상**: Slice에 테스트 가능한 `contract`와 `acceptance_threshold` 필드 추가
- **Assumption Engine 자동 적용**: 세션 시작 시 Wilson Score 기반 규칙 자동 조정
- **적응형 Evaluator 모델**: 모든 검증 subagent가 설정 가능한 모델 사용 (기본: sonnet), Assumption Engine으로 자동 조정
- **Phase 스킵 유연화**: `--skip-to-implement` 플래그, 인라인 slice 생성
- **양방향 조정**: Assumption Engine이 증거 기반으로 규칙 강화도 자동 수행

### 변경
- Structural review가 실패 시 자동으로 수정 루프 실행 (최대 3회)
- 테스트 단계가 실패 slice만 대상으로 자동 implement 복귀
- Assumption health 보고서에 현재 세션의 자동 조정 내역 표시
- Slice 형식에 `contract`와 `acceptance_threshold` 필드 추가
- 기본 evaluator 모델이 haiku에서 sonnet으로 변경

### 수정
- Assumption Engine 보고서의 "Auto-application is a Phase 2 feature" 문구 제거

## [5.0.0] - 2026-03-30

### 추가
- **Self-Evolving Harness (Assumption Engine)**: 모든 enforcement 규칙이 이제 machine-readable evidence signal을 가진 falsifiable hypothesis. deep-work가 세션 데이터로 자체 가설을 검증.
- **`assumptions.json`**: 5개 핵심 가설 레지스트리 (phase_guard, tdd, research, cross_model_review, receipt_collection). evidence signal, 조절 가능한 enforcement 레벨, 최소 세션 임계값 포함.
- **`assumption-engine.js`**: Wilson Score confidence, 모델별 분할, staleness 감지, 새 모델 감지, per-slice signal 평가, 리포트 생성, ASCII 타임라인, shields.io 배지 내보내기. 42개 단위 테스트.
- **`/deep-assumptions` 커맨드**: report (기본 + --verbose), history (ASCII 타임라인), export (--format=badge), --rebuild (receipts에서 JSONL 재생성).
- **Receipt의 `harness_metadata`**: slice별 메타데이터 (model_id, assumption_overrides, rework_count, tests_passed_first_try 등). 하위 호환.
- **세션 히스토리 JSONL**: Stop hook에서 `harness-sessions.jsonl` append. per-slice 데이터, 세션 중복 방지, 크로스 플랫폼 날짜 계산.
- **세션 초기화 시 건강도 요약**: `/deep-work`에서 충분한 히스토리가 있으면 가설 건강도 표시. 새 모델 감지 시 cold start 경고.
- **리포트의 Assumption Health**: `/deep-report`에 confidence 테이블과 세션별 harness metadata 집계 포함.

## [4.2.1] - 2026-03-26

### 추가
- **TDD Override**: 구현 중 TDD가 production 파일 수정을 차단하면, Claude가 차단 이유를 설명하고 사용자에게 대화형으로 선택지를 제공 — 테스트 먼저 작성(권장), 또는 사유와 함께 이 slice의 TDD 건너뛰기(config 변경, 테스트 불가, 긴급 수정). Override는 slice 범위로 제한되며 slice 전환 시 자동 해제.
- **차단 메시지에 탈출구 안내**: strict/coaching 모드의 TDD 차단 메시지에 `/deep-slice spike`, `/deep-slice reset` 대안을 표시하여 사용자가 우회 방법을 즉시 알 수 있도록 개선.
- **`tdd_override` 상태 필드**: 어떤 slice에 TDD override가 활성화되어 있는지 추적. Hook이 이 필드를 읽어 fast-path 허용 결정.
- **Receipt에 override 기록**: Override된 slice는 receipt JSON에 `tdd_override: true`와 `tdd_override_reason`으로 기록. Receipt 대시보드에서 `override` 상태를 `spike`와 구분하여 표시 (merge 가능 + 경고).
- 9개 새 unit test 추가 (총 56개)

### 변경
- `phase-guard-core.js`: `checkTddEnforcement`에 `tddOverride` 파라미터 추가; `processHook`에서 `state.tdd_override` 전달
- `phase-guard.sh`: state 파일에서 `tdd_override` 읽기; active slice와 일치하는 override에 대한 fast-path 추가; Node.js에 override 전달
- `deep-implement.md`: "TDD Override" 섹션 추가 (AskUserQuestion 흐름, main 모델 라우팅만 적용)
- `deep-receipt.md`: Override 아이콘, 카운트, JSON 스키마 업데이트
- `deep-finish.md`: `tdd_compliance`에 `override` 카운트 포함
- `deep-history.md`: `tdd_compliance` 및 TDD 준수율 표시에 `override` 포함

## [4.2.0] - 2026-03-25

### 추가
- **구조적 리뷰(Structural Review)**: 모든 페이즈 문서(brainstorm, research, plan)가 Claude haiku 서브에이전트를 통해 페이즈별 차원으로 구조적 리뷰를 받음
- **적대적 크로스 모델 리뷰(Adversarial Review)**: Plan 문서가 codex 및/또는 gemini-cli에 의해 독립적으로 리뷰됨 (아키텍처, 가정, 리스크 커버리지)
- **갈등 해결 UX**: 모델 간 의견이 다를 때 갈등을 투명하게 표시하고 사용자가 해결 방식을 결정 (수용, 면책, 수동 편집)
- **리뷰 게이트**: 구조적 리뷰 점수 <5 또는 비판적 합의 이슈가 있으면 자동 구현 전환 차단
- **`/deep-review` 커맨드**: 구조적 또는 적대적 리뷰를 언제든 수동 트리거
- **`--skip-review` 플래그**: spike/실험 세션에서 모든 리뷰 건너뛰기
- **크로스 모델 도구 자동 감지**: 세션 초기화 시 codex/gemini-cli 자동 감지
- **프로필 `cross_model_preference`**: 프리셋에 크로스 모델 선호 저장 (항상/안함/매번 확인)
- **리뷰 상태 resume/status 통합**: `/deep-resume`이 리뷰 상태를 인식; `/deep-status`가 리뷰 결과 표시
- **JSON 스키마 정규화**: 모든 리뷰 결과가 구조화된 JSON으로 저장 (`{phase}-review.json`)

### 변경
- `deep-brainstorm.md`: 기존 spec review를 review-gate 프로토콜 참조로 교체
- `deep-research.md`: 리서치 완료 후 구조적 리뷰 추가
- `deep-plan.md`: 승인 전 구조적 + 적대적 리뷰 추가
- `phase-guard-core.js`: SAFE_COMMAND_PATTERNS에 codex/gemini/mktemp 추가
- State 파일: `review_state`, `cross_model_tools`, `cross_model_enabled`, `review_results` 필드 추가
- 프로필: 프리셋 스키마에 `cross_model_preference` 추가

### 수정
- `.gitignore`: `deep-work-workflow-workspace/` 추가하여 venv 추적 방지

## [4.1.0] - 2026-03-25

### Added
- **Worktree 격리**: 세션이 기본적으로 격리된 git worktree에서 실행됩니다. `/deep-work` 시 `.worktrees/dw/<slug>/`에 worktree를 생성하여 main 브랜치를 보호합니다. `--no-branch` 또는 프리셋의 `git_branch: false`로 비활성화 가능.
- **슬라이스 복잡도 기반 모델 자동 선택**: 구현 단계에서 각 슬라이스의 크기(S/M/L/XL)에 따라 최적 모델(haiku/sonnet/opus)을 자동 선택합니다. `/deep-slice model SLICE-NNN <모델>`로 슬라이스별 override 가능. 프리셋에서 routing_table 커스터마이즈 가능.
- **세션 완료 워크플로우** (`/deep-finish`): 세션 종료 시 4가지 옵션 제공 — 베이스 브랜치로 병합, PR 생성, 브랜치 유지, 삭제. `session-receipt.json`으로 전체 세션 요약 생성.
- **CI/CD receipt 검증**: `validate-receipt.sh`로 receipt 체인 무결성 검증. `templates/deep-work-ci.yml`로 GitHub Actions 워크플로우 템플릿 제공. `/deep-receipt export --format=ci`로 CI 친화적 번들 내보내기.
- **세션 이력 대시보드** (`/deep-history`): 과거 세션들의 모델 사용량, TDD 준수율, 완료율, 비용 추적 등 크로스 세션 트렌드 표시.
- **Worktree 정리** (`/deep-cleanup`): 7일 이상 된 비활성 deep-work worktree를 스캔하고 일괄/개별 삭제 옵션 제공.
- **Receipt 스키마 v1.0**: 새 필드 — `schema_version`, `model_used`, `model_auto_selected`, `worktree_branch`, `git_before`, `git_after`, `estimated_cost`. Session receipt은 파생 캐시이며 slice receipt이 정본.
- **Receipt 마이그레이션 헬퍼** (`receipt-migration.js`): v4.1 이전 receipt을 스키마 v1.0으로 자동 변환. atomic write 및 손상 파일 백업 지원.
- **Worktree 인식 세션 재개** (`/deep-resume`): 세션 재개 시 worktree 경로를 감지하고 작업 디렉토리 컨텍스트를 복원. 삭제된 worktree도 우아하게 처리.
- **모델 비용 추적**: slice 및 session receipt에 `estimated_cost` 필드로 세션별 AI 모델 사용 비용 가시성 제공.
- **Shell 유틸리티 추출** (`utils.sh`): 3개 hook 스크립트의 공통 함수를 단일 소스 파일로 추출하여 코드 중복 제거.
- **모델 라우팅 테스트**: 라우팅 테이블 조회, 모델 이름 검증, 커스텀 테이블 override에 대한 11개 새 유닛 테스트 추가 (총 48개 테스트).

### Changed
- 기본 `model_routing.implement`가 `"sonnet"`에서 `"auto"` (크기 기반 라우팅)로 변경
- 프리셋의 기본 `git_branch`가 `true`로 변경 (worktree 격리 기본 활성화)
- `session-end.sh`가 worktree 브랜치 정보를 표시하고 `/deep-finish` 사용을 안내
- `validate-receipt.sh`가 macOS Bash 3.2 호환을 위해 `set -eo pipefail` 사용

## [4.0.1] - 2026-03-25

### Added
- **Git 기반 자동 업데이트 체크**: SessionStart 훅에서 GitHub 최신 버전 확인. 자동 업그레이드, 스누즈(24h→48h→1w), 비활성화 지원.
- **Shell injection 방지**: phase-guard.sh, file-tracker.sh에서 `process.argv`로 안전한 값 전달.

### Fixed
- macOS 호환성: `timeout` 명령 제거 (macOS 미지원)
- 버전 일관성: CLAUDE.md, TODOS.md에 올바른 v4.0 버전 반영

## [4.0.0] - 2026-03-25

### BREAKING — Evidence-Driven Development Protocol

deep-work이 **evidence-driven development protocol**로 전환되었습니다. 모든 코드 변경에 증거가 수반됩니다: failing test output, passing test output, git diff, spec compliance check, code review — 모두 JSON receipt으로 수집됩니다.

### Added
- **Phase 0: 브레인스톰** (`/deep-brainstorm`): "왜 만드는가"를 먼저 탐색 — 문제 정의, 접근법 비교, spec-reviewer 검증. `--skip-brainstorm`으로 생략 가능.
- **Slice 기반 실행**: Plan 태스크가 "slice"로 변환 — per-slice TDD 사이클, 파일 범위, 검증 커맨드, 스펙 체크리스트 포함.
- **TDD 강제**: Hook 기반 상태 머신 (PENDING→RED→RED_VERIFIED→GREEN_ELIGIBLE→GREEN→REFACTOR). failing test 없이 production 코드 수정 차단. 모드: `strict`, `relaxed`, `coaching`, `spike`.
- **Receipt 시스템**: slice별 JSON 증거 수집 (`receipts/SLICE-NNN.json`) — test output, git diff, lint, spec checklist, code review.
- **Bash 도구 감시**: PreToolUse 훅이 Bash 커맨드도 감시. `echo >`, `sed -i`, `cp`, `tee` 등 파일 쓰기 패턴 탐지/차단.
- **체계적 디버깅** (`/deep-debug`): 4단계 root-cause 조사 (investigate→analyze→hypothesize→fix). 예기치 않은 테스트 실패 시 자동 진입. 3회 실패 후 에스컬레이션.
- **Slice 관리** (`/deep-slice`): ASCII 진행 대시보드, 수동 활성화, spike 모드, slice 리셋.
- **Receipt 관리** (`/deep-receipt`): 대시보드 뷰, per-slice 상세, JSON/Markdown export.
- **2단계 코드 리뷰**: Spec Compliance Review (required) + Code Quality Review (advisory) — 서브에이전트 기반.
- **Receipt Completeness Gate** (required): 모든 slice에 receipt 존재 확인.
- **Verification Evidence Gate** (required): 실제 테스트 실행 증거 확인.
- **TDD Coaching 모드**: TDD 초보자를 위한 교육적 메시지 (차단 대신 가이드).
- **Spike Mode Guard**: spike 종료 시 자동 git stash + slice 리셋.
- **29개 unit test**: phase-guard-core.js (TDD 상태 머신, Bash 탐지, slice scope, receipt 검증).

### Changed
- Hook 아키텍처: bash+Node.js 하이브리드 — bash fast path (~50ms), Node.js subprocess (~200ms).
- Plan 포맷: Task Checklist → Slice Checklist (per-slice 메타데이터).
- `hooks.json`: PreToolUse/PostToolUse에 `Bash` 추가.
- `phase-guard.sh`: bash+Node 하이브리드로 전면 재작성.
- `file-tracker.sh`: receipt 수집 및 active slice 매핑 확장.
- `deep-implement.md`: Slice 단위 TDD 실행으로 전면 재설계.
- `deep-test.md`: 4개 신규 Quality Gate 추가.
- `deep-plan.md`: Slice 포맷 도입.
- `deep-work.md`: Phase 0 옵션, `--tdd=MODE`, `--skip-brainstorm`.
- `package.json`: 4.0.0 → 4.0.1.

## [3.3.3] - 2026-03-24

### Added
- **멀티 프리셋 Profile System**: 작업 스타일별 Named 프리셋 지원 (예: `dev`, `quick`, `review`).
  - Profile v2 형식: 단일 YAML 파일에 `presets:` 키로 여러 프리셋 저장
  - v1 → v2 자동 마이그레이션 (기존 단일 프로필 → `default` 프리셋으로 래핑)
  - `/deep-work --setup`으로 프리셋 관리 UI (생성, 수정)
  - `/deep-work --profile=X "작업"` 으로 프리셋 직접 지정 (인터랙티브 스킵)
  - 프리셋 2개 이상 시 AskUserQuestion으로 선택
  - 프리셋 1개인 경우 자동 적용
- **트리거 평가 최적화**: trigger-eval.json 확장 및 SKILL.md description 정제.
  - trigger-eval.json 20개 → 31개 (16 true + 15 false)
  - v3.3.2 기능 커버리지 추가: profile, preset, resume, checkpoint 키워드
  - 동음이의어 false positive 방지 (profile picture, resume template, deep copy 등)
  - SKILL.md description 최적화: 범용 키워드 제거, preset/프리셋 추가

### Changed
- `deep-work.md` Step 1.5 전면 재작성: v2 프로필 버전 체크 (v1 자동 마이그레이션, v2 정상 진행, 그 외 거부), 프리셋 선택 로직, 필드→변수 매핑
- `deep-work.md` Step 1.5a 플래그 테이블에 `--profile=X` 추가
- `deep-work.md` Step 1.5b: `--setup` 시 프리셋 관리 UI 표시 (태스크 유무에 따라 분기)
- `deep-work.md` Step 1.5d: 프리셋 관리 UI 신규 섹션 (편집, 생성)
- `deep-work.md` Step 7: 상태 파일 템플릿에 `preset` 필드 추가
- `deep-work.md` Step 7.5: 프로필 저장 형식 v1 (`defaults.*`) → v2 (`presets.default.*`)
- `deep-work.md` Step 8: 확인 메시지에 프리셋 이름 표시 (🎯 프리셋: [name])
- `deep-resume.md` Step 1: 상태 파일에서 `preset` 필드 추출
- `deep-resume.md` Step 3: 재개 상태 표시에 프리셋 이름 포함
- SKILL.md Profile System 섹션에 멀티 프리셋 문서 추가
- SKILL.md v3.3.3 Features 섹션 추가

## [3.3.2] - 2026-03-22

### Added
- **Profile System**: 질문 없는 세션 초기화를 위한 자동 프로필 저장/로드.
  - 첫 `/deep-work` 실행 시 설정 답변을 `.claude/deep-work-profile.yaml`에 자동 저장
  - 이후 실행 시 모든 설정 질문 스킵, 저장된 프로필 즉시 적용
  - 단일 세션 오버라이드 플래그: `--team`, `--zero-base`, `--skip-research`, `--no-branch`
  - 프로필 재설정: `/deep-work --setup`
  - 마이그레이션용 프로필 버전 필드 (`version: 1`)
- **Session Resume (`/deep-resume`)**: 중단된 세션 복구 및 전체 컨텍스트 복원.
  - `.claude/deep-work.local.md`에서 활성 세션 자동 감지
  - 산출물에서 AI 컨텍스트 복원: research.md (요약), plan.md (전문), test-results.md (실패 내역)
  - Phase별 자동 재개: research → plan 리뷰 → implement 체크포인트 → test
  - Implement 단계: 체크포인트 기반 재개 (모델 라우팅 재위임 우회)
- **Checkpoint Verification**: Agent 위임 후 구현 무결성 검증.
  - `git diff --name-only` 기반 1차 검증
  - git 변경이 있으나 미표시된 태스크의 plan.md `[x]` 자동 보정
  - `file-changes.log` 미존재 시 graceful fallback (Agent 위임 모드)

### Changed
- `deep-work.md` Step 1.5 (프로필 로드/플래그 파싱), Step 7.5 (프로필 저장) 구조 추가
- `deep-work.md` Step 2-1 (git 브랜치) 프로필 설정에 따라 자동 생성/스킵
- `deep-implement.md` Section 0-pre Agent 프롬프트에 체크포인트 의무 명시
- `deep-implement.md` Section 0-pre에 Agent 완료 후 체크포인트 검증 단계 추가
- SKILL.md description에 resume/profile 트리거 키워드 추가
- SKILL.md에 Profile System, Session Resume, v3.3.2 Features 섹션 추가

## [3.3.0] - 2026-03-22

### Added
- **Insight 계층 Quality Gate**: 3계층 Quality Gate 시스템의 세 번째이자 마지막 계층. 워크플로우 차단 없이 코드 메트릭과 분석 정보를 제공.
  - `/deep-insight` 커맨드 (standalone/workflow 이중 모드)
  - 내장 분석: 파일 메트릭, 복잡도 지표, 의존성 그래프, 변경 요약
  - plan.md Quality Gates 테이블에 커스텀 ℹ️ 게이트 정의 가능
  - `insight-report.md` 산출물
  - `/deep-test`에서 Required/Advisory 게이트 이후 자동 실행
- **PostToolUse 파일 추적**: `file-tracker.sh` 훅이 Implement 단계에서 파일 수정을 자동으로 `$WORK_DIR/file-changes.log`에 타임스탬프와 함께 기록. `/deep-report`와 `/deep-insight`에서 활용.
- **Stop 훅 — 세션 종료 핸들러**: `session-end.sh` 훅이 CLI 세션 종료 시 실행. Deep Work 세션이 활성 상태이면 알림 메시지 출력 및 설정된 채널로 알림 전송.
- **insight-guide.md**: Insight 계층 레퍼런스 가이드 — 분석 해석 방법, 커스텀 게이트 정의, 제한 사항

### Changed
- `hooks.json`이 PreToolUse 전용에서 PreToolUse + PostToolUse + Stop 3개 이벤트로 확장
- `/deep-test` Section 2-1에서 ✅(required), ⚠️(advisory)와 함께 ℹ️(insight) 마커 파싱 추가
- `/deep-test` Section 4에 "4-2. Built-in Insight Analysis" 단계 추가 (Required/Advisory 게이트 이후 실행)
- `quality-gates.md` 출력에 "Insight Gates" 섹션 및 판정의 insight 카운트 추가
- `/deep-report`가 `insight-report.md`와 `file-changes.log`를 읽어 리포트 보강
- `/deep-status` 산출물 목록에 `insight-report.md`, `file-changes.log` 추가
- `/deep-implement`에 PostToolUse 파일 추적 안내 노트 추가
- SKILL.md Phase Enforcement 섹션에 3개 훅 유형 전체 문서화
- SKILL.md description에 insight/metrics/tracking 트리거 키워드 추가

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
