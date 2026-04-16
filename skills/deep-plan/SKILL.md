---
name: deep-plan
version: "6.2.3"
description: "Phase 2 — Plan: create a detailed implementation plan"
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
4. `work_dir`, `project_type`, `team_mode` 추출 → `$WORK_DIR` 설정 (기본: deep-work)
5. `current_phase`가 "plan"이고 `research_complete`가 true인지 확인
6. `plan_started_at` 기록 (ISO timestamp)

## Prerequisites 로드

1. Read `$WORK_DIR/research.md` — 주 참조
2. Team 모드 시 보조 참조 (존재하면):
   - `$WORK_DIR/research-architecture.md`
   - `$WORK_DIR/research-patterns.md`
   - `$WORK_DIR/research-dependencies.md`

## Critical Constraints

- DO NOT implement anything or modify source code files
- ONLY plan and document in `$WORK_DIR/`

# Section 2: Phase 실행

## Pre-steps

### Backup (iteration_count > 0)
기존 plan.md → `$WORK_DIR/plan.v{iteration_count}.md`로 복사

### Template 제안 (선택적)
Read("skills/shared/references/plan-templates.md") → 적합 템플릿 확인 → 사용자에게 제안

### 사용자 피드백 확인
기존 plan.md에 `> [!NOTE]`, `<!-- HUMAN: -->`, inline comment가 있으면 반영

## plan.md 작성

상세 작성 가이드: Read("skills/shared/references/planning-guide.md")

### 문서 구조

**Existing codebase (`project_type: existing`):**
```markdown
# Implementation Plan: [Task Title]
## Plan Summary
  - 접근법 / 변경 범위 / 리스크 수준 / 핵심 결정
## Overview
## Architecture Decision
  - Research 근거: [RF-NNN], [RA-NNN] 태그 연결
## Files to Modify
  - 각 파일: Action, Changes, Code sketch (S/M/L 티어링), Line references, Reason, Risk
## Boundary: Files NOT to Modify (table)
## Execution Order
## Dependency Analysis
## Trade-offs (table)
## Rollback Strategy
## Slice Checklist
## Open Questions
```

**Zero-base (`project_type: zero-base`):**
```markdown
# Implementation Plan: [Task Title] (Zero-Base)
## Plan Summary
## Overview / Architecture Decision
## Project Structure (디렉토리 트리)
## Files to Create
## Boundary: Files NOT to Modify
## Setup Instructions
## Slice Checklist
## Open Questions
```

### Slice Format (v4.0)

각 slice는 자기 완결적 TDD 단위:
```markdown
- [ ] SLICE-NNN: [Goal]
  - files: [file1, file2]
  - failing_test: [test file — description]
  - verification_cmd: [command]
  - expected_output: [success output]
  - spec_checklist: [req1, req2]
  - contract: [testable criterion 1, criterion 2]
  - acceptance_threshold: all
  - size: S/M/L
  - steps: (M/L 필수, S 선택)
```

**Size별 상세도:**
- S: 목표+파일+failing_test로 충분. steps 선택.
- M: 3-7 steps. 함수 시그니처+assertion 포함.
- L: 5-12 steps. Boundary 코드 완성형. 12 초과 시 슬라이스 분할.

### Completeness Policy (v5.8)

**금지 패턴** — 최종 plan.md에 아래가 남으면 plan 실패:
`TBD`, `TODO`, `FIXME`, `PLACEHOLDER`, `implement later`,
`Add appropriate error handling` (구체적 케이스 없이),
`Similar to SLICE-N` (세부 반복 필수), `...`, `[etc.]`,
빈 섹션, 정의되지 않은 타입/함수 참조

해결 불가 시 → Open Questions로 이동.

## Contract Negotiation (v5.1)

M/L/XL slice에 contract 필드 필수. Agent(contract-validator)로 검증:
- 모호성, 테스트 불가, 누락된 엣지 케이스 검출
- Auto-fix + 재검증 (최대 2회)

## Plan Diff (iteration_count > 0)

이전 버전과 구조적 비교 → `$WORK_DIR/plan-diff.md` 작성:
추가/수정/삭제 태스크, 파일 영향 변경, 아키텍처 결정 변경, 리스크 수준 변경

## Phase Review Gate

Read("skills/shared/references/phase-review-gate.md") — 프로토콜 실행:
- Phase: plan
- Document: `$WORK_DIR/plan.md`
- Self-review checklist: placeholder 없음, 연구-계획 추적성, 슬라이스 완성도

사용자 확인 결과:
- 옵션 1 (동의) → 수정 후 Section 3으로
- 옵션 2 (항목별 조정) → 개별 처리 후 Section 3으로
- 옵션 3 (전부 스킵) → plan.md 그대로 Section 3으로

수정 규모별 re-review: 3+ 섹션 → full, 1-2 섹션 → structural only, <50줄 → skip. 최대 2회.

# Section 3: 완료

## State 업데이트

- `review_state: completed`
- `phase_review.plan` + `review_results.plan` 업데이트
- `plan_completed_at`: ISO timestamp

**NOTE: `current_phase`를 변경하지 않는다.** Orchestrator가 리뷰+승인 후 변경.

## 완료 메시지

```
구현 계획이 작성되었습니다!
계획서: $WORK_DIR/plan.md
변경 파일: N개 / 신규: N개 / 태스크: N개 / 위험도: Low/Medium/High

계획이 준비되었습니다. 리뷰해주세요.
```

## Notification

```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$STATE_FILE" "plan" "completed" "Plan 작성 완료" 2>/dev/null || true
```
