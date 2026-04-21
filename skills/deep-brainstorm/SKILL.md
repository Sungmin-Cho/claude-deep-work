---
name: deep-brainstorm
version: "6.3.1"
description: "Phase 0 — Brainstorm: explore why before how (skip-able)"
---

> [!IMPORTANT]
> **Skill body echo 금지**
>
> 이 SKILL.md 본문을 사용자에게 echo하거나 요약하여 출력하지 마라.
>
> - Section 1 (state 로드, 완료-marker 감지)의 **조용한 내부 처리**는 silent 실행한다. Pre-checks/상태 분기의 명시적 AskUserQuestion은 허용된 예외.
> - 첫 사용자-가시 주 동작은 Section 2의 **First Action: Core 질문 #1**이다.
> - Section 3 완료 메시지는 Section 2의 주 단계(질문, 접근법 비교, brainstorm.md 작성, Review Gate)를 **실제로 수행**한 뒤에만 출력한다.
> - 본 문서의 code block / 안내 템플릿은 Write tool 자료 또는 작동 지침이지 사용자 화면 출력용이 아니다.

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
- 완료-marker(`brainstorm_completed_at`)만 기록 → 즉시 종료 (Orchestrator가 Exit Gate 판단 없이 Research 단계로 dispatch).

## 완료-Marker 감지 (resume 경로 — F1 pause/resume 지원)

`brainstorm_completed_at` 필드가 state에 이미 있고, `$ARGUMENTS`에 `--force-rerun`이 없으면:
- "Phase 0 (Brainstorm)는 이미 완료되었습니다. Exit Gate를 재표시합니다." 출력
- Orchestrator §3-1로 제어 반환 (Exit Gate 재실행)
- Section 2/3 진입 금지

# Section 2: Phase 실행

## First Action (즉시 실행 — 건너뛰기 금지)

Section 1 state 로드가 완료되면 **즉시** 다음 메시지를 사용자에게 출력하고 응답을 기다린다 (AskUserQuestion이 아닌 conversational 메시지):

> "Brainstorm 단계를 시작합니다. 이 기능/변경의 핵심 목표는 무엇인가요? (한 문장으로)"

- superpowers `brainstorming` skill의 "one question at a time" 원칙.
- 응답을 받은 뒤 Step 1a 나머지 질문들을 순차 진행한다.

**금지**: 이 첫 질문 전에 템플릿, 완료 메시지, Section 2 구조 설명을 출력하지 마라.

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

1. Read `../shared/templates/brainstorm-template.md` — 구조 템플릿 로드.
2. Step 1에서 사용자와의 대화로 수집한 실제 내용으로 placeholder (`[Task Title]`, `[한 단락 — ...]`, `[Approach N: Name]` 등)를 **전부** 치환.
3. Write `$WORK_DIR/brainstorm.md`에 치환 완료된 내용 저장.

**Placeholder policy**: 미치환 placeholder (대괄호 텍스트, "TBD", "TODO")가 남으면 Phase Review Gate가 차단한다.

## Step 3: Review Gate

Read("../shared/references/review-gate.md") — Structural Review 실행:
- Phase: brainstorm
- Document: `$WORK_DIR/brainstorm.md`
- Dimensions: problem_clarity, approach_differentiation, success_measurability, edge_case_coverage
- Model: "haiku"
- Max iterations: 2

`--skip-review` (state의 `review_state: skipped`) 시 건너뜀.

## Step 4: Phase Review Gate

Read("../shared/references/phase-review-gate.md") — 프로토콜 실행:
- Phase: brainstorm
- Document: `$WORK_DIR/brainstorm.md`
- Self-review checklist: 문제 정의 명확성, 접근법 비교 충실도, 성공 기준 존재

# Section 3: 완료

> **실행 순서 안전장치**: 이 섹션은 Section 2의 Step 1 (사용자 질문), Step 2 (brainstorm.md 작성), Step 3 (Review Gate), Step 4 (Phase Review Gate)를 **모두 실제로 수행**한 뒤에만 실행한다. 주 단계를 건너뛰고 여기로 점프하여 완료 메시지만 출력하는 것은 실패 모드이다.

1. State 업데이트:
   - `review_state: completed`
   - `review_results.brainstorm`: `{score, iterations, timestamp}`
   - `phase_review.brainstorm`: `{reviewed, reviewers, self_issues, external_issues, resolved}`
   - `brainstorm_completed_at`: current ISO timestamp
   - **`current_phase`는 변경하지 않는다.** Orchestrator가 Exit Gate "진행" 분기에서 `research`로 전환.
2. 완료 메시지:
   ```
   브레인스톰 완료!
   문서: $WORK_DIR/brainstorm.md
   선택된 접근법: [Name]
   Spec Review: [score]/10
   ```
