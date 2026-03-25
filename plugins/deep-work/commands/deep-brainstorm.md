---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent
description: "Phase 0: Brainstorm — explore why before how (skip-able with --skip-brainstorm)"
---

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

Read `.claude/deep-work.local.md` and verify:
- `current_phase` is "brainstorm"

Extract `work_dir` and `task_description` from the state file.

**Record start time**: Update `brainstorm_started_at` in the state file.

### 2. Problem Exploration

Engage the user in a structured design conversation:

#### 2a. Problem Definition
```
🧠 브레인스톰 시작: [task_description]

먼저 문제를 정확히 이해하겠습니다.
```

Ask the user (one at a time):
1. **이 기능/변경의 핵심 목표는 무엇인가요?** (단순히 "무엇"이 아니라 "왜")
2. **이 변경이 없으면 어떤 문제가 계속되나요?** (pain point 구체화)
3. **성공하면 어떻게 보이나요?** (성공 기준)

#### 2b. Approach Comparison

Based on the user's answers, propose 2-3 distinct approaches:

```
📊 접근 방식 비교:

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

💡 추천: [A/B] — [이유]
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
📋 브레인스톰 완료!

📄 문서: $WORK_DIR/brainstorm.md
🎯 선택된 접근법: [Approach Name]
📊 Spec Review: [score]/10

다음 단계: Research 단계로 진행합니다.
```

Update state file:
- `brainstorm_completed_at`: current timestamp
- `current_phase: research`

**Auto-execute**: Read `/deep-research` command and follow its steps.
