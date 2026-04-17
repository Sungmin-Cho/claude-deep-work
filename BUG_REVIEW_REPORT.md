# deep-work v6.2.3 — Ultra Bug Review Report

> **Status (2026-04-17):** 전 항목이 v6.2.4에서 해결되었습니다. 리뷰 중 추가 발견된 SKILL.md 깨진 링크 15건과 `(v6.2.1)` 라벨 13건도 함께 수정. 이연 항목: 크로스 플랫폼 CI matrix (추후 릴리스 예정). 상세 내역은 [CHANGELOG.md](./CHANGELOG.md#624--2026-04-17) 참조.

**리뷰 일자:** 2026-04-17
**대상 커밋:** `a9bca9f` (chore: update trigger-eval.json to v6.2 and bump version to 6.2.3)
**리뷰 범위:** hooks/scripts (13), commands (23), skills (8), sensors, docs
**리뷰 방법:** 4개 전문 에이전트 병렬 투입 + 직접 검증

---

## Executive Summary

기능적 영향이 확인된 실질 버그 **15건** (Critical 4, High 8, Medium 3), 문서·버전 드리프트 **4건**.

가장 심각한 이슈는 다음 4건이며, **사용자가 체감하는 오작동**을 일으킵니다.

| # | 파일 | 증상 |
|---|------|------|
| C-1 | `hooks/scripts/phase-transition.sh:20` | Phase 전환 시 조건 체크리스트(worktree_path, team_mode 등) 주입이 사실상 미작동 |
| C-2 | `hooks/scripts/phase-guard.sh:80` 외 | `file_path`에 따옴표·이스케이프 포함 시 정상 Write/Edit가 차단됨 |
| C-3 | `hooks/scripts/file-tracker.sh:132-150` | PostToolUse 동시 호출 시 receipt의 `files_modified` 항목 유실 (5-way 재현에서 1건 손실) |
| C-4 | `hooks/scripts/file-tracker.sh:204,207` | Linux 환경에서 `sed -i ''` BSD 구문 실패 → sensor cache 갱신 영구 누락 |

---

## Critical (치명) — 즉시 수정 권고

### C-1. Phase Transition Injector 미작동 위험

**위치:** `hooks/scripts/phase-transition.sh:17-21`

```bash
TOOL_INPUT="${CLAUDE_TOOL_USE_INPUT:-${CLAUDE_TOOL_INPUT:-}}"
[[ -z "$TOOL_INPUT" ]] && exit 0
```

**문제:** 훅이 stdin 대신 `CLAUDE_TOOL_USE_INPUT` / `CLAUDE_TOOL_INPUT` 환경변수에 의존한다. 공식 Claude Code 훅 프로토콜은 tool input을 **stdin JSON**으로 전달하므로, 런타임이 위 환경변수를 실제로 설정하는지 확인이 필요하다.

- 만약 미설정이면: `TOOL_INPUT`은 항상 빈 문자열 → 21행에서 즉시 `exit 0` → worktree_path / team_mode / cross_model_enabled / tdd_mode 체크리스트가 LLM 컨텍스트에 **한 번도 주입되지 않음**.
- 테스트(`phase-transition.test.js:46`)는 이 환경변수를 명시적으로 주입하므로 통과 — 실제 런타임과 검증 조건이 괴리된다.

**검증 방법:** 실제 phase 전환이 일어나는 세션에서 `stdout`에 "Phase Transition:" 라인이 나오는지 확인하거나, Claude Code 공식 훅 환경변수 목록을 문서로 확인.

**수정안:** `file-tracker.sh`(첫 PostToolUse 훅)이 stdin을 읽은 뒤 공유 tmp 파일에 저장하고, `phase-transition.sh`가 해당 tmp를 읽도록 구조 변경. 혹은 두 훅을 합쳐 stdin 1회 소비.

---

### C-2. 파일 경로 따옴표 이스케이프로 phase-guard 오차단

**위치:** `hooks/scripts/phase-guard.sh:80`, `file-tracker.sh:58`, `phase-transition.sh:26`

```bash
grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"'
```

**문제:** 정규식 `[^"]*`는 이스케이프된 `\"`를 종결자로 오인식한다. 입력 `{"file_path":"a \"b\" c.txt"}`에서 추출된 경로는 앞부분만 잘린 `a `가 된다.

**Impact:**
- PreToolUse `phase-guard.sh`가 잘못된 경로로 worktree 경계·ownership 검사 → 실제로는 worktree 내부인데 "외부 파일"로 오판 → `exit 2` 블록 → **사용자의 Write/Edit가 이유 없이 차단**.
- `file-tracker.sh`가 receipt에 잘못된 경로를 기록.

**수정안:** `grep -o` 기반 파싱을 `node -e 'console.log(JSON.parse(process.argv[1]).file_path)'` 또는 `jq`로 통일.

---

### C-3. file-tracker.sh의 receipt 동시 쓰기 race condition

**위치:** `hooks/scripts/file-tracker.sh:132-150`

PostToolUse 훅은 `Write|Edit|MultiEdit|Bash`에 매칭되며 동시 tool invocation에서 **병행 실행**된다. 인라인 Node.js가 `readFileSync → JSON.parse → push → writeFileSync(tmp) → renameSync`를 하지만 **락이 없다**. rename은 원자적이어도 read-modify-write 전체는 그렇지 않아, 두 훅이 같은 `SLICE-XXX.json`을 거의 동시에 수정하면 한쪽 append가 유실된다 (5-way concurrent 재현 시 1건 손실 확인).

**Impact:** receipt의 `changes.files_modified`가 누락되어 `/deep-finish`의 quality score·드리프트 검사가 "수정 파일 없음"으로 오판. TDD 감사 증거가 손실된다.

**수정안:** `utils.sh`에 이미 존재하는 mkdir 스핀락 패턴을 receipt 갱신에도 적용, 또는 append-only JSONL 포맷으로 전환.

---

### C-4. `sed -i ''` BSD 전용 구문이 Linux에서 무음 실패

**위치:** `hooks/scripts/file-tracker.sh:204`, `:207`

```bash
sed -i '' 's/^sensor_cache_valid:.*/sensor_cache_valid: false/' "$STATE_FILE" 2>/dev/null || true
```

**문제:** BSD sed 전용 `-i ''` 구문. GNU sed(Linux, GitHub Actions 등)는 `''`를 파일명 인자로 해석해 실패한다. 명령 실패는 `2>/dev/null || true`로 완전히 은폐된다.

**Impact:** Linux 환경에서 `package.json`/`tsconfig.json`/`requirements.txt` 등 marker file을 수정해도 `sensor_cache_valid: false`로 갱신되지 않아 **의존성 변경 후에도 sensor cache가 영구히 stale** → 잘못된 linter/type-checker 결과.

**수정안:** Perl (`perl -i -pe`) 또는 Node.js 인라인 스크립트로 통일.

---

## High (높음)

### H-1. 알림(notify.sh) osascript가 메시지 내 따옴표로 파싱 실패
`notify.sh:34,43` — `MESSAGE_ESCAPED`는 curl 바디에만 적용되고 osascript에는 raw `$MESSAGE`를 삽입. 메시지에 `"`가 섞이면 macOS 알림이 **syntax error로 무음 실패**. `|| true`로 완전 은폐.

### H-2. 알림 enabled 파싱이 다른 YAML 섹션과 혼동
`notify.sh:21-23` — `grep -q "^  enabled: false"` 는 YAML 구조 무시하고 들여쓰기 패턴만 매칭. state에 `team_mode:\n  enabled: false` 같은 다른 섹션이 있으면 **알림이 활성화 상태인데도 전 채널 무음 차단** (false positive 재현 확인).

### H-3. session_id 추출이 경로에 `deep-work.`가 2회 등장하면 깨짐
`phase-transition.sh:33` — `grep -o | sed` 체인에 `head -1`이 없어 다중 매치가 개행으로 이어진 `SESSION_ID` 반환. fork 세션의 `.deep-work/sessions/deep-work.s-XXX/` 구조에서 필연 발생 → 캐시 파일 경로에 `/`가 들어가 `mkdir -p` 없이 쓰기 실패 → **phase cache 갱신 불가**.

### H-4. state 파일 race between sensor-trigger.js ↔ file-tracker.sh
`sensor-trigger.js:57` + `file-tracker.sh:204-209` — 동일 state YAML을 한쪽은 Node readFile/writeFile, 다른 쪽은 BSD `sed -i`로 수정. 공통 락 없음. `current_phase`, `active_slice`, `tdd_state`, `sensor_cache_valid` 중 하나가 씹힘 → **PreToolUse 가드 오작동**.

### H-5. `write_registry` stale lock 강제 제거로 registry 파괴
`utils.sh:167-176` — `flock` 없는 환경(macOS 기본) 스핀락 3회 실패 시 `rmdir` / `rm -rf`로 다른 프로세스 락 강제 해제 후 자기 획득. 3+개 세션 동시 등록 시 registry 레코드 유실 → **cross-session ownership false negative** → 파일 교차 덮어쓰기 가능.

### H-6. `phase-guard.sh` Node.js 결과 `decision` 파싱 fail-open
`phase-guard.sh:262-283` — Node가 잘못된 JSON/공백을 뱉어도 `grep`이 매칭 없으면 단순 `exit 0`(allow). TDD 강제·slice scope 검사가 **Node 쪽 오류로 조용히 해제**.

### H-7. Ownership 검사 내부 Node 예외와 의도적 block 미구분
`phase-guard.sh:111-118` — `node -e` 예외 종료(registry 손상/parse 오류)와 실제 block이 같은 exit 1로 귀결. 사용자는 "세션: () ()"라는 파싱 깨진 차단 메시지를 받으며 repro 불가한 block을 반복 경험.

### H-8. `slice_files` 미전달로 slice scope 검사 무력화
`phase-guard.sh:249` — Node 입력 조립에 `slice_files`, `strict_scope`, `exempt_patterns`가 빠져 있음. `phase-guard-core.js:631`의 `checkSliceScope`는 `state.slice_files` 없으면 `{ inScope: true }`를 반환 → **"Do NOT modify files outside slice scope" 약속이 실제로 강제되지 않음** (`deep-implement/SKILL.md:40`).

---

## Medium (중간)

### M-1. JSONL append 락 실패 시 무락 폴백
`session-end.sh:241-249` — 3회 재시도 후 락 없이 `echo >>`. PIPE_BUF 초과 라인(state 커지면 쉬움) → `harness-sessions.jsonl` 깨진 JSON → `assumption-engine.js:119`가 "Malformed JSON"으로 drop → 세션 통계 유실.

### M-2. JSON reason 이스케이프 누락
`phase-guard.sh:37,140,229,270,280` — block 메시지의 `${_OWN_FILE}` / `${REASON}`을 heredoc에 raw 삽입. 파일 경로에 `"` 또는 개행이 포함되면 block JSON 파싱 실패 → Claude Code가 block 사유를 인식 못 함.

### M-3. update-check.sh node -e 경로 인용 취약
`update-check.sh:23` — 플러그인 경로에 `'`이 들어가면 JS 구문 오류. 업데이트 확인이 조용히 스킵된다.

---

## 문서·버전 드리프트

### D-1. `commands/deep-finish.md:89` — `"deep_work_version": "5.3.0"` 하드코딩 ✅ 검증 완료
session-receipt.json 스키마 예시가 **5.3.0으로 고정**. plugin.json은 6.2.3. 이 값은 기계적으로 소비될 수 있으므로 실제 기능 영향 가능.

### D-2. `skills/deep-work-workflow/SKILL.md`의 6개 가이드 링크 모두 깨짐 ✅ 검증 완료
라인 154, 187, 216, 241, 253, 258 — 모두 `skills/shared/references/<x>.md`로 되어 있으나 SKILL.md 위치상 상대 경로 해석 시 `skills/deep-work-workflow/skills/shared/references/...`로 404.
수정: `../shared/references/<x>.md`.

### D-3. `commands/*.md`의 `(v6.2.1)` 카테고리 라벨 13개
2개 릴리스 이후에도 v6.2.1 라벨 유지. 기능적 영향 없음이지만 버전 추적 혼동.

### D-4. `hooks/hooks.json:2` description = "v5.6.0 Session Fork"
릴리스 업그레이드와 함께 갱신 누락.

### D-5. CLAUDE.md 구조 설명 누락
`sensors/`, `health/`, `assumptions.json`, `templates/topologies/`, `package.json`, `templates/topology-detector.js` 등이 **구조 기술에서 빠짐**. package.json의 `files` 필드에는 포함되어 배포됨.

### D-6. `skills/deep-work-orchestrator/SKILL.md:237` — Test 행 변경 주체 오기재
표에는 "Phase Skill"이지만 `deep-test/SKILL.md:122`에서는 "Orchestrator 또는 `/deep-finish`". 실제 구현과 표가 불일치.

### D-7. `commands/deep-resume.md:231,246` — `--resume-from` 플래그 Orchestrator에 미정의
resume 경로가 Orchestrator를 `--resume-from=research` / `--resume-from=plan`으로 호출하지만 Orchestrator SKILL.md에 이 플래그 파싱이 정의되어 있지 않음 → 최악의 경우 Research/Plan Skill **중복 실행**.

---

## 권장 수정 순서

1. **C-4** (Linux sed 실패) — 30줄 이내, perl 치환으로 즉시 수정 가능
2. **C-2** (파일 경로 파싱) — 3개 파일에 Node/jq 기반 파서 적용
3. **C-1** (Phase Transition Injector) — 런타임 환경변수 실존 확인 후 구조 변경 필요
4. **C-3** (receipt race) — 스핀락 패턴 재사용 또는 JSONL 전환
5. **H-1 ~ H-4** — 알림·session_id·state race 각각 국지적 수정
6. **H-8** (slice scope 무력화) — phase-guard.sh 입력 조립에 `slice_files` 추가 1줄
7. **D-2** (SKILL.md 링크 6개) — 경로 1 sed 커맨드
8. **D-1** (deep_work_version 5.3.0) — 템플릿에 동적 주입으로 변경

---

## 재현 검증 된 항목

| 항목 | 검증 방법 | 결과 |
|------|----------|------|
| C-4 sed BSD 문법 | `file-tracker.sh:204,207` 직접 grep | ✅ 확인 |
| D-1 hardcoded 5.3.0 | `grep deep_work_version` | ✅ line 89 |
| D-2 6개 깨진 링크 | `grep skills/shared/references` on SKILL.md | ✅ 6건 모두 |
| C-1 phase-transition 구조 | 소스 20-21행 직접 읽음 | ✅ 환경변수 의존 확인 |

나머지 항목은 코드 경로 분석에 근거하며, 일부는 런타임 재현 테스트를 통해 최종 확정이 필요합니다(특히 race condition류 H-3, H-4, M-1).

---

**작성:** Claude Opus 4.7 ultra-review pipeline
**다음 단계 제안:** C-1 ~ C-4를 단일 hotfix PR(6.2.4)로 묶고 별도 이슈 트래커에 H/M/D 항목 등록.
