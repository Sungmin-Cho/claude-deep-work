---
name: deep-integrate
version: "6.3.0"
description: |
  Phase 5 — Integrate: 설치된 deep-suite 플러그인 상태를 수집하여 AI가 다음 단계를
  추천하고 사용자가 선택·실행하는 대화형 루프. Phase 4(Test) 완료 후 호출되거나
  `/deep-integrate`로 명시적 재진입 가능. `--skip-integrate`로 건너뛸 수 있다.
---

# Phase 5: Integrate — AI 추천 루프

## Section 1: State 로드 및 전환 (필수 — 건너뛰기 금지)

1. **Session resolution** (기존 deep-brainstorm과 동일):
   - `$ARGUMENTS`에 `--session=<id>` 있으면 사용
   - 없으면 `DEEP_WORK_SESSION_ID` env var
   - 없으면 `.claude/deep-work-current-session` pointer
   - 모두 실패 시: "활성 deep-work 세션이 없습니다. `/deep-work`부터 시작하세요." 출력 후 종료(exit 1)

2. **State file 경로**: `.claude/deep-work.${SESSION_ID}.md`
   - 파일 부재 시: 동일 에러 메시지 + 종료
   - `current_phase` 읽기. `test` 또는 `idle`이 아니면 경고 후 선택:
     - `current_phase == "implement"` 등 → AskUserQuestion "Phase 4 Test를 완료하지 않았습니다. 계속 진행할까요?"
     - 사용자 취소 → 종료

3. **WORK_DIR 해석**: state file의 `work_dir` frontmatter 필드 (project-root 기준 상대 경로)
   - `WORK_DIR="${PROJECT_ROOT}/$(read_frontmatter_field $STATE_FILE work_dir)"`

4. **Skip 분기**: `$ARGUMENTS`에 `--skip-integrate` 있으면
   - `current_phase: test` 유지 (변경 없음)
   - orchestrator에게 즉시 반환 → `/deep-finish`로 진행

5. **Phase 5 진입 기록** (C5 fix — `finished` 신규 state 도입 폐기):
   - state file의 `current_phase`를 **`idle`**로 전환 (phase-guard.sh의 idle fast-path 활용)
   - `phase5_entered_at: $(date -u +%FT%TZ)` 필드 추가
   - Phase 5 종료 시 `current_phase`는 **`idle` 유지**하고 `phase5_completed_at` 필드로 완료 신호 전달. 새 `finished` state는 기존 state machine과 충돌하므로 도입하지 않음.

## Section 2: Loop state 초기화 또는 재개

1. `LOOP_FILE="$WORK_DIR/integrate-loop.json"` 설정
2. 파일 존재 시 (재진입):
   - Read → `terminated_by` 확인
   - `null`이면 AskUserQuestion: "이전 Phase 5 루프가 중단되었습니다. (1) 이어서 (2) 처음부터 (3) skip"
   - `"interrupted"`이면 동일 질문
   - `"user-finish"`, `"max-rounds"`, `"no-more-recommendations"` 이면: "이전 루프는 종료됐습니다. 새 루프를 시작할까요?" (yes면 새로 작성)
3. 파일 부재 또는 "처음부터" 선택 시: 다음 초기 상태로 작성

   ```json
   {
     "session_id": "<SESSION_ID>",
     "work_dir": "<work_dir slug>",
     "entered_at": "<ISO 8601>",
     "loop_round": 0,
     "max_rounds": 5,
     "executed": [],
     "last_recommendations": null,
     "terminated_by": null
   }
   ```

## Section 3: 루프 Body (반복)

각 라운드마다 다음을 순차 수행.

### 3-1. 감지 & 수집

```bash
bash skills/deep-integrate/detect-plugins.sh > "$WORK_DIR/tmp-plugins.json"
# W2 fix: SKILL이 resolve한 SESSION_ID를 env var로 명시 전달
# (--session=<id>, env var, pointer 3-source 중 SKILL이 선택한 것을 script가 우선 사용)
# N19 fix: 임시 파일을 세션 디렉토리 안에 두어 디버깅/재현성 향상 (세션 종료 시 자동 정리됨)
DEEP_WORK_SESSION_ID="$SESSION_ID" \
  bash skills/deep-integrate/gather-signals.sh "$PROJECT_ROOT" "$(cat "$WORK_DIR/tmp-plugins.json")" \
  > "$WORK_DIR/tmp-envelope.json"
```

두 파일의 생성 여부 확인. 실패 시 "Phase 5 시그널 수집 실패" 경고 + 종료(`terminated_by: "error"`).

`loop_round += 1`. `already_executed = executed[].plugin`으로 envelope에 주입.

### 3-2. LLM 추천 요청

Claude 에이전트에게 다음 프롬프트로 요청 (Agent tool `subagent_type: general-purpose`로 호출 — signal envelope를 LLM 프롬프트로 전달하고 JSON 응답을 받는 단순 추론용이므로 특화 에이전트 불필요):

```
당신은 deep-suite 플러그인 워크플로우의 "다음 단계 추천자"다.
다음 signal envelope를 보고 최대 3개의 추천을 JSON으로 반환한다.

[envelope JSON 삽입]

규칙:
- recommendations는 0-3개. rank는 1..N 연속 정수.
- plugin은 plugins.installed 중에서만 선택 (deep-work 제외).
- 이미 loop.already_executed에 있는 plugin은 requires_rerun=true인 경우에만 재추천.
- rationale은 10자 이상, 구체적 신호 인용 (예: "changes.categories.docs=1").
- 강한 신호(recurring-findings >= 3 등)가 있는데 plugin이 plugins.missing에 있으면
  installation_suggestions에 1건 추가.
- 변경이 없고(session.changes.files_changed == 0) recurring findings도 없으면
  finish_recommended=true.

출력 스키마:
<skills/deep-integrate/schema/llm-output.json 첨부>

반드시 위 스키마를 준수하는 JSON만 반환. 설명 문장·마크다운 코드블록 감싸기 금지.
```

응답 파싱:
- JSON 파싱 성공 → **runtime 검증** (W7 fix, JSON Schema로 표현 불가):
  - `recommendations` 배열의 `rank`가 **정확히 {1, 2, …, N}** 집합인지 확인
  - 위반 시 재시도 요청 — "rank가 1..N 연속 집합이어야 합니다. 받은 값: `[…]`. 다시 생성하세요."
- 모두 통과 → Section 3-3로
- JSON 파싱 실패 또는 rank 검증 실패 → 1회 재시도 (프롬프트에 "ONLY RAW JSON, NO MARKDOWN + rank must be 1..N contiguous" 강조)
- 2회 실패 → Section 3-4 B-fallback

### 3-3. 렌더링 및 사용자 선택

```
━━━━━━━━━━ Phase 5: Integrate (round <N>/5) ━━━━━━━━━━

세션 요약: <session_summary>

추천:
  1. <command> <args>  — <rationale>
  2. ...
  3. ...

(설치 권장 있으면) 💡 Install suggestions:
  - <plugin> — <rationale>

선택: [1] [2] [3] [기타] [skip] [finish]
```

`AskUserQuestion`로 선택 수집. 각 분기:
- 1/2/3 → 해당 recommendation을 실행 (Section 3-5)
- 기타 → AskUserQuestion 자유 입력, `plugin/command/args` 직접 수집 후 실행
- skip → 이 라운드는 건너뜀. `loop_round`는 증가(예산 소비)하고 `executed[]`에 `{plugin:"(skip)", command:"(skip)", args:"", at:"<ISO>", outcome:"skipped", notes:null}` 항목 추가. 다음 라운드로 진행.
- finish → `terminated_by: "user-finish"` 기록 후 Section 4

### 3-4. B-fallback (LLM 실패 시)

```
자연어 추천 3개를 단순 규칙으로 표시:
  1. /deep-review (세션에 충분한 코드 변경 있음)
  2. /deep-docs scan (CLAUDE.md/README.md 변경 시)
  3. /wiki-ingest <work_dir> (세션 규모가 중간 이상일 때)

"자동 ranking 실패 — 수동 선택:" 메시지 출력.
```

### 3-5. 선택된 커맨드 실행 및 이력 기록 (W6 fix — v1 UX 결정 명시)

**V1 정책 — optimistic 기록**

SKILL은 out-of-process 플러그인의 완료/실패를 직접 관찰할 수 없다. 따라서:
- **사용자 선택 직후**에 `executed[]`에 optimistic 기록 (outcome 기본 `"completed"`).
- 실제 실패·스킵은 **재진입 시 추가 질문**으로 확인하여 outcome 업데이트.
- V2에서는 플러그인 완료 hook으로 자동 outcome 감지 고려 (spec 섹션 7).

**단계**:

1. 명령어를 Claude Code에 전달 (사용자가 직접 `/command` 입력 대신, 스킬이 AskUserQuestion으로 "이 명령을 실행하시겠습니까?"라고 확인한 뒤 사용자가 해당 명령어를 수동 입력하는 방식).

   **중요 — v1 단순 경로**: 스킬은 명령어를 "제안"만 하고 실제 실행은 사용자의 다음 슬래시 입력에 맡긴다. Phase 5 내부 자동 dispatch는 v1 범위 밖.

2. **사용자 선택 즉시** `executed[]`에 optimistic 기록:
   ```json
   { "round": <N>, "plugin": "<p>", "command": "<cmd>", "args": "<a>", "at": "<ISO>", "outcome": "completed", "notes": null }
   ```
   - `last_recommendations`에 이번 라운드 추천 저장 (사용자 "다시 보기"용)
   - Loop 파일 write.

3. **재진입 시 직전 라운드 확인**:
   - `executed[]`에 마지막 항목이 있고 `outcome == "completed"`이면, AskUserQuestion:
     "지난 번 `<command>` 실행이 어떻게 됐나요? (1) 성공 (2) 실패 (3) 건너뜀"
   - (1) → 유지, (2) → `outcome: "failed"`, (3) → `outcome: "skipped"` + notes 간단 입력
   - 첫 라운드면 이 단계 스킵.

### 3-6. 종료 조건 체크

다음 중 하나면 Section 4로:
- `terminated_by != null`
- `loop_round >= max_rounds`: `terminated_by: "max-rounds"` 기록
- LLM이 `recommendations: []` + `finish_recommended: true`: `terminated_by: "no-more-recommendations"` 기록

아니면 Section 3-1로 돌아가 다음 라운드.

## Section 4: 루프 종료 및 복귀

1. `LOOP_FILE` 최종 write (terminated_by 확정).
2. state file 업데이트 (C5 fix):
   - `current_phase`는 **`idle` 유지** (Phase 5 진입 시 설정된 값 그대로).
   - `phase5_completed_at: $(date -u +%FT%TZ)` 필드 기록.
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
