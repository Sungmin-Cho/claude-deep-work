---
name: deep-debug
description: "Use when the user enters debug sub-mode during deep-work Phase 3 (Implement) to investigate root causes before applying fixes. Triggers on `/deep-debug`, \"systematic debug\", \"root cause investigation\", \"디버그 모드\", \"근본 원인 분석\", `verification_cmd` 실패 시 자동 진입, or \"fix this\" once iron-rule blocks guessing. Four phases: Investigate → Analyze → Hypothesize → Implement. Iron rule: NO fixes without root cause investigation first. Escalates to user after 3 invalidated hypotheses."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-debug [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-debug", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) | Debug sub-mode 진입 — 현재 실패 컨텍스트로부터 root cause 분석 |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


# Systematic Debugging (v4.0)

You are entering **Debug Sub-Mode** within a Deep Work implementation session.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. Output ALL user-facing messages in the detected language.

## Iron Rule

🚫 **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

Do NOT:
- Guess at fixes based on the error message alone
- Try random changes to see if they work
- Apply a fix without understanding WHY the bug exists
- Move on after a fix without verifying the root cause theory

## Trigger Conditions

This command activates automatically when:
- `verification_cmd` fails after the GREEN phase (unexpected regression)
- A previously passing test starts failing
- The user explicitly calls `/deep-debug`

## Phase 1: Investigate

1. **Read the error carefully**:
   ```
   에러 분석:
      테스트: [failing test name]
      에러 메시지: [exact error]
      스택 트레이스: [relevant lines]
   ```

2. **Reproduce consistently**: Run the failing command 2 more times to confirm it's not flaky

3. **Check recent changes**: What was the last edit before the failure?
   ```bash
   git diff HEAD
   git log --oneline -5
   ```

4. **Gather evidence**: Read related files, check imports, trace data flow

## Phase 2: Analyze

1. **Find a working reference**: Is there similar code that works? Compare patterns.

2. **Identify the difference**: What's different between the working and broken state?

3. **Trace data flow**: Follow the data from input to the failure point:
   ```
   데이터 흐름:
      입력: [source] → [transform1] → [transform2] → ❌ [failure point]
      예상: [expected value at failure point]
      실제: [actual value at failure point]
   ```

## Phase 3: Hypothesize

1. **Form ONE hypothesis**: Based on evidence, not guessing
   ```
   가설:
      원인: [specific root cause]
      근거: [evidence supporting this hypothesis]
      검증 방법: [how to test this hypothesis]
   ```

2. **Test the hypothesis minimally**: Verify with the smallest possible change or check

3. **If hypothesis is wrong**: Return to Phase 2 with new data. Do NOT try another random fix.

## Phase 4: Implement Fix

1. **Apply the minimal fix** based on verified root cause
2. **Run the failing test** — it should now pass
3. **Run the full test suite** — no regressions
4. **Record the root cause**:

Write to `$WORK_DIR/debug-log/RC-NNN.md`:
```markdown
# Root Cause: [Title]

## 증상
- 실패한 테스트: [test name]
- 에러 메시지: [message]

## 근본 원인
[Explanation of why the bug existed]

## 수정 내용
[What was changed and why]

## 교훈
[What to watch for in the future]

## 관련 Slice
- SLICE-NNN: [goal]
```

5. **Update receipt**: Set `debug.root_cause_note` to the RC file path

## Escalation

If 3 fix attempts fail (3 different hypotheses tested and invalidated):

```
⚠️ 디버깅 에스컬레이션

3번의 수정 시도가 실패했습니다. 이것은 아키텍처 수준의 문제일 수 있습니다.

시도한 가설:
1. [hypothesis 1] — [why it failed]
2. [hypothesis 2] — [why it failed]
3. [hypothesis 3] — [why it failed]

사용자의 판단이 필요합니다.
```

**STOP and wait for user guidance.** Do NOT continue guessing.

## State Management

On entry:
- Set `debug_mode: true` in state file

On exit (fix verified):
- Set `debug_mode: false`
- Resume the TDD cycle where it was interrupted
