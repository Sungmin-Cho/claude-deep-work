---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent
description: "Phase 0: Brainstorm — explore why before how (skip-able with --skip-brainstorm)"
---

> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.

# Phase 0: Deep Brainstorm (v4.0)

You are in the **Brainstorm** phase of a Deep Work session. This phase explores "why" before "how."

## Language

Detect the user's language from their messages or the Claude Code `language` setting. Output ALL user-facing messages in the detected language.

## Critical Constraints

🚫 **DO NOT implement anything.**
🚫 **DO NOT modify any source code files.**
🚫 **DO NOT create implementation files.**
✅ **ONLY explore the problem space and document the design in brainstorm.md.**

## Skip Condition

If the user started the session with `--skip-brainstorm` or `--start-phase=research`:
- Skip this phase entirely
- Set `current_phase: research` and proceed to `/deep-research`

## Instructions

### 1. Verify prerequisites

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `.claude/deep-work.local.md`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` and verify:
- `current_phase` is "brainstorm"

Extract `work_dir` and `task_description` from the state file.

**Record start time**: Update `brainstorm_started_at` in the state file.

### 2. Problem Exploration

Engage the user in a structured design conversation:

#### 2a. Problem Definition
```
브레인스톰 시작: [task_description]

먼저 문제를 정확히 이해하겠습니다.
```

Ask the user 3-5 questions (one at a time). Start with core questions, then add context-appropriate ones:

**Core questions (always ask):**
1. **이 기능/변경의 핵심 목표는 무엇인가요?** (단순히 "무엇"이 아니라 "왜")
2. **성공하면 어떻게 보이나요?** (측정 가능한 성공 기준)

**Context-adaptive questions (choose 1-3 based on the task):**
- For user-facing features: **누가 이 기능을 사용하나요? 어떤 시나리오에서?**
- For refactoring: **현재 코드의 가장 큰 문제점은 무엇인가요?**
- For bug fixes: **이 문제가 발생하는 정확한 조건은? 재현 단계는?**
- For performance: **현재 성능 수치는? 목표 수치는?**
- For integration: **연동 대상의 API 문서나 제약사항이 있나요?**

**Always close with:**
- **이 변경에서 절대 건드리면 안 되는 부분이 있나요?** (Boundaries — feeds into plan's "Files NOT to Modify")

#### 2a-bis. Scope Assessment

Before proposing approaches, evaluate scope:

1. **Decomposition check**: Does this task describe multiple independent subsystems? If so:
   ```
   이 작업은 여러 독립적인 하위 시스템을 포함합니다:
   - [subsystem 1]
   - [subsystem 2]
   각각 별도의 deep-work 세션으로 분리하는 것을 권장합니다.
   먼저 [subsystem]부터 진행할까요?
   ```

2. **Quick codebase pulse**: Read 2-3 key files related to the task to ground the conversation in reality. This is NOT full research — just enough to avoid proposing approaches that conflict with the existing architecture.
   ```
   빠른 코드베이스 확인:
   - [file1]: [1줄 요약]
   - [file2]: [1줄 요약]
   이 컨텍스트를 바탕으로 접근법을 제안합니다.
   ```

#### 2b. Approach Comparison

Based on the user's answers, propose 2-3 distinct approaches:

```
접근 방식 비교:

APPROACH A: [Name]
  요약: [1-2문장]
  장점: [bullets]
  단점: [bullets]
  복잡도: S/M/L

APPROACH B: [Name]
  요약: [1-2문장]
  장점: [bullets]
  단점: [bullets]
  복잡도: S/M/L

추천: [A/B] — [이유]
```

Wait for user's choice or feedback.

#### 2c. Design Sharpening

For the chosen approach, probe deeper:
- **엣지 케이스**: What could go wrong?
- **의존성**: What does this depend on?
- **영향 범위**: What else might be affected?

### 3. Write brainstorm.md

Write `$WORK_DIR/brainstorm.md`:

```markdown
# Brainstorm: [Task Title]

## 문제 정의
[Why this change is needed — user's own words]

## 성공 기준
- [criterion 1]
- [criterion 2]

## 접근 방식 비교

### Approach A: [Name]
- **요약**: [description]
- **장점**: [bullets]
- **단점**: [bullets]
- **복잡도**: S/M/L

### Approach B: [Name]
- **요약**: [description]
- **장점**: [bullets]
- **단점**: [bullets]
- **복잡도**: S/M/L

## 선택된 접근 방식
**[Approach Name]** — [이유]

## 엣지 케이스 & 리스크
- [edge case 1]
- [edge case 2]

## 변경하지 않는 부분 (Boundaries)
- [기존 기능/파일/인터페이스 that explicitly stays unchanged]
- [Integration point that must remain backward-compatible]

## 다음 단계
Research 단계에서 코드베이스를 분석하여 이 접근 방식의 실현 가능성을 검증합니다.
```

### 4. Structural Review

Read `references/review-gate.md` from the skill directory (located at `skills/deep-work-workflow/references/review-gate.md`).

Follow the **Structural Review Protocol** with these settings:
- **Phase**: brainstorm
- **Document**: `$WORK_DIR/brainstorm.md`
- **Dimensions**: problem_clarity, approach_differentiation, success_measurability, edge_case_coverage
- **Output**: `$WORK_DIR/brainstorm-review.json` + `$WORK_DIR/brainstorm-review.md`
- **Model**: "haiku"
- **Max iterations**: 2

If `--skip-review` flag was set during session init (check state file `review_state: skipped`), skip this step entirely and proceed.

After review completes, update state file:
- `review_state: completed`
- `review_results.brainstorm`: `{score: N, iterations: N, timestamp: "ISO"}`

### 5. Present and transition

```
브레인스톰 완료!

문서: $WORK_DIR/brainstorm.md
선택된 접근법: [Approach Name]
Spec Review: [score]/10

다음 단계: Research 단계로 진행합니다.
```

### 5.1. Phase Review Gate

brainstorm.md 작성 완료 후, Phase Review Gate를 실행한다.

Read `references/phase-review-gate.md` and follow the protocol with:
- **Phase**: `brainstorm`
- **Document**: `$WORK_DIR/brainstorm.md`
- **Self-review checklist**: 문제 정의 명확성, 접근법 비교 충실도, 성공 기준 존재

Phase Review Gate 완료 후 Research로 자동 전환한다.

Update state file:
- `brainstorm_completed_at`: current timestamp
- `current_phase: research`

**Auto-execute**: Read `/deep-research` command and follow its steps.
