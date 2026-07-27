# Workspace, capability and profile-save steps

> Reference for `${CLAUDE_PLUGIN_ROOT}/skills/deep-work-orchestrator/SKILL.md`. §1-5 work-dir creation, §1-6 cross-model tool detection, §1-7 assumption health check, §1-8 git branch/worktree, and §1-10/§1-11 profile save plus the session confirmation display.

---

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

---

## 1-10. 프로필 저장 (첫 실행 시)

프로필 미존재 시 `.claude/deep-work-profile.yaml`에 **v3 형식**으로 저장 (v2 형식 사용 금지). §1-3-2의 migration 단계가 `not-found-created-v3` 응답 시 이미 v3 파일이 생성되므로, 본 단계에서는 §1-4-3 ask 결과를 반영하여 해당 프리셋 defaults를 업데이트한다.

## 1-11. 세션 확인 표시

> **근거 라인 분기**: `MR_OUT.meta.error === true`(CLI 자동 결정 실패 — fail-safe)이면 아래 "근거" 라인 대신
> `근거: 자동 선택 실패 — 전 phase main(현재 세션 모델)로 fallback`을 표시하고 `MR_OUT.warnings`의 사유도 함께 보여준다.
> 정상 meta(`{tiers, scale, signals_summary, difficulty, ...}`)일 때만 아래 scale/tracked_files/difficulty 근거를 표시한다
> (fallback meta는 `{runtime, tiers, error}` 형태뿐이라 `scale`/`signals_summary`/`difficulty`를 참조하면 undefined로 렌더된다.)

```
Deep Work 세션이 시작되었습니다!

작업: $ARGUMENTS
작업 폴더: $WORK_DIR
프리셋: [preset_name]
작업 모드: Solo / Team
TDD 모드: strict / relaxed / coaching / spike
모델 라우팅(자동): R=[model] P=main I=[model] T=[model]
  근거: [meta.scale] 코드베이스([meta.signals_summary.tracked_files] files) · 난이도 [meta.difficulty ?? "기준선"]
  (또는 meta.error === true 시: 근거: 자동 선택 실패 — 전 phase main(현재 세션 모델)로 fallback)
  조정: --model-routing=implement=deep 형식 또는 /deep-slice model

워크플로우:
  Phase 0: deep-brainstorm  [← 현재 / ✅ 건너뜀]
  Phase 1: deep-research
  Phase 2: deep-plan
  Phase 3: deep-implement
  Phase 4: deep-test
  Phase 5: deep-integrate  [skippable]

각 phase 완료 시 진행 확인을 받으며 순차 실행합니다. "다음 phase로 진행" 선택 시 추가 확인 없이 즉시 다음 단계를 시작합니다.
```

