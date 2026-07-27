# verify-receipt and the rollback protocol (§2.3)

> Reference for `skills/deep-implement/SKILL.md`. Running verify-delegated-receipt.sh, the pass path, the fail path (Rollback Protocol AskUserQuestion), partial verify on the inline path, and resume/takeover when delegation_snapshot is non-null.

---

## Section 2.3: verify-receipt + Rollback Protocol

### 전제

모든 slice 완료 직후, Phase Review Gate 진입 **직전** precondition으로 실행한다.
execution_mode에 따라 형태만 달라진다:

- **delegate** (Section 2.1 solo / 2.2 team 완료 후) — 전체 verify.
- **inline** (Section 1.5가 inline을 선택한 경로) — 부분 verify. 아래 §inline 절 참조.

어느 경로도 이 단계를 건너뛰지 않는다.

### verify-delegated-receipt.sh 실행

```bash
state_file=".claude/deep-work.${SESSION_ID}.md"
receipts_dir="${WORK_DIR}/receipts"
plan_path="${WORK_DIR}/plan.md"

bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/verify-delegated-receipt.sh" \
     "$state_file" "$receipts_dir" "$plan_path"
rc=$?
```

### Pass 경로

`rc == 0` → state의 `delegation_snapshot`을 null로 clear (Edit tool로 해당 라인만 교체) → Phase Review Gate 진입 → state 업데이트 → Exit Gate.

### Fail 경로 (§5.6a Rollback Protocol)

`rc != 0` → AskUserQuestion:

```
options = [
  "재위임 (git reset --hard <delegation_snapshot>, receipts 제거 후 재위임)",
  "수동 수정 (rollback 없이 main session이 해당 cluster 인계 — inline takeover)",
  "abort (아무 정리 없이 세션 종료)"
]
```

#### "재위임" 선택 시

hash는 **state YAML에 기록된** `delegation_snapshot`에서 읽고, 롤백은 **guarded route로만**
수행한다. raw `git reset --hard` + 와일드카드 receipt 삭제는 사용하지 않는다 — 그 경로는
스냅샷 검증·divergence 체크·receipt digest 바인딩·lock·journal·retry를 모두 우회한다:

```bash
snapshot_hash=$(awk '/^delegation_snapshot:/ {gsub(/["'\'']/, "", $2); print $2; exit}' "$state_file")
node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" git delegated rollback \
  --state "$state_file" \
  --receipts-dir "${WORK_DIR}/receipts" \
  --snapshot "$snapshot_hash"
```

route는 state의 `delegation_snapshot`이 `--snapshot`과 일치하지 않으면
`delegated-rollback-snapshot`으로 fail-closed하므로, 잘못된 스냅샷으로의 되감기가 차단된다.
worktree 되감기와 receipt 정리는 route 내부에서 lock + journal 하에 함께 처리된다.

그 후 Section 2.1 또는 2.2 경로로 재진입. (새 delegation은 새로 capture한 snapshot을 다시 state에 기록하므로 idempotent.)

#### "수동 수정" 선택 시 (inline takeover)

- `active_cluster_takeover: "<cluster_id>"` state 필드 기록 (중단 후 resume 대비)
- main session이 Solo Slice Loop 로직으로 해당 cluster 구현 (TDD hook 정상)
- 완료 후 `active_cluster_takeover` clear, 다음 cluster는 다시 decide_execution_mode 결과에 따름

#### "abort" 선택 시

세션 종료. state의 `delegation_snapshot`은 **그대로 남긴다** — 그 값이 non-null이면 `/deep-resume` 시 Section 2.3 Resume 분기가 Rollback Protocol AskUserQuestion을 다시 표시한다. 사용자는 worktree 상태를 수동 검토 후 resume 할 수 있다.

(abort가 state를 완전히 clean하게 두면 resume이 verify 결과를 잃어버려 무한 루프에 빠짐 — delegation_snapshot을 pending signal로 유지해 명시적으로 재진입 가능.)

### inline 경로에서의 부분 verify-receipt

Section 1.5 `execution_mode == "inline"` 경로도 Phase Review Gate 직전에 verify-delegated-receipt를 실행하되, **item 1-4만 skip**한다 (item 1-4는 hook이 real-time으로 강제). 나머지 item 5-9는 그대로 평가된다 — item 9(spec-governed evidence 완결성)는 governed slice가 있으면 skip 자체가 거부된다. `verify-delegated-receipt.sh`의 `--skip-items=` 플래그로 호출한다:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/verify-delegated-receipt.sh" \
  --skip-items=1,2,3,4 \
  "$state_file" "$receipts_dir" "$plan_md_path"
```

item 별 역할:
- item 5: out-of-scope 편집 탐지 (hook의 edit 차단 이외 이중 안전망)
- item 6: baseline chain — inline Solo Slice Loop이 `git_before_slice`/`git_after_slice` 기록 필수
- item 7: red_verification_output 기록 필수
- item 8: 기록된 verification_output vs expected_output 비교 (shell 실행 없음)
- item 9: spec-governed slice의 committed evidence 완결성·identity 검증 (skip 불가)

### Resume with `--exec` override 또는 takeover 분기

`/deep-resume` 시 Section 1.5 진입 전에 다음 순서로 체크:

```
# 최우선: delegation_snapshot이 set되어 있고 implement가 미완료 → verify-receipt fail 후 interrupt된 케이스
if state.delegation_snapshot is not null and state.implement_completed_at is null:
    # Rollback Protocol AskUserQuestion을 재표시
    # (재위임 / 수동 수정 / abort 중 선택, §2.3 Fail 경로와 동일)
    re_present_rollback_askuserquestion(state.delegation_snapshot)
    # 사용자 선택에 따라 Section 2.1/2.2 재진입 or inline takeover or abort

elif state.active_cluster_takeover != null:
    # 이전 세션이 debug takeover 도중 중단
    # → 해당 cluster를 inline으로 이어 진행 (TDD hook 정상)
    execute_cluster_inline(state.active_cluster_takeover)
    state.active_cluster_takeover = null  # 완료 후 clear
    # 다음 cluster는 다시 decide_execution_mode에 따름

elif receipts_dir has complete receipts from prior session:
    # 완료된 slice는 item 1-4를 skip한 부분 검증 (이미 수용된 산출물)
    # 미완료 slice만 새 경로(현재 execution_mode)로 실행
    verify-delegated-receipt.sh --skip-items=1,2,3,4 --only-completed
    delegate_or_inline_remaining_slices()
```

구현 세부:
- `--only-completed` 플래그는 `status: "complete"` 인 receipt만 골라 검증한다.
- deep-implement Section 1의 Resume Detection 이 `delegation_snapshot` / `active_cluster_takeover` 필드를 읽어 분기 우선순위 결정.
- `delegation_snapshot`은 delegate 진입 직전에 state에 persist, verify-receipt pass 시 null로 clear. 따라서 resume 시 이 필드가 non-null이면 "fail 후 interrupt" 신호.

