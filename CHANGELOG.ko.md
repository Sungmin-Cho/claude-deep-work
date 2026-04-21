[English](./CHANGELOG.md) | **한국어**

# Changelog

All notable changes to the Deep Work plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v6.3.1 — 2026-04-21

### Fixed

- **Phase skill body echo 버그** — `Skill("deep-*")` 호출 시 SKILL.md 본문의 markdown 템플릿이 사용자에게 노출된 뒤 phase 작업(예: brainstorm의 명확화 질문)이 수행되지 않고 대화가 종료되는 현상. 브레인스톰의 명확화 질문 누락 및 리서치/플랜의 분석 단계 누락을 모두 해결.
- **Exit Gate pause/resume 회귀** (F1) — phase skill이 완료 시 current_phase를 다음 phase로 미리 전환하던 기존 동작이 Exit Gate "일시정지" 선택 시 `/deep-resume` 재개 경로에서 Exit Gate를 건너뛰고 다음 phase로 자동 진입하는 문제를 야기. current_phase 변경 주체를 Orchestrator로 일원화하여 해결.

### Added

- **4계층 echo 방어** (5개 phase skill 공통):
  1. `> [!IMPORTANT]` admonition 블록 — skill body echo 금지 + Pre-checks 예외 허용
  2. 템플릿 외부 분리 — `skills/shared/templates/{brainstorm,research}-template.md` + `plan-template-{existing,zerobase}.md` (2-mode 분기)
  3. First Action 서브섹션 — phase 진입 시 즉시 수행할 가시 첫 동작 명시
  4. Section 3 실행 순서 안전장치
- **Phase Exit Gate × 5** — 각 phase 완료 시 AskUserQuestion으로 "진행 / 재실행 / 일시정지" 선택. "진행" 선택 시 즉시 다음 skill 호출.
- **완료-Marker 감지 분기** — 모든 5개 phase skill Section 1에서 `*_completed_at` 필드 감지 시 Orchestrator로 제어 반환 (Exit Gate 재표시).

### Changed

- **current_phase 변경 주체 일원화**: Brainstorm/Implement phase skill이 Section 3에서 직접 변경하던 동작 제거. 모든 phase의 current_phase 변경을 Orchestrator Exit Gate "진행" 분기로 이관.
- Orchestrator §1-11 문구: "자동 흐름을 시작합니다..." → "각 phase 완료 시 진행 확인을 받으며 순차 실행합니다..."
- `review-approval-workflow.md`: Exit Gate와의 관계 명시.

### Excluded

- Phase 5 Integrate는 이미 interactive loop이므로 Exit Gate 적용 대상에서 제외.
- Hook 스크립트 로직 변경 없음. `node --test hooks/scripts/*.test.js` 결과: 397/398 pass. 1 pre-existing failure (`multi-session.test.js:507` - phase5-guard.test.js fixture와의 lint 충돌)는 main 브랜치에도 존재하며 v6.3.1과 무관.

### Added (v6.3.1 NW5 integrity check + NO3 data preservation)

- **Approval integrity hash** — Research/Plan approval 시점의 `sha256(research.md/plan.md)`를 `research_approved_hash` / `plan_approved_hash`로 state에 기록. `/deep-resume` Resume fast-path가 현재 파일 hash와 비교하여 out-of-band 편집(일시정지 중 외부 편집기 수정 등)을 자동 감지 — 불일치 시 **data preservation + in-place review** 경로 발동 (NO3): 편집된 문서를 `$WORK_DIR/{research,plan}.v{N}-edit.md`로 백업 + approval state invalidate + Skill 재호출 스킵하고 Review+Approval workflow 직접 진입. 편집 내용이 보존된 채 재검토되어 사용자 편집이 유실되지 않음. 필드 부재 시(pre-v6.3.1 세션 또는 재실행 후 재승인 전)는 Skill 재실행이 safer default.
- **Backup filename collision 방지 (NP3)**: orchestrator가 생성하는 hash mismatch backup은 `-edit` 접미사를 사용하여 deep-plan/deep-research skill의 자체 backup(`v{N}.md`)과 파일명 충돌 방지.

### Known Limitations (v6.3.2 예정)

- **Hash mismatch recovery의 plan-specific validation 부재**: NO3 data preservation 경로는 generic Review+Approval workflow를 실행하나, `deep-plan` 고유 validation(Completeness Policy, Contract Negotiation, Phase Review Gate)는 스킵됨. Out-of-band 편집이 `TBD` 같은 placeholder를 추가한 뒤 승인되는 경로는 현재 가드 불충분. Workaround: Exit Gate option 2 "재실행/수정"을 사용하면 skill 재실행으로 모든 validation 적용됨. v6.3.2에서 in-place review에도 phase-specific validation hook 추가 예정.
- **Backup write-failure fail-safe 부재**: NO3 backup 복사 실패 시(권한/디스크 full 등) state 변경을 중단하는 가드 없음. 희귀 edge case이며 data는 여전히 원본 research.md/plan.md에 남아있음. v6.3.2에서 backup 실패 시 state 변경 중단 + 사용자 알림 가드 추가 예정.

## [6.3.0] — 2026-04-18

### 추가됨
- **Phase 5 "Integrate"** — Phase 4(Test) 완료 후 호출되는 skippable 단계. `deep-review`, `deep-docs`, `deep-wiki`, `deep-dashboard`, `deep-evolve` 플러그인 아티팩트를 읽어 AI가 최대 3개의 다음 단계를 추천하면 사용자가 선택·실행한다. 대화형 루프 (최대 5라운드). 설계 문서: `docs/superpowers/specs/2026-04-18-phase5-integrate-design.md`.
- `/deep-integrate` 커맨드: Phase 5 수동 재진입용.
- `--skip-integrate` 플래그: Phase 5 건너뛰고 `/deep-finish`로 직행.
- `skills/deep-integrate/` 신규 스킬 + 헬퍼 스크립트(`detect-plugins.sh`, `gather-signals.sh`, `phase5-finalize.sh`, `phase5-record-error.sh`), JSON 스키마, L6 snapshot fixture.
- `phase5_work_dir_snapshot` state 필드 — Phase 5 진입 시점의 work_dir을 불변 snapshot으로 기록. phase-guard가 이 값을 enforcement 기준으로 사용하므로 런타임에 state file의 `work_dir`이 변조돼도 boundary가 유지된다.
- `phase5-finalize.sh` helper — state file의 `phase5_completed_at`만 atomically 기록. state file 경로가 현재 세션과 일치하는지 검증하며, Phase 5 중 state 수정은 이 helper 경유만 허용된다.
- `phase5-record-error.sh` helper — `/deep-finish --skip-integrate` 경로에서 `integrate-loop.json`의 `terminated_by`를 `"error"`로 기록. Stop-hook의 `interrupted` 마킹과 함께 belt-and-suspenders.
- Stop-hook: 세션 중단 시 `integrate-loop.json`에 `terminated_by: "interrupted"` 기록.

### 변경됨
- `deep-work-orchestrator`가 Phase 4(Test) 완료 후 Phase 5로 dispatch한다. Phase 5 에러 시 `/deep-finish`에 `--skip-integrate`를 전달하여 state machine이 정상 종료되도록 한다.
- `/deep-finish`: `integrate-loop.json` 부재 시 `/deep-integrate` 힌트. `--skip-integrate`는 Phase 5 중단 prompt를 우회하고 `phase5-record-error.sh`를 defensively 호출한다.
- **`phase-guard.sh` Phase 5 mode 도입** (초기 계획 "phase-guard 변경 없음"은 보안 검토 결과 뒤집혔음). `current_phase=idle + phase5_entered_at + !phase5_completed_at` 상태에서 다음을 강제:
  - `Write/Edit/MultiEdit/NotebookEdit`: 대상 경로가 snapshot `$WORK_DIR` 하위여야 함. state file 직접 수정은 차단 — `phase5-finalize.sh`만 허용.
  - `Bash`: **allowlist-only (default-deny)**. 첫 command token(env 변수 prefix 이후)이 Phase 5 read-mostly allowlist에 있어야 통과: 파일시스템 read(`cat`/`head`/`tail`/`wc`/`ls`/`pwd`/`file`/`stat`/`realpath`/`readlink`/`dirname`/`basename`), 검색/필터(`grep`/`sort`/`uniq`/`diff`/`cut`/`paste`/`column`/`tr`/`find`), JSON/YAML read(`jq`/`yq` `-i` 제외), shell builtins(`echo`/`printf`/`date`/`env`/`true`/`false`/`test`/`which`/`type`/`command`/`xxd`/checksums), `git` read-only subcommand(`status`/`diff`/`log`/`show`/`blame`/`grep`/`rev-parse`/`rev-list`/`merge-base`/`symbolic-ref`/`ls-files`/`ls-tree`/`branch`/`tag`/`config`/`describe`/`cat-file`/`fsck`/`shortlog`/`reflog`/`name-rev`/`for-each-ref`/`count-objects`/`verify-pack`/`check-ignore`/`check-attr`/`var`/`help`/`version`), 인터프리터(`bash`/`sh`/`python`/`perl`/`ruby`/`node`/`awk`/`sed`/`php`/`osascript`/`tsx`/`deno`/`bun`) + script canonical check, 파일시스템 ops(`mv`/`cp`/`mkdir`/`rm`/`rmdir`/`chmod`/`chown`/`truncate`/`touch`/`ln`/`install`) + target-in-`$WORK_DIR` 검증. 알 수 없는 command는 즉시 block. 추가 제약: 파괴적 변형(`/bin/rm`, `\rm`, `command/exec/builtin rm`) 정규화; `git` global flags(`-C <path>`, `--git-dir [=]<path>`, `--work-tree [=]<path>`, `-c <k=v>`, `-p`/`--no-pager`/`--bare`/...) fixed-point iteration으로 제거; `git` mutating 서브커맨드(위 목록) 정규화 후 block; `find -delete/-exec/-ok/...` block; `jq/sed/perl/ruby -i` in-place flag block; 인터프리터 `-c/-e` flag block; compound 연산자(`;`, `&&`, `||`, `|`, `&`) reject; helper 경로 shell metacharacter(`$`, `` ` ``, `(`, `)`, `<`, `>`, newline, CR) reject. `mv`/`cp`는 SRC와 DEST 양쪽 검증. **인터프리터 + script 호출**은 script canonical `realpath`가 `${PROJECT_ROOT}/skills/deep-integrate/<helper>.sh` 또는 `${HOME}/.claude/plugins/cache/claude-deep-suite/deep-work/*/skills/deep-integrate/<helper>.sh`와 정확히 일치할 때만 허용. 읽기 도구(`Read`, `Glob`, `Grep`, `Agent`, `AskUserQuestion`, `Skill`)는 통과.
- `/deep-integrate` tool allowlist 축소: `Skill, Read, Bash, Glob, Grep, Agent, AskUserQuestion` (`Write, Edit` 제거).

### 업그레이드 안내
- v6.2.x에서 Phase 5 진입한 세션은 `phase5_work_dir_snapshot`이 없을 수 있다. phase-guard는 backward-compat으로 `work_dir` fallback을 사용하지만, 이 경로는 state-tampering 공격에 더 노출된다. v6.3.0 신규 Phase 5 진입은 snapshot을 자동 기록한다.
- `phase5-finalize.sh`는 state file basename이 `deep-work.<sid>.md` 패턴이고 `.claude/` 디렉토리에 있는지 검증한다. 기존에 redirect로 state를 수정하던 로직은 이 helper 호출로 전환해야 한다.
- **의존성**: `phase5-record-error.sh`, `gather-signals.sh`, Stop-hook `terminated_by` marker는 `jq`가 `PATH`에 있어야 한다 (없으면 helper가 명시적 에러로 종료). `phase5-finalize.sh`는 `awk`만 사용하여 `jq` 의존성 없음.

### 알려진 제약
- **인터프리터 커버리지**: `Rscript`/`julia`/`lua`/`groovy`/`tclsh`는 allowlist 미포함. 실제 Phase 5 workflow에 이들이 필요하면 명시적으로 추가해야 한다. v6.3.1에서 검토.
- **`awk -f script.awk`**: `-f` 플래그 형태는 interpreter-with-script canonical check에서 커버되지 않는다(`-e/-c`는 `-c/-e` 규칙으로 차단). Phase 5 Bash allowlist가 알 수 없는 형태를 거부하고 legitimate workflow에서 `awk -f`를 쓰지 않아 실무 위험은 낮음.
- **레거시 세션 업그레이드**: v6.2.x에서 `phase5_work_dir_snapshot` 없이 Phase 5 진입한 세션은 mutable `work_dir` fallback. v6.3.0에서 재진입 시 snapshot이 자동 기록됨.
- **`phase5-record-error.sh` / `phase5-finalize.sh` 단위 테스트**: 현재 `phase5-guard.test.js`에서 간접 커버. 전용 단위 테스트 파일은 v6.3.1 예정.
- **Allowlist 명령 악용**: read-mostly allowlist의 명령은 표준 read-only form에서 허용되며 niche invocation은 이론적으로 악용 가능(예: `find`의 mutating flag 차단됨; `jq -i` 차단; `mv`/`cp`/`mkdir`은 target 검증; 나머지는 safe 가정). `curl`은 allowlist 미포함; 네트워크 접근 helper의 data-exfil 방어 같은 per-command invocation audit은 v6.4.0에서 검토.
- **Non-Bash 도구(`Agent`/`Skill`)**: Phase 5 guard를 통과. `Agent`로 dispatch된 subagent는 자체 tool set을 가지며 Phase 5 enforcement는 호출 세션의 Bash/Write/Edit에만 적용. v6.3.0에서는 out-of-scope trust boundary로 취급.

## [6.2.4] — 2026-04-17

내부 감사(`BUG_REVIEW_REPORT.md`)로 식별된 hook 레이어 버그 15건 + 문서 드리프트 7건을 수정하는 버그 픽스 릴리스. 실행 전 플랜 독립 리뷰에서 추가로 발견된 critical 5건도 함께 해결.

### 수정됨

**Hooks — 호환성 및 파싱**
- `file-tracker.sh`: BSD 전용 `sed -i ''` 구문을 Node.js 인라인 스크립트로 교체. 기존 코드는 Linux의 GNU sed에서 무음 실패하여 marker 파일 수정 후에도 `sensor_cache_valid`가 stale로 남았음. macOS에서도 insert-when-missing 경로가 두 번째 `---` 구분자를 잘못 처리했던 문제도 함께 해결.
- `update-check.sh`: 플러그인 경로를 `process.argv[1]`로 전달 (기존에는 셸 문자열 보간). 경로에 apostrophe(`/Users/O'Brien/...`)가 포함되면 JS 구문 오류로 업데이트 확인이 조용히 스킵되던 문제 해결.
- `phase-guard.sh` / `file-tracker.sh` / `phase-transition.sh`: `file_path` 추출을 regex에서 `extract_file_path_from_json` (JSON 파서) 기반으로 교체. escape된 따옴표를 포함한 경로(`a \"b\" c.txt`)가 잘려서 오인 block 및 receipt 손상이 발생하던 문제 해결.
- `phase-transition.sh`: `SESSION_ID` 추출 시 가장 안쪽의 `deep-work.XXXX` 세그먼트를 취함. Fork worktree 경로(`.deep-work/sessions/deep-work.s-parent/sub/.claude/deep-work.s-child.md`)가 이제 `s-child`로 정확히 해결됨 (기존엔 다중 매치로 cache 파일 경로가 깨짐).

**Hooks — race condition**
- `file-tracker.sh` receipt 업데이트: read-modify-write를 mkdir 기반 spinlock(40회 × 50ms)으로 감쌈. 타임아웃 시 `<receipt>.pending-changes.jsonl`에 큐잉하고 다음 lock 보유자가 crash-safe 패턴(rename → `.draining.<pid>` → merge → canonical rename → `.draining` unlink)으로 드레인. 드레인 중 크래시가 나도 `.draining.*` 파일이 남아 다음 invocation에서 복구. 5+ 동시 PostToolUse 호출에서 `files_modified` 항목이 유실되거나, lock timeout 경로로 큐잉된 후 아무도 드레인하지 않아 조용히 사라지던 문제 해결.
- `sensor-trigger.js` + `file-tracker.sh` state YAML 업데이트: 동일한 `<state>.lock`을 공유 — `file-tracker.sh`의 marker file `sensor_cache_valid` flip도 포함(초기 v6.2.4에서 누락됐다가 post-review에서 수정). 기존에는 `current_phase`/`active_slice`/`sensor_pending`/`sensor_cache_valid` 변경이 race로 하나가 씹힘.
- `utils.sh` `write_registry`: lock 타임아웃 시 fail-closed (다른 프로세스의 lock 디렉터리 강제 제거 금지). 호출자(`register_session`, `update_last_activity`, `register_file_ownership`, `update_registry_phase`, `unregister_session`, `register_fork_session`)는 `_try_write_registry`를 통해 실패를 `.claude/deep-work-guard-errors.log`에 기록 (기존 조용히 swallow).
- `session-end.sh` JSONL append: lock 타임아웃 시 `<jsonl>.pending-append.jsonl`에 큐잉. 다음 append는 receipt와 동일한 rename-first crash-safe 패턴 사용. 재시도 10→20회.

**Hooks — 검증 강건화**
- `phase-guard-core.js`: 내부 에러(잘못된 입력, 런타임 예외)를 `process.exit(3)`으로 구분, 가드 로그 참조 안내가 포함된 JSON block을 stdout에 출력. 의도적 block은 기존대로 exit 0 + `decision=block`. 기존에는 둘 다 exit 2여서 사용자 메시지에서 구분 불가.
- `phase-guard.sh`: Node exit 3을 hook exit 2 + 디버그 메시지로 변환. stdout의 `decision`이 비어있으면 fail-closed + 별도 메시지 (기존엔 무음 allow).
- `phase-guard.sh`: state frontmatter에서 `slice_files` / `strict_scope` / `exempt_patterns`를 읽어 (신규 `read_frontmatter_list` 헬퍼 사용) Node 입력에 전달. 기존엔 이 필드들이 한번도 전달되지 않아 `checkSliceScope`가 `undefined`를 받고 항상 `inScope=true`를 반환 → `deep-implement/SKILL.md`의 slice 범위 계약이 무음 미강제.
- `phase-guard.sh` block 메시지: 4개 heredoc 모두 보간 필드(파일 경로, worktree 경로, phase 라벨, 다음 단계)를 JSON-escape. 따옴표/개행 포함 메시지가 기존엔 invalid JSON을 만들었음.

**Hooks — phase-transition injector (C-1)**
- `file-tracker.sh`가 stdin을 `$PROJECT_ROOT/.claude/.hook-tool-input.<ppid>`에 **phase early-return 이전에** 캐시, `.tmp.$$` + `mv`로 원자적 쓰기. `phase-transition.sh`는 `CLAUDE_TOOL_USE_INPUT` / `CLAUDE_TOOL_INPUT` 환경변수가 unset일 때 (Claude Code 프로덕션의 실제 동작) 이 캐시를 fallback으로 읽음. 초기 v6.2.4 수정 후에도 캐시가 `implement` phase 블록 내부에서만 기록되어 research→plan / plan→implement / test→idle 전환에서는 이전 implement payload가 재사용되거나 no-op. Post-review 수정으로 캐시 쓰기를 hook 최상단으로 이동.
- `session-end.sh`가 자신의 `.hook-tool-input.$PPID` 및 60분 이상 된 `.hook-tool-input.*` 파일을 정리 — 캐시는 tool call 단위 임시 파일이며 세션 간 축적되면 안 됨.

**알림**
- `notify.sh`: YAML 인식 `notifications.enabled` 파서. 기존 `grep -q "^  enabled: false"`가 관련 없는 `team_mode:\n  enabled: false`를 false-positive로 매칭하여 전 채널 무음 차단.
- `notify.sh`: `_osascript_escape` 헬퍼를 macOS `osascript` 호출에 적용. 메시지에 따옴표가 포함되면 무음 구문 오류로 알림이 미전달되던 문제 해결.
- `notify.sh`: `_xml_escape` 헬퍼를 Windows PowerShell toast XML에 적용. `<`, `&`, `"` 문자가 XML을 깨트려 알림이 나타나지 않던 문제 해결.
- `notify.sh`: `set -euo pipefail`에서 `pipefail` 제거. best-effort 스크립트에서 채널 미설정 시 grep 파이프라인이 비매칭으로 비정상 종료하는 문제 해결.

**문서**
- 7개 SKILL.md 파일의 `skills/shared/references/` → `../shared/references/` 링크 21건 일괄 수정 (`deep-work-workflow`, `deep-test`, `deep-implement`, `deep-plan`, `deep-research`, `deep-brainstorm`, `deep-work-orchestrator`).
- `commands/*.md`의 `(v6.2.1)` 라벨 13건을 `(v6.2.4)`로 갱신.
- `commands/deep-finish.md` 예시: `"deep_work_version": "5.3.0"` → `"6.2.4"` (두 minor 릴리스 동안 고정되어 있었음).
- `hooks/hooks.json` description: `(v5.6.0 Session Fork)` → `(v6.2.4)`.
- `skills/deep-work-orchestrator/SKILL.md`: phase 소유권 표의 Test 행 수정 — `/deep-finish` 이후 Test → idle 전환은 Orchestrator가 담당 (Phase Skill 아님).
- `skills/deep-work-orchestrator/SKILL.md`: `deep-resume.md`가 이미 사용 중이었으나 문서화되지 않았던 `--resume-from=<phase>` 플래그 공식 문서화.
- `CLAUDE.md`: 누락되었던 디렉터리·파일을 구조에 추가 (`sensors/`, `health/`, `templates/topologies/`, `assumptions.json`, `package.json`).

### 내부

- `hooks/scripts/utils.sh`에 공유 헬퍼 추가, 여러 훅에서 소비:
  - `_acquire_lock` / `_release_lock`: mkdir 기반 spinlock, 타임아웃 fail-closed (`.claude/deep-work-guard-errors.log`에 기록).
  - `extract_file_path_from_json`: JSON 파서 기반 file_path 추출. escape된 따옴표를 정확히 처리.
  - `json_escape`: block 메시지 내 안전한 보간을 위한 JSON 문자열 이스케이프. 인자 필수 — stdin fallback 없음 (훅 hang 방지).
  - `read_frontmatter_list`: frontmatter의 YAML 리스트 필드(`[a, b]` 또는 `- a` 블록)를 JSON 배열로 반환.
- `hooks/scripts/utils.sh` `write_registry`: `_acquire_lock` 기반으로 리팩터링, fail-closed 동작으로 변경.
- 테스트: 329개 (6.2.3의 294개에서), 91 suite. 순증 +35개 — 호환성(3), 입력 파싱 e2e(5), notify YAML/escape(4), receipt race(1, 80 병렬 쓰기 — canonical 완전성 + pending 사이드카 empty + `.draining.*` orphan 없음 검증), phase-guard 강건화(6), phase-transition cache(2), utils 헬퍼(19), post-review 강건화(7: cache-before-phase-check × 4 phase, marker-flip lock × 2, 원자적 캐시 쓰기 × 1).
- 독립 3-way 리뷰 (Opus + Codex review + Codex adversarial)가 초기 v6.2.4 브랜치에서 critical 3건 + warning 3건을 식별; 모두 merge 전 해결. 리포트: `.deep-review/reports/2026-04-17-implementation-review.md`.

### 알려진 제약

- 크로스 플랫폼 CI matrix는 아직 구성되지 않음. 모든 새 수정은 `node --test` 기반 단위 테스트로 검증되었으나, Linux/Windows 커버리지는 새 portability 로직에 의존 (CI 강제 아님). 다음 릴리스에서 추가 예정.

## [6.2.3] — 2026-04-16

### 변경됨
- **trigger-eval.json v6.2 업데이트**: 벤치마크 테스트셋을 31개에서 54개로 확장 (true 21 + false 33). v6.2 신규 기능 대응 true 10개 추가 (Session Fork, Mutation Test, Brainstorm, Team Mode, Assumption Engine, Worktree, 영어 쿼리, semantic-only 트리거, Debug). false 13개 추가 (동음이의어, 메타 쿼리, 영어 hard negative, standalone 커맨드). 기존 true 5개를 false로 재분류 (SOLID 리뷰, drift check, deep-status, quality gate 설정, 프리셋 설정) — standalone 커맨드는 full workflow 트리거가 아님.

## [6.2.2] — 2026-04-16

### 수정됨
- **크로스 플랫폼 hooks 호환성**: `hooks.json`의 5개 hook command에서 POSIX inline env var assignment(`FOO=bar command`) 문법을 제거. Windows `cmd.exe`에서 이 문법을 파싱하지 못해 모든 hook이 실패하는 문제 해결. 스크립트가 Claude Code의 네이티브 env var(`CLAUDE_TOOL_USE_TOOL_NAME`, `CLAUDE_TOOL_USE_INPUT`)를 직접 읽되 기존 변수명도 fallback으로 유지.

### 변경됨
- `hooks/scripts/phase-guard.sh`: `CLAUDE_TOOL_USE_TOOL_NAME` 읽기 + `CLAUDE_TOOL_NAME` fallback
- `hooks/scripts/file-tracker.sh`: `CLAUDE_TOOL_USE_TOOL_NAME` 읽기 + `CLAUDE_TOOL_NAME` fallback
- `hooks/scripts/phase-transition.sh`: `CLAUDE_TOOL_USE_INPUT` 읽기 + `CLAUDE_TOOL_INPUT` fallback

## [6.2.1] — 2026-04-15

### 변경됨
- **커맨드 분류 정리**: `Deprecated in v5.2` 블록을 가진 11개 커맨드와 같은 표에 함께 분류되었던 2개(`deep-brainstorm`, `deep-phase-review`)를 5개 카테고리로 재분류 — Quality Gate(3), Internal(6), Escape hatch(1), Utility(2), Special utility(`/deep-phase-review` 이동).
- **`/deep-finish` 표현**: "자동 호출이 주 경로이며, test 통과 후 수동 호출도 공식 경로"로 재서술 (deprecated 아님).
- **Hook/skill 사용자 안내**가 `/deep-status` 플래그로 라우팅:
  - `hooks/scripts/assumption-engine.js`: `/deep-assumptions` → `/deep-status --assumptions`
  - `hooks/scripts/session-end.sh`: `/deep-report` → `/deep-status --report`
  - `skills/deep-test/SKILL.md`: 동일 정렬
- **Session Report 수동 경로 정책**: `/deep-report`와 `/deep-status --report` **둘 다** 공식 수동 경로로 유지. `skills/deep-work-workflow/SKILL.md` 제목·본문, `commands/deep-report.md` 본문, `commands/deep-resume.md` 본문 3위치 일관 표기.
- **README**(en/ko): "Deprecated Commands (13)" 단일 표를 5개 카테고리 표로 분리; "What changed" bullets를 재분류 서술로 갱신(deprecated 아님); Worktree Isolation 섹션의 `/deep-cleanup`/`/deep-resume` 본문을 standalone utility로 재서술.
- **`skills/deep-work-workflow/SKILL.md`** 분류 섹션을 6개 카테고리로 재작성.

### 변경 없음
- **삭제된 커맨드 없음.** `/deep-cleanup`과 `/deep-resume`은 각각 worktree 스캔/fork 정리, active 세션 선택/worktree 복원/phase dispatch의 유일한 경로로 계속 남습니다. 기능 이관은 follow-up으로 추적.
- **functional 동작 변경 없음.** 기존 슬래시 커맨드는 모두 이전과 동일하게 동작; 라벨·문구·버전 번호만 변경.
- 이전 섹션의 `v5.2` deprecated 기록은 역사로 보존.

## [6.2.0] — 2026-04-14

### 추가
- **크로스 플러그인 컨텍스트**: Phase 1 Research에서 harnessability-report.json(deep-dashboard)과 evolve-insights.json(deep-evolve)을 참조하여 research context 강화.

## v6.1.0

### 3-Layer Architecture + Computational Guard

2026-04-12 세션의 Inferential Enforcement 실패 3건(worktree 격리 미적용, team 모드 미적용, codex 미실행)을 구조적으로 해결.

#### 추가
- **P0 Worktree Path Guard** — PreToolUse hook으로 worktree 외부 Write/Edit/Bash를 hard block. 메타 디렉토리(`.claude/`, `.deep-work/`)는 PROJECT_ROOT 기준으로 예외 처리. 모든 phase에서 session ID 없이도 작동.
- **P1 Phase Transition Injector** — PostToolUse hook으로 `current_phase` 변경 시 worktree_path, team_mode, cross_model_enabled, tdd_mode를 LLM context에 자동 주입. Cache 파일로 전환 감지, `CLAUDE_TOOL_INPUT` 환경변수로 stdin 안전성 확보.
- **6개 Phase Skill** — 각 phase별 독립 SKILL.md (brainstorm 120줄, research 183줄, plan 165줄, implement 187줄, test 147줄, orchestrator 230줄). 기존 command 대비 context 로드 45-81% 축소.
- **Review + Approval Workflow** — Research/Plan 완료 후 6단계 프로토콜: 자동 리뷰 → main 에이전트 판단 → 사용자 승인 → 수정 → 최종 확인. Orchestrator가 current_phase 관리.
- **`review-approval-workflow.md`** reference — Research/Plan 리뷰 게이트 공유 프로토콜 문서.

#### 변경
- **Command → Thin Wrapper** — 6개 core phase command를 `Skill()` 호출 1줄로 축소. 모든 wrapper의 `allowed-tools`에 `Skill` 포함.
- **References 경로 통합** — `skills/deep-work-workflow/references/` → `skills/shared/references/` (14개 파일). 모든 command/skill 경로 업데이트.
- **`deep-resume` 업데이트** — Research/Plan resume를 orchestrator 경유로 변경 (dead-end 방지). test_passed 시 `/deep-finish`로 라우팅.
- **`deep-test` phase 전환** — 성공 시 `current_phase: idle` 미설정. Orchestrator/finish가 idle 전환 담당.
- **Receipt 계약** — `status: "complete"` 필드를 implement receipt에 필수 명시 (deep-test gate 의존).
- **Drift gate fallback** — `plan_approved_at` fallback 체인: timestamp → plan.md mtime → 24시간 커밋 window.
- **`cross_model_enabled` 파싱** — nested YAML mapping 지원 (`grep -A3` fallback).
- **`session-end.sh`** — 세션 종료 시 phase cache 정리 (stale P1 injection 방지).

#### 아키텍처
```
Layer 1: Commands (thin wrappers) → Skill dispatch
Layer 2: Skills (execution logic) → 100-230줄 SKILL.md + 공유 references
Layer 3: Hooks (enforcement) → P0 hard block + P1 context injection
```

## v6.0.2

### Phase Review Gate
- **통합 리뷰 게이트** — 모든 Phase(0-3) 종료 시 셀프 리뷰 + 외부 리뷰 자동 실행. 사용자 확인 후 다음 단계로 전환.
- **Phase별 Fallback 체인** — Phase 0-2(문서): Structural + Adversarial + Opus 서브에이전트. Phase 3(코드): deep-review → codex/gemini + Opus → 셀프 + Opus.
- **사용자 확인 UX** — 요약 보기 + 3가지 선택지(자동 수정/현재 진행/상세 보기). 상세 보기에서 항목별 수정/스킵 선택.
- **Degraded Mode** — 외부 리뷰어 실패 시 자동 fallback.
- **`/deep-phase-review` 통합** — 수동 리뷰가 자동 게이트와 동일한 Fallback 체인 사용.

### 작업 폴더 이름 변경
- **세션 폴더 변경** — `deep-work/` → `.deep-work/` (숨김 디렉토리). `.claude/`, `.git/` 등 관례와 일치.
- **자동 마이그레이션** — 기존 `deep-work/` 폴더는 다음 세션 시작 시 자동 마이그레이션. worktree 안전 체크 포함.
- **메타데이터 갱신** — state 파일, JSONL 히스토리, fork 메타데이터 경로 일괄 업데이트.
- **선택적 .gitignore** — 세션 폴더(`.deep-work/20*/`)와 히스토리만 제외, 설정 파일은 유지.

## [6.0.1] - 2026-04-10

### 추가 — Superpowers 강점 통합 (Slice Review, Red Flags, Escalation)

- **Slice Review (Step C-2)**: 센서 파이프라인 이후 슬라이스별 2단계 독립 리뷰. Stage 1 (스펙 준수, required) + Stage 2 (코드 품질, advisory). Subagent 실패 시 graceful degradation.
- **Red Flags 테이블**: implement (10항목) 및 test (6항목) 단계의 합리화 방지 테이블. Hook 기반 하드 게이트를 소프트 가이던스로 보완.
- **Pre-flight Check (Step A-2)**: TDD 시작 전 전제조건 검증. `command -v`로 안전한 실행 가능성 확인. 2개 옵션: 계속 진행 (done_with_concerns) 또는 Plan 수정.
- **Status Reporting**: 슬라이스별 `slice_confidence` (done/done_with_concerns) 및 `concerns` 배열. 리뷰/센서/pre-flight 이력 기반 자동 판정.
- **Agent delegation prompt 확장**: 위임 에이전트용 규칙 7-10 (self-review, receipt 기록, pre-flight, confidence 판정).
- **Phase 4 cross-slice + 보완 리뷰**: Section 4-2/4-3을 전체 제어 흐름으로 재작성. Phase 3 FAIL 슬라이스는 필수 보완 대상.
- **Scope creep 감지**: `git diff --name-only`로 슬라이스 외 파일 변경 탐지.
- **Per-slice working tree diff**: `git diff $git_before` (커밋이 아닌 working tree 비교).
- **deep-finish.md concerns 요약**: 세션 리포트에 slice confidence 집계 및 concerns 목록 추가.

### 변경

- Phase 4 Spec Compliance (4-2) 및 Code Quality (4-3) 게이트가 per-slice 검증 대신 cross-slice 일관성 검증으로 전환 (per-slice은 Phase 3에서 수행).
- Receipt의 `changes.git_diff`가 per-slice baseline (`git diff $git_before -- [files]`)으로 변경.
- `AskUserQuestion`이 deep-implement.md의 `allowed-tools`에 추가.
- 버전 참조 6.0.1로 통일 (CLAUDE.md, SKILL.md, package.json, plugin.json).

## [6.0.0] - 2026-04-09

### 추가
- **Computational Sensor Pipeline (#2)** — 레지스트리 기반 센서 오케스트레이션, TDD 워크플로우 통합:
  - `sensors/registry.json`: JS, TS, Python, C#, C++ 생태계 정의 (감지 규칙, lint/typecheck/mutation 명령, coverage 플래그)
  - `sensors/detect.js`: 프로젝트 마커 파일(package.json, tsconfig.json, pyproject.toml 등)에서 자동 생태계 감지
  - 8개 출력 파서: eslint, tsc, ruff, generic-line, generic-json, stryker, dotnet, clang-tidy
  - TDD 상태 머신 확장: GREEN 이후 SENSOR_RUN → SENSOR_FIX → SENSOR_CLEAN 상태
  - 자기 교정 루프: GREEN 후 센서 자동 실행, 센서별 최대 3회 수정
  - `sensor-trigger.js`: Config/마커 파일 변경 시 생태계 전체 센서 재스캔 트리거
  - `/deep-sensor-scan`: 독립 실행 computational sensor 스캔 커맨드
  - 감지 결과 캐싱 (`.sensor-detection-cache.json`)
  - Fail-closed 정책: non-zero exit + 0 진단 항목 = 명시적 실패
- **Mutation Testing (#1)** — AI 생성 테스트 품질 검증:
  - Stryker (JS/TS), stryker-net (C#), mutmut (Python) 통합 (registry.json 기반)
  - `/deep-mutation-test`: git diff 기반 범위, 자동 테스트 재생성 루프 (최대 3회)
  - Implement phase 복귀 패턴: Phase 4 mutation 실패 → Phase 3 TDD 루프로 테스트 보강
  - Mutation Score Quality Gate (Advisory) + Session Quality Score 통합 (15% 가중치)
  - `stryker-parser.js`: NoCoverage + 로깅 변이에 possibly_equivalent 태깅
  - Receipt `mutation_testing` 필드: score, survived_details, auto_fix_rounds
- **Health Engine (#3A)** — Phase 1 Research 자동 Health Check (4개 드리프트 센서 병렬 실행):
  - `dead-export`: JS/TS 미사용 export 감지 (entry point/라이브러리/barrel 제외, health-ignore.json 지원)
  - `stale-config`: tsconfig.json, package.json, .eslintrc 깨진 경로 참조 감지
  - `dependency-vuln`: `npm audit --json` 기반 high/critical 취약점 감지 (Required gate)
  - `coverage-trend`: 이전 세션 baseline 대비 커버리지 퇴화 감지 (5%p 임계값)
- **아키텍처 Fitness Function (#4)** — `.deep-review/fitness.json` 선언적 아키텍처 규칙:
  - 4개 rule checker: `file-metric` (줄 수), `forbidden-pattern` (정규식), `structure` (colocated 테스트), `dependency` (순환 의존성, dep-cruiser)
  - `fitness-validator.js`: JSON 스키마 검증 + 규칙 실행 엔진 (`required_missing` 상태)
  - `fitness-generator.js`: Ecosystem-aware 자동 생성 (비 JS/TS에서 dependency 규칙 제외)
  - dep-cruiser 미설치 시 설명 + 설치 제안
- **Health Check 오케스트레이터** (`health-check.js`) — 병렬 드리프트 스캔 (Promise.allSettled) + 순차 fitness 검증 (센서별 타임아웃, 전체 180초)
- **Baseline 관리** — `health-baseline.json` commit/branch 스코핑, 브랜치 전환/rebase(git merge-base --is-ancestor)/7일 만료 시 자동 무효화
- **Phase 4 Quality Gates**:
  - Fitness Delta Gate (Advisory) — 이번 구현에서 추가된 fitness 위반 감지
  - Health Required Gate (Required) — Phase 1 required 실패 전파 + 유저 acknowledge 흐름
  - Phase 4 Baseline 갱신 — 게이트 통과 후 health-baseline.json 자동 업데이트
- **Receipt 스키마 확장** — `health_report` 필드 + `scan_commit` (deep-review stale 판정용)
- **deep-review 연동** — fitness.json을 리뷰 에이전트 프롬프트에 주입 + receipt health_report scan_commit 기반 stale 체크
- **Harness Templates (#5)**: 6개 내장 토폴로지(nextjs-app, react-spa, express-api, python-web, python-lib, generic)를 갖춘 토폴로지 감지 레이어. deep merge 및 custom/ override 지원 템플릿 로더. Phase 1/3에 토폴로지별 가이드 통합. Fitness generator에 template fitness_defaults 확장.
- **Self-Correction Loop (#6)**: always-on 레이어(토폴로지 가이드)와 fitness 레이어(fitness.json 규칙)를 갖춘 review-check 센서. 센서별 독립 3회 교정 제한. 설정 비활성화 지원. Receipt 스키마 확장.

### 변경
- 세션 품질 점수 5가지 가중치 (테스트 통과율 25%, 재작업 사이클 20%, Plan Fidelity 25%, 센서 클린율 15%, Mutation Score 15%). Health Check은 점수에서 제외.
- `sensors/registry.json` — javascript/typescript에 `audit` 필드 추가

## [5.8.1] - 2026-04-08

### 변경
- **Breaking**: `/deep-review` → `/deep-phase-review`로 리네이밍. deep-review 플러그인(deep-suite)과의 이름 충돌 해소. Phase 문서 리뷰는 `/deep-phase-review`, 코드 diff 리뷰는 deep-review 플러그인 사용.
- `deep-plan.md`, `deep-resume.md`, `README.md`, `README.ko.md` 참조 업데이트
- deep-review 플러그인 연동(Sprint Contract, 슬라이스 리뷰, 전체 리뷰)은 변경 없음

## [5.8.0] - 2026-04-08

### 추가
- **Completeness Policy** (Section 3.3-1) — plan.md의 명시적 금지 패턴 정의 (TBD, TODO, 모호한 지시, 컨텍스트 없는 교차 참조). Claude 자체 재검토 + structural review `code_completeness` 차원으로 강제.
- **Code sketch 크기별 완성도** — S: 주석 의사코드, M: 실제 함수 시그니처 + 타입 정의, L: 경계면 완전 코드 (인터페이스, API, 테스트). 기존 "의사코드 또는 실제 코드"를 비례 기준으로 대체.
- **Slice 필드: `expected_output`, `steps`** — `expected_output`: verification_cmd 성공 시 예상 출력. `steps`: M/L slice 내 실행 가이드 (3-12개 번호 액션). 하위 호환성을 위해 모두 optional.
- **`failing_test` 크기별 상세도** — S: 파일+설명, M: 함수 시그니처+핵심 assertion, L: 경계면 테스트 완전 본문.
- **"Boundary: Files NOT to Modify"** 섹션 — plan 템플릿에 추가, 구현 중 scope creep 방지.
- **Research 추적성 태그** — `[RF-NNN]` (Key Findings), `[RA-NNN]` (인터페이스/시그니처). plan Architecture Decision에서 구체적 연구 근거 참조 가능.
- **Research 태그 Lifecycle 규칙** — 단조 증가 번호, incremental 보존, plan 참조 태그 삭제 경고.
- **Research `Testing Patterns` 섹션** — 기존 테스트 프레임워크, assertion 스타일, 파일 명명 규칙 문서화.
- **Brainstorm 맥락 적응형 질문** — Core 2개 + 맥락별 1-3개 (기능/리팩토링/버그/성능/통합) + 마무리 경계 질문.
- **Brainstorm `Scope Assessment`** — 분해 점검 + 빠른 코드베이스 확인 후 접근법 비교.
- **Brainstorm `Boundaries` 섹션** — 변경하지 않는 부분 명시, plan Boundary 섹션으로 전달.
- **Review gate 차원: `code_completeness`, `buildability`** — 4곳 동기화 (structural 테이블, 하드코딩, cross-model Plan Rubric, JSON 스키마).
- **Review gate 하위 호환성 fallback** — `expected_output`/`steps` 없는 기존 plan은 차원별 완화 기준으로 평가.

### 변경
- `deep-implement.md` slice 파서가 `expected_output`, `steps`, `contract`, `acceptance_threshold` 인식 (모두 optional).
- Step B-1 (RED): `failing_test`에 테스트 코드가 있으면 직접 사용 (M/L).
- Step B-2 (GREEN): `expected_output`이 있으면 verification_cmd 출력과 비교.
- `deep-work.md` 인라인 plan: `failing_test` 표현 변경 + Completeness Policy 제외 주석.
- `research-guide.md` quality criteria 4→8개 확장.
- `plan-templates.md` API Endpoint 템플릿을 v5.8 exemplar로 업그레이드. 레거시 템플릿에 마이그레이션 가이드 추가.
- `testability` 차원: `expected_output`은 권장, 필수 아님으로 명확화.

## [5.7.0] - 2026-04-08

### 추가
- **W1: Sprint Contract 생성** — Phase 2 plan 승인 후, deep-review 플러그인이 설치되어 있으면 plan.md의 슬라이스에서 `.deep-review/contracts/SLICE-{NNN}.yaml` 자동 생성
- **W2-a: 슬라이스 리뷰 제안** — Phase 3에서 슬라이스 GREEN 도달 시 `/deep-review --contract SLICE-{NNN}` 실행 제안
- **W2-b: 전체 리뷰 제안** — Phase 4 진입 시 `/deep-review` 전체 리뷰 실행 제안
- **K1: 위키 ingest 제안** — Phase 4 완료 후 `/wiki-ingest report.md` 실행 제안

### 변경
- Sprint Contract 생성 시점을 plan 작성 직후에서 **plan 승인 후**로 이동 (최종 plan과 contract 일치 보장)
- 플러그인 감지를 cache + plugins 이중 경로로 통일 (설치 방식 무관)

## [5.6.0] - 2026-04-07

### 추가
- **`/deep-fork` 커맨드**: deep-work 세션을 fork하여 다른 접근법을 탐색하면서 원래 세션을 보존
  - Git 환경: worktree 기반 전체 복제, dirty 상태 검증 (`git stash --include-untracked`), session ID 기반 branch suffix (race condition 방지), worktree 컨텍스트 자동 전환 (`FORK_PROJECT_ROOT`)
  - Non-git 환경: 산출물만 복제, plan phase 제한 (implement/test는 phase guard가 차단)
  - 부모-자식 관계 추적: 상태 파일의 `fork_info`/`fork_children`
  - `fork-snapshot.yaml`: fork 시점 상태 스냅샷 (비교 기준점)
  - Stale 부모 검증 (git: commit 존재 확인, non-git: 작업 디렉토리 존재 확인)
  - Fork 세대 제한: 최대 3세대, 초과 시 경고
- **`/deep-status --tree`**: fork 관계 트리 시각화 (UTF-8 트리 문자)
- **`/deep-status --compare` 자동 감지**: 인자 없이 호출 시 fork 관계 자동 감지 비교
- **`/deep-status` fork 정보 표시**: 기본 출력에 `fork_info`/`fork_children` 표시
- **`/deep-cleanup` fork 지원**: idle fork 세션 스캔, 부모+자식 전체 idle 시 일괄 정리 제안
- **Phase guard**: artifacts-only fork 세션의 implement/test phase 차단
- **Fork 유틸 함수**: `validate_fork_target`, `get_fork_generation`, `update_parent_fork_children`, `register_fork_session` (원자적 레지스트리 + 부모 업데이트)
- **`session-end.sh`**: fork 세션 종료 시 부모의 `fork_children` 상태를 idle로 업데이트
- **Fork 통합 테스트**: 원자적 등록, 다중 fork, phase-guard 통합, edge cases, git worktree fork 등 18개 테스트

### 변경
- `deep-work-sessions.json` 레지스트리: 세션별 `fork_parent`, `fork_generation` 필드 추가
- 상태 파일 YAML frontmatter: `fork_info` (부모 관계), `fork_children` (자식 목록) 섹션 추가

## [5.5.2] - 2026-04-06

### 추가
- **확장된 bash 파일 쓰기 감지**: 20+ 신규 FILE_WRITE_PATTERNS — perl in-place (`perl -pi -e`), 런타임 언어 쓰기 (node -e `fs.writeFileSync`, python -c `open().write()`, ruby -e `File.write`), awk in-place, swift, truncate, sponge, git 파괴 연산 (`reset --hard`, `clean -f`), curl/wget 출력, ln, tar/unzip/cpio 추출, rsync, 범용 `writeFile` 감지.
- **확장된 safe command 패턴**: docker/kubectl 읽기 전용, cargo build/check/bench, go build/vet, deno test/check, bun run/x, python unittest, tsc --noEmit, stat/du/df/free/uname/hostname, diff/file, env/printenv, rmdir.
- **확장된 테스트 파일 패턴**: Dart (`.test.dart`, `_test.dart`), Elixir (`_test.exs`), Lua (`.test.lua`), Vue (`.test.vue`), `fixtures/`, `__fixtures__/`, `__mocks__/`, `spec/` 디렉토리.
- **확장된 TDD exempt 패턴**: `.toml`, `.ini`, `.cfg`, `.lock`, `.editorconfig`, `.svg`, `.png`, `.jpg`, `.gif`.
- **TDD state 검증**: 알 수 없는 TDD 상태값을 processHook에서 차단하고 안내 메시지 제공.
- **Backtick 및 subshell 처리**: `splitCommands`가 backtick 인용과 `$()` subshell 깊이를 추적하여 중첩 표현식 내부의 잘못된 분할 방지.
- **Perl 타겟 파일 추출**: `extractBashTargetFile`이 `perl -pi -e` 명령에서 타겟 파일을 추출하여 정확한 TDD 적용.

### 수정
- **보안: file-write-first 감지 순서**: FILE_WRITE_PATTERNS를 SAFE_COMMAND_PATTERNS보다 먼저 검사하여, safe 패턴이 파일 쓰기를 은폐하는 것을 방지 (예: `node -e`의 `fs.writeFileSync` 우회 차단).
- **file-tracker.sh Node.js 25 argv 호환성**: Node.js 25에서 `[eval]` 마커가 제거되어 receipt 생성이 무음 실패하던 문제 수정. `process.argv.filter(a => a !== '[eval]')`로 크로스 버전 호환.
- **assumption-engine.js quality-timeline CLI**: 파싱된 `parsed` 객체 대신 raw `input` 문자열을 참조하던 버그 수정.
- **assumption-engine.js evalSignal threshold 전달**: 시그널 평가자의 `threshold` 필드가 `fn()`에 올바르게 전달되도록 수정.
- **assumption-engine.js readHistory dedup 순서**: `session_id` 중복 시 first→latest로 변경하여 finalized 레코드가 무시되는 문제 해결.
- **assumption-engine.js 입력 가드**: `isSessionDuplicate`, `detectStaleness`, `detectNewModel`, `generateReport`에 `Array.isArray` 검사 추가.
- **session-end.sh JSON 검증**: JSONL append 전 JSON 유효성 검증으로 malformed entry 방지.
- **session-end.sh session ID fallback**: state file에 `started_at` 누락 시 `DEEP_WORK_SESSION_ID` 환경변수로 폴백.
- **session-end.sh 에러 로깅**: 에러를 `/dev/null` 대신 `.claude/deep-work-guard-errors.log`에 기록.
- **phase-guard.sh 에러 로깅**: Node.js 에러를 `.claude/deep-work-guard-errors.log`에 기록.
- **utils.sh matchGlob trailing slash**: 정확한 경로 비교에서 trailing slash 정규화.
- **utils.sh session pointer 안전성**: 세션 포인터 파일 쓰기 전 `mkdir -p` 추가.
- **utils.sh session ID 생성**: `/dev/urandom` hex 생성에서 탭 문자 제거.

### 변경
- **Redirect 감지 범위 확대**: 일반 출력 리다이렉트 패턴을 `(?:^|\|)` 접두사에서 `(?:^|[|;]|\s)`로 변경하여 명령 중간 리다이렉트 감지 (예: `cat << EOF > file`).
- **`node -e` safe 패턴 제거**: 이전에 safe로 처리되던 `node -e`를 다른 명령과 동일하게 file-write 패턴으로 평가.
- **모델 이름 살균**: `validateModelName`이 비알파벳 문자 제거; `lookupModel`에 `toString().trim()` 추가.
- **시그널 평가 threshold 설정 가능**: 평가자 정의의 `threshold` 필드로 설정 가능 (이전: 하드코딩된 기본 파라미터).
- **광범위 리다이렉트 패턴**: 명령 중간 리다이렉트 (heredoc, 공백 후) 올바르게 감지.

## [5.5.1] - 2026-04-03

### 변경
- **Plan 단계 team research 교차 검증**: `team_mode: team`일 때 plan 단계에서 부분 리서치 파일(`research-architecture.md`, `research-patterns.md`, `research-dependencies.md`)을 보조 참조로 로드. Claude 자체 재검토(Section 3.4.5)에서 합성 과정 누락 세부 사항을 교차 확인하여 plan 정확도 향상.
- **TDD state 업데이트 필수화**: `deep-implement.md`의 B-1 (RED_VERIFIED), B-2 (GREEN) state file 업데이트를 필수로 표시하고 phase guard 차단 경고 추가.

### 수정
- **phase-guard.sh 입력 파싱 안정화**: JSON 입력 빌드를 `process.argv`에서 stdin pipe 방식으로 변경하여 대용량 tool input에서 `set -e` 실패 방지.

## [5.5.0] - 2026-04-02

### 추가
- **Research Cross-Model Review**: codex/gemini adversarial review가 research 단계에도 적용 (기존: plan만 해당). Research 전용 rubric 사용 (completeness, accuracy, relevance, risk_identification, actionability).
- **Plan Claude 자체 재검토**: plan 작성 직후 자동 품질 점검 — placeholder, 내부 일관성, research 정합성, scope creep, 누락된 rollback 커버리지 탐색. 명백한 결함은 structural review 전에 자동 수정.
- **종합 판단 프로토콜**: 개별 conflict AskUserQuestion을 Claude 종합 판단 + 사용자 일괄 확인으로 대체. Research와 plan cross-model review 양쪽에 적용.
- **Auto-fix 스냅샷 계약**: 매 auto-fix 반복 전 스냅샷 필수, score 하락 시 rollback. Research: `research.v{N}.md`, Plan: `plan.autofix-v{N}.md`.
- **Degraded Mode**: cross-model 리뷰어 실패 시 `reviewer_status` 필드로 명시적 추적. Consensus/conflict 분류는 2개 이상 성공한 리뷰어 필요; 단독 결과는 "단독 이슈"로만 분류.
- **State 스키마 마이그레이션 (v5.5)**: 신규 필드 `review_results.{phase}.judgments`, `judgments_timestamp`, `reviewer_status`. 기존 state file 자동 초기화. Resume 시 문서 수정 시각 vs judgments_timestamp 비교 검증.

### 변경
- **Structural Review 기준 강화**: auto-fix 트리거를 score < 5에서 score < 7로 상향 (research, plan 양쪽). Research max iterations 3으로 증가.
- **Research 사용자 피드백 게이트**: 종합 판단 단계(Step 4.7)에 통합. Step 5와 auto-flow Step 9-3의 중복 AskUserQuestion 제거.
- **deep-review.md**: 개별 conflict UX 대신 종합 판단 프로토콜 사용으로 업데이트.
- **deep-resume.md**: `review_state: in_progress`로 resume 시 judgments_timestamp 검증 기반 새 리뷰 흐름으로 라우팅.

## [5.3.0] - 2026-03-31

### 추가
- **Document Intelligence**: research.md/plan.md 피드백 적용 시 자동 중복 제거 및 정리. 3단계 프로토콜: Apply → Deduplicate → Prune. Refinement log 추적.
- **Session Relevance Detection**: 피드백 적용 전 범위 확인 — 현재 세션 범위 밖 요청 감지 시 새 세션 분리 또는 백로그(`deep-work/backlog.md`) 저장 제안.
- **Plan Fidelity Score**: 구현 vs 플랜 충실도를 0-100 점수로 산출. drift-check 및 deep-test 인라인 검증에 통합.
- **Session Quality Score**: 세션 완료 시 자동 품질 점수(0-100) 산출. Core 지표: Test Pass Rate(35%), Rework Cycles(30%), Plan Fidelity(35%). 진단 지표(Code Efficiency, Phase Balance)는 참고용으로만 표시.
- **Assumption Snapshot**: 세션 시작 시 각 assumption의 enforcement level 기록. 정확한 active/inactive cohort 분석 가능.
- **Assumption Engine 품질 연동**: 품질 점수를 assumption 평가에 반영. Cohort 분석(cohort당 최소 3세션 게이트). `/deep-status --assumptions`에서 Quality Impact 표시.
- **Cross-Session Quality Trend**: 세션 간 품질 점수 추이를 ASCII 차트로 시각화. `/deep-status --history`에서 확인.
- **Quality Badge**: README용 shields.io 뱃지 생성. `/deep-status --badge`에서 사용. 뱃지: 품질 점수, 세션 수, 플랜 충실도.
- **Authoritative JSONL write**: `deep-finish`가 `harness-sessions.jsonl`에 atomic upsert(lock 패턴)로 확정 기록. `session-end.sh`는 provisional 레코드만 기록.

### 수정
- **JSONL 경로**: `session-end.sh`가 per-session 폴더 대신 공유 `deep-work/harness-history/`에 기록하도록 수정. trend/assumption 커맨드에서 세션 데이터가 보이지 않던 버그 해결.

### 변경
- **README 개편**: 데모 GIF 삭제. 문제→해결 중심 서술 구조로 전환. 품질 측정 및 자기 진화 규칙 섹션 추가.
- **exportBadge()**: 단일 뱃지 대신 `{ harness, quality, sessions, fidelity }` 객체 반환. 직접 소비자에 대한 breaking change — 테스트 업데이트 완료.
- **hooks.json**: 설명을 "v5.3 Precision + Evidence Protocol"로 업데이트.

## [5.2.0] - 2026-03-31

### 추가
- **Auto-flow 오케스트레이션**: `/deep-work`이 이제 모든 단계를 자동으로 연결 (brainstorm → research → plan → implement → test → finish). Plan 승인만이 유일한 필수 인터랙션
- **통합 `/deep-status`**: `--receipts`, `--history`, `--report`, `--assumptions`, `--all` 플래그로 5개 개별 커맨드를 하나로 통합
- **테스트 게이트 자동 실행**: Drift Check (필수), SOLID Review (권고), Insight Analysis가 Quality Gates 테이블 설정 없이 `/deep-test`에서 자동 실행

### 변경
- 13개 보조 커맨드에 deprecated 표시 추가 (여전히 동작, deprecation notice 추가)
- `/deep-work` Step 1: 세션 감지 시 이어서/새로/취소 선택지 제공 (기존: 덮어쓰기 경고만)
- `/deep-test`: plan.md의 Quality Gates 테이블이 이제 선택적 오버라이드 (자동 감지가 기본)
- `phase-guard-core.js`: TDD 차단 메시지에 auto-flow 대안 안내 추가
- SKILL.md 461줄 → ~250줄로 축소 (버전별 히스토리 섹션 제거)
- plugin.json 키워드 36개 → 12개로 축소

### Deprecated
- `/deep-brainstorm` — `/deep-work` 흐름에서 자동 실행
- `/deep-review` — `/deep-plan`에서 자동 실행
- `/deep-receipt` — `/deep-status --receipts` 사용
- `/deep-slice` — `/deep-implement`에서 자동 관리
- `/deep-insight` — `/deep-test`에서 자동 실행
- `/deep-finish` — `/deep-work` 흐름 끝에서 자동 실행
- `/deep-cleanup` — `/deep-work` init 시 자동 감지
- `/deep-history` — `/deep-status --history` 사용
- `/deep-assumptions` — `/deep-status --assumptions` 사용
- `/deep-resume` — `/deep-work` init 시 자동 감지
- `/deep-report` — `/deep-status --report` 사용
- `/drift-check` — `/deep-test`에서 자동 실행
- `/solid-review` — `/deep-test`에서 자동 실행

## [5.1.2] - 2026-03-30

### 추가
- **Team 모드 자동 설정**: Team 모드 선택 시 환경변수가 미설정이면 수동 안내 대신 Claude Code가 자동으로 `~/.claude/settings.json` 설정을 제안
- **Team 모드 런타임 검증**: 모든 단계(research, plan, implement)에서 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 환경변수를 재검증, 비활성화 시 자동 Solo fallback

### 수정
- **Team 모드 Solo fallback**: 설정 미완료 시 초기화 단계뿐 아니라 전 단계에서 안정적으로 Solo 모드로 전환

## [5.1.1] - 2026-03-30

### 수정
- **CRITICAL: Phase guard fail-closed** — `phase-guard-core.js`의 catch 블록이 내부 오류 시 allow 대신 block을 반환하도록 변경, TDD/단계 강제 우회 방지
- **CRITICAL: Receipt 원자적 쓰기** — Receipt JSON 업데이트가 temp 파일 + rename 패턴을 사용하여 동시 PostToolUse 훅의 데이터 손상 방지
- **HIGH: 명령어 체인 우회** — `detectBashFileWrite`가 체인된 명령어(`&&`, `||`, `;`, `|`)를 분리하여 각 하위 명령어를 독립 검증; safe prefix가 file-write suffix를 가리지 않음
- **HIGH: Bash TDD 대상 추출** — 새 `extractBashTargetFile()` 함수가 bash 명령어에서 실제 대상 파일을 추출하여 전체 명령어 문자열 대신 정확한 test/exempt 패턴 매칭
- **HIGH: Skipped phases 정확한 매칭** — 서브스트링 매칭을 쉼표 구분 정확 매칭으로 교체하여 오탐 방지
- **HIGH: Write/Edit file_path 미추출 시 차단** — 파일 경로를 추출할 수 없을 때 allow 대신 block으로 변경
- **MEDIUM: JSONL 히스토리 잠금** — `session-end.sh`가 동시 JSONL append에 mkdir 기반 잠금 사용
- **MEDIUM: 크로스 플랫폼 타임스탬프 파싱** — 기간 계산을 Node.js `Date.parse`로 교체 (macOS/GNU date 분기 제거)
- **MEDIUM: 알림 JSON 이스케이프** — 웹훅 페이로드가 `JSON.stringify`로 줄바꿈/유니코드 정상 이스케이프
- **MEDIUM: 경로 정규화** — `normalize_path`가 `..` 세그먼트를 `path.resolve`로 해결
- **MEDIUM: YAML 필드 추출** — `read_frontmatter_field`가 regex 인젝션 대신 리터럴 prefix 매칭 사용
- **MEDIUM: Receipt 초기 생성** — Heredoc을 `JSON.stringify`로 교체하여 slice ID 인젝션 방지

### 변경
- Assumption engine의 `SIGNAL_EVALUATORS`가 `{ scope, fn }` 형식 사용; session-scoped 신호는 세션당 1회, slice-scoped 신호는 any-true 집계
- `TEST_FILE_PATTERNS`에 Rust, Java, C#, Kotlin, Swift 패턴 추가
- phase-guard-core.js에 `splitCommands`, `extractBashTargetFile` 새 export 추가

## [5.1.0] - 2026-03-30

### 추가
- **자동 루프 검증**: Plan 리뷰와 테스트 단계에서 실패 시 자동 수정 + 재검증 (최대 3회)
- **계약 협상**: Slice에 테스트 가능한 `contract`와 `acceptance_threshold` 필드 추가
- **Assumption Engine 자동 적용**: 세션 시작 시 Wilson Score 기반 규칙 자동 조정
- **적응형 Evaluator 모델**: 모든 검증 subagent가 설정 가능한 모델 사용 (기본: sonnet), Assumption Engine으로 자동 조정
- **Phase 스킵 유연화**: `--skip-to-implement` 플래그, 인라인 slice 생성
- **양방향 조정**: Assumption Engine이 증거 기반으로 규칙 강화도 자동 수행

### 변경
- Structural review가 실패 시 자동으로 수정 루프 실행 (최대 3회)
- 테스트 단계가 실패 slice만 대상으로 자동 implement 복귀
- Assumption health 보고서에 현재 세션의 자동 조정 내역 표시
- Slice 형식에 `contract`와 `acceptance_threshold` 필드 추가
- 기본 evaluator 모델이 haiku에서 sonnet으로 변경

### 수정
- Assumption Engine 보고서의 "Auto-application is a Phase 2 feature" 문구 제거

## [5.0.0] - 2026-03-30

### 추가
- **Self-Evolving Harness (Assumption Engine)**: 모든 enforcement 규칙이 이제 machine-readable evidence signal을 가진 falsifiable hypothesis. deep-work가 세션 데이터로 자체 가설을 검증.
- **`assumptions.json`**: 5개 핵심 가설 레지스트리 (phase_guard, tdd, research, cross_model_review, receipt_collection). evidence signal, 조절 가능한 enforcement 레벨, 최소 세션 임계값 포함.
- **`assumption-engine.js`**: Wilson Score confidence, 모델별 분할, staleness 감지, 새 모델 감지, per-slice signal 평가, 리포트 생성, ASCII 타임라인, shields.io 배지 내보내기. 42개 단위 테스트.
- **`/deep-assumptions` 커맨드**: report (기본 + --verbose), history (ASCII 타임라인), export (--format=badge), --rebuild (receipts에서 JSONL 재생성).
- **Receipt의 `harness_metadata`**: slice별 메타데이터 (model_id, assumption_overrides, rework_count, tests_passed_first_try 등). 하위 호환.
- **세션 히스토리 JSONL**: Stop hook에서 `harness-sessions.jsonl` append. per-slice 데이터, 세션 중복 방지, 크로스 플랫폼 날짜 계산.
- **세션 초기화 시 건강도 요약**: `/deep-work`에서 충분한 히스토리가 있으면 가설 건강도 표시. 새 모델 감지 시 cold start 경고.
- **리포트의 Assumption Health**: `/deep-report`에 confidence 테이블과 세션별 harness metadata 집계 포함.

## [4.2.1] - 2026-03-26

### 추가
- **TDD Override**: 구현 중 TDD가 production 파일 수정을 차단하면, Claude가 차단 이유를 설명하고 사용자에게 대화형으로 선택지를 제공 — 테스트 먼저 작성(권장), 또는 사유와 함께 이 slice의 TDD 건너뛰기(config 변경, 테스트 불가, 긴급 수정). Override는 slice 범위로 제한되며 slice 전환 시 자동 해제.
- **차단 메시지에 탈출구 안내**: strict/coaching 모드의 TDD 차단 메시지에 `/deep-slice spike`, `/deep-slice reset` 대안을 표시하여 사용자가 우회 방법을 즉시 알 수 있도록 개선.
- **`tdd_override` 상태 필드**: 어떤 slice에 TDD override가 활성화되어 있는지 추적. Hook이 이 필드를 읽어 fast-path 허용 결정.
- **Receipt에 override 기록**: Override된 slice는 receipt JSON에 `tdd_override: true`와 `tdd_override_reason`으로 기록. Receipt 대시보드에서 `override` 상태를 `spike`와 구분하여 표시 (merge 가능 + 경고).
- 9개 새 unit test 추가 (총 56개)

### 변경
- `phase-guard-core.js`: `checkTddEnforcement`에 `tddOverride` 파라미터 추가; `processHook`에서 `state.tdd_override` 전달
- `phase-guard.sh`: state 파일에서 `tdd_override` 읽기; active slice와 일치하는 override에 대한 fast-path 추가; Node.js에 override 전달
- `deep-implement.md`: "TDD Override" 섹션 추가 (AskUserQuestion 흐름, main 모델 라우팅만 적용)
- `deep-receipt.md`: Override 아이콘, 카운트, JSON 스키마 업데이트
- `deep-finish.md`: `tdd_compliance`에 `override` 카운트 포함
- `deep-history.md`: `tdd_compliance` 및 TDD 준수율 표시에 `override` 포함

## [4.2.0] - 2026-03-25

### 추가
- **구조적 리뷰(Structural Review)**: 모든 페이즈 문서(brainstorm, research, plan)가 Claude haiku 서브에이전트를 통해 페이즈별 차원으로 구조적 리뷰를 받음
- **적대적 크로스 모델 리뷰(Adversarial Review)**: Plan 문서가 codex 및/또는 gemini-cli에 의해 독립적으로 리뷰됨 (아키텍처, 가정, 리스크 커버리지)
- **갈등 해결 UX**: 모델 간 의견이 다를 때 갈등을 투명하게 표시하고 사용자가 해결 방식을 결정 (수용, 면책, 수동 편집)
- **리뷰 게이트**: 구조적 리뷰 점수 <5 또는 비판적 합의 이슈가 있으면 자동 구현 전환 차단
- **`/deep-review` 커맨드**: 구조적 또는 적대적 리뷰를 언제든 수동 트리거
- **`--skip-review` 플래그**: spike/실험 세션에서 모든 리뷰 건너뛰기
- **크로스 모델 도구 자동 감지**: 세션 초기화 시 codex/gemini-cli 자동 감지
- **프로필 `cross_model_preference`**: 프리셋에 크로스 모델 선호 저장 (항상/안함/매번 확인)
- **리뷰 상태 resume/status 통합**: `/deep-resume`이 리뷰 상태를 인식; `/deep-status`가 리뷰 결과 표시
- **JSON 스키마 정규화**: 모든 리뷰 결과가 구조화된 JSON으로 저장 (`{phase}-review.json`)

### 변경
- `deep-brainstorm.md`: 기존 spec review를 review-gate 프로토콜 참조로 교체
- `deep-research.md`: 리서치 완료 후 구조적 리뷰 추가
- `deep-plan.md`: 승인 전 구조적 + 적대적 리뷰 추가
- `phase-guard-core.js`: SAFE_COMMAND_PATTERNS에 codex/gemini/mktemp 추가
- State 파일: `review_state`, `cross_model_tools`, `cross_model_enabled`, `review_results` 필드 추가
- 프로필: 프리셋 스키마에 `cross_model_preference` 추가

### 수정
- `.gitignore`: `deep-work-workflow-workspace/` 추가하여 venv 추적 방지

## [4.1.0] - 2026-03-25

### Added
- **Worktree 격리**: 세션이 기본적으로 격리된 git worktree에서 실행됩니다. `/deep-work` 시 `.worktrees/dw/<slug>/`에 worktree를 생성하여 main 브랜치를 보호합니다. `--no-branch` 또는 프리셋의 `git_branch: false`로 비활성화 가능.
- **슬라이스 복잡도 기반 모델 자동 선택**: 구현 단계에서 각 슬라이스의 크기(S/M/L/XL)에 따라 최적 모델(haiku/sonnet/opus)을 자동 선택합니다. `/deep-slice model SLICE-NNN <모델>`로 슬라이스별 override 가능. 프리셋에서 routing_table 커스터마이즈 가능.
- **세션 완료 워크플로우** (`/deep-finish`): 세션 종료 시 4가지 옵션 제공 — 베이스 브랜치로 병합, PR 생성, 브랜치 유지, 삭제. `session-receipt.json`으로 전체 세션 요약 생성.
- **CI/CD receipt 검증**: `validate-receipt.sh`로 receipt 체인 무결성 검증. `templates/deep-work-ci.yml`로 GitHub Actions 워크플로우 템플릿 제공. `/deep-receipt export --format=ci`로 CI 친화적 번들 내보내기.
- **세션 이력 대시보드** (`/deep-history`): 과거 세션들의 모델 사용량, TDD 준수율, 완료율, 비용 추적 등 크로스 세션 트렌드 표시.
- **Worktree 정리** (`/deep-cleanup`): 7일 이상 된 비활성 deep-work worktree를 스캔하고 일괄/개별 삭제 옵션 제공.
- **Receipt 스키마 v1.0**: 새 필드 — `schema_version`, `model_used`, `model_auto_selected`, `worktree_branch`, `git_before`, `git_after`, `estimated_cost`. Session receipt은 파생 캐시이며 slice receipt이 정본.
- **Receipt 마이그레이션 헬퍼** (`receipt-migration.js`): v4.1 이전 receipt을 스키마 v1.0으로 자동 변환. atomic write 및 손상 파일 백업 지원.
- **Worktree 인식 세션 재개** (`/deep-resume`): 세션 재개 시 worktree 경로를 감지하고 작업 디렉토리 컨텍스트를 복원. 삭제된 worktree도 우아하게 처리.
- **모델 비용 추적**: slice 및 session receipt에 `estimated_cost` 필드로 세션별 AI 모델 사용 비용 가시성 제공.
- **Shell 유틸리티 추출** (`utils.sh`): 3개 hook 스크립트의 공통 함수를 단일 소스 파일로 추출하여 코드 중복 제거.
- **모델 라우팅 테스트**: 라우팅 테이블 조회, 모델 이름 검증, 커스텀 테이블 override에 대한 11개 새 유닛 테스트 추가 (총 48개 테스트).

### Changed
- 기본 `model_routing.implement`가 `"sonnet"`에서 `"auto"` (크기 기반 라우팅)로 변경
- 프리셋의 기본 `git_branch`가 `true`로 변경 (worktree 격리 기본 활성화)
- `session-end.sh`가 worktree 브랜치 정보를 표시하고 `/deep-finish` 사용을 안내
- `validate-receipt.sh`가 macOS Bash 3.2 호환을 위해 `set -eo pipefail` 사용

## [4.0.1] - 2026-03-25

### Added
- **Git 기반 자동 업데이트 체크**: SessionStart 훅에서 GitHub 최신 버전 확인. 자동 업그레이드, 스누즈(24h→48h→1w), 비활성화 지원.
- **Shell injection 방지**: phase-guard.sh, file-tracker.sh에서 `process.argv`로 안전한 값 전달.

### Fixed
- macOS 호환성: `timeout` 명령 제거 (macOS 미지원)
- 버전 일관성: CLAUDE.md, TODOS.md에 올바른 v4.0 버전 반영

## [4.0.0] - 2026-03-25

### BREAKING — Evidence-Driven Development Protocol

deep-work이 **evidence-driven development protocol**로 전환되었습니다. 모든 코드 변경에 증거가 수반됩니다: failing test output, passing test output, git diff, spec compliance check, code review — 모두 JSON receipt으로 수집됩니다.

### Added
- **Phase 0: 브레인스톰** (`/deep-brainstorm`): "왜 만드는가"를 먼저 탐색 — 문제 정의, 접근법 비교, spec-reviewer 검증. `--skip-brainstorm`으로 생략 가능.
- **Slice 기반 실행**: Plan 태스크가 "slice"로 변환 — per-slice TDD 사이클, 파일 범위, 검증 커맨드, 스펙 체크리스트 포함.
- **TDD 강제**: Hook 기반 상태 머신 (PENDING→RED→RED_VERIFIED→GREEN_ELIGIBLE→GREEN→REFACTOR). failing test 없이 production 코드 수정 차단. 모드: `strict`, `relaxed`, `coaching`, `spike`.
- **Receipt 시스템**: slice별 JSON 증거 수집 (`receipts/SLICE-NNN.json`) — test output, git diff, lint, spec checklist, code review.
- **Bash 도구 감시**: PreToolUse 훅이 Bash 커맨드도 감시. `echo >`, `sed -i`, `cp`, `tee` 등 파일 쓰기 패턴 탐지/차단.
- **체계적 디버깅** (`/deep-debug`): 4단계 root-cause 조사 (investigate→analyze→hypothesize→fix). 예기치 않은 테스트 실패 시 자동 진입. 3회 실패 후 에스컬레이션.
- **Slice 관리** (`/deep-slice`): ASCII 진행 대시보드, 수동 활성화, spike 모드, slice 리셋.
- **Receipt 관리** (`/deep-receipt`): 대시보드 뷰, per-slice 상세, JSON/Markdown export.
- **2단계 코드 리뷰**: Spec Compliance Review (required) + Code Quality Review (advisory) — 서브에이전트 기반.
- **Receipt Completeness Gate** (required): 모든 slice에 receipt 존재 확인.
- **Verification Evidence Gate** (required): 실제 테스트 실행 증거 확인.
- **TDD Coaching 모드**: TDD 초보자를 위한 교육적 메시지 (차단 대신 가이드).
- **Spike Mode Guard**: spike 종료 시 자동 git stash + slice 리셋.
- **29개 unit test**: phase-guard-core.js (TDD 상태 머신, Bash 탐지, slice scope, receipt 검증).

### Changed
- Hook 아키텍처: bash+Node.js 하이브리드 — bash fast path (~50ms), Node.js subprocess (~200ms).
- Plan 포맷: Task Checklist → Slice Checklist (per-slice 메타데이터).
- `hooks.json`: PreToolUse/PostToolUse에 `Bash` 추가.
- `phase-guard.sh`: bash+Node 하이브리드로 전면 재작성.
- `file-tracker.sh`: receipt 수집 및 active slice 매핑 확장.
- `deep-implement.md`: Slice 단위 TDD 실행으로 전면 재설계.
- `deep-test.md`: 4개 신규 Quality Gate 추가.
- `deep-plan.md`: Slice 포맷 도입.
- `deep-work.md`: Phase 0 옵션, `--tdd=MODE`, `--skip-brainstorm`.
- `package.json`: 4.0.0 → 4.0.1.

## [3.3.3] - 2026-03-24

### Added
- **멀티 프리셋 Profile System**: 작업 스타일별 Named 프리셋 지원 (예: `dev`, `quick`, `review`).
  - Profile v2 형식: 단일 YAML 파일에 `presets:` 키로 여러 프리셋 저장
  - v1 → v2 자동 마이그레이션 (기존 단일 프로필 → `default` 프리셋으로 래핑)
  - `/deep-work --setup`으로 프리셋 관리 UI (생성, 수정)
  - `/deep-work --profile=X "작업"` 으로 프리셋 직접 지정 (인터랙티브 스킵)
  - 프리셋 2개 이상 시 AskUserQuestion으로 선택
  - 프리셋 1개인 경우 자동 적용
- **트리거 평가 최적화**: trigger-eval.json 확장 및 SKILL.md description 정제.
  - trigger-eval.json 20개 → 31개 (16 true + 15 false)
  - v3.3.2 기능 커버리지 추가: profile, preset, resume, checkpoint 키워드
  - 동음이의어 false positive 방지 (profile picture, resume template, deep copy 등)
  - SKILL.md description 최적화: 범용 키워드 제거, preset/프리셋 추가

### Changed
- `deep-work.md` Step 1.5 전면 재작성: v2 프로필 버전 체크 (v1 자동 마이그레이션, v2 정상 진행, 그 외 거부), 프리셋 선택 로직, 필드→변수 매핑
- `deep-work.md` Step 1.5a 플래그 테이블에 `--profile=X` 추가
- `deep-work.md` Step 1.5b: `--setup` 시 프리셋 관리 UI 표시 (태스크 유무에 따라 분기)
- `deep-work.md` Step 1.5d: 프리셋 관리 UI 신규 섹션 (편집, 생성)
- `deep-work.md` Step 7: 상태 파일 템플릿에 `preset` 필드 추가
- `deep-work.md` Step 7.5: 프로필 저장 형식 v1 (`defaults.*`) → v2 (`presets.default.*`)
- `deep-work.md` Step 8: 확인 메시지에 프리셋 이름 표시 (🎯 프리셋: [name])
- `deep-resume.md` Step 1: 상태 파일에서 `preset` 필드 추출
- `deep-resume.md` Step 3: 재개 상태 표시에 프리셋 이름 포함
- SKILL.md Profile System 섹션에 멀티 프리셋 문서 추가
- SKILL.md v3.3.3 Features 섹션 추가

## [3.3.2] - 2026-03-22

### Added
- **Profile System**: 질문 없는 세션 초기화를 위한 자동 프로필 저장/로드.
  - 첫 `/deep-work` 실행 시 설정 답변을 `.claude/deep-work-profile.yaml`에 자동 저장
  - 이후 실행 시 모든 설정 질문 스킵, 저장된 프로필 즉시 적용
  - 단일 세션 오버라이드 플래그: `--team`, `--zero-base`, `--skip-research`, `--no-branch`
  - 프로필 재설정: `/deep-work --setup`
  - 마이그레이션용 프로필 버전 필드 (`version: 1`)
- **Session Resume (`/deep-resume`)**: 중단된 세션 복구 및 전체 컨텍스트 복원.
  - `.claude/deep-work.local.md`에서 활성 세션 자동 감지
  - 산출물에서 AI 컨텍스트 복원: research.md (요약), plan.md (전문), test-results.md (실패 내역)
  - Phase별 자동 재개: research → plan 리뷰 → implement 체크포인트 → test
  - Implement 단계: 체크포인트 기반 재개 (모델 라우팅 재위임 우회)
- **Checkpoint Verification**: Agent 위임 후 구현 무결성 검증.
  - `git diff --name-only` 기반 1차 검증
  - git 변경이 있으나 미표시된 태스크의 plan.md `[x]` 자동 보정
  - `file-changes.log` 미존재 시 graceful fallback (Agent 위임 모드)

### Changed
- `deep-work.md` Step 1.5 (프로필 로드/플래그 파싱), Step 7.5 (프로필 저장) 구조 추가
- `deep-work.md` Step 2-1 (git 브랜치) 프로필 설정에 따라 자동 생성/스킵
- `deep-implement.md` Section 0-pre Agent 프롬프트에 체크포인트 의무 명시
- `deep-implement.md` Section 0-pre에 Agent 완료 후 체크포인트 검증 단계 추가
- SKILL.md description에 resume/profile 트리거 키워드 추가
- SKILL.md에 Profile System, Session Resume, v3.3.2 Features 섹션 추가

## [3.3.0] - 2026-03-22

### Added
- **Insight 계층 Quality Gate**: 3계층 Quality Gate 시스템의 세 번째이자 마지막 계층. 워크플로우 차단 없이 코드 메트릭과 분석 정보를 제공.
  - `/deep-insight` 커맨드 (standalone/workflow 이중 모드)
  - 내장 분석: 파일 메트릭, 복잡도 지표, 의존성 그래프, 변경 요약
  - plan.md Quality Gates 테이블에 커스텀 ℹ️ 게이트 정의 가능
  - `insight-report.md` 산출물
  - `/deep-test`에서 Required/Advisory 게이트 이후 자동 실행
- **PostToolUse 파일 추적**: `file-tracker.sh` 훅이 Implement 단계에서 파일 수정을 자동으로 `$WORK_DIR/file-changes.log`에 타임스탬프와 함께 기록. `/deep-report`와 `/deep-insight`에서 활용.
- **Stop 훅 — 세션 종료 핸들러**: `session-end.sh` 훅이 CLI 세션 종료 시 실행. Deep Work 세션이 활성 상태이면 알림 메시지 출력 및 설정된 채널로 알림 전송.
- **insight-guide.md**: Insight 계층 레퍼런스 가이드 — 분석 해석 방법, 커스텀 게이트 정의, 제한 사항

### Changed
- `hooks.json`이 PreToolUse 전용에서 PreToolUse + PostToolUse + Stop 3개 이벤트로 확장
- `/deep-test` Section 2-1에서 ✅(required), ⚠️(advisory)와 함께 ℹ️(insight) 마커 파싱 추가
- `/deep-test` Section 4에 "4-2. Built-in Insight Analysis" 단계 추가 (Required/Advisory 게이트 이후 실행)
- `quality-gates.md` 출력에 "Insight Gates" 섹션 및 판정의 insight 카운트 추가
- `/deep-report`가 `insight-report.md`와 `file-changes.log`를 읽어 리포트 보강
- `/deep-status` 산출물 목록에 `insight-report.md`, `file-changes.log` 추가
- `/deep-implement`에 PostToolUse 파일 추적 안내 노트 추가
- SKILL.md Phase Enforcement 섹션에 3개 훅 유형 전체 문서화
- SKILL.md description에 insight/metrics/tracking 트리거 키워드 추가

## [3.2.2] - 2026-03-21

### Added
- **다국어 지원 (i18n)**: 9개 커맨드 파일 모두 사용자의 메시지 또는 Claude Code `language` 설정에서 언어를 감지하여 해당 언어로 모든 사용자 대면 메시지를 출력. 한국어 템플릿을 참조 포맷으로 유지하며 Claude가 사용자 언어에 맞게 자연스럽게 번역. 영어, 일본어, 중국어 등 모든 언어 사용자 지원.
- SKILL.md에 Internationalization 섹션 추가.

## [3.2.1] - 2026-03-21

### Fixed
- **SKILL.md description 축소**: ~1,500자 → ~450자 (권장치의 3배 초과 해소). 하위 기능 트리거 키워드 제거하여 매칭 정확도 향상 및 매 대화마다 소모되는 프롬프트 예산 절감.
- **SKILL.md changelog 중복 제거**: 본문과 중복되던 v3.1.0/v3.2.0 Features 섹션(~400단어) 삭제. 비표준 `compatibility` frontmatter 필드를 본문 Compatibility 섹션으로 이동.
- **deep-research.md 섹션 번호 정리**: 0, 0-1, 0-2 → 1-1, 1-2, 1-3으로 논리적 실행 순서에 맞게 변경.
- **deep-test.md allowed-tools 수정**: Phase Guard가 코드 수정을 차단하는 Test phase에서 `Edit` 도구 제거.
- **커맨드 description 언어 통일**: `drift-check.md`, `solid-review.md`의 description을 한국어에서 영문으로 변경 (나머지 7개 커맨드와 일치).
- **notify.sh JSON 안전성**: JSON 보간 전 `MESSAGE` 변수의 쌍따옴표/백슬래시 이스케이프 추가하여 잘못된 페이로드 방지.
- **Phase Guard 경로 참조**: SKILL.md에 `hooks/scripts/phase-guard.sh` 명시적 경로 추가.

### Added
- `.gitignore` 파일 추가 (`.npmignore` 패턴 반영). 상태 파일 및 세션 아티팩트의 실수 커밋 방지.

## [3.2.0] - 2026-03-18

### Added
- **3계층 Quality Gate 시스템**: Quality Gate를 3계층으로 분리 — Required (차단), Advisory (경고), Insight (정보, v3.3 예정).
- **Plan Alignment / Drift Detection**: `/drift-check` 커맨드 및 `/deep-test` 내장 Required 게이트. plan.md 항목과 실제 git diff를 자동 비교하여 미구현 항목, 범위 초과, 설계 이탈을 감지. `drift-report.md` 산출물.
- **SOLID Design Review**: `/solid-review` 커맨드 및 Advisory Quality Gate. 5가지 SOLID 원칙(SRP, OCP, LSP, ISP, DIP) 기준 코드 설계 품질 리뷰. 파일별 스코어카드, 종합 판정, Top 5 리팩토링 제안. `solid-review.md` 산출물.
- **solid-guide.md**: 프레임워크 무관 SOLID 리뷰 체크리스트 (심각도 기준 + KISS 균형)
- **solid-prompt-guide.md**: AI 도구에 SOLID 준수 코드를 요청하고 AI 출력물을 검증하는 가이드

### Changed
- `/deep-test`에서 plan.md 존재 시 다른 Quality Gate 이전에 Plan Alignment 검사를 자동 실행 (설정 불필요)
- SKILL.md 구조 개선: Plan Alignment, SOLID Review, Session Report를 "Quality Gates & Utilities" 섹션으로 분리 (기존 "The Four Phases" 하위에서 이동)
- SKILL.md description 최적화: ~40개 세부 트리거 키워드를 ~10개 대표 키워드로 통합 (신호 대 잡음비 개선)
- SKILL.md에 v3.2.0 Features 섹션 추가 (영어 일관성 유지)
- State 스키마에 `plan_approved_at` 필드 추가 (선택적, Drift Detection 비교 기준)

## [3.1.0] - 2026-03-17

### Breaking Changes
- **저장소 구조 개편**: 루트 플러그인에서 `plugins/deep-work/` 서브디렉토리 패턴으로 전환. 기존 사용자는 재설치 필요.

### Added
- **모델 라우팅 (F1)**: Phase별 최적 모델 배정 (Research=sonnet, Plan=main, Implement=sonnet, Test=haiku). Agent 위임 패턴으로 토큰 30~40% 절감.
- **멀티채널 알림 (F2)**: Phase 완료 시 OS 네이티브 + Slack/Discord/Telegram/커스텀 Webhook 알림. Fire-and-forget 패턴.
- **증분 리서치 (F3)**: `/deep-research --incremental` — git diff 기반 변경 영역만 재분석. 시간 60~80% 절감.
- **Quality Gate 시스템 (F4)**: plan.md에 Quality Gates 정의 → required/advisory 게이트 실행. `quality-gates.md` 산출물.
- **Plan Diff 시각화 (F5)**: Plan 재작성 시 구조적 변경 사항 자동 시각화. `plan-diff.md` 산출물.
- **model-routing-guide.md**: 모델 라우팅 설정 가이드
- **notification-guide.md**: 알림 채널 설정 가이드

### Changed
- `/deep-work` 초기화에 모델 라우팅/알림 설정 옵션 추가
- `/deep-status`에 모델 라우팅, 알림, Quality Gate 상태 표시
- `/deep-report`에 Quality Gate 결과, Plan Diff 요약 섹션 추가
- State 스키마에 `model_routing`, `notifications`, `last_research_commit`, `quality_gates_passed` 필드 추가
- marketplace.json source 경로 `"./"` → `"./plugins/deep-work"` 변경

## [3.0.0] - 2026-03-13

### Added

#### Phase 4: Test (`/deep-test`)
- **P-1**: 새로운 Test phase 추가 (`implement → test → idle`)
- 프로젝트 설정 파일에서 테스트/린트/타입체크 명령어 자동 감지 (package.json, pyproject.toml, Makefile, Cargo.toml, go.mod)
- 테스트 실패 시 implement 단계로 자동 복귀, 수정 후 재테스트 루프 (최대 3회)
- `test-results.md`에 시도별 검증 결과 누적 기록
- Test phase에서 코드 수정 차단 (Phase Guard)

#### 제로베이스 모드
- **P-3**: 새 프로젝트를 처음부터 설계하는 Zero-Base 모드 추가
- 기술 스택 선정, 코딩 컨벤션, 데이터 모델, API 설계, 스캐폴딩, 의존성 평가 6개 영역 Research
- Plan에서 "Files to Create" + "Project Structure" + "Setup Instructions" 제공
- `references/zero-base-guide.md` 신규 가이드 추가

#### 대화형 Plan 리뷰
- **A-7**: 채팅으로 피드백하면 plan.md 자동 수정 (파일 직접 편집 불필요)
- 수정 내용 하이라이트 표시 후 재리뷰 대기

#### Plan 기능 강화
- **A-6**: Plan 재작성 시 이전 버전을 `plan.v{N}.md`로 백업, Change Log 섹션 추가
- **A-11**: 작업 유형별 Plan 템플릿 6종 (API 엔드포인트, UI 컴포넌트, DB 마이그레이션, 리팩토링, 버그 수정, Full Stack 기능)
- **P-2**: Plan 승인 시 Team↔Solo 모드 전환 자동 제안 (태스크 수, 파일 수 기반)

#### Research 기능 강화
- **A-8**: 부분 리서치 재실행 — `/deep-research --scope=api,data`로 특정 영역만 재분석
- **A-9**: Research 캐싱 — 이전 세션의 research.md를 베이스라인으로 활용, git diff 기반 변경 영역만 재분석

#### Git 통합
- **A-10**: 세션 시작 시 `deep-work/[slug]` 브랜치 생성 제안
- 세션 완료(테스트 통과) 시 커밋 메시지 자동 생성 및 커밋 제안

#### Phase 스킵
- **A-1**: 세션 초기화 시 Research를 건너뛰고 Plan부터 시작 가능
- 익숙한 코드베이스에서 불필요한 Research 생략

#### Implement 체크포인트
- **A-4**: 구현 중 중단 후 재실행 시 완료된 태스크 자동 스킵, 미완료 태스크부터 재개

#### 시간 추적
- **A-12**: 모든 Phase의 시작/완료 타임스탬프 기록
- 세션 리포트에 Phase별 소요 시간 테이블 추가

#### Team 모드 진행 알림
- **A-13**: Team 모드에서 에이전트 태스크 완료 시 `[2/3] pattern-analyst 완료 ✅` 형식 진행 알림

#### 세션 비교
- **A-14**: `/deep-status --compare`로 두 세션의 접근법, 수정 파일, 검증 결과 비교

#### 신규 파일
- `commands/deep-test.md` — Test Phase 커맨드
- `references/testing-guide.md` — Test Phase 상세 가이드
- `references/plan-templates.md` — Plan 템플릿 모음
- `references/zero-base-guide.md` — 제로베이스 Research 가이드
- `CHANGELOG.md` — 변경 이력 파일

### Changed

#### 출력 형식 개선
- **P-5**: research.md에 Executive Summary, Key Findings, Risk & Blockers를 최상단에 배치 (피라미드 원칙)
- **P-5**: plan.md에 Plan Summary (접근법, 변경 범위, 리스크, 핵심 결정)를 최상단에 배치

#### Phase Guard 메시지 개선
- **A-2**: 차단 메시지에 Phase별 "다음 단계" 구체적 안내 추가
- Research: "→ /deep-plan 또는 /deep-research 실행"
- Plan: "→ 계획 승인 또는 /deep-plan 재실행"
- Test: "→ 테스트 통과/실패 시 자동 처리, test-results.md 참조"

#### Phase 흐름 변경
- `research → plan → implement → idle` → `research → plan → implement → test ⟲ → idle`
- Implement 완료 후 idle 대신 test phase로 자동 전환
- Test 실패 시 implement로 복귀하는 재시도 루프

#### 상태 파일 스키마 확장
- 신규 필드: `project_type`, `git_branch`, `test_retry_count`, `max_test_retries`, `test_passed`
- 신규 타임스탬프: `research_started_at/completed_at`, `plan_started_at/completed_at`, `implement_started_at/completed_at`, `test_started_at/completed_at`

#### 버전 통일
- **A-3**: `plugin.json`과 `package.json`의 버전을 3.0.0으로 통일

#### SKILL.md 업데이트
- 4-phase 워크플로우 반영
- 제로베이스 모드 트리거 키워드 추가 ("새 프로젝트 시작", "제로베이스", "zero-base", "from scratch")
- 신규 기능 설명 추가 (Research 캐싱, 부분 재실행, Plan 템플릿, 대화형 리뷰 등)

#### Reference 가이드 업데이트
- `research-guide.md` — Executive Summary/Key Findings 출력 형식 추가, 제로베이스 가이드 링크
- `planning-guide.md` — Plan Summary 출력 형식 추가, 템플릿 가이드 링크
- `implementation-guide.md` — 완료 후 Test phase 전환으로 Completion Protocol 변경

## [2.0.0] - 2026-03-07

### Added
- 작업별 폴더 히스토리 (`deep-work/YYYYMMDD-HHMMSS-slug/`)
- 승인 시 자동 구현 시작
- 세션 리포트 자동 생성 (`report.md`)
- `/deep-report` 커맨드 (리포트 조회/재생성)
- `/deep-status` 커맨드 (상태, 진행률, 세션 히스토리)
- Solo/Team 모드 선택
- Team 모드: 3명 병렬 Research, 파일 소유권 기반 병렬 Implement, 크로스 리뷰

### Changed
- 상태 파일에 `work_dir`, `team_mode`, `started_at` 필드 추가
- Phase Guard가 `deep-work/` 디렉토리 내 문서 수정은 허용

## [1.1.0] - 2026-03-01

### Added
- Phase Guard (PreToolUse hook) — Research/Plan 단계에서 코드 파일 수정 차단
- 상태 파일 기반 phase 관리

### Changed
- 기존 단순 프롬프트 기반에서 hook 기반 강제 분리로 전환

## [1.0.0] - 2026-02-15

### Added
- 초기 버전
- 3단계 워크플로우: Research → Plan → Implement
- `/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement` 커맨드
- `research.md`, `plan.md` 산출물 생성
- 반복적 Plan 리뷰 지원
