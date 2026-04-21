# Review + Approval Workflow

Research와 Plan phase 완료 후 Orchestrator가 실행하는 6단계 리뷰/승인 프로토콜.

## Step 1: 산출물 로드

- Phase Skill 완료 후, Orchestrator가 산출물(research.md / plan.md)을 Read
- 산출물의 핵심 내용을 context에 확보
- 산출물 경로: `.deep-work/{SESSION_ID}/research.md` 또는 `.deep-work/{SESSION_ID}/plan.md`

## Step 2: Auto Review

병렬로 두 리뷰어를 실행:

1. **Agent(subagent_type="deep-review:code-reviewer")**:
   - 산출물 경로 전달
   - 구조적 리뷰 (누락, 불완전, 모순 검출)

2. **Agent(codex:rescue)** (codex 설치된 경우):
   - 교차 검증 (독립적 관점)
   - codex 미설치 시 skip

두 리뷰어의 findings를 수집한다.

## Step 3: Main 에이전트 판단

Main 에이전트가 모든 findings를 읽고 자체 판단:

- 각 finding에 대해 **동의/비동의** 결정
- 동의 시: 수정 대상으로 분류 + 동의 근거
- 비동의 시: 비동의 근거 기록
- 판단 기준: 산출물의 목적, 현재 task의 맥락, 기술적 타당성

## Step 4: 1차 승인 요청 (수정 항목)

AskUserQuestion으로 사용자에게 제시:

```
리뷰 결과 중 반영이 필요하다고 판단한 항목:

반영 제안:
1. {finding} — (동의 근거)
2. {finding} — (동의 근거)

반영하지 않는 항목:
- {finding} — (비동의 근거)

선택:
1) 전체 승인 — 모든 제안 반영
2) 선택 승인 — 번호 지정
3) 수정 없이 진행
```

## Step 5: 수정 적용

- 사용자가 승인한 항목만 산출물(research.md / plan.md)에 반영
- 수정 후 변경 요약 출력

## Step 6: 2차 승인 요청 (최종 확인 + 다음 phase)

AskUserQuestion으로 사용자에게 제시:

```
수정 완료. 최종 문서를 확인해주세요.
1) 문서 최종 승인
2) 추가 수정 요청
3) 이 phase 재실행
```

- **승인** → 문서 저장 + `*_approved: true` + `*_approved_at` + **`*_approved_hash`** 기록 (Research: `research_approved` / Plan: `plan_approved`) → Orchestrator §3-N Exit Gate로 제어 반환 (v6.3.1 F1: current_phase는 Exit Gate "진행" 선택 시에만 전환)
  - **NC1 규칙**: `*_completed_at` / `*_complete`은 skill Section 3에서 기록하는 marker로 review+approval 이전에 set된다. Resume fast-path의 approval-state 판별 marker로는 `*_approved: true` 만 사용할 것.
  - **NW5 규칙 (integrity hash)**: 승인 시점의 `sha256(${WORK_DIR}/{research,plan}.md)`을 `*_approved_hash`에 기록한다. Resume fast-path는 현재 파일 hash와 비교하여 out-of-band 편집을 감지 — 불일치 시 approval 자동 invalidate + review+approval 재실행.
- **추가 수정** → Step 5로 복귀
- **재실행** → Phase Skill을 `--force-rerun`과 함께 다시 호출 (Step 1로 복귀). **재실행 시 기존 `*_approved`와 `*_approved_at`, `*_approved_hash`를 반드시 clear** — 재승인이 완료될 때까지 Resume fast-path가 stale approval을 재사용하지 않도록 보장 (NC2 + NW5 규칙).

---

## v6.3.1: Exit Gate와의 관계

본 workflow의 Step 6(2차 승인)은 **문서 최종 승인**이다 — "research.md / plan.md 내용이 맞는가?"를 확인한다.

v6.3.1부터 Orchestrator §3는 review-approval workflow 완료 후 별도의 **Phase Exit Gate**를 실행하여 "다음 phase로 진행할지"를 묻는다. 두 질문은 목적이 다르므로 통합하지 않는다:

- Review-Approval Step 6: 문서 콘텐츠 승인 ("이 내용 맞아?")
- Exit Gate: phase 전환 결정 ("다음으로 갈까, 다른 작업을 할까?")

Brainstorm / Implement / Test phase는 review-approval을 쓰지 않지만 Exit Gate는 모두 적용된다. Phase 5 Integrate는 이미 interactive loop이므로 Exit Gate 대상에서 제외.

**state 관리 (F1 Option A)**: Exit Gate "진행" 선택 시에만 Orchestrator가 `current_phase`를 다음 값으로 전환한다. "일시정지" 선택 시 현재 phase 값을 유지하여, `/deep-resume` 호출 시 Exit Gate가 재표시된다.
