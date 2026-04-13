---
name: deep-work-orchestrator
version: "6.1.0"
description: "Evidence-Driven Development — session initialization + auto-flow orchestration"
---

# Step 1: 세션 초기화

사용자 입력: **$ARGUMENTS**

## 1-1. Update Check

SessionStart hook의 update-check.sh 출력 처리:
- `JUST_UPGRADED` → 업그레이드 완료 메시지, 계속 진행
- `UPGRADE_AVAILABLE` → 프로필 `auto_update` 확인 → 자동 또는 AskUserQuestion으로 업그레이드 제안

## 1-2. 기존 세션 확인 (Multi-Session)

### Legacy 마이그레이션
`.claude/deep-work.local.md` 존재 + active → `migrate_legacy_state` 실행

### Stale 세션 감지
`detect_stale_sessions` → 각 stale 세션에 대해 AskUserQuestion:
1. 이어서 진행 → state 읽기 + worktree 확인 + artifact 복원 → **Step 3으로 jump**
2. 종료 처리 → idle 설정, registry 해제
3. 무시 → 계속

### Active 세션 목록
Registry에서 활성 세션 표시. 5개 이상이면 경고.

### 세션 ID 생성
```
SESSION_ID=$(generate_session_id)
write_session_pointer "$SESSION_ID"
```

## 1-3. 프로필 로드 + 플래그 파싱

### $ARGUMENTS에서 플래그 추출

| 플래그 | 효과 |
|--------|------|
| `--setup` | 프로필 재설정 강제 |
| `--team` | team_mode → "team" |
| `--zero-base` | project_type → "zero-base" |
| `--skip-research` | start_phase → "plan" |
| `--skip-brainstorm` | brainstorm 건너뜀 |
| `--tdd=MODE` | strict / relaxed / coaching / spike |
| `--skip-review` | review_state → "skipped" |
| `--no-branch` | git_branch → false |
| `--skip-to-implement` | Plan까지 전부 건너뜀, 인라인 slice |
| `--profile=X` | 프리셋 X 직접 선택 |

플래그 제거 후 나머지 = task description. 비어있으면 AskUserQuestion.

### 프로필 로드

`.claude/deep-work-profile.yaml` 존재 시:
1. version 확인 (v1 → v2 자동 마이그레이션)
2. 프리셋 선택: `--profile=X` / 단일 프리셋 → 자동선택 / 복수 → AskUserQuestion
3. 프리셋 필드 → 내부 변수 매핑 (team_mode, project_type, start_phase, tdd_mode, model_routing, notifications, cross_model_preference)
4. 플래그 override 적용 (--team, --zero-base 등이 프리셋보다 우선)
5. 적용된 설정 표시 + "이대로 진행 / 이번 세션만 변경" 선택

프로필 미존재 시: 아래 대화형 설정 진행.

### --setup 사용 시
기존 프로필 존재 → 프리셋 관리 UI (편집/새로 만들기)

## 1-4. 대화형 설정 (프로필 미존재 시)

프로필 로드 성공 시 이 단계 전부 건너뜀.

1. **작업 모드**: Solo / Team → Team 선택 시 Agent Teams 환경변수 확인
2. **모델 라우팅**: 기본값(R=sonnet, P=main, I=sonnet, T=haiku) / 커스텀
3. **알림**: 없음 / 로컬 / 외부 채널 (Slack/Discord/Telegram/Webhook)
4. **프로젝트 타입**: 기존 코드베이스 / 제로베이스
5. **시작 단계**: Brainstorm / Research / Plan
6. **TDD 모드**: strict / coaching / relaxed / spike

## 1-5. 작업 디렉토리 생성

```
mkdir -p .deep-work
TASK_FOLDER="${TIMESTAMP}-${SLUG}"
mkdir -p ".deep-work/${TASK_FOLDER}"
```

Legacy `deep-work/` → `.deep-work/` 마이그레이션 자동 처리.

## 1-6. Cross-model 도구 감지

codex/gemini 설치 여부 확인 → 프로필의 `cross_model_preference`에 따라 자동 활성화 / AskUserQuestion.

## 1-7. Assumption Health Check

세션 히스토리 충분 시 (>=5):
- assumption engine auto-adjust 실행
- 자동 조정 결과 표시 (tdd_mode 등)
- 사용자 --tdd 플래그가 override

## 1-8. Git Branch + Worktree

Git repository인 경우:
- 프로필/플래그에 따라 worktree 격리 / 새 브랜치 / 현재 브랜치 유지
- Worktree 성공 시: `worktree_enabled: true`, `worktree_path`, `worktree_branch` state에 기록
- 이후 모든 파일 작업은 worktree 절대 경로 기준

## 1-9. State 파일 + Registry 생성

`.claude/deep-work.{SESSION_ID}.md` 생성 (YAML frontmatter):
- session_id, current_phase, task_description, work_dir
- team_mode, tdd_mode, model_routing, worktree_*, cross_model_*
- 각 phase timestamp, test_retry_count, max_test_retries 등

Registry 등록: `register_session "$SESSION_ID" ...`

## 1-10. 프로필 저장 (첫 실행 시)

프로필 미존재 시 `.claude/deep-work-profile.yaml`에 v2 형식으로 저장.

## 1-11. 세션 확인 표시

```
Deep Work 세션이 시작되었습니다!

작업: $ARGUMENTS
작업 폴더: $WORK_DIR
프리셋: [preset_name]
작업 모드: Solo / Team
TDD 모드: strict / relaxed / coaching / spike
모델 라우팅: R=[model] P=main I=[model] T=[model]

워크플로우:
  Phase 0: deep-brainstorm  [← 현재 / ✅ 건너뜀]
  Phase 1: deep-research
  Phase 2: deep-plan
  Phase 3: deep-implement
  Phase 4: deep-test

자동 흐름을 시작합니다...
```

# Step 2: 조건 변수 조립

```
ARGS="--session={SESSION_ID}"
if worktree_enabled: ARGS += " --worktree={worktree_path}"
if team_mode=team:   ARGS += " --team"
if cross_model_enabled: ARGS += " --cross-model"
if tdd_mode:         ARGS += " --tdd={tdd_mode}"
```

# Step 3: Auto-flow Dispatch

State의 `current_phase`에서 시작점 결정:
- brainstorm → 3-1 | research → 3-2 | plan → 3-3 | implement → 3-4 | test → 3-5

## 3-1. Brainstorm (skip 가능)

`skipped_phases` / `start_phase` 확인. 건너뛰면 → 3-2.

Skill("deep-brainstorm", args=ARGS)

완료 후 (`current_phase` → research): → 3-2.

## 3-2. Research

Skill("deep-research", args=ARGS)

완료 후: **Review + Approval Workflow 실행.**

Phase Skill 완료 후:
1. 산출물 Read → Auto Review (subagent + codex)
2. Main 에이전트가 findings 판단 → 동의/비동의 분류
3. 1차 승인: 수정 항목을 사용자에게 제시 (AskUserQuestion)
4. 승인된 항목 반영
5. 2차 승인: 최종 문서 확인 + 다음 phase 진행 (AskUserQuestion)
→ 상세: Read("skills/shared/references/review-approval-workflow.md")

승인 → `current_phase: plan` 설정 → 3-3.

## 3-3. Plan

Skill("deep-plan", args=ARGS)

완료 후: **Review + Approval Workflow 실행** (Research와 동일 패턴).
→ 상세: Read("skills/shared/references/review-approval-workflow.md")

승인 → State 업데이트:
- `current_phase: implement`
- `plan_approved: true`
- `plan_approved_at`: current ISO timestamp (drift baseline으로 사용)
→ 3-4.

## 3-4. Implement

Skill("deep-implement", args=ARGS + " --tdd={tdd_mode}")

완료 후 (`current_phase` → test): → 3-5.

> current_phase 변경 주체: Implement Phase Skill이 직접 `test`로 전환.

## 3-5. Test

Skill("deep-test", args=ARGS)

`/deep-test`가 내부적으로 implement-test retry loop 관리 (max 3회).

**All pass** (`test_passed: true`, `current_phase`는 test 유지): → 3-6.
**Retry exhausted**: auto-flow 중단. 사용자 수동 개입.

> current_phase 변경 주체: Test Phase Skill은 `current_phase`를 변경하지 않음. Orchestrator가 finish 후 idle로 전환.

## 3-6. Finish

Read `/deep-finish` → 완료 옵션 제시:
- **Merge**: worktree를 base branch에 merge
- **PR**: GitHub PR 생성
- **Keep**: branch/worktree 유지, 나중에 처리
- **Discard**: branch/worktree 삭제

세션 히스토리 기록 (JSONL), Session Quality Score 계산.

Finish 완료 후: `current_phase: idle` 설정.
Registry 해제: `unregister_session "$SESSION_ID"`.

# current_phase 변경 주체 정리

| Phase | Review | 사용자 승인 | current_phase 변경 주체 |
|-------|--------|------------|----------------------|
| Brainstorm | 선택적 | 불필요 | Phase Skill |
| **Research** | **필수** | **필수** | **Orchestrator** |
| **Plan** | **필수** | **필수** | **Orchestrator** |
| Implement | Phase Review | 불필요 | Phase Skill |
| Test | 자동 | 불필요 | Phase Skill |
