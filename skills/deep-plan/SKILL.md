---
name: deep-plan
description: "This skill should be used at Phase 2 of deep-work, after research.md approval, to design a detailed implementation plan with TDD slices. Decomposes work into SLICE-NNN units with `depends_on` DAG, acceptance contracts (`failing_test`, `acceptance_threshold`), and optional `cluster_id` hint for parallel-safe grouping. Emits plan.md with the inline slice DAG (Implement Phase's deep-implement skill parses it for worker fan-out — no external slices.md/slice-graph.json is emitted). Triggered by 'create implementation plan', '계획 수립', /deep-plan slash, cross-platform Skill({ skill: \"deep-work:deep-plan\", args: \"...\" }), or orchestrator dispatch after research approval."
user-invocable: true
---

> [!IMPORTANT]
> **Skill body echo 금지**
>
> 이 SKILL.md 본문을 사용자에게 echo하거나 요약하여 출력하지 마라.
>
> - Section 1 (state 로드, Prerequisites research.md Read, 완료-marker 감지)는 silent 내부 처리. user-facing 주 동작은 Section 2의 **First Action: slice 설계 개시 선언**.
> - Section 3 완료 메시지는 plan.md 작성, Completeness Policy 검증, Phase Review Gate를 **실제로 수행**한 뒤에만 출력.
> - 본 문서 내 code block은 지침/예시이다. 응답으로 출력하지 마라.

# Section 1: State 로드 (필수 — 건너뛰기 금지)

1. Session ID 결정
   - $ARGUMENTS에 --session=ID → 사용
   - 없으면 → .claude/deep-work-sessions.json에서 active session 탐색
2. State 파일 읽기: `.claude/deep-work.{SESSION_ID}.md`
3. 조건 변수 확인:
   - worktree_path — $ARGUMENTS 우선, 없으면 state에서
   - team_mode — $ARGUMENTS 우선, 없으면 state에서 (없으면 solo)
   - cross_model — $ARGUMENTS 우선, 없으면 state에서
4. `work_dir`, `project_type`, `team_mode` 추출 → `$WORK_DIR` 설정 (기본: deep-work)
5. `current_phase`가 "plan"이고 `research_complete`가 true인지 확인
6. `plan_started_at` 기록 (ISO timestamp)

## 완료-Marker 감지 (resume 경로 — F1, NW5)

`plan_approved: true` 필드가 state에 이미 있고 `$ARGUMENTS`에 `--force-rerun`이 없으면 paused-after-approval 복귀 후보 경로이다. 단, Orchestrator §3-3가 이미 integrity check(sha256 비교)를 수행하여 stale approval 시 skill을 직접 재호출하므로, 본 branch는 정상 dispatch 경로에서만 도달:
- "Phase 2 (Plan)은 이미 승인·완료되었습니다. Exit Gate를 재표시합니다." 출력
- Orchestrator §3-3으로 제어 반환 (review+approval 거치지 않고 바로 Exit Gate 재실행)
- Section 2/3 진입 금지

**중요 (NW5)**: Resume fast-path의 integrity check(`plan_approved_hash` 비교)는 Orchestrator §3-3가 우선 담당. 본 branch는 `plan_approved: true`만 감지하나, Orchestrator가 hash 불일치 감지 시 approval invalidate + skill 재호출로 우회됨.

## Prerequisites 로드

1. Read `$WORK_DIR/research.md` — 주 참조
2. Team 모드 시 보조 참조 (존재하면):
   - `$WORK_DIR/research-architecture.md`
   - `$WORK_DIR/research-patterns.md`
   - `$WORK_DIR/research-dependencies.md`

## Critical Constraints

- DO NOT implement anything or modify source code files
- ONLY plan and document in `$WORK_DIR/`

# Section 2: Phase 실행

## First Action (즉시 실행 — 건너뛰기 금지)

Section 1 state 로드, Prerequisites research.md Read, 완료-marker 감지가 모두 silent하게 끝난 뒤 **즉시** 다음 메시지를 출력한다:

> "Plan 단계를 시작합니다. research.md를 기반으로 slice를 설계합니다."

이어서 Pre-steps (backup / template 로드 / 사용자 피드백 확인) → plan.md 작성 순으로 연속 진행. "시작할까요?" 같은 추가 확인 금지.

**금지**: 이 선언과 Pre-steps 진입 전에 template 본문, 완료 메시지, slice 목록을 출력하지 마라.

## Pre-steps

### Backup (iteration_count > 0)
기존 plan.md → `$WORK_DIR/plan.v{iteration_count}.md`로 복사

### Template 제안 (선택적)
Read("../shared/references/plan-templates.md") → 적합 템플릿 확인 → 사용자에게 제안

### 사용자 피드백 확인
기존 plan.md에 `> [!NOTE]`, `<!-- HUMAN: -->`, inline comment가 있으면 반영

## plan.md 작성

상세 작성 가이드: Read("../shared/references/planning-guide.md")

### 문서 구조

**Template 로드 (project_type 분기)**:

- `project_type: existing` → Read `../shared/templates/plan-template-existing.md`
- `project_type: zero-base` → Read `../shared/templates/plan-template-zerobase.md`

둘 중 해당하는 template을 Read하여 구조를 파악한 뒤, Section 2에서 수행한 분석 결과로 placeholder를 전부 치환하고 `$WORK_DIR/plan.md`에 Write.

**Placeholder policy**: `Completeness Policy` (아래 섹션)가 남은 placeholder를 차단한다.

### Slice Format (v4.0 + v6.7 executable steps + v6.6 DAG)

Medium+ spec-governed plans place exactly one `## Spec Contract Binding` JSON
block before the checklist. It records `schema_version: 1`, `mode: strict-spec`,
`created_by_version`, the validated `spec_contract` identity
(`spec_id`, `spec_sha256`, `spec_approved_hash`), and `risk_profile_sha256`.
The plan approval runtime is the sole producer of the derived `plan.json`.

각 slice는 `- [ ] SLICE-NNN` 형식을 유지하는 자기 완결적 TDD 단위이며, 아래 필드는 `cluster_id`를 제외하고 모두 필수이다. `cluster_id`는 optional parallel-safe grouping hint로 유지한다:
```markdown
- [ ] SLICE-NNN: [Goal]
  - outcome: [independently observable vertical result]
  - files: [exact/file/path.ext, exact/test/path.test.ext]
  - failing_test: [exact test file/path — expected failing signal before implementation]
  - verification_cmd: [exact command]
  - expected_output: [exact success output fragment]
  - depends_on: [SLICE-MMM, ...]       # DAG edge. 빈 배열이면 root.
  - integration_touchpoints: [CLI, state-store]
  - requirements: [REQ-NNN]
  - invariants: [INV-NNN]
  - failure_modes: [FM-NNN]
  - risk: { class: medium, score: 6, triggers: [state-machine] }
  - negative_tests: [NEG-NNN]
  - evidence_required: [GATE-targeted-tests, GATE-negative-tests]
  - rollback: { method: revert-slice, verification: [GATE-recovery] }
  - review_policy: deterministic/single/dual
  - scope_expansion_trigger: [public API change, new persistent field]
  - cluster_id: <optional — C1|C2|...> # parallel-safe grouping hint (선택)
  - code_sketch: [function signature, pseudocode, or boundary sketch]
  - spec_checklist: [req1, req2]
  - contract: [testable criterion 1, criterion 2]
  - acceptance_threshold: all
  - size: S/M/L
  - steps:
    1. [exact file path] [code sketch or function signature detail]
    2. [exact file path] [verification step]
```

**Size별 상세도 (steps required):**
- S: 2-4 steps
- M: 3-7 steps
- L: 5-12 steps

모든 `steps` 항목은 실행 가능한 작업이어야 한다. 특히 code-changing step은 수정할 exact file path를 명시하고, code sketch 또는 function signature 수준의 구현 세부를 포함한다. L이 12 steps를 초과하면 slice를 분할한다.

### Slice DAG — Implement Phase contract

`depends_on`과 `cluster_id`는 deep-implement skill이 worker fan-out 시 읽는 contract이다.

- **`depends_on: [SLICE-MMM, ...]`** — slice 간 DAG edge 정의. 빈 배열이면 root slice (다른 slice 의존 없이 즉시 시작 가능). DAG는 plan.md 단일 파일에 인라인으로 표현되며, **별도 `slices.md` 또는 `slice-graph.json` 산출물은 emit하지 않는다.** Implement Phase의 deep-implement skill (§Section 1)이 plan.md를 파싱해 DAG를 in-memory로 재구성한다.
- **`cluster_id`** — parallel-safe grouping의 hint. deep-plan은 선택적으로 명시할 수 있으나, **권한적 cluster 결정은 deep-implement이 수행한다** (project size, team_mode, slice 의존성 위상에 따라 동적 grouping; `agents/implement-slice-worker.md`가 worker invocation 시 `cluster_id` + `cluster_ids` prompt 인자를 받음).
- **Circular dependency 금지** — A → B → A 형태의 사이클은 plan 실패로 처리한다 (Completeness Policy 차단 대상). 같은 cluster 내 slice는 동일 cluster_id를 공유해야 한다.
- **외부 산출물 없음 정책** — deep-plan은 plan.md만 emit한다. slice 목록이 별도 파일로 필요한 경우 deep-implement이 plan.md 파싱 결과를 in-memory로 보유하거나 receipt provenance에 기록한다.

### Completeness Policy (v5.8)

**금지 패턴** — 최종 plan.md에 아래가 남으면 plan 실패:
`TBD`, `TODO`, `FIXME`, `PLACEHOLDER`, `implement later`,
`Add appropriate error handling` (구체적 케이스 없이),
`Write tests for the above` (구체적 test path/assertion 없이),
`Similar to SLICE-N` (세부 반복 필수), `...`, `[etc.]`,
빈 섹션, 정의되지 않은 타입/함수 참조,
`failing_test` 안에 expected failing signal 누락,
`expected_output` 안에 exact output fragment 누락,
**slice DAG circular dependency** (A → B → A 또는 자기 참조).

해결 불가 시 → Open Questions로 이동.

## Contract Negotiation (v5.1)

모든 S/M/L slice의 contract 필드를 Agent(contract-validator)로 검증:
- 모호성, 테스트 불가, 누락된 엣지 케이스 검출
- Auto-fix + 재검증 (최대 2회)

## Plan Diff (iteration_count > 0)

이전 버전과 구조적 비교 → `$WORK_DIR/plan-diff.md` 작성:
추가/수정/삭제 태스크, 파일 영향 변경, 아키텍처 결정 변경, 리스크 수준 변경

## Phase Review Gate

Read("../shared/references/phase-review-gate.md") — 프로토콜 실행:
- Phase: plan
- Document: `$WORK_DIR/plan.md`
- Self-review checklist: placeholder 없음, 연구-계획 추적성, 슬라이스 완성도

사용자 확인 결과:
- 옵션 1 (동의) → 수정 후 Section 3으로
- 옵션 2 (항목별 조정) → 개별 처리 후 Section 3으로
- 옵션 3 (전부 스킵) → plan.md 그대로 Section 3으로

수정 규모별 re-review: 3+ 섹션 → full, 1-2 섹션 → structural only, <50줄 → skip. 최대 2회.

# Section 3: 완료

> **실행 순서 안전장치**: 이 섹션은 Section 2의 plan.md 작성, Completeness Policy 검증, Contract Negotiation, Phase Review Gate를 **모두 실제로 수행**한 뒤에만 실행한다. 주 단계를 건너뛰고 완료 메시지만 출력하는 것은 실패 모드이다.

## State 업데이트

- `review_state: completed`
- `phase_review.plan` + `review_results.plan` 업데이트
- `plan_completed_at`: ISO timestamp

### Slice risk projection (v6.13 strict binding; legacy shadow compatibility)

plan.md 작성 완료 직후 slice별 위험도를 계산한다. strict-spec plan은 계산된
class/score/triggers를 각 slice의 `risk` 필드에 투영하고 approval 전에
`slice_risk_shadow_json`과 exact match시킨다. legacy no-spec plan만 기존
display-only shadow 호환 경로를 사용한다. 실패는 slice 단위 fail-open이지만
strict-spec approval은 불일치 상태에서 fail-closed한다.

먼저 `PROJECT_ROOT="$(git -C "$WORK_DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"`를 설정한다 — 이 스킬 컨텍스트에 `PROJECT_ROOT`는 미정의이며, 미설정 시 CLI가 cwd로 fallback해 signals를 오수집한다 (Task 7 리뷰 W1과 동일 처방). 입력 파일은 `RISK_IN=$(mktemp)`로 만들고 각 호출 후 `rm -f "$RISK_IN"` 한다.

각 SLICE-NNN에 대해:
1. 입력 JSON: `{"task_text": "<slice 제목+outcome+steps 요약>", "slice_id": "SLICE-NNN", "evidence": {"changed_paths": <slice files 목록>, "keywords": [], "side_effects": [], "evidence_refs": []}}`
2. `RISK_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/risk-profile-cli.js" --stage slice --root "$PROJECT_ROOT" --work-dir "$WORK_DIR" --input-file "$RISK_IN")`로 출력을 캡처
3. 성공: `slice_risk_shadow_json`의 해당 키에 `{class: RISK_OUT.risk_profile.class, score: RISK_OUT.risk_profile.score, triggers: RISK_OUT.risk_profile.hard_triggers의 id 목록, rationale: RISK_OUT.risk_profile.rationale, input_ref: RISK_OUT.input_ref}` 기록 — `input_ref`는 risk_profile 내부가 아니라 **top-level RISK_OUT.input_ref**다 (CLI 출력 계약). (기존 JSON 병합 재기록)
4. 실패: `risk_profile_json`이 아직 없으면(예: v6.11 이전에 생성된 legacy/resume 세션 — v6.11 orchestrator는 init 시 §1-8.6이 provisional을 항상 기록) `{"schema_version":1,"history":[],"errors":[]}` skeleton을 먼저 생성한 뒤 (§5.1 canonical shape — deep-research/orchestrator writer와 동일 3-key), `risk_profile_json.errors`에 `{stage: "slice", message: "SLICE-NNN: <error>", at}` append — `slice_risk_shadow_json`은 성공한 slice만 보관한다 (스펙 §5.1)

이 기록은 Implement의 모델 소비 연결점이다. deep-implement는 각 slice에서
`sliceModelTierWithRisk(sessionTier, slice.size, slice_risk_shadow_json["SLICE-NNN"].class)`를
호출한다. slice class가 없으면 helper가 기존 `sliceModelTier`와 같은 결과를 내므로 legacy와
fail-open 동작은 보존된다.

`--force-rerun`으로 plan.md가 재작성되면 이 계산도 재수행한다 — 이때 `slice_risk_shadow_json`은 병합이 아니라 **현재 plan.md의 slice 집합만으로 새 객체를 구성해 통째로 교체(replace)** 한다. 제거된 slice의 이전 결과가 유령 항목으로 잔존하면 `/deep-status --risk`가 plan에 없는 slice를 표시하게 된다 (Task 8 리뷰 W1).

**NOTE: `current_phase`를 변경하지 않는다.** Orchestrator가 리뷰+승인 후 변경.

## 완료 메시지

```
구현 계획이 작성되었습니다!
계획서: $WORK_DIR/plan.md
변경 파일: N개 / 신규: N개 / 태스크(slice): N개 / 위험도: Low/Medium/High
Slice DAG: root N개 / 최대 depth N / cluster hint N개

계획이 준비되었습니다. 리뷰해주세요.
```
