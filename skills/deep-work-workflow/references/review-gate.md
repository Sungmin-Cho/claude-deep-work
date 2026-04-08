# Review Gate Protocol

## 개요

Phase 문서(brainstorm.md, research.md, plan.md)에 대한 자동 품질 검증 프로토콜.
두 가지 레벨의 리뷰를 제공한다:

1. **Structural Review** — haiku subagent가 phase별 차원에서 문서를 평가
2. **Adversarial Review** — 외부 모델(codex, gemini)이 plan.md를 독립 평가 후, Claude가 종합

## Minimum Document Size

문서가 **500자 미만**이면 structural review를 건너뛴다. 콘솔에 안내:
```
⚠️ 문서가 너무 짧습니다 (${charCount}자 < 500자). Structural review를 건너뜁니다.
```

---

## 1. Structural Review Protocol

### 실행 방법

Claude가 Agent(haiku 모델)를 스폰하여 현재 phase의 문서를 리뷰한다.

**Agent prompt 템플릿:**
```
Review the following document for a ${phase} phase.

Evaluate on these dimensions (score 1-10 each):
${dimensionList}

For each dimension:
- Score 1-10
- Brief justification (1-2 sentences)
- Issues found (if any)

Output ONLY valid JSON matching this schema:
{
  "phase": "${phase}",
  "overall_score": <number>,
  "dimensions": {
    "<dimension_name>": <score>,
    ...
  },
  "issues": [
    {
      "id": "SR-001",
      "severity": "critical" | "major" | "minor",
      "dimension": "<dimension_name>",
      "section": "<document section>",
      "description": "<what's wrong>",
      "suggested_fix": "<how to fix>"
    }
  ],
  "summary": "<1-2 sentence overall assessment>"
}
```

### 점수 기준

| 점수 범위 | 등급 | 동작 |
|-----------|------|------|
| ≥ 7 | **PASS** | 다음 단계 진행 허용 |
| 5 – 6 | **WARNING** | 경고 표시, 사용자가 진행 여부 결정 |
| ≤ 4 | **FAIL** | 문서 수정 후 재리뷰 필요 |

### Auto-fix 스냅샷 계약

Auto-fix 루프에서 문서를 수정할 때 반드시 따라야 하는 안전 계약:

1. **스냅샷 필수**: 매 auto-fix 반복 전에 현재 문서를 스냅샷으로 저장
   - Research: `$WORK_DIR/research.v{N}.md` (N = iteration 번호)
   - Plan: `$WORK_DIR/plan.autofix-v{N}.md` (plan.v{N}.md 버전 관리와 별도)

2. **수정 범위 제한**: auto-fix 시 이슈가 지적한 특정 섹션만 수정. 전체 문서 재작성 금지.

3. **Score 하락 감지**: auto-fix 후 structural review score가 이전 iteration보다 하락하면:
   - 즉시 이전 스냅샷으로 revert
   - 사용자에게 수동 수정 요청:
     ```
     ⚠️ Auto-fix로 점수가 하락했습니다 ([prev_score] → [new_score]).
        이전 버전으로 복원했습니다. 수동으로 수정해주세요.
     ```

4. **정리**: 스냅샷 파일은 세션 종료 시 정리 (최종 문서만 보존). Plan의 autofix 스냅샷은 `plan.v{N}.md` 사용자 버전 관리와 별도.

### 반복 제한

최대 **3회** structural review 반복. 3회 후에도 FAIL이면:
```
⚠️ Structural review 3회 반복 후에도 FAIL입니다.
   현재 점수: ${score}/10
   사용자 판단이 필요합니다. 진행하시겠습니까? (y/n)
```

### 출력 파일

- `$WORK_DIR/${phase}-review.json` — 구조화된 리뷰 결과
- `$WORK_DIR/${phase}-review.md` — 사람이 읽을 수 있는 리뷰 요약

---

## 2. Review Dimensions by Phase

### Brainstorm Phase

| Dimension | 설명 |
|-----------|------|
| `problem_clarity` | 문제가 명확하게 정의되었는가? "왜"가 설명되었는가? |
| `approach_differentiation` | 제안된 접근법들이 의미 있게 다른가? |
| `success_measurability` | 성공 기준이 측정 가능한가? |
| `edge_case_coverage` | 엣지 케이스와 리스크가 고려되었는가? |

### Research Phase

| Dimension | 설명 |
|-----------|------|
| `completeness` | 필요한 모든 영역이 조사되었는가? |
| `accuracy` | 코드베이스 분석이 정확한가? |
| `relevance` | 발견 사항이 과제와 직접 관련 있는가? |
| `depth` | 피상적이지 않고 충분히 깊게 조사했는가? |
| `actionability` | 발견 사항이 plan 단계에서 바로 활용 가능한가? |

### Plan Phase

| Dimension | 설명 |
|-----------|------|
| `architecture_fit` | 기존 코드베이스의 아키텍처/패턴과 일관성 있는가? |
| `slice_executability` | 각 slice가 독립적으로 실행 가능하고 구체적인가? |
| `testability` | 각 slice에 failing_test와 verification_cmd(+expected_output)가 있는가? |
| `code_completeness` | Code sketch가 Completeness Policy를 충족하는가? (placeholder 부재, 크기별 코드 완성도) |
| `buildability` | 코드베이스에 익숙하지 않은 엔지니어가 이 plan만 보고 구현할 수 있는가? |
| `rollback_completeness` | 롤백 전략이 구체적이고 실행 가능한가? |
| `risk_coverage` | 리스크가 식별되고 완화 방안이 있는가? |

**하위 호환성 (v5.8)**: plan.md에 `steps` 또는 `expected_output` 필드가 없는 경우 (기존 형식), `code_completeness`는 기존 기준(Code sketch 존재 여부 + placeholder 부재)으로 평가하고, `buildability`는 기존 `slice_executability`와 동일 기준으로 fallback한다. 인라인 plan(`skipped_phases` includes "plan")은 structural review 자체를 skip한다.

---

## 3. Adversarial Review Protocol (plan.md & research.md)

### 전제 조건

- Phase가 `plan` 또는 `research`일 때 실행
- State file의 `cross_model_enabled: true`일 때만 실행
- `which codex` 또는 `which gemini`로 CLI 존재 확인

### 모델별 실행 방법

#### Shell Injection 방지

프롬프트를 임시 파일에 작성하여 shell injection을 방지한다:
```bash
PROMPT_FILE=$(mktemp /tmp/dw-review-XXXXXXXX.txt)
```

프롬프트 파일에 plan.md 내용과 리뷰 rubric을 작성한다.

#### Codex 실행

```bash
TMPERR=$(mktemp /tmp/dw-err-XXXXXXXX.txt)
timeout 120 codex exec "$(cat "$PROMPT_FILE")" -s read-only 2>"$TMPERR"
```

- `-s read-only` 플래그로 코드베이스 변경 방지
- timeout 120초

#### Gemini 실행

```bash
TMPERR=$(mktemp /tmp/dw-err-XXXXXXXX.txt)
timeout 120 gemini exec "$(cat "$PROMPT_FILE")" 2>"$TMPERR"
```

실패 시 fallback:
```bash
timeout 120 gemini -p "$(cat "$PROMPT_FILE")" 2>"$TMPERR"
```

#### Plan Rubric

Plan phase에서 각 모델에 제공하는 rubric:

| Dimension | 설명 |
|-----------|------|
| `architecture_fit` | 기존 아키텍처/패턴과의 일관성 |
| `assumption_validity` | plan의 가정이 유효한가 |
| `slice_executability` | 각 slice가 독립 실행 가능한가 |
| `code_completeness` | Code sketch가 Completeness Policy를 충족하는가 |
| `buildability` | 이 plan만으로 구현이 가능한가 (막히는 부분 없이) |
| `risk_coverage` | 리스크와 완화 방안이 충분한가 |
| `alternative_consideration` | 대안이 충분히 검토되었는가 |

#### Research Rubric (Cross-Model Review 전용)

Research phase의 cross-model review에서 사용하는 rubric:

> **Note:** Structural review(Step 4.5)는 기존 dimension(`completeness, accuracy, relevance, depth, actionability`)을 유지한다. Cross-model review는 `depth` 대신 `risk_identification`을 사용한다. 이는 의도적 차이: structural review가 문서의 깊이를 평가하고, cross-model review가 리스크 커버리지를 평가하는 상호보완적 설계.

| Dimension | 설명 |
|-----------|------|
| `completeness` | 누락된 분석 영역이 있는가 |
| `accuracy` | 코드베이스 분석이 정확한가 |
| `relevance` | 과제와 직접 관련 있는 내용인가 |
| `risk_identification` | 리스크가 충분히 식별되었는가 |
| `actionability` | plan 단계에서 바로 활용 가능한가 |

#### 프롬프트 지시문

Phase에 따라 적절한 rubric의 dimensions를 사용한다:
- `plan` → Plan Rubric의 5개 dimension
- `research` → Research Rubric의 5개 dimension

**Note:** `dimensions` 객체의 키는 현재 phase의 rubric에 맞춰야 한다.
- Plan: `architecture_fit`, `assumption_validity`, `slice_executability`, `code_completeness`, `buildability`, `risk_coverage`, `alternative_consideration`
- Research: `completeness`, `accuracy`, `relevance`, `risk_identification`, `actionability`

각 모델에 다음을 지시한다:

```
Output ONLY valid JSON in this schema:
{
  "reviewer": "<model_name>",
  "score": <number 1-10>,
  "dimensions": {
    "architecture_fit": <score>,
    "assumption_validity": <score>,
    "slice_executability": <score>,
    "code_completeness": <score>,
    "buildability": <score>,
    "risk_coverage": <score>,
    "alternative_consideration": <score>
  },
  "issues": [
    {
      "id": "<reviewer>-001",
      "severity": "critical" | "major" | "minor",
      "dimension": "<dimension_name>",
      "section": "<plan.md section>",
      "description": "<what's wrong>",
      "suggested_fix": "<how to fix>",
      "confidence": <0.0-1.0>
    }
  ]
}
```

### JSON 파싱 전략

1. 모델 출력을 JSON으로 파싱 시도
2. **파싱 실패 시**: raw output을 저장하고, Claude가 ` ```json ` 블록에서 JSON 추출 시도
3. **그래도 실패 시**: 해당 모델을 `failed` 상태로 기록하고, 콘솔에 경고 출력:
   ```
   ⚠️ ${model} 출력을 JSON으로 파싱할 수 없습니다. 해당 모델 리뷰를 건너뜁니다.
      Raw output saved: $WORK_DIR/${model}-raw-output.txt
   ```

### 리뷰어 실패 처리 (Degraded Mode)

JSON 파싱 실패, timeout (120초 초과), CLI 에러 시:
1. 해당 리뷰어를 `failed` 상태로 기록
2. State file에 `reviewer_status` 업데이트: `{codex: "completed"|"failed"|"skipped", gemini: ...}`
3. UI에 degraded 상태 명시 표시:
   ```
   ⚠️ ${model} 리뷰 실패 (${reason}). ${otherModel} 결과만으로 판단합니다.
   ```

**Degraded mode 분류 규칙:**
- **실패한 리뷰어가 있을 때 consensus/conflict 분류 금지** — 성공한 리뷰어의 결과는 "단독 이슈"로만 분류
- consensus 판정은 2개 이상의 리뷰어가 모두 성공했을 때만 가능
- 모든 리뷰어가 실패한 경우: cross-model review를 건너뛰고 structural review 결과만으로 종합 판단 진행

### 결과 종합

Claude가 모든 **성공한** 모델 결과를 종합하여 다음을 도출한다:

1. **Consensus** (합의): 2개 이상의 성공한 리뷰어가 동의하는 이슈 (degraded mode에서는 불가)
2. **Conflicts** (충돌): 2개 이상의 성공한 리뷰어 간 점수 차이 ≥ 3 또는 대립하는 결론 (degraded mode에서는 불가)
3. **단독 이슈**: 한 리뷰어만 제기한 이슈 (degraded mode에서는 모든 이슈가 여기에 분류)
4. **Waivers** (면제): 사용자가 의도적으로 무시하기로 한 이슈

---

## 4. Conflict Resolution UX (항목별 조정 시에만 사용)

> **Note:** 이 섹션은 종합 판단 프로토콜(Section 4-1)에서 사용자가 "항목별 조정"을 선택했을 때, 해당 항목에 대해서만 호출된다. 직접 호출되지 않는다.

각 conflict에 대해 `AskUserQuestion`으로 4가지 선택지를 제시한다:

```
Conflict detected on: [dimension / section]

  Claude (score: ${claudeScore}): ${claudeAssessment}
  ${otherModel} (score: ${otherScore}): ${otherAssessment}

  1️⃣ Accept Claude's assessment (no change)
  2️⃣ Accept ${otherModel}'s assessment (Claude rewrites section)
  3️⃣ Waiver — acknowledge but skip (requires justification)
  4️⃣ Manual edit — you'll edit plan.md directly

Choose [1-4]:
```

### End-states

| Option | 동작 |
|--------|------|
| **1 — Accept Claude** | 변경 없음. Conflict를 resolved로 기록 |
| **2 — Accept other model** | Claude가 해당 section을 재작성 → structural re-review 트리거 |
| **3 — Waiver** | 사용자에게 justification 입력 요청. Waiver를 JSON에 기록 |
| **4 — Manual edit** | 사용자가 직접 plan.md를 수정하도록 안내. 수정 후 re-review 권장 |

---

## 4-1. 종합 판단 + 일괄 확인 프로토콜 (research/plan 공통)

Structural review + cross-model review 완료 후, Claude가 모든 결과를 종합 분석하여 사용자에게 일괄 확인을 받는다.

### Claude 종합 판단 생성

Claude는 다음 기준으로 각 이슈에 대해 판단한다:

1. **Consensus 이슈** (모든 리뷰어 동의): 기본적으로 `accept`
2. **Conflict 이슈** (리뷰어 간 점수 차이 >= 3): Claude가 코드베이스 컨텍스트를 기반으로 판단
3. **단독 이슈** (한 리뷰어만 제기 — degraded mode 포함): Claude가 유효성 검증 후 판단

판단 유형:
- `accept` — 수용 (문서 수정 필요)
- `reject` — 거절 (문서 유지) + 이유
- `partial` — 부분 수용 (수정 범위 제한) + 어떤 부분을 수용하는지

### 사용자 일괄 확인 표시

**Cross-model review가 성공한 경우:**

```
📊 [Research/Plan] 리뷰 종합 판단

Structural Review: [score]/10
Cross-Model: codex [score]/10, gemini [score]/10

Consensus (모든 리뷰어 동의) — [N]건:
  ✅ [CR-001] [이슈 설명] — Claude: 수용

Conflicts (리뷰어 간 의견 충돌) — [N]건:
  ✅ [CR-002] [이슈 설명]
     Claude [score] vs codex [score]: Claude 판단 — 수용 ([이유])
  ❌ [CR-003] [이슈 설명]
     Claude [score] vs gemini [score]: Claude 판단 — 거절 ([이유])

단독 이슈 — [N]건:
  ⚠️ [CR-004] [이슈 설명] — Claude: 부분 수용 ([범위])

---
수정 예정: [N]건 | 거절: [N]건 | 부분 수용: [N]건

이 판단대로 [research.md/plan.md]를 수정할까요?
  1. 동의 — 판단대로 수정
  2. 항목별 조정 — 특정 항목의 판단을 변경하고 싶습니다
  3. 전부 스킵 — 리뷰 결과를 반영하지 않음
```

**Cross-model tool이 없거나 degraded mode (structural review만):**

```
📊 [Research/Plan] 리뷰 종합 판단

Structural Review: [score]/10

Claude 판단:
  ✅ 수용: [이슈 설명] — [수용 이유]
  ❌ 거절: [이슈 설명] — [거절 이유]

이 판단대로 [research.md/plan.md]를 수정할까요?
  1. 동의 — 판단대로 수정
  2. 수정 — 특정 항목에 대해 의견을 변경하고 싶습니다
  3. 전부 스킵 — 현재 문서 그대로 진행
```

**Research phase 전용 추가 옵션:**

Research 리뷰의 경우, 위 선택지에 추가:
```
  4. 특정 영역 재분석 — 지정 영역만 재분석 후 리뷰 재진행
```
옵션 4 선택 시 (**재귀적 `/deep-research` 호출이 아닌 내부 분기로 처리**):
1. `research_review_retries`를 0으로 리셋
2. `review_state`를 `in_progress`로 리셋
3. 기존 review 아티팩트(`research-review.json`, `research-cross-review.json`) 삭제
4. 지정된 scope 영역만 재분석하여 research.md 업데이트 (Document Refinement Protocol 적용)
5. Step 4.5(Structural Review)부터 다시 진행

### 항목별 조정 흐름

사용자가 옵션 2 (항목별 조정)를 선택한 경우:
1. 변경하고 싶은 항목 번호를 입력받음
2. 해당 항목에 대해서만 Section 4 (Conflict Resolution UX)의 4지선다 제시
3. 조정 완료 후 수정 진행

### 확인 후 수정

사용자가 옵션 1 (동의) 또는 옵션 2 (항목별 조정 완료) 후:
1. `accept` 또는 `partial`로 판정된 이슈만 문서에 반영
2. 수정 후 기존 re-review 로직 적용 (변경 규모에 따라 re-review 권장, max 2회)
3. State file에 `judgments`, `judgments_timestamp` 업데이트

---

## 5. Review Gate Blocking

다음 조건 중 하나라도 해당하면 implement 자동 전환을 **차단**한다:

- Structural review 점수 < 5
- Critical severity의 consensus issue가 존재

차단 시 표시:
```
🚫 Review Gate 미통과 — 자동 implement 전환이 차단되었습니다.

  사유:
  - ${blockReasons}

  옵션:
  1. 문서를 수정하고 re-review
  2. 수동 override: "override review gate" 입력
```

사용자가 명시적으로 "override review gate" 또는 동등한 표현을 입력하면 차단을 해제한다.

---

## 6. Re-review Loop

Conflict resolution으로 plan.md가 수정된 후, 변경 범위에 따라 re-review를 권장한다:

| 변경 범위 | 권장 |
|-----------|------|
| 3개 이상 section 변경 | Full re-review (structural + adversarial) |
| 1-2개 section 변경 | Structural review only |
| 50줄 미만 변경 | Skip re-review |

```
plan.md가 수정되었습니다 (${changedSections}개 섹션, ${changedLines}줄 변경).

  권장: ${recommendation}
  Re-review를 실행할까요? (y/n)
```

**최대 2회** re-review loop 허용. 2회 초과 시:
```
⚠️ Re-review 최대 횟수(2회)에 도달했습니다. 현재 결과로 진행합니다.
```

---

## 7. Progress Display

Codex/Gemini 실행 중 (30-120초 소요) 진행 상황을 표시한다:

```
${model} 리뷰 실행 중... (예상 30-120초)
```

60초 경과 시 경고:
```
⏳ ${model} 리뷰가 60초 이상 소요되고 있습니다. 최대 120초까지 대기합니다.
```

Timeout (120초 초과) 시:
```
⚠️ ${model} 리뷰가 timeout되었습니다 (120초). 해당 모델 리뷰를 건너뜁니다.
```

---

## 8. Disk Write Failure Handling

JSON 결과 파일 쓰기가 실패할 경우, 결과를 콘솔에 직접 출력한다:

```
⚠️ ${filePath} 쓰기 실패. 결과를 콘솔에 출력합니다:

${JSON.stringify(result, null, 2)}
```

---

## 9. JSON Schema

### TypeScript Interfaces

```typescript
/** Single review issue */
interface ReviewIssue {
  /** Unique ID: "SR-001" for structural, "${reviewer}-001" for adversarial */
  id: string;
  /** Issue severity */
  severity: 'critical' | 'major' | 'minor';
  /** Which review dimension this relates to */
  dimension: string;
  /** Which section of the document */
  section: string;
  /** Description of the issue */
  description: string;
  /** How to fix it */
  suggested_fix: string;
  /** Confidence level (adversarial only, 0.0-1.0) */
  confidence?: number;
}

/** Structural review result */
interface ReviewResult {
  /** Phase that was reviewed */
  phase: 'brainstorm' | 'research' | 'plan';
  /** Overall score (1-10) */
  overall_score: number;
  /** Per-dimension scores */
  dimensions: Record<string, number>;
  /** List of issues found */
  issues: ReviewIssue[];
  /** Brief overall assessment */
  summary: string;
  /** ISO timestamp of review */
  reviewed_at: string;
  /** Number of review iterations performed */
  iteration: number;
}

/** Adversarial reviewer result (one per model) */
interface AdversarialReviewerResult {
  /** Model name: "codex" | "gemini" */
  reviewer: string;
  /** Overall score (1-10) */
  score: number;
  /** Per-dimension scores */
  dimensions: {
    architecture_fit: number;
    assumption_validity: number;
    slice_executability: number;
    risk_coverage: number;
    alternative_consideration: number;
  };
  /** List of issues found */
  issues: ReviewIssue[];
  /** Whether JSON parsing succeeded */
  parse_success: boolean;
  /** Raw output (stored if parse failed) */
  raw_output?: string;
  /** Execution time in seconds */
  execution_time_seconds?: number;
}

/** A conflict between reviewers */
interface ConflictItem {
  /** Which dimension or section the conflict is about */
  dimension: string;
  /** Section in plan.md */
  section?: string;
  /** Claude's score for this dimension */
  claude_score: number;
  /** Claude's assessment */
  claude_assessment: string;
  /** Other model's name */
  other_reviewer: string;
  /** Other model's score */
  other_score: number;
  /** Other model's assessment */
  other_assessment: string;
  /** How it was resolved */
  resolution: 'accept_claude' | 'accept_other' | 'waiver' | 'manual_edit' | 'pending';
  /** Waiver justification (if resolution is 'waiver') */
  waiver_justification?: string;
}

/** A waived issue */
interface WaiverItem {
  /** The issue that was waived */
  issue_id: string;
  /** Which reviewer raised it */
  reviewer: string;
  /** User's justification for waiving */
  justification: string;
  /** ISO timestamp */
  waived_at: string;
}

/** Complete adversarial review result (aggregated) */
interface AdversarialReviewResult {
  /** Claude's structural review */
  structural: ReviewResult;
  /** Results from each external model */
  adversarial_reviewers: AdversarialReviewerResult[];
  /** Consensus issues (all reviewers agree) */
  consensus: ReviewIssue[];
  /** Conflicts between reviewers */
  conflicts: ConflictItem[];
  /** Waived issues */
  waivers: WaiverItem[];
  /** Overall gate status */
  gate_status: 'PASS' | 'WARNING' | 'FAIL' | 'BLOCKED';
  /** Block reasons (if gate_status is BLOCKED) */
  block_reasons?: string[];
  /** Whether user overrode the gate */
  user_override: boolean;
  /** ISO timestamp */
  completed_at: string;
}
```

### 파일 위치

| 파일 | 경로 | 설명 |
|------|------|------|
| Structural review JSON | `$WORK_DIR/${phase}-review.json` | Structural review 결과 |
| Structural review MD | `$WORK_DIR/${phase}-review.md` | 사람이 읽는 리뷰 요약 |
| Adversarial review JSON | `$WORK_DIR/${phase}-cross-review.json` | 전체 adversarial review 결과 (research 또는 plan) |
| Model raw output | `$WORK_DIR/${model}-raw-output.txt` | JSON 파싱 실패 시 원본 출력 |

---

## 10. State File 스키마 변경 (v5.5)

### 신규 필드

| 필드 | 타입 | 설명 |
|------|------|------|
| `review_results.{phase}.model_scores` | `Record<string, number>` | Cross-model 리뷰어별 점수 |
| `review_results.{phase}.judgments` | `JudgmentResult[]` | Claude 종합 판단 결과 |
| `review_results.{phase}.judgments_timestamp` | `string` | 종합 판단 완료 시각 (단일 ISO timestamp, invalidation 기준) |
| `review_results.{phase}.reviewer_status` | `Record<string, "completed"\|"failed"\|"skipped">` | 리뷰어별 상태 |

여기서 `{phase}`는 `research` 또는 `plan`. 양쪽 모두 동일 구조.

```typescript
/** Single judgment from Claude's consolidated review */
interface JudgmentResult {
  issue_id: string;
  judgment: 'accept' | 'reject' | 'partial';
  reason: string;
  scope?: string; // partial일 때 수용 범위
}

/** review_results.{phase} 전체 구조 */
interface PhaseReviewResults {
  score?: number;                    // structural review score
  iterations?: number;               // structural review iterations
  model_scores?: Record<string, number>;  // cross-model scores
  judgments?: JudgmentResult[];       // Claude 종합 판단
  judgments_timestamp?: string;       // 단일 invalidation timestamp (ISO)
  reviewer_status?: Record<string, 'completed' | 'failed' | 'skipped'>;
  conflicts?: ConflictItem[];         // 충돌 항목
  waivers?: WaiverItem[];             // 면제 항목
}
```

### 마이그레이션 규칙

- 신규 필드가 없는 기존 state file: 해당 필드를 빈 값(`{}` 또는 `[]`)으로 초기화하고 리뷰를 처음부터 실행
- Resume 시 검증: `review_results.{phase}.judgments_timestamp`가 존재하면, 대응하는 문서(`research.md` 또는 `plan.md`)의 최종 수정 시각과 비교
  - 문서가 judgments_timestamp 이후 수정됨 → judgments 무효화, 리뷰 재실행
  - 일치 → 기존 judgments 재사용
