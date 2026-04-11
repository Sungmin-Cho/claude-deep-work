# Phase Review Gate Protocol

## 개요

모든 Phase(0 Brainstorm, 1 Research, 2 Plan, 3 Implement) 종료 시 자동으로 실행되는 통합 리뷰 게이트.
Phase 4(Test)는 최종 단계이므로 제외.

이 프로토콜은 각 커맨드 파일의 Phase 전환 시점에서 참조된다.
수동 리뷰(`/deep-phase-review`)도 이 프로토콜을 사용한다.

---

## 1. 리뷰어 Fallback 체인

### Phase 0~2 (문서 산출물: brainstorm.md, research.md, plan.md)

deep-review 플러그인은 코드 diff 리뷰어이므로 문서 Phase에는 사용하지 않는다.
기존 `review-gate.md`의 Structural Review + Adversarial Review 패턴을 활용한다.

```
① codex / gemini CLI 설치 확인
    ├─ 하나 이상 설치됨 → Structural Review + Adversarial Review(codex/gemini)
    │                     + 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
    └─ 둘 다 미설치 → ②로
        ↓
② 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
```

**Structural Review + Adversarial Review:**
기존 `review-gate.md`의 프로토콜을 그대로 따른다:
- Structural Review: `review-gate.md` Section 1-2 참조
- Adversarial Review: `review-gate.md` Section 3 참조 (codex/gemini CLI 필요)

### Phase 3 (코드 산출물: 구현된 코드 전체)

```
① deep-review 플러그인 설치 확인
    ├─ 설치됨 → deep-review + 셀프 리뷰 (병렬)
    └─ 미설치 → ②로
        ↓
② codex / gemini CLI 설치 확인
    ├─ 하나 이상 설치됨 → 크로스 모델 리뷰 + 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
    └─ 둘 다 미설치 → ③으로
        ↓
③ 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
```

**deep-review 설치 확인:**
```bash
ls "$HOME/.claude/plugins/cache/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null || \
  ls "$HOME/.claude/plugins/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null
```

설치됨: `/deep-review` 실행 (Agent subagent, 백그라운드)
미설치: 다음 fallback으로 진행

---

## 2. Opus 서브에이전트 리뷰

Claude Code의 Agent tool로 독립 리뷰 서브에이전트를 직접 스폰한다 (백그라운드).
플러그인 의존 없이, 현재 Phase 산출물과 리뷰 관점을 프롬프트로 전달한다.

**스폰 방법:**
```
Agent({
  description: "Phase review - ${phase}",
  model: "opus",
  run_in_background: true,
  prompt: "${phase_document} 를 독립적으로 리뷰해줘.
    관점: ${review_checklist}
    이슈 목록을 severity(high/medium/low)와 함께 반환.
    200단어 이내로 간결하게."
})
```

---

## 3. 셀프 리뷰 체크리스트

Phase별로 Claude가 직접 산출물을 재검토한다:

| Phase | 산출물 | 셀프 리뷰 관점 |
|-------|--------|---------------|
| 0 Brainstorm | brainstorm.md | 문제 정의 명확성, 접근법 비교 충실도, 성공 기준 존재 |
| 1 Research | research.md | 아키텍처 분석 완성도, 패턴 식별, 리스크 누락 |
| 2 Plan | plan.md | placeholder 없음, 연구-계획 추적성, 슬라이스 완성도 |
| 3 Implement | 구현 코드 전체 | 계획 충실도, 크로스 슬라이스 일관성, 미구현 항목 |

---

## 4. 실행 흐름

```
Phase 작업 완료
    ↓
① Fallback 체인에 따라 리뷰어 결정 + 실행 (병렬)
    ↓
② 리뷰 결과 종합 요약 생성
    ↓
③ 사용자에게 결과 제시 + 선택지
    ├─ "자동 수정 후 진행" → 이슈 자동 수정 → 다음 Phase
    ├─ "현재 상태로 진행" → 수정 없이 다음 Phase
    └─ "상세 보기" → 전체 이슈 목록 → 항목별 수정/스킵 → 다음 Phase
```

---

## 5. 사용자 확인 UX

### 기본 표시 (요약)

```
📋 ${Phase} 리뷰 완료
  - 리뷰어: ${reviewer_list}
  - 셀프 리뷰: ${self_count}건 발견
  - 외부 리뷰: ${external_count}건 발견

  1) 자동 수정 후 진행
  2) 현재 상태로 진행
  3) 상세 보기
```

### "상세 보기" 선택 시

전체 이슈 목록을 펼쳐서 표시한다:

```
📋 ${Phase} 리뷰 상세

셀프 리뷰:
  [S-1] ${severity}: ${description}
  [S-2] ${severity}: ${description}

외부 리뷰 (${reviewer}):
  [E-1] ${severity}: ${description}
  [E-2] ${severity}: ${description}

각 항목에 대해 (수정/스킵):
```

AskUserQuestion으로 항목별 수정/스킵을 선택받은 후 수정 진행.

---

## 6. 실패/타임아웃 처리 (Degraded Mode)

기존 `review-gate.md` Section 3의 Degraded Mode 패턴을 재사용한다:

- **리뷰어 실패 시** (JSON 파싱 실패, timeout 120초 초과, CLI 에러):
  1. 해당 리뷰어를 `failed` 상태로 기록
  2. 나머지 성공한 리뷰어 결과만으로 진행
  3. 사용자에게 degraded 상태 명시 표시:
     ```
     ⚠️ ${reviewer} 리뷰 실패 (${reason}). 나머지 결과만으로 판단합니다.
     ```

- **deep-review 설치됐지만 실패**: Fallback ②로 자동 전환 (codex/gemini + Opus)
- **codex/gemini 중 일부만 성공**: 성공한 리뷰어 결과만 사용
- **모든 외부 리뷰어 실패**: 셀프 리뷰 + Opus 서브에이전트만으로 진행

---

## 7. 상태 추적

state 파일 YAML frontmatter에 `phase_review` 필드를 추가/업데이트한다:

```yaml
phase_review:
  ${phase}:
    reviewed: true
    reviewers: ["self", "opus-subagent"]  # 또는 ["self", "deep-review"], ["self", "codex", "opus-subagent"] 등
    self_issues: 1
    external_issues: 2
    resolved: 3
```

기존 세션 resume 시 `phase_review` 필드가 없으면 빈 객체 `{}` 로 자동 초기화한다.

기존 `review_results.{phase}` 필드가 있는 경우:
- `phase_review.{phase}.reviewed: true` 로 마이그레이션
- `review_results` 필드는 하위 호환성을 위해 유지 (읽기만, 신규 쓰기는 `phase_review`로)
