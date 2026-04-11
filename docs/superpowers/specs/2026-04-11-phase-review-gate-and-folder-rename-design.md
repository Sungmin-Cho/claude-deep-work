# Phase Review Gate & Work Folder Rename — v6.0.2 Design Spec

## Summary

두 가지 변경 사항:

1. **Phase Review Gate**: 모든 Phase(0~3) 종료 시 셀프 리뷰 + 외부 리뷰를 자동 실행하고, 사용자에게 결과를 확인받은 후 다음 단계로 전환
2. **Work Folder Rename**: 사용자 프로젝트에 생성되는 세션 폴더를 `deep-work/` → `.deep-work/`로 변경 (숨김 폴더)

Target version: **v6.0.2**

---

## 1. Phase Review Gate

### 1-1. 문제

- 각 단계 종료 시 셀프/크로스 리뷰가 일관되게 실행되지 않음
- 리뷰가 실행되더라도 사용자 확인 없이 다음 단계로 자동 전환됨
- v5.5에서 Research/Plan에 크로스 모델 리뷰가 정의되어 있지만 실제 동작이 불안정

### 1-2. 해결: 통합 Phase Review Gate

모든 Phase(0 Brainstorm, 1 Research, 2 Plan, 3 Implement) 종료 시 동일한 3단계 리뷰 게이트를 실행한다. Phase 4(Test)는 최종 단계이므로 제외.

### 1-3. 리뷰어 Fallback 체인 (Phase별 분기)

**Phase 0~2 (문서 산출물: brainstorm.md, research.md, plan.md):**

deep-review 플러그인은 코드 diff 리뷰어이므로 문서 Phase에는 사용하지 않는다. 기존 `review-gate.md`의 Structural Review + Adversarial Review 패턴을 활용한다.

```
① codex / gemini CLI 설치 확인
    ├─ 하나 이상 설치됨 → Structural Review + Adversarial Review(codex/gemini) + 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
    └─ 둘 다 미설치 → ②로
        ↓
② 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
```

**Phase 3 (코드 산출물: 구현된 코드 전체):**

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

**deep-review 설치 확인 (Phase 3에서만):**
```bash
ls "$HOME/.claude/plugins/cache/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null || \
  ls "$HOME/.claude/plugins/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null
```

**Opus 서브에이전트 리뷰** (모든 Phase의 Fallback에서 사용):
- Claude Code의 Agent tool로 독립 리뷰 서브에이전트를 직접 스폰 (백그라운드)
- 플러그인 의존 없이, 현재 Phase 산출물과 리뷰 관점을 프롬프트로 전달
- 메인 컨텍스트와 분리된 독립적 평가

### 1-3-1. 실패/타임아웃 처리 (Degraded Mode)

기존 `review-gate.md` Section 3의 Degraded Mode 패턴을 재사용한다:

- **리뷰어 실패 시** (JSON 파싱 실패, timeout 120초 초과, CLI 에러):
  1. 해당 리뷰어를 `failed` 상태로 기록
  2. 나머지 성공한 리뷰어 결과만으로 진행
  3. 사용자에게 degraded 상태 명시 표시:
     ```
     ⚠️ ${reviewer} 리뷰 실패 (${reason}). 나머지 결과만으로 판단합니다.
     ```
- **deep-review 설치됐지만 실패**: Fallback ②로 자동 전환 (codex/gemini + Opus)
- **codex/gemini 중 일부만 성공**: 성공한 리뷰어 결과만 사용, consensus 판정은 2+ 성공 시에만
- **모든 외부 리뷰어 실패**: 셀프 리뷰 + Opus 서브에이전트만으로 진행

### 1-4. 실행 흐름

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

### 1-5. 사용자 확인 UX

기본 표시 (요약):
```
📋 Research 리뷰 완료
  - 리뷰어: deep-review ✅
  - 셀프 리뷰: 1건 발견
  - 외부 리뷰: 2건 발견

  1) 자동 수정 후 진행
  2) 현재 상태로 진행
  3) 상세 보기
```

"상세 보기" 선택 시 → 전체 이슈 목록 펼침 → 항목별 수정/스킵 선택

### 1-6. Phase별 셀프 리뷰 체크리스트

| Phase | 산출물 | 셀프 리뷰 관점 |
|-------|--------|---------------|
| 0 Brainstorm | brainstorm.md | 문제 정의 명확성, 접근법 비교 충실도, 성공 기준 존재 |
| 1 Research | research.md | 아키텍처 분석 완성도, 패턴 식별, 리스크 누락 |
| 2 Plan | plan.md | placeholder 없음, 연구-계획 추적성, 슬라이스 완성도 |
| 3 Implement | 구현 코드 전체 | 계획 충실도, 크로스 슬라이스 일관성, 미구현 항목 |

### 1-7. 상태 추적

state 파일 YAML frontmatter에 `phase_review` 필드 추가:

```yaml
phase_review:
  brainstorm: { reviewed: true, reviewers: ["self", "deep-review"], self_issues: 0, external_issues: 2, resolved: 2 }
  research: { reviewed: true, reviewers: ["self", "opus-subagent"], self_issues: 1, external_issues: 1, resolved: 2 }
  plan: { reviewed: false }
  implement: { reviewed: false }
```

기존 세션 resume 시 `phase_review` 필드가 없으면 빈 객체로 자동 초기화 (v5.5.1 State 스키마 마이그레이션 패턴 재사용).

### 1-8. 기존 리뷰 로직과의 관계

| 기존 로직 | 처리 |
|----------|------|
| Research 크로스 모델 리뷰 (v5.5) | Phase Review Gate로 흡수 |
| Plan 자체 재검토 + 종합 판단 (v5.5) | Phase Review Gate로 흡수 |
| Implement Slice Review | **유지** (per-slice, Phase Review Gate와 별개) |
| Plan 승인 인터랙션 | **유지** (리뷰 게이트 통과 후 승인 요청) |
| `/deep-phase-review` 수동 커맨드 | **통합** — 새 `phase-review-gate.md`를 참조하도록 변경 |
| `references/review-gate.md` | **유지** — Phase 0~2의 Structural/Adversarial Review 프로토콜로 계속 사용. `phase-review-gate.md`가 이를 참조 |

### 1-9. deep-phase-review.md 통합

기존 `commands/deep-phase-review.md`는 `references/review-gate.md`를 참조하여 수동 리뷰를 실행한다. 새 Phase Review Gate와 이원화를 방지하기 위해:

1. `deep-phase-review.md`의 "Load review protocol" 단계에서 새 `references/phase-review-gate.md`도 함께 참조
2. 수동 실행(`/deep-phase-review`)과 자동 게이트(Phase 전환 시)가 **동일한 리뷰어 Fallback 체인**을 사용
3. 수동 실행 시에도 사용자 확인 UX(요약 → 선택지 → 상세) 적용
4. `review_results.{phase}` 대신 `phase_review.{phase}` 상태 필드를 사용하도록 통일

---

## 2. Work Folder Rename

### 2-1. 문제

세션 폴더가 `deep-work/`로 생성되어 사용자 프로젝트 루트가 지저분해짐. `.claude/`, `.git/` 등 도구 설정 폴더 관례와 일치하지 않음.

### 2-2. 변경 내용

| 항목 | Before | After |
|------|--------|-------|
| 세션 폴더 | `deep-work/20260307-jwt-auth/` | `.deep-work/20260307-jwt-auth/` |
| 히스토리 | `deep-work/harness-history/` | `.deep-work/harness-history/` |
| 백로그 | `deep-work/backlog.md` | `.deep-work/backlog.md` |
| Git 브랜치 | `deep-work/jwt-auth` | `deep-work/jwt-auth` **(유지)** |

Git 브랜치명은 변경하지 않는다. 브랜치명에 dot-prefix는 관례에 맞지 않고, `git branch` 목록에서만 보이므로 숨길 필요가 없다.

### 2-3. 수정 대상 파일

> **Note:** `deep-phase-review.md`, `deep-assumptions.md`, `deep-implement.md`, `deep-receipt.md`는 `$WORK_DIR` 변수를 사용하므로 직접 경로 변경 불필요. state 파일의 `work_dir` 값이 변경되면 자동으로 반영됨.

> **Note:** `health/` 디렉토리의 파일들(`dead-export.js`, `health-check.test.js`, `drift.test.js`)은 이미 `.deep-work/` (dot-prefix) 경로를 사용 중. 세션 폴더가 `.deep-work/` 아래로 이동하면 자연스럽게 공존함.

**핵심 로직 (5)**:
- `commands/deep-work.md` — `mkdir -p` 경로, `WORK_DIR` 설정
- `commands/deep-fork.md` — `NEW_WORK_DIR` 경로
- `hooks/scripts/phase-guard.sh` — `"/deep-work/"` 허용 패턴 → `"/.deep-work/"`
- `hooks/scripts/file-tracker.sh` — 동일 패턴 매칭 수정
- `commands/deep-status.md` — `ls -d` 탐색 경로

**커맨드 참조 (5)**:
- `commands/deep-finish.md` — harness-history 경로
- `commands/deep-research.md` — 이전 세션 탐색, backlog 경로
- `commands/deep-plan.md` — backlog 경로
- `commands/deep-report.md` — harness-sessions.jsonl 경로
- `commands/deep-history.md` — find 경로

**테스트 (4)**:
- `hooks/scripts/phase-guard-core.test.js`
- `hooks/scripts/fork-utils.test.js`
- `hooks/scripts/fork-integration.test.js`
- `health/drift/drift.test.js`

**문서 (5)**:
- `skills/deep-work-workflow/SKILL.md` — 예시 경로, Session History 섹션
- `README.md`, `README.ko.md` — 예시 경로
- `CHANGELOG.md`, `CHANGELOG.ko.md` — 기록 참조

### 2-4. 마이그레이션 로직

`/deep-work` 세션 시작 시 (commands/deep-work.md에 추가):

```
1. .deep-work/ 존재 확인
2. deep-work/ 존재 && .deep-work/ 미존재:
   → 활성 worktree 체크: deep-work/ 내부를 참조하는 git worktree가 있는지 확인
     git worktree list | grep "deep-work/"
     → worktree 있으면: 사용자에게 경고 + 수동 처리 안내 (자동 mv 중단)
     → worktree 없으면: 진행
   → 안내: "기존 deep-work/ 폴더를 .deep-work/로 마이그레이션합니다"
   → mv deep-work/ .deep-work/
   → 메타데이터 갱신 (2-5 참조)
3. 둘 다 존재:
   → 사용자에게 질문:
     "deep-work/와 .deep-work/ 폴더가 모두 존재합니다."
     a) deep-work/ 내용을 .deep-work/에 병합 + 메타데이터 갱신
     b) .deep-work/만 사용 (deep-work/ 유지)
     c) 직접 처리
4. .gitignore 처리 (2-6 참조)
```

### 2-5. 마이그레이션 메타데이터 갱신

`mv deep-work/ .deep-work/` 후, 기존 경로를 참조하는 메타데이터를 일괄 갱신한다:

**State 파일** (`.claude/deep-work.*.md`):
```bash
# 모든 state 파일에서 work_dir 경로 치환
for f in .claude/deep-work.*.md; do
  sed -i '' 's|work_dir: deep-work/|work_dir: .deep-work/|g' "$f"
done
```

**세션 히스토리** (`.deep-work/harness-history/harness-sessions.jsonl`):
- JSONL 파일 내 `work_dir` 필드의 `deep-work/` → `.deep-work/` 치환

**Fork 메타데이터** (state 파일 내 `fork_info`, `fork_children`):
- `parent_work_dir`, `work_dir` 필드의 경로 치환

**Current session pointer** (`.claude/deep-work-current-session`):
- 포인터 파일 자체는 세션 ID만 저장하므로 변경 불필요

### 2-6. .gitignore 처리

`.deep-work/` 전체를 무시하면 `health-ignore.json`, `config.json` 등 커밋해야 할 설정 파일도 제외됨. 세션 폴더만 선택적으로 제외한다:

```gitignore
# deep-work 세션 산출물 (날짜-접두사 폴더)
.deep-work/20*/
.deep-work/harness-history/
```

마이그레이션 시 기존 `.gitignore`에 `deep-work/` 항목이 있으면 제거하고 위 패턴으로 교체한다.

---

## 3. 구현 순서

```
Step 1: 폴더 이름 변경 (.deep-work/)
  ├─ 1a. 핵심 로직 파일 경로 변경 (5파일)
  ├─ 1b. 커맨드 참조 파일 경로 변경 (5파일)
  ├─ 1c. 마이그레이션 로직 + 메타데이터 갱신 추가 (commands/deep-work.md)
  ├─ 1d. 테스트 파일 경로 업데이트 (4파일)
  └─ 1e. 테스트 실행 + 검증

Step 2: Phase Review Gate 레퍼런스 작성
  └─ 2a. references/phase-review-gate.md 신규 작성
       - Phase별 분기 Fallback 체인 (Phase 0~2: 문서, Phase 3: 코드)
       - 셀프 리뷰 체크리스트
       - 사용자 확인 UX (요약 → 선택지 → 상세)
       - 실패/타임아웃 Degraded Mode
       - review-gate.md 참조 관계 명시

Step 3: 커맨드별 리뷰 게이트 통합
  ├─ 3a. deep-brainstorm.md — 리뷰 게이트 추가
  ├─ 3b. deep-research.md — 기존 크로스 리뷰 → 게이트 참조로 대체
  ├─ 3c. deep-plan.md — 기존 재검토/종합판단 → 게이트 참조로 대체
  ├─ 3d. deep-implement.md — phase-end 리뷰 게이트 추가
  └─ 3e. deep-phase-review.md — 새 phase-review-gate.md 참조로 통합

Step 4: 상태 스키마 업데이트
  ├─ 4a. state 파일에 phase_review 필드 추가
  ├─ 4b. 기존 review_results → phase_review 마이그레이션 규칙
  └─ 4c. SKILL.md 문서화

Step 5: 문서 업데이트
  ├─ 5a. SKILL.md — Phase Review Gate 설명, 폴더 경로 예시
  ├─ 5b. README.md / README.ko.md
  └─ 5c. CHANGELOG.md / CHANGELOG.ko.md
```

### 신규 파일

- `skills/deep-work-workflow/references/phase-review-gate.md` — 통합 리뷰 게이트 프로토콜

### 수정 파일 (리뷰 게이트 관련)

- `commands/deep-phase-review.md` — 새 프로토콜 참조로 통합
- `skills/deep-work-workflow/references/review-gate.md` — 기존 유지 (Phase 0~2에서 참조)

### 버전

- 현재: v6.0.1
- 변경: **v6.0.2**
