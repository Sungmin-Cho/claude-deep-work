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
1) 승인 — 다음 phase로 진행
2) 추가 수정 요청
3) 이 phase 재실행
```

- **승인** → Orchestrator가 `current_phase` 업데이트 → 다음 Skill 호출
- **추가 수정** → Step 5로 복귀
- **재실행** → Phase Skill을 다시 호출 (Step 1로 복귀)
