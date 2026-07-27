# Loop exit, edge cases and recursion block

> Reference for `skills/deep-integrate/SKILL.md`. Sections 4-6: terminating the loop and returning to the orchestrator, the edge-case table, and the rule that /deep-integrate must not re-enter itself.

---

## Section 4: 루프 종료 및 복귀

1. `LOOP_FILE` 최종 write (terminated_by 확정).
2. state file 업데이트:
   - `current_phase`는 **`idle` 유지** (Phase 5 진입 시 설정된 값 그대로).
   - `phase5_completed_at` 기록은 **전용 helper로만** 수행 — phase-guard가 일반 Write/Edit에는 state file 쓰기를 차단한다. 호출 시 **command substitution(`$(...)`) 금지** — phase-guard가 shell metacharacter를 block하므로 helper에게 timestamp 인자를 생략하거나 이미 resolve된 literal 값을 전달한다:
     ```bash
     # 권장: helper가 내부에서 timestamp 생성 (phase-guard-friendly)
     DEEP_WORK_SESSION_ID=<session-id> bash skills/deep-integrate/phase5-finalize.sh <abs-path-to-state.md>
     # 또는 literal ISO 8601 값을 미리 생성 후 전달 (LLM이 date를 먼저 read-only Bash로 받고 값 embedding)
     DEEP_WORK_SESSION_ID=<session-id> bash skills/deep-integrate/phase5-finalize.sh <abs-path-to-state.md> 2026-04-19T03:45:00Z
     ```
   - helper는 ISO 8601 형식 검증과 atomic write(awk frontmatter rewrite + mv)를 수행하며 그 외 state file 필드는 건드리지 않는다. `DEEP_WORK_SESSION_ID` env prefix는 `--session=<id>` 재진입 시 helper의 session 검증이 정확히 작동하도록 한다.
   - Task 9의 deep-finish 수정이 "idle + phase5_completed_at 존재"를 "정상 완료"로 해석하도록 연동.
3. 사용자에게 요약 출력:
   ```
   Phase 5 종료 — terminated_by: <reason>
   실행 이력: <N>개
   다음: /deep-finish
   ```

## Section 5: 엣지 케이스 참조

spec 섹션 4.1/4.2의 대응 정책을 그대로 따른다. 주요 지점:
- 아티팩트 파싱 실패 → null fallback (`gather-signals.sh`가 이미 처리)
- LLM JSON 파싱 실패 → 1회 재시도 → B-fallback
- 이미 실행한 플러그인 재추천 → `requires_rerun` 필드 기반 필터링 (정규식은 safety-net)
- envelope 총 크기 > 20KB 예산 → E7 축약 정책 적용 (gather-signals에 미래 확장)
- Ctrl-C / 중단 → Stop hook이 `terminated_by: "interrupted"` 기록 (Task 10 참조)

## Section 6: 재귀 차단

Phase 5는 다른 플러그인을 호출하지만 **다른 플러그인은 Phase 5를 호출하지 않는다** (단방향 원칙). 환경변수·파일 flag 기반 차단 장치는 v1 범위 밖. 만약 미래에 외부가 Phase 5를 호출하는 시나리오가 생기면 `integrate-loop.json`에 `running: true` file flag를 도입 (spec 섹션 4.2 E5).
