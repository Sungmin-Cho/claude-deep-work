---
name: deep-phase-review
description: "Use when the user wants to manually trigger structural review and/or cross-model adversarial review on a deep-work Phase document (brainstorm/research/plan). Triggers on `/deep-phase-review`, \"phase review\", \"adversarial review\", \"cross-model review\", \"phase 리뷰\", \"구조 검증\", \"어드버서리얼 리뷰\". For code review use the deep-review plugin (deep-suite). Structural runs always; adversarial requires the plan phase + cross_model enabled. Supports `--structural`, `--adversarial`, `--phase=<phase>`."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-phase-review [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-phase-review", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) | Default — current phase 의 structural review (+ plan + adversarial enabled 면 adversarial) |
| `--structural` | Structural review 만 |
| `--adversarial` | Adversarial review 만 (plan phase 만) |
| `--phase=<phase>` | `brainstorm|research|plan` 강제 |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


> **Special Utility (v6.2.4)** — 특정 Phase 문서(brainstorm/research/plan)의 구조적 리뷰와 adversarial 크로스 모델 리뷰를 수동으로 트리거합니다. 코드 리뷰는 deep-review 플러그인(deep-suite) 사용.

# Deep Phase Review — Manual Review Gate Trigger (v4.2)

Manually trigger structural review and/or cross-model adversarial review on the current phase document.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. Output ALL user-facing messages in the detected language. The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Usage

- `/deep-phase-review` — Run structural review (+ adversarial if plan phase and enabled)
- `/deep-phase-review --structural` — Run structural review only
- `/deep-phase-review --adversarial` — Run adversarial review only (plan phase only)
- `/deep-phase-review --phase=brainstorm` — Force review on a specific phase document
- `/deep-phase-review --structural --adversarial` — Run both explicitly

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
   사용법: /deep-phase-review --phase=brainstorm|research|plan
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

Read `skills/shared/references/phase-review-gate.md` from the plugin root. This protocol defines the unified Fallback chain for all phases.
Also read `skills/shared/references/review-gate.md` for Structural Review and Adversarial Review details (referenced by phase-review-gate.md).

Follow the Phase Review Gate protocol for reviewer selection:
- Phase 0~2 (brainstorm, research, plan): Structural + Adversarial + 셀프 + Opus 서브에이전트

> **Note:** Phase 3 (implement) 리뷰는 `/deep-implement` 커맨드의 Phase Review Gate에서 자동 실행된다. `/deep-phase-review`는 문서 Phase(0~2) 전용이다.

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
   문서를 수정한 후 /deep-phase-review를 다시 실행하세요.
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
- Add or update `phase_review.{phase}` (where `{phase}` is the target phase) with:
  - `reviewed`: true
  - `reviewers`: array of reviewer names (e.g., ["self", "opus-subagent", "codex"])
  - `self_issues`: count of self-review issues
  - `external_issues`: count of external review issues
  - `resolved`: count of resolved issues

Keep backward compatibility: if `review_results.{phase}` exists from a previous session, read from it but write to `phase_review.{phase}`.

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
- FAIL/BLOCKED: "문서를 수정한 후 /deep-phase-review를 다시 실행하세요."
