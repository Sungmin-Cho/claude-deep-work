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

Read `.claude/deep-work.local.md` and extract:
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
- Target phase is `plan`
- `cross_model_enabled` is `true` in the state file

If conditions are not met and `--adversarial` was explicitly requested:
```
⚠️ Adversarial review를 실행할 수 없습니다.
   조건:
   - Phase가 plan이어야 합니다 (현재: ${phase})
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

5. Synthesize results — identify consensus, conflicts, waivers.

6. For each conflict, run conflict resolution UX per review-gate.md Section 4.

7. Write aggregated results to `$WORK_DIR/adversarial-review.json`.
   If disk write fails, output to console.

8. Display summary:
   ```
   Adversarial Review 결과:

     Models: ${modelList}
     Consensus Issues: ${consensusCount}개
     Conflicts: ${conflictCount}개 (${resolvedCount} resolved)
     Waivers: ${waiverCount}개

     Gate Status: ${gateStatus}

     상세: $WORK_DIR/adversarial-review.json
   ```

### 6. Apply review gate blocking

Per review-gate.md Section 5:
- If structural review score < 5 OR critical consensus issues exist → gate status is BLOCKED
- Inform the user and require explicit override or document fixes

### 7. Handle re-review loop

If conflict resolution modified plan.md:
- Evaluate change scope per review-gate.md Section 6
- Ask user if re-review is desired
- Max 2 re-review loops

### 8. Update state file

Update `.claude/deep-work.local.md`:
- Add or update `review_results` with:
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
