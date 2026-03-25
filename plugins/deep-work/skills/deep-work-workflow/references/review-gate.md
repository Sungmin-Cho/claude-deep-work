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
| `testability` | 각 slice에 failing_test와 verification_cmd가 있는가? |
| `rollback_completeness` | 롤백 전략이 구체적이고 실행 가능한가? |
| `risk_coverage` | 리스크가 식별되고 완화 방안이 있는가? |

---

## 3. Adversarial Review Protocol (plan.md only)

### 전제 조건

- Phase가 `plan`일 때만 실행
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

#### 공통 Rubric

각 모델에 동일한 rubric을 제공한다:

| Dimension | 설명 |
|-----------|------|
| `architecture_fit` | 기존 아키텍처/패턴과의 일관성 |
| `assumption_validity` | plan의 가정이 유효한가 |
| `slice_executability` | 각 slice가 독립 실행 가능한가 |
| `risk_coverage` | 리스크와 완화 방안이 충분한가 |
| `alternative_consideration` | 대안이 충분히 검토되었는가 |

#### 프롬프트 지시문

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
3. **그래도 실패 시**: 해당 모델 결과를 건너뛰고, 콘솔에 경고 출력:
   ```
   ⚠️ ${model} 출력을 JSON으로 파싱할 수 없습니다. 해당 모델 리뷰를 건너뜁니다.
      Raw output saved: $WORK_DIR/${model}-raw-output.txt
   ```

### 결과 종합

Claude가 모든 모델 결과를 종합하여 다음을 도출한다:

1. **Consensus** (합의): 모든 리뷰어가 동의하는 이슈
2. **Conflicts** (충돌): 점수 차이 ≥ 3 또는 대립하는 결론이 있는 항목
3. **Waivers** (면제): 사용자가 의도적으로 무시하기로 한 이슈

---

## 4. Conflict Resolution UX

각 conflict에 대해 `AskUserQuestion`으로 4가지 선택지를 제시한다:

```
🔀 Conflict detected on: [dimension / section]

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
📝 plan.md가 수정되었습니다 (${changedSections}개 섹션, ${changedLines}줄 변경).

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
🔄 ${model} 리뷰 실행 중... (예상 30-120초)
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
| Adversarial review JSON | `$WORK_DIR/adversarial-review.json` | 전체 adversarial review 결과 |
| Model raw output | `$WORK_DIR/${model}-raw-output.txt` | JSON 파싱 실패 시 원본 출력 |
