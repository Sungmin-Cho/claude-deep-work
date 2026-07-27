# Phase 5 entry hint and defensive error marker

> Reference for `skills/deep-finish/SKILL.md`. Sections 1a and 1c: the optional Phase 5 Integrate prompt and the defensive `terminated_by: "error"` marker written into integrate-loop.json before Section 2. Read when the session state carries a Phase 5 hint or `--skip-integrate` is absent.

---

### 1a. Phase 5 Integrate 힌트

`$WORK_DIR/integrate-loop.json` 존재 여부 확인:
- 존재 & `terminated_by != null` → 정상 진행 (Section 2로).
- 존재 & `terminated_by == null`:
  - **주의**: `$ARGUMENTS`에 `--skip-integrate` 있음 → prompt 없이 Section 1c로 진행 (orchestrator auto-flow가 질문에 막히지 않도록).
  - `--skip-integrate` 없음 → **Phase 5 루프가 중단된 상태** (Ctrl-C 또는 재진입 대기). AskUserQuestion:

    ```
    ⚠️ Phase 5 Integrate 루프가 중단된 상태입니다.
       (1) /deep-integrate로 재진입 (권장)
       (2) 강제로 건너뛰고 finish 진행 (--skip-integrate 없이도)
    ```
    - (1) 선택 → "exit 후 /deep-integrate 실행하세요" + exit 0.
    - (2) 선택 → 기존 절차 계속.

- 부재 & `$ARGUMENTS`에 `--skip-integrate` 없음 → AskUserQuestion:

  ```
  ℹ️ Phase 5 Integrate를 아직 실행하지 않았습니다.
     `/deep-integrate`로 AI의 다음 단계 추천을 받을 수 있습니다.

     (1) /deep-integrate 먼저 실행 (권장)
     (2) Phase 5 건너뛰고 바로 finish 진행
  ```

- (1) 선택 → "exit 후 /deep-integrate 실행하세요" 안내 + exit 0.
- (2) 선택 → 기존 절차 계속.
- `$ARGUMENTS`에 `--skip-integrate` 있음 → 힌트 스킵하고 바로 Section 2.

### 1c. Phase 5 defensive error marker

`$ARGUMENTS`에 `--skip-integrate`가 있고 Section 1의 분기에서 `phase5_entered_at`이 있으나 `phase5_completed_at`이 없어 이 Section에 도달한 경우에만 실행한다. 이 시점에는 Section 1 말미에서 `$WORK_DIR`가 이미 resolve되었으므로 아래 helper 호출이 유효하다.

**LLM은 아래 명령을 그대로 Bash tool로 단일 호출한다** (compound 연산자·shell metacharacter 없이 단일 명령이어야 Phase 5 guard helper exception 적용, RC4-1/RC5-1):

```bash
bash skills/deep-integrate/phase5-record-error.sh <ABSOLUTE_WORK_DIR>
```

**중요**: Claude Code의 Bash tool은 매 호출마다 새 shell을 spawn하므로 이전 단계에서 export한 `$WORK_DIR` 같은 변수가 persist하지 않는다. LLM은 state file에서 `work_dir`을 먼저 읽어 `<ABSOLUTE_WORK_DIR>` 자리에 실제 절대경로를 치환 후 호출한다. literal `"$WORK_DIR"`를 그대로 전달하면 empty string으로 확장되어 helper가 usage 에러로 fail한다.

또한 helper는 state file의 `phase5_work_dir_snapshot`을 읽어 인자와 일치하는지 검증하므로, 올바른 세션 work_dir이어야 실행된다.

이 helper가 `integrate-loop.json`의 `terminated_by`를 atomically `"error"`로 교체하거나, 파일 부재 시 최소 구조로 생성한다.

`session-end.sh` Stop hook의 `terminated_by=interrupted` 마킹은 여전히 belt-and-suspenders로 남아있어, finish가 실행되지 않고 세션이 Ctrl-C로 종료된 경우에도 evidence가 남는다.

