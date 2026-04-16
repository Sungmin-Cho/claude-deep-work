---
name: deep-test
version: "6.2.1"
description: "Phase 4 — Test: comprehensive verification + implement-test retry loop"
---

# Section 1: State 로드 (필수 — 건너뛰기 금지)

1. Session ID 결정
   - $ARGUMENTS에 --session=ID → 사용
   - 없으면 → .claude/deep-work-sessions.json에서 active session 탐색
2. State 파일 읽기: `.claude/deep-work.{SESSION_ID}.md`
3. 조건 변수 확인:
   - worktree_path — $ARGUMENTS 우선, 없으면 state에서
   - team_mode — $ARGUMENTS 우선, 없으면 state에서
4. 추출: `work_dir`, `test_retry_count`, `max_test_retries`, `model_routing.test`, `evaluator_model`
5. Verify: `current_phase` = "test", plan.md slice checklist 모두 `[x]`
6. `test_started_at` 기록 (ISO timestamp)

## Critical Constraints

- **DO NOT modify any code files** — Phase Guard가 차단
- ONLY: 테스트 실행, 결과 분석, 문서 업데이트
- 테스트 실패 시 implement phase로 복귀하여 수정

## Red Flags — 이 생각이 들면 멈추세요

| 합리화 시도 | 현실 |
|------------|------|
| "테스트는 통과했으니 됐다" | 테스트 통과 ≠ 스펙 충족. Receipt의 spec_compliance를 확인하라. |
| "lint 경고 몇 개는 괜찮겠지" | Sensor Clean Gate가 차단한다. 지금 고쳐라. |
| "커버리지가 낮지만 핵심은 테스트했다" | "핵심"은 주관적이다. 누락된 경로가 프로덕션에서 터진다. |
| "이 실패는 환경 문제일 거야" | 95%의 "환경 문제"는 불완전한 조사다. Root cause를 찾아라. |

## Model Routing

`model_routing.test` 확인 (기본: "haiku"). "main"이 아니면 Agent 위임 (전체 test 지시 포함).
"main" → 아래 inline 실행.

# Section 2: Phase 실행

## Step 1: Required Gate — Receipt Completeness

plan.md의 모든 SLICE-NNN에 대해 `$WORK_DIR/receipts/SLICE-NNN.json` 존재 + `status: "complete"` 확인.
실패 → implement로 복귀.

## Step 2: Required Gate — Plan Alignment (Drift Detection)

1. plan.md에서 파일 목록 + 체크리스트 + 설계 지침 파싱
2. Baseline 커밋 결정 (우선순위):
   - `plan_approved_at` timestamp → 해당 시점의 가장 가까운 커밋
   - fallback: plan.md 파일의 mtime → 해당 시점 커밋
   - fallback: 최근 24시간 이내 커밋 window
3. `git diff --name-only [baseline]..HEAD`로 변경 파일 비교
4. 각 plan 항목 분류: Implemented / Not implemented / Out of scope / Design drift
5. `$WORK_DIR/drift-report.md` + `fidelity-score.txt` 생성
6. Not implemented 또는 Design drift 있으면 → **FAIL** (Required Gate)

## Step 3: Auto-detect + Run Verification

1. 프로젝트 설정에서 검증 명령어 감지 (package.json, pyproject.toml, Makefile 등)
2. plan.md에 `## Quality Gates` 테이블 있으면 auto-detection 대신 사용
3. 순차 실행, 결과 기록: `$WORK_DIR/test-results.md`

## Step 4: Quality Gates

### 4-1. Cross-Slice Spec Consistency (✅ Required)

Agent(evaluator_model): 전체 receipt + plan.md 기반 cross-slice 일관성 검증.
Phase 3에서 slice_review를 skip/self-review한 slice는 backfill(보완) review 포함.
`done_with_concerns` slice는 extra scrutiny.
결과: `$WORK_DIR/cross-slice-review.json`

### 4-2. Cross-Slice Quality Review (⚠️ Advisory)

Agent(evaluator_model): 전체 git diff + receipt 기반 cross-cutting quality 검증.
backfill 대상 slice 포함. Advisory — 차단 없음.

### 4-3. Verification Evidence (✅ Required)

각 receipt의 `tdd.passing_test_output` 비어있지 않음 + `verification.full_test_suite` PASS 확인.

### 4-4. SOLID Review (⚠️ Advisory)

변경된 source 파일 대상 SOLID 원칙 평가 → `$WORK_DIR/solid-review.md`
상세: Read("skills/shared/references/solid-guide.md")

### 4-5. Insight Analysis (ℹ️ Insight)

코드 메트릭, 복잡도, 의존성 분석 → `$WORK_DIR/insight-report.md`
실패해도 pass/fail에 영향 없음.

### 4-6. Sensor Clean (✅ Required) + Coverage (⚠️ Advisory)

Receipt의 `sensor_results`에서 읽기 (재실행 아님):
- Sensor Clean: 모든 slice의 lint/typecheck pass 확인. fail/timeout → FAIL.
- Coverage: coverage 퍼센트 표시. Advisory — 차단 없음.

### 4-7. Mutation Score (⚠️ Advisory)

mutation testing 도구 감지 시 `/deep-mutation-test` 실행.
survived mutants → `/deep-mutation-test`가 내부적으로 implement 복귀 처리.

### 4-8. Fitness Delta (⚠️ Advisory)

Phase 1의 fitness_baseline과 현재 비교. 위반 증가 시 경고.

### 4-9. Health Required (✅ Required)

Phase 1의 `unresolved_required_issues` 확인. 있으면 AskUserQuestion으로 acknowledge 요청.

모든 gate 후: quality_gates_passed 업데이트 + `$WORK_DIR/quality-gates.md` 작성.
상세: Read("skills/shared/references/testing-guide.md")

# Section 3: 완료

## All Pass

1. State 업데이트:
   - `test_passed: true`
   - `test_completed_at`: current ISO timestamp
   - **`current_phase`는 변경하지 않음** (test 유지). Orchestrator 또는 `/deep-finish`가 idle로 전환.
2. 완료 메시지:
   ```
   모든 검증 통과! `/deep-finish`로 세션을 완료하세요.
   상세 결과: $WORK_DIR/test-results.md
   ```
3. 알림: `notify.sh "$STATE_FILE" "test" "passed"`
4. Session report 자동 생성: `$WORK_DIR/report.md`
5. Git commit 제안 (git_branch 설정 시)

## Some Fail (retry available)

`test_retry_count` < `max_test_retries` 시:

1. `test_retry_count` 증가
2. 실패한 gate/slice 분석 → 수정 대상 식별
3. State: **`current_phase: implement`**
4. 실패 slice만 TDD cycle 재실행
5. 완료 후: `current_phase: test` → 전체 gate 재실행 (Section 1부터)
6. 알림: `notify.sh "$STATE_FILE" "test" "auto_retry"`

## Some Fail (retry exhausted)

`test_retry_count` >= `max_test_retries` 시:

1. 누적 실패 이력 표시
2. `current_phase: implement` 유지 (사용자 수동 수정)
3. 알림: `notify.sh "$STATE_FILE" "test" "failed_final"`
4. 안내: `/deep-test`로 재실행 또는 `/deep-status --report`로 결과 정리
