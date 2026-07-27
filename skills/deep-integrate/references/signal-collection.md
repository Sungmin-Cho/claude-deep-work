# Phase 5 signal collection (§3-1)

> Reference for `skills/deep-integrate/SKILL.md`. The detect-plugins + gather-signals invocation, the absolute-path expansion rule that phase-guard enforces, and the `--plugins-file` / `--loop-file` options that replace `$(cat ...)` substitution.

---

### 3-1. 감지 & 수집

**중요**: Phase 5 mode의 phase-guard는 Bash 쓰기 대상 경로를 snapshot된 `$WORK_DIR` 절대경로와 대조한다. LLM이 아래 예제를 실행할 때는 반드시 **변수 확장된 절대 경로**로 쓰기 리다이렉트를 수행해야 하며, `"$WORK_DIR/..."` 같은 literal 문자열이나 `$(...)` command substitution은 **phase-guard에서 block**된다. 즉 LLM은 state에서 `work_dir`을 먼저 읽어 `WORK_DIR_ABS="$PROJECT_ROOT/$WORK_DIR_REL"` 식으로 expanded 후 명령 문자열을 구성한다. `$(cat ...)` 같은 substitution 대신 **`--plugins-file` / `--loop-file` 옵션**을 사용하여 파일 경로를 직접 전달한다.

```bash
# 아래는 LLM이 변수 치환 후 최종 구성할 예시 형태 (실제 실행 시 절대 경로로 확장):
bash skills/deep-integrate/detect-plugins.sh > /abs/path/to/.deep-work/<sid>/tmp-plugins.json
# SKILL이 resolve한 SESSION_ID를 env var로 명시 전달
# 임시 파일을 세션 디렉토리 안에 두어 디버깅/재현성 향상 (세션 종료 시 자동 정리됨)
# --loop-file 옵션으로 integrate-loop.json 경로 전달 — envelope에 `loop` 필드 병합
# --plugins-file 옵션 사용. `$(cat ...)` substitution은 phase-guard가 block.
DEEP_WORK_SESSION_ID=<session-id> \
  bash skills/deep-integrate/gather-signals.sh <abs-project-root> \
    --plugins-file /abs/path/to/.deep-work/<sid>/tmp-plugins.json \
    --loop-file /abs/path/to/.deep-work/<sid>/integrate-loop.json \
  > /abs/path/to/.deep-work/<sid>/tmp-envelope.json
```

두 파일의 생성 여부 확인. 실패 시 "Phase 5 시그널 수집 실패" 경고 + `integrate-loop.json`에 `terminated_by: "error"` 기록. Section 4의 종료 절차는 **스킵**하고 skill을 에러 종료시킨다 — orchestrator가 이 종료를 감지하면 `--skip-integrate`와 함께 `/deep-finish`를 호출하여 state machine을 닫는다. `phase5_completed_at`은 기록하지 않으며, `phase5_entered_at`만 남은 상태는 `--skip-integrate`가 우회한다.

`loop_round += 1` (SKILL이 먼저 반영한 뒤 gather-signals를 호출하므로 envelope의 `loop.round`가 현재 라운드 번호와 일치). `already_executed`는 gather-signals가 `integrate-loop.json`의 `executed[].plugin`에서 자동 추출한다 — SKILL이 별도로 주입할 필요 없음.

