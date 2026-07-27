# Pre-routing: inline vs delegate execution mode (§1.5)

> Reference for `skills/deep-implement/SKILL.md`. decide_execution_mode, the auto-inline notice, explicit `--exec` override precedence, and what §1.5 persists (`execution_mode`, `delegation_snapshot`).

---

## Section 1.5: Pre-routing — Inline Escape Hatches

Section 1 전체 완료 후 (state 로드 + Plan 파싱 + Slice 파싱 + Resume Detection + 완료-marker 감지가 모두 끝난 뒤), Section 2 First Action 진입 **전에** 실행 모드를 결정한다.

### decide_execution_mode

```
def decide_execution_mode(state, args):
    # B. 명시적 override 우선순위: CLI args > state
    #    예전 버전: `args.exec == "inline" or state.execution_override == "inline"`
    #    → state=inline + CLI=delegate 일 때 state가 이기는 버그.
    #    수정: CLI가 지정된 경우 무조건 CLI가 이긴다.
    if args.exec is not None:       # CLI 명시 → 무조건 우선
        return args.exec            # "inline" or "delegate"
    if state.execution_override is not None:  # state override 있음
        return state.execution_override

    # A. 자동 heuristic (CLI도 state도 없을 때만)
    if state.tdd_mode == "spike":
        return "inline"
    if ("plan" in state.skipped_phases
        and len(plan.slices) == 1
        and plan.slices[0].size == "S"):
        return "inline"

    # 기본
    return "delegate"
```

### 자동 inline 알림

자동 heuristic inline 결정 시 1회 메시지:
```
[auto-inline] tdd_mode=spike — main session에서 구현합니다.
              (subagent 위임을 강제하려면 --exec=delegate 사용)
```

### 명시적 override

- CLI `--exec=<mode>` → state의 `execution_override` 필드 (값: `inline | delegate | null`)
- state.execution_override는 resume 시에도 유지
- **CLI args > state**: resume 시 `/deep-resume --exec=X`가 기존 state 값을 덮어씀

### Section 1.5 출력

Section 2 진입 시 메모리에 보유 + state YAML에 persist:
- `execution_mode`: "inline" | "delegate" (메모리만)
- `delegation_snapshot`: `git rev-parse HEAD` (delegate 모드 진입 직전에 기록)
  — **state YAML에도 `delegation_snapshot: <hash>` 로 Edit tool로 기록**.
  이 persist가 있어야 verify-receipt fail 후 세션이 interrupted 되어도 `/deep-resume`이
  state에서 기준 hash를 읽어 Rollback Protocol을 재표시할 수 있다.
  verify-receipt가 pass하면 Section 2.3 말미에서 `delegation_snapshot: null` 로 clear.

