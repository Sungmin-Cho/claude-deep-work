---
name: deep-brainstorm
version: "6.2.3"
description: "Phase 0 — Brainstorm: explore why before how (skip-able)"
---

# Section 1: State 로드 (필수 — 건너뛰기 금지)

1. Session ID 결정
   - $ARGUMENTS에 --session=ID → 사용
   - 없으면 → .claude/deep-work-sessions.json에서 active session 탐색
2. State 파일 읽기: `.claude/deep-work.{SESSION_ID}.md`
3. 조건 변수 확인:
   - worktree_path — $ARGUMENTS 우선, 없으면 state에서
   - team_mode — $ARGUMENTS 우선, 없으면 state에서
   - cross_model — $ARGUMENTS 우선, 없으면 state에서
4. `work_dir`, `task_description` 추출 → `$WORK_DIR` 설정
5. `brainstorm_started_at` 기록 (ISO timestamp)

## Skip 조건

$ARGUMENTS에 `--skip-brainstorm` 또는 `--start-phase=research` 포함 시:
- `current_phase: research` 설정 → 즉시 종료 (Orchestrator가 다음 Skill 호출)

# Section 2: Phase 실행

## Critical Constraints

- DO NOT implement anything or modify source code files
- ONLY explore the problem space and document in brainstorm.md

## Step 1: 문제 탐색

### 1a. 문제 정의 — 사용자에게 질문 (one at a time)

**Core (항상):**
1. 이 기능/변경의 핵심 목표는? (왜)
2. 성공하면 어떻게 보이나요? (측정 가능한 기준)

**Context-adaptive (1-3개 선택):**
- User-facing → 누가 사용? 어떤 시나리오?
- Refactoring → 현재 코드의 가장 큰 문제점?
- Bug fix → 재현 조건/단계?
- Performance → 현재/목표 수치?
- Integration → API 문서/제약사항?

**항상 마지막:**
- 이 변경에서 절대 건드리면 안 되는 부분? (Boundaries)

### 1b. Scope 평가

- **분해 검사**: 여러 독립 하위 시스템이면 → 세션 분리 제안
- **Quick codebase pulse**: 관련 파일 2-3개 Read → 기존 아키텍처와 충돌 방지

### 1c. 접근법 비교 (2-3개)

각 접근법에 대해:
```
APPROACH A: [Name]
  요약 / 장점 / 단점 / 복잡도: S/M/L

추천: [A/B] — [이유]
```

사용자 선택 대기.

### 1d. 설계 심화 (선택된 접근법)

- 엣지 케이스, 의존성, 영향 범위 점검

## Step 2: brainstorm.md 작성

Write `$WORK_DIR/brainstorm.md`:

```markdown
# Brainstorm: [Task Title]

## 문제 정의
## 성공 기준
## 접근 방식 비교
### Approach A / B: [Name] — 요약, 장점, 단점, 복잡도
## 선택된 접근 방식 — [Name] + 이유
## 엣지 케이스 & 리스크
## 변경하지 않는 부분 (Boundaries)
## 다음 단계
```

## Step 3: Review Gate

Read("skills/shared/references/review-gate.md") — Structural Review 실행:
- Phase: brainstorm
- Document: `$WORK_DIR/brainstorm.md`
- Dimensions: problem_clarity, approach_differentiation, success_measurability, edge_case_coverage
- Model: "haiku"
- Max iterations: 2

`--skip-review` (state의 `review_state: skipped`) 시 건너뜀.

## Step 4: Phase Review Gate

Read("skills/shared/references/phase-review-gate.md") — 프로토콜 실행:
- Phase: brainstorm
- Document: `$WORK_DIR/brainstorm.md`
- Self-review checklist: 문제 정의 명확성, 접근법 비교 충실도, 성공 기준 존재

# Section 3: 완료

1. State 업데이트:
   - `review_state: completed`
   - `review_results.brainstorm`: `{score, iterations, timestamp}`
   - `phase_review.brainstorm`: `{reviewed, reviewers, self_issues, external_issues, resolved}`
   - `brainstorm_completed_at`: current ISO timestamp
   - **`current_phase: research`**
2. 완료 메시지:
   ```
   브레인스톰 완료!
   문서: $WORK_DIR/brainstorm.md
   선택된 접근법: [Name]
   Spec Review: [score]/10
   ```
