---
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion
description: "Manually trigger structural review and/or cross-model adversarial review on current phase document"
argument-hint: "[--structural] [--adversarial] [--phase=brainstorm|research|plan]"
---

> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.

# Deep Review — Manual Review Gate Trigger (v4.2)

Manually trigger structural review and/or cross-model adversarial review on the current phase document.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. Output ALL user-facing messages in the detected language. The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Usage

- `/deep-review` — Run structural review (+ adversarial if plan phase and enabled)
- `/deep-review --structural` — Run structural review only
- `/deep-review --adversarial` — Run adversarial review only (plan phase only)
- `/deep-review --phase=brainstorm` — Force review on a specific phase document
- `/deep-review --structural --adversarial` — Run both explicitly

## Instructions

### 1. Read state and determine phase

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `$STATE_FILE`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` and extract:
- `current_phase`
- `work_dir` (default: `deep-work`)
- `cross_model_enabled` (default: `false`)

Set `WORK_DIR` to the `work_dir` value.

If `--phase` flag is provided, use that instead of `current_phase`.
Valid phase values: `brainstorm`, `research`, `plan`.

If no valid phase can be determined, inform the user:
```
❌ 리뷰할 phase를 결정할 수 없습니다.
   현재 phase: ${current_phase}
   사용법: /deep-review --phase=brainstorm|research|plan
```

### 2. Locate the phase document

Find the document for the target phase in `$WORK_DIR`:

| Phase | Document |
|-------|----------|
| brainstorm | `$WORK_DIR/brainstorm.md` |
| research | `$WORK_DIR/research.md` |
| plan | `$WORK_DIR/plan.md` |

If the document does not exist:
```
❌ ${phase} 문서를 찾을 수 없습니다: ${documentPath}
   먼저 /deep-${phase}를 실행하여 문서를 생성하세요.
```

### 3. Load review protocol

Read `references/review-gate.md` from the skill directory. Follow its protocol exactly for all review operations.

### 4. Run structural review

**Condition**: Run if `--structural` flag is present, OR if no flags were specified.

1. Check document size. If < 500 characters, skip with warning per protocol.
2. Determine the review dimensions for the target phase (see review-gate.md Section 2).
3. Read `evaluator_model` from state file (default: "sonnet"). Spawn an Agent with the resolved evaluator model to review the document on those dimensions.
4. Parse the Agent's JSON response.
5. Write results to:
   - `$WORK_DIR/${phase}-review.json`
   - `$WORK_DIR/${phase}-review.md`
6. If disk write fails, output results to console as fallback.

Display results:
```
Structural Review 결과: ${phase}

  Overall Score: ${score}/10 — ${grade} (PASS/WARNING/FAIL)

  Dimensions:
  ${dimensionScores}

  Issues: ${issueCount}개
  - Critical: ${criticalCount}
  - Major: ${majorCount}
  - Minor: ${minorCount}

  상세: $WORK_DIR/${phase}-review.json
```

**Auto-loop context (v5.1)**: If `plan_review_retries` > 0 in state file:
- Display: `(자동 수정 시도 [N]/[max] 후 수동 리뷰)`
- Manual review results reset the auto-loop counter (manual intervention is more targeted)
- Update state: `plan_review_retries: 0` after manual review completes

If score < 5 (FAIL), inform the user that review gate is blocking:
```
⛔ Structural review FAIL (${score}/10).
   문서를 수정한 후 /deep-review를 다시 실행하세요.
```

### 5. Run adversarial review

**Condition**: Run if ALL of the following are true:
- `--adversarial` flag is present, OR no flags were specified
- Target phase is `plan` or `research`
- `cross_model_enabled` is `true` in the state file

If conditions are not met and `--adversarial` was explicitly requested:
```
⚠️ Adversarial review를 실행할 수 없습니다.
   조건:
   - Phase가 plan 또는 research여야 합니다 (현재: ${phase})
   - cross_model_enabled가 true여야 합니다 (현재: ${cross_model_enabled})
```

If conditions are met:

1. Check CLI availability:
   ```bash
   which codex 2>/dev/null
   which gemini 2>/dev/null
   ```
   At least one model CLI must be available.

2. Prepare the review prompt per review-gate.md Section 3:
   - Write prompt to temp file: `PROMPT_FILE=$(mktemp /tmp/dw-review-XXXXXXXX.txt)`
   - Include plan.md content and rubric in the prompt
   - Include JSON output schema instructions

3. Execute each available model per review-gate.md Section 3.
   Show progress display per review-gate.md Section 7.

4. Parse results per review-gate.md JSON parsing strategy.

5. Synthesize results — identify consensus, conflicts, single-reviewer issues.

6. Write aggregated results to `$WORK_DIR/adversarial-review.json`.
   If disk write fails, output to console.

7. Display summary:
   ```
   Adversarial Review 결과:

     Models: ${modelList}
     Consensus Issues: ${consensusCount}개
     Conflicts: ${conflictCount}개
     단독 이슈: ${singleCount}개

     상세: $WORK_DIR/adversarial-review.json
   ```

### 6. 종합 판단 + 일괄 확인

Cross-model review 완료 후 (또는 structural review만 완료된 경우), `review-gate.md`의 **종합 판단 + 일괄 확인 프로토콜** (Section 4-1)을 따른다.

**Phase**: 현재 review 대상 phase (`research` 또는 `plan`)
**Document**: 대상 문서 (`$WORK_DIR/research.md` 또는 `$WORK_DIR/plan.md`)
**Inputs**: structural review 결과 + cross-model review 결과 (있는 경우)

사용자 확인 후 문서 수정, 항목별 조정(Section 4 호출), 또는 스킵을 Section 4-1에 따라 처리한다.

### 7. Handle re-review loop

If document modification from Section 6 is significant:
- Evaluate change scope per review-gate.md Section 6
- Ask user if re-review is desired
- Max 2 re-review loops

### 8. Update state file

Update `$STATE_FILE`:
- Add or update `review_results.{phase}` (where `{phase}` is the target phase — `research` or `plan`) with:
  - `judgments`: Claude 종합 판단 결과 array
  - `judgments_timestamp`: 종합 판단 완료 시각 (ISO timestamp)
  - `reviewer_status`: 각 리뷰어 실행 결과 (`{ claude, codex?, gemini? }`)
  - `structural_score`: overall score
  - `structural_grade`: PASS / WARNING / FAIL
  - `adversarial_gate`: PASS / WARNING / FAIL / BLOCKED (if adversarial ran)
  - `review_completed_at`: ISO timestamp
  - `review_iterations`: number of review rounds performed

### 9. Display final summary

```
✅ Review 완료!

  Structural: ${score}/10 (${grade})
  ${adversarialLine}
  결과 파일: $WORK_DIR/${phase}-review.json
  ${adversarialFileLine}

  ${nextStepMessage}
```

Where `nextStepMessage` depends on grade:
- PASS: "다음 단계로 진행할 수 있습니다."
- WARNING: "경고 사항을 확인하고 진행 여부를 결정하세요."
- FAIL/BLOCKED: "문서를 수정한 후 /deep-review를 다시 실행하세요."
