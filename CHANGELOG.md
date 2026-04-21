**English** | [한국어](./CHANGELOG.ko.md)

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

### Known Limitations (v6.3.2 예정)

- **Out-of-band 편집 후 approval 재사용 가능** — `research.md` 또는 `plan.md`를 Orchestrator option 2 경로를 거치지 않고(예: 일시정지 중 외부 편집기로) 수정하면, `research_approved` / `plan_approved` marker는 그대로 유지되어 `/deep-resume` 시 Resume fast-path가 stale approval을 재사용. Orchestrated path(Exit Gate option 2 "재실행/수정")를 사용하면 approval이 정상 clear됨. 근본 해결은 approval 시점 file hash snapshot 기반 integrity check — v6.3.2에서 설계 후 구현 예정.

## [6.3.0] — 2026-04-18

### Added
- **Phase 5 "Integrate"** — new skippable phase after Test that reads deep-suite plugin artifacts (`deep-review`, `deep-docs`, `deep-wiki`, `deep-dashboard`, `deep-evolve`) and lets an AI recommend top-3 next steps which the user can choose to execute. Interactive loop (max 5 rounds) with recommendation + rationale + signals. Design spec: `docs/superpowers/specs/2026-04-18-phase5-integrate-design.md`.
- `/deep-integrate` command for manual re-entry after skipping Phase 5.
- `--skip-integrate` flag to skip Phase 5 and go directly to `/deep-finish`.
- `skills/deep-integrate/` — new skill with helper scripts (`detect-plugins.sh`, `gather-signals.sh`, `phase5-finalize.sh`, `phase5-record-error.sh`), JSON schemas, and L6 snapshot fixtures.
- `phase5_work_dir_snapshot` state field — immutable boundary snapshot recorded at Phase 5 entry, used by phase-guard as enforcement reference so that runtime tampering with `work_dir` cannot widen the write boundary.
- `phase5-finalize.sh` helper — atomically records `phase5_completed_at` in the session state file. Validates the state file matches the current session and is the only sanctioned path for writing to state during Phase 5.
- `phase5-record-error.sh` helper — used by `/deep-finish --skip-integrate` to record `terminated_by: "error"` in `integrate-loop.json` when Phase 5 failed. Belt-and-suspenders alongside the Stop-hook `terminated_by: "interrupted"` marker.
- Stop-hook: record `terminated_by: "interrupted"` in `integrate-loop.json` on session interruption.

### Changed
- `deep-work-orchestrator` dispatches Phase 5 between Phase 4 (Test) and `/deep-finish`. On Phase 5 error, passes `--skip-integrate` to `/deep-finish` so state-machine can close.
- `/deep-finish` hints `/deep-integrate` when no `integrate-loop.json` exists. `--skip-integrate` now bypasses the Phase 5-interrupted prompt and runs `phase5-record-error.sh` defensively.
- **`phase-guard.sh` — new Phase 5 mode** (supersedes the prior "no changes required" plan in earlier drafts). When `current_phase=idle + phase5_entered_at + !phase5_completed_at` the guard enforces:
  - `Write/Edit/MultiEdit/NotebookEdit`: target path must be under snapshot `$WORK_DIR`; state file direct modification is blocked — only `phase5-finalize.sh` may mutate it.
  - `Bash`: **allowlist-only (default-deny)**. The first command token (after env-var prefixes) must be in the Phase 5 read-mostly allowlist: filesystem read (`cat`/`head`/`tail`/`wc`/`ls`/`pwd`/`file`/`stat`/`realpath`/`readlink`/`dirname`/`basename`), search/filter (`grep`/`sort`/`uniq`/`diff`/`cut`/`paste`/`column`/`tr`/`find`), JSON/YAML read (`jq`/`yq` without `-i`), shell builtins (`echo`/`printf`/`date`/`env`/`true`/`false`/`test`/`which`/`type`/`command`/`xxd`/checksums), `git` with read-only subcommand (`status`/`diff`/`log`/`show`/`blame`/`grep`/`rev-parse`/`rev-list`/`merge-base`/`symbolic-ref`/`ls-files`/`ls-tree`/`branch`/`tag`/`config`/`describe`/`cat-file`/`fsck`/`shortlog`/`reflog`/`name-rev`/`for-each-ref`/`count-objects`/`verify-pack`/`check-ignore`/`check-attr`/`var`/`help`/`version`), interpreters (`bash`/`sh`/`python`/`perl`/`ruby`/`node`/`awk`/`sed`/`php`/`osascript`/`tsx`/`deno`/`bun`) with canonical script path check, or filesystem ops (`mv`/`cp`/`mkdir`/`rm`/`rmdir`/`chmod`/`chown`/`truncate`/`touch`/`ln`/`install`) with target-in-`$WORK_DIR` verification. Unknown commands are rejected outright. Additional constraints: destructive variants (`/bin/rm`, `\rm`, `command/exec/builtin rm`) normalized; `git` global flags (`-C <path>`, `--git-dir [=]<path>`, `--work-tree [=]<path>`, `-c <k=v>`, `-p`/`--no-pager`/`--bare`/...) stripped via fixed-point iteration; `git` mutating subcommands (`add|commit|stash|checkout|merge|reset|rebase|cherry-pick|revert|apply|mv|rm|tag|push|fetch|pull|clean|am|format-patch|worktree|branch|submodule|notes|update-ref|write-tree|hash-object|bisect|replace|gc|prune|repack|reflog|remote|restore|switch|filter-branch|filter-repo`) blocked after normalization; `find -delete/-exec/-ok/...` blocked; `jq/sed/perl/ruby -i` in-place flags blocked; interpreter `-c/-e` flags blocked; compound operators (`;`, `&&`, `||`, `|`, `&`) rejected; shell metacharacters in helper paths (`$`, `` ` ``, `(`, `)`, `<`, `>`, newline, CR) rejected. `mv`/`cp` checks both SRC and DEST. **Interpreter + script invocations** (e.g. `python foo.py`, `sh foo.sh`) require the script path's canonical `realpath` to exactly match `${PROJECT_ROOT}/skills/deep-integrate/<helper>.sh` or `${HOME}/.claude/plugins/cache/claude-deep-suite/deep-work/*/skills/deep-integrate/<helper>.sh`; fake helpers under `$WORK_DIR` and other cached plugins are rejected. All other tools (`Read`, `Glob`, `Grep`, `Agent`, `AskUserQuestion`, `Skill`) pass through.
- `/deep-integrate` tool allowlist narrowed to `Skill, Read, Bash, Glob, Grep, Agent, AskUserQuestion` (removed `Write, Edit`).

### Upgrade notes
- Sessions that entered Phase 5 under v6.2.x without `phase5_work_dir_snapshot` will fall back to reading `work_dir` from the state file. Phase-guard preserves backward compatibility via this fallback, but such sessions are more exposed to state-tampering attacks. Re-entering Phase 5 on v6.3.0 records the snapshot automatically.
- `phase5-finalize.sh` rejects any state-file path whose basename does not match `deep-work.<sid>.md` in a `.claude/` directory. Callers that previously wrote to state via direct redirect must migrate to this helper.
- **Dependencies**: `phase5-record-error.sh`, `gather-signals.sh`, and the Stop-hook `terminated_by` marker require `jq` on `PATH` (helpers exit with an explicit error when missing). `phase5-finalize.sh` uses only `awk` (no `jq` dependency).

### Known limitations
- **Interpreter coverage**: `Rscript`/`julia`/`lua`/`groovy`/`tclsh` are not yet in the interpreter allowlist — if these become part of a legitimate Phase 5 workflow they must be added explicitly. Track in v6.3.1.
- **`awk -f script.awk`**: the `-f` flag form is not covered by the interpreter-with-script canonical check (only `awk -e/-c` is blocked via the `-c/-e` rule). Practical risk is low because the Phase 5 Bash allowlist rejects unknown forms and legitimate workflow does not use `awk -f`.
- **Legacy session upgrade**: sessions that started Phase 5 under v6.2.x without the `phase5_work_dir_snapshot` field fall back to the mutable `work_dir`; re-entering Phase 5 in v6.3.0 populates the snapshot.
- **`phase5-record-error.sh` / `phase5-finalize.sh` unit tests**: currently covered indirectly via `phase5-guard.test.js`. Dedicated unit test file planned for v6.3.1.
- **Allowlist command abuse**: commands in the read-mostly allowlist are permitted in their standard read-only form but remain theoretically abusable in niche invocations (e.g. `find` minus mutating flags blocked; `jq` without `-i`; `mv`/`cp`/`mkdir` with target checks; other entries assumed safe). Deeper per-command invocation audit (esp. `curl` is not allowed; data-exfil mitigation on other networked helpers) tracked in v6.4.0.
- **Non-Bash tools (`Agent`/`Skill`)**: pass through the Phase 5 guard. Subagents dispatched via `Agent` carry their own tool set; Phase 5 enforcement applies only to the invoking session's Bash/Write/Edit. Treated as out-of-scope trust boundary for v6.3.0.

## [6.2.4] — 2026-04-17

Bug fix release addressing 15 hook-layer bugs + 7 documentation drift items identified by an internal audit (`BUG_REVIEW_REPORT.md`). Plan reviewed independently before execution; 5 additional critical issues found during review were also addressed.

### Fixed

**Hooks — portability & parsing**
- `file-tracker.sh`: Replace BSD-only `sed -i ''` with a Node.js inline script. The previous code failed silently on Linux (`sed -i`'s GNU syntax differs), leaving `sensor_cache_valid` stale after marker-file changes. The insert-when-missing path also mis-handled the second `---` delimiter even on macOS — now fixed.
- `update-check.sh`: Pass the plugin path via `process.argv[1]` instead of shell interpolation. An install path containing an apostrophe (e.g. `/Users/O'Brien/...`) caused a JS syntax error and silently skipped the update check.
- `phase-guard.sh` / `file-tracker.sh` / `phase-transition.sh`: Replace regex-based `file_path` extraction with `extract_file_path_from_json` (JSON parser). Paths containing escaped quotes (`a \"b\" c.txt`) were truncated, causing spurious blocks and receipt corruption.
- `phase-transition.sh`: Extract the innermost `deep-work.XXXX` segment for `SESSION_ID`. Fork worktree paths like `.deep-work/sessions/deep-work.s-parent/sub/.claude/deep-work.s-child.md` now resolve to `s-child` instead of a multi-line mess that broke the cache file path.

**Hooks — race conditions**
- `file-tracker.sh` receipt updates: Wrap read-modify-write with a mkdir-based spinlock (40 retries × 50ms). On timeout, queue the pending entry to `<receipt>.pending-changes.jsonl`; the next lock holder drains it crash-safely (rename-to-`.draining.<pid>` → merge → canonical rename → unlink `.draining`). A crash anywhere mid-drain leaves recoverable state; the next invocation sweeps stray `.draining.*` files. Previously, 5+ concurrent PostToolUse invocations could drop `files_modified` entries, and the first-pass lock-timeout path could silently orphan queued entries if no later write drained them.
- `sensor-trigger.js` + `file-tracker.sh` state YAML updates: Both now acquire the same `<state>.lock` before read-modify-write — including the marker-file `sensor_cache_valid` flip in `file-tracker.sh` (which initially missed the lock in v6.2.4 and was flagged by post-review). Previously, `current_phase` / `active_slice` / `sensor_pending` / `sensor_cache_valid` could race and lose one of the writes.
- `utils.sh` `write_registry`: Fail-closed on lock timeout (no force-remove of another process's lock directory). The old force-remove behaviour silently corrupted the session registry under contention. Callers (`register_session`, `update_last_activity`, `register_file_ownership`, `update_registry_phase`, `unregister_session`, `register_fork_session`) now use `_try_write_registry` which logs failures to `.claude/deep-work-guard-errors.log` instead of silently swallowing them.
- `session-end.sh` JSONL append: Lock timeout queues to `<jsonl>.pending-append.jsonl`. Drain on the next append uses the same rename-first crash-safe pattern as the receipt path. Retries bumped 10 → 20.

**Hooks — validation hardening**
- `phase-guard-core.js`: Internal errors (malformed input, runtime exceptions) now `process.exit(3)` with a JSON block message pointing at the guard error log. Intentional blocks continue to exit 0 with `decision=block`. Previously, both paths exited 2 — indistinguishable in user-facing output.
- `phase-guard.sh`: Translate Node exit 3 to hook exit 2 with the debug-oriented block message. Empty `decision` on stdout now fail-closes with a distinct message instead of silently allowing.
- `phase-guard.sh`: Read `slice_files` / `strict_scope` / `exempt_patterns` from state frontmatter (via the new `read_frontmatter_list` helper) and pass them into the Node input. Previously, these fields were never populated, so `checkSliceScope` received `undefined` and returned `inScope=true` unconditionally — the slice-scope contract in `deep-implement/SKILL.md` was silently unenforced.
- `phase-guard.sh` block messages: All 4 heredocs now JSON-escape interpolated fields (file path, worktree path, phase label, next-step). Messages with literal quotes or newlines previously produced invalid JSON.

**Hooks — phase-transition injector (C-1)**
- `file-tracker.sh` caches stdin to `$PROJECT_ROOT/.claude/.hook-tool-input.<ppid>` **before** any phase-based early return, and writes atomically via `.tmp.$$` + `mv`. `phase-transition.sh` falls back to this cache when `CLAUDE_TOOL_USE_INPUT` / `CLAUDE_TOOL_INPUT` are unset — which is the actual Claude Code production behaviour (these env vars are not part of the hook protocol). Previously (even after the initial v6.2.4 fix), the cache was only written inside the `implement`-phase branch, so research→plan, plan→implement, and test→idle transitions never refreshed the cache; `phase-transition.sh` would fall back to a stale implement-phase payload or no-op. Post-review fix moves the cache write to the top of the hook.
- `session-end.sh` now cleans up its own `.hook-tool-input.$PPID` and reaps `.hook-tool-input.*` files older than 60 minutes — the cache is transient per-tool-call and should not accumulate across sessions.

**Notifications**
- `notify.sh`: YAML-aware `notifications.enabled` parser. Previously, `grep -q "^  enabled: false"` false-positive-matched an unrelated `team_mode:\n  enabled: false`, silently suppressing all channels.
- `notify.sh`: `_osascript_escape` helper applied to macOS `osascript` calls. A double-quote in the message (e.g. `phase "done"`) previously caused a silent syntax error.
- `notify.sh`: `_xml_escape` helper applied to Windows PowerShell toast XML. `<`, `&`, `"` in the message would have broken the XML document and the notification would never appear.
- `notify.sh`: Drop `pipefail` from `set -euo pipefail`. This is a best-effort script; many `grep` pipelines legitimately return non-zero when a channel isn't configured, and `pipefail` turned those no-ops into script aborts.

**Documentation**
- 21 broken `skills/shared/references/` → `../shared/references/` link fixes across 7 `SKILL.md` files (`deep-work-workflow`, `deep-test`, `deep-implement`, `deep-plan`, `deep-research`, `deep-brainstorm`, `deep-work-orchestrator`).
- 13 `(v6.2.1)` labels in `commands/*.md` refreshed to `(v6.2.4)`.
- `commands/deep-finish.md` example: `"deep_work_version": "5.3.0"` → `"6.2.4"` (was frozen across two minor releases).
- `hooks/hooks.json` description: `(v5.6.0 Session Fork)` → `(v6.2.4)`.
- `skills/deep-work-orchestrator/SKILL.md`: Corrected Test row in the phase ownership table — it is Orchestrator (not the Phase Skill) that transitions Test → idle after `/deep-finish`.
- `skills/deep-work-orchestrator/SKILL.md`: Documented `--resume-from=<phase>` flag that `deep-resume.md` was already passing, but was undocumented in Orchestrator.
- `CLAUDE.md`: Added previously-omitted directories and files to the structure listing (`sensors/`, `health/`, `templates/topologies/`, `assumptions.json`, `package.json`).

### Internal

- New `hooks/scripts/utils.sh` helpers consumed across the hook layer:
  - `_acquire_lock` / `_release_lock`: mkdir-based advisory spinlock, fail-closed on timeout (logs to `.claude/deep-work-guard-errors.log`).
  - `extract_file_path_from_json`: JSON-parser-based file_path extraction; handles escaped quotes correctly.
  - `json_escape`: JSON-string escape for safe interpolation into block messages. Argument required — no stdin fallback (prevents hook hangs).
  - `read_frontmatter_list`: reads YAML list fields (inline `[a, b]` or block `- a`) from frontmatter; emits JSON array.
- `hooks/scripts/utils.sh` `write_registry`: refactored to use `_acquire_lock` with fail-closed behavior.
- Test suite: 329 tests (from 294 in 6.2.3), across 91 suites. Net +35 tests covering: portability (3), input parsing e2e (5), notify YAML/escape (4), receipt race (1, 80 parallel writes — now validates canonical completeness + empty pending sidecar + no leftover `.draining.*` files), phase-guard hardening (6), phase-transition cache (2), utils helpers (19), post-review robustness (7: cache-before-phase-check × 4 phases, marker-flip lock behaviour × 2, atomic cache write × 1).
- Independent review (3-way: Opus + Codex review + Codex adversarial) identified 3 critical + 3 warning issues on the initial v6.2.4 branch; all were addressed before merge. Report: `.deep-review/reports/2026-04-17-implementation-review.md`.

### Known limitations

- Cross-platform CI matrix is not yet in place. All new fixes are unit-tested against Node `node --test`, but Linux/Windows coverage relies on the new portability logic rather than CI enforcement. Tracked for a future release.

## [6.2.3] — 2026-04-16

### Changed
- **trigger-eval.json v6.2 update**: Benchmark test set expanded from 31 to 54 samples (true 21 + false 33). Added 10 true samples for v6.2 features (Session Fork, Mutation Test, Brainstorm, Team Mode, Assumption Engine, Worktree, English queries, semantic-only trigger, Debug). Added 13 false samples (homophone disambiguation, meta-queries, English hard negatives, standalone command invocations). Reclassified 5 existing true samples to false (SOLID review, drift check, deep-status, quality gate config, preset setup) — standalone commands should not trigger full workflow sessions.

## [6.2.2] — 2026-04-16

### Fixed
- **Cross-platform hooks compatibility**: Removed POSIX inline env var assignments (`FOO=bar command`) from all 5 hook commands in `hooks.json`. Windows `cmd.exe` cannot parse this syntax, causing all hooks to fail silently. Scripts now read Claude Code's native env vars (`CLAUDE_TOOL_USE_TOOL_NAME`, `CLAUDE_TOOL_USE_INPUT`) directly with backwards-compatible fallback.

### Changed
- `hooks/scripts/phase-guard.sh`: reads `CLAUDE_TOOL_USE_TOOL_NAME` with `CLAUDE_TOOL_NAME` fallback
- `hooks/scripts/file-tracker.sh`: reads `CLAUDE_TOOL_USE_TOOL_NAME` with `CLAUDE_TOOL_NAME` fallback
- `hooks/scripts/phase-transition.sh`: reads `CLAUDE_TOOL_USE_INPUT` with `CLAUDE_TOOL_INPUT` fallback

## [6.2.1] — 2026-04-15

### Changed
- **Command classification cleanup**: 11 commands previously labeled `Deprecated in v5.2` and 2 more (`deep-brainstorm`, `deep-phase-review`) in the same table are now reclassified into five accurate categories: Quality Gate (3), Internal (6), Escape hatch (1), Utility (2), and Special utility (`/deep-phase-review` moved out).
- **`/deep-finish` framing**: now described as "auto-call is primary, manual invocation remains a first-class path after test pass" rather than deprecated.
- **Hook/skill user-facing guidance** now routes to `/deep-status` flags:
  - `hooks/scripts/assumption-engine.js`: `/deep-assumptions` → `/deep-status --assumptions`
  - `hooks/scripts/session-end.sh`: `/deep-report` → `/deep-status --report`
  - `skills/deep-test/SKILL.md`: same alignment
- **Session Report manual policy**: both `/deep-report` and `/deep-status --report` remain supported manual entry points. Wording is unified across `skills/deep-work-workflow/SKILL.md` heading + body, `commands/deep-report.md` body, and `commands/deep-resume.md` body.
- **README** (en/ko): "Deprecated Commands (13)" single table replaced by five category tables; "What changed" bullets updated to reflect reclassification (not deprecation); body references to `/deep-cleanup`/`/deep-resume` in the Worktree Isolation section reframed as standalone utilities.
- **`skills/deep-work-workflow/SKILL.md`** classification section rewritten into 6 categories (Primary / Special / Quality Gate / Internal / Escape hatch / Utility).

### Not changed
- **No commands removed.** `/deep-cleanup` and `/deep-resume` continue to be the sole path for worktree scan/fork cleanup and for active-session selection/worktree restore/phase dispatch respectively. Their feature migration is tracked as a follow-up.
- **No functional behavior changed.** Existing slash commands continue to work exactly as before; only labels, wordings, and version numbers changed.
- Historical `v5.2` deprecated notes in earlier sections are preserved as-is.

## [6.2.0] — 2026-04-14

### Added
- **Cross-Plugin Context**: Phase 1 Research에서 harnessability-report.json(deep-dashboard)과 evolve-insights.json(deep-evolve)을 참조하여 research context 강화.

## v6.1.0

### 3-Layer Architecture + Computational Guard

Resolves inferential enforcement failures from 2026-04-12 session (worktree isolation bypass, team mode bypass, codex bypass).

#### Added
- **P0 Worktree Path Guard** — PreToolUse hook that hard-blocks Write/Edit/Bash outside the active worktree path. Meta directories (`.claude/`, `.deep-work/`) are exempt, anchored to PROJECT_ROOT to prevent external path bypass. Works across all phases, independent of session ID.
- **P1 Phase Transition Injector** — PostToolUse hook that injects worktree_path, team_mode, cross_model_enabled, and tdd_mode into LLM context when `current_phase` changes. Uses cache file for transition detection, `CLAUDE_TOOL_INPUT` env var for stdin safety.
- **6 Phase Skills** — Independent SKILL.md for each phase (brainstorm 120L, research 183L, plan 165L, implement 187L, test 147L, orchestrator 230L). Context load reduced 45-81% from original commands.
- **Review + Approval Workflow** — 6-step protocol for Research and Plan: auto review → main agent judgment → user approval → modification → final confirmation. Orchestrator manages `current_phase` for these phases.
- **`review-approval-workflow.md`** reference — Shared protocol document for Research/Plan review gates.

#### Changed
- **Command → Thin Wrapper** — 6 core phase commands reduced to single `Skill()` dispatch calls. `Skill` added to `allowed-tools` in all wrappers.
- **References relocated** — `skills/deep-work-workflow/references/` → `skills/shared/references/` (14 files). All command/skill paths updated.
- **`deep-resume` updated** — Research/Plan resume routed through orchestrator (prevents dead-end). Test-passed resume routes to `/deep-finish`.
- **`deep-test` phase transition** — No longer sets `current_phase: idle` on success. Orchestrator/finish handles idle transition.
- **Receipt contract** — `status: "complete"` field explicitly required in implement receipts (deep-test gate dependency).
- **Drift gate fallback** — `plan_approved_at` fallback chain: timestamp → plan.md mtime → 24h commit window.
- **`cross_model_enabled` parsing** — Nested YAML mapping support via `grep -A3` fallback in phase-transition.sh.
- **`session-end.sh`** — Phase cache cleanup on session end (stale P1 injection prevention).

#### Architecture
```
Layer 1: Commands (thin wrappers) → Skill dispatch
Layer 2: Skills (execution logic) → 100-230 line SKILL.md + shared references
Layer 3: Hooks (enforcement) → P0 hard block + P1 context injection
```

## v6.0.2

### Phase Review Gate
- **Unified Review Gate** — Every phase (0-3) now runs self-review + external review before transitioning. User confirms results before proceeding.
- **Phase-specific Fallback Chain** — Phase 0-2 (documents): Structural + Adversarial + Opus subagent. Phase 3 (code): deep-review plugin → codex/gemini + Opus → self + Opus.
- **User Confirmation UX** — Summary view with 3 options: auto-fix, proceed as-is, show details. Detail view allows per-issue fix/skip.
- **Degraded Mode** — Graceful fallback when external reviewers fail.
- **`/deep-phase-review` unified** — Manual review now uses the same Fallback chain as automatic gates.

### Work Folder Rename
- **Session folder renamed** — `deep-work/` → `.deep-work/` (hidden directory). Matches `.claude/`, `.git/` conventions.
- **Auto-migration** — Existing `deep-work/` folders are automatically migrated on next session start. Worktree safety check included.
- **Metadata update** — State files, JSONL history, and fork metadata paths are updated during migration.
- **Selective .gitignore** — Only session folders (`.deep-work/20*/`) and history are excluded, not config files.

## [6.0.1] - 2026-04-10

### Added — Superpowers Integration (Slice Review, Red Flags, Escalation)

- **Slice Review (Step C-2)**: Per-slice 2-stage independent review after sensor pipeline. Stage 1 (Spec Compliance, required) + Stage 2 (Code Quality, advisory). Subagent failure fallback with graceful degradation.
- **Red Flags tables**: Rationalization prevention in implement (10 entries) and test (6 entries) phases. Complements hook-based hard gates with soft behavioral guidance.
- **Pre-flight Check (Step A-2)**: Prerequisite verification before TDD cycle. Uses `command -v` for safe executability check. 2 options: continue (done_with_concerns) or plan revision.
- **Status Reporting**: `slice_confidence` (done/done_with_concerns) and `concerns` array per slice receipt. Automatic judgment based on review/sensor/pre-flight history.
- **Agent delegation prompt extended**: Rules 7-10 for self-review, receipt recording, pre-flight, and confidence judgment in delegated agents.
- **Phase 4 cross-slice + backfill review**: Section 4-2/4-3 rewritten with full control flow (prompt, parser, judgment, storage, display). Slices with Phase 3 FAIL are mandatory backfill targets.
- **Scope creep detection**: `git diff --name-only` against all changed files, not just slice files.
- **Per-slice working tree diff**: `git diff $git_before` (not `..HEAD`) for accurate uncommitted change capture.
- **deep-finish.md concerns summary**: Slice confidence tally and concerns list in session report.

### Changed

- Phase 4 Spec Compliance (4-2) and Code Quality (4-3) gates now focus on cross-slice consistency instead of per-slice validation (already done in Phase 3).
- `changes.git_diff` in receipts now uses per-slice baseline (`git diff $git_before -- [files]`).
- `AskUserQuestion` added to deep-implement.md `allowed-tools`.
- Version references updated to 6.0.1 across CLAUDE.md, SKILL.md, package.json, plugin.json.

## [6.0.0] - 2026-04-09

### Added
- **Computational Sensor Pipeline (#2)** — Registry-driven sensor orchestration integrated into the TDD workflow:
  - `sensors/registry.json`: Ecosystem definitions for JS, TS, Python, C#, C++ with detect rules, lint/typecheck/mutation commands, and coverage flags
  - `sensors/detect.js`: Automatic ecosystem detection from project marker files (package.json, tsconfig.json, pyproject.toml, etc.)
  - 8 output parsers: eslint, tsc, ruff, generic-line, generic-json, stryker, dotnet, clang-tidy
  - TDD state machine extension: SENSOR_RUN → SENSOR_FIX → SENSOR_CLEAN states after GREEN
  - Self-correction loop: automatic sensor execution after GREEN, up to 3 fix rounds per sensor
  - `sensor-trigger.js`: Config/marker file changes trigger ecosystem-wide sensor re-scan
  - `/deep-sensor-scan`: Standalone computational sensor scan command
  - Detection result caching (`.sensor-detection-cache.json`)
  - Fail-closed policy: non-zero exit + 0 diagnostics = explicit failure
- **Mutation Testing (#1)** — AI-generated test quality verification:
  - Stryker (JS/TS), stryker-net (C#), mutmut (Python) integration via registry.json
  - `/deep-mutation-test`: git diff-based scope, automatic test regeneration loop (up to 3 rounds)
  - Implement phase return pattern: Phase 4 mutation failure → Phase 3 TDD loop for test hardening
  - Mutation Score Quality Gate (Advisory) + Session Quality Score integration (15% weight)
  - `stryker-parser.js`: possibly_equivalent tagging for NoCoverage + logging mutations
  - Receipt `mutation_testing` field: score, survived_details, auto_fix_rounds
- **Health Engine (#3A)** — Automatic Health Check during Phase 1 Research with 4 drift sensors running in parallel:
  - `dead-export`: Detects unused JS/TS exports via grep-based cross-referencing (entry point/library/barrel exclusion, health-ignore.json support)
  - `stale-config`: Detects broken path references in tsconfig.json, package.json, .eslintrc
  - `dependency-vuln`: Runs `npm audit --json` for known high/critical vulnerabilities (Required gate)
  - `coverage-trend`: Compares current coverage against previous session baseline (5%p threshold)
- **Architecture Fitness Functions (#4)** — Declarative architecture rules in `.deep-review/fitness.json`:
  - 4 rule checkers: `file-metric` (line count), `forbidden-pattern` (regex), `structure` (colocated tests), `dependency` (circular deps via dep-cruiser)
  - `fitness-validator.js`: JSON schema validation + rule execution engine with `required_missing` status
  - `fitness-generator.js`: Ecosystem-aware auto-generation (dependency rules excluded for non-JS/TS projects)
  - dep-cruiser install suggestion with explanation when dependency rules are present but tool is missing
- **Health Check Orchestrator** (`health-check.js`) — Parallel drift scan (Promise.allSettled) + sequential fitness validation with per-sensor timeouts (180s total)
- **Baseline Management** — `health-baseline.json` with commit/branch scoping, automatic invalidation on branch switch, rebase (git merge-base --is-ancestor), or 7-day expiry
- **Phase 4 Quality Gates**:
  - Fitness Delta Gate (Advisory) — Detects new fitness violations added during implementation
  - Health Required Gate (Required) — Propagates Phase 1 required failures with user acknowledge flow
  - Phase 4 Baseline Refresh — Updates health-baseline.json after gates pass
- **Receipt Schema Extension** — `health_report` field with `scan_commit` for deep-review stale detection
- **deep-review Integration** — fitness.json injected into review agent prompt + receipt health_report consumed with commit-based staleness check
- **Harness Templates (#5)**: Topology detection layer with 6 built-in topologies (nextjs-app, react-spa, express-api, python-web, python-lib, generic). Template loader with deep merge and custom/ override support. Phase 1/3 integration with topology-specific guides. Fitness generator extended with template fitness_defaults.
- **Self-Correction Loop (#6)**: review-check sensor with always-on layer (topology guides) and fitness layer (fitness.json rules). Per-sensor 3-round independent correction limit. Config disable support. Receipt schema extension.

### Changed
- Session Quality Score now uses 5 weights (Test Pass Rate 25%, Rework Cycles 20%, Plan Fidelity 25%, Sensor Clean Rate 15%, Mutation Score 15%). Health Check is excluded from scoring.
- `sensors/registry.json` — Added `audit` field to javascript/typescript ecosystems

## [5.8.1] - 2026-04-08

### Changed
- **Breaking**: `/deep-review` → `/deep-phase-review` renamed to resolve naming conflict with deep-review plugin (deep-suite). Phase document review is now `/deep-phase-review`; code diff review uses the deep-review plugin.
- Updated references in `deep-plan.md`, `deep-resume.md`, `README.md`, `README.ko.md`
- deep-review plugin integration (Sprint Contract, slice review, full review) unchanged

## [5.8.0] - 2026-04-08

### Added
- **Completeness Policy** (Section 3.3-1) — explicit banned patterns for plan.md (TBD, TODO, vague directives, cross-references without content). Enforced via Claude self-review + structural review `code_completeness` dimension.
- **Code sketch tiering** — S: annotated pseudocode, M: actual function signatures + type definitions, L: complete boundary code (interfaces, APIs, tests). Replaces "pseudocode or actual code" with proportional standard.
- **Slice fields: `expected_output`, `steps`** — `expected_output` defines what `verification_cmd` should print on success. `steps` provides execution guidance within M/L slices (3-12 numbered actions). Both optional for backward compatibility.
- **`failing_test` detail tiers** — S: file + description, M: function signature + key assertion, L: complete test body for boundary tests.
- **"Boundary: Files NOT to Modify"** section in plan templates — prevents scope creep during implementation.
- **Research traceability tags** — `[RF-NNN]` for Key Findings, `[RA-NNN]` for interfaces/signatures. Tags enable plan Architecture Decision to reference specific research evidence.
- **Research Tag Lifecycle Rules** — monotonic numbering, incremental preservation, deletion warnings for plan-referenced tags.
- **Research `Testing Patterns` section** — documents existing test framework, assertion style, file naming for plan test specification.
- **Brainstorm context-adaptive questions** — core 2 + context-adaptive 1-3 (by task type: feature/refactoring/bug/performance/integration) + closing boundary question.
- **Brainstorm `Scope Assessment`** — decomposition check + quick codebase pulse before approach comparison.
- **Brainstorm `Boundaries` section** — documents what explicitly stays unchanged, feeds into plan Boundary section.
- **Review gate dimensions: `code_completeness`, `buildability`** — synchronized across 4 locations (structural table, hardcoded dimensions, cross-model Plan Rubric, JSON schema).
- **Review gate backward compatibility fallback** — legacy plans without `expected_output`/`steps` evaluated with relaxed criteria per dimension.

### Changed
- `deep-implement.md` slice parser now recognizes `expected_output`, `steps`, `contract`, `acceptance_threshold` fields (all optional for backward compatibility).
- Step B-1 (RED) uses test code from `failing_test` field when available (M/L slices).
- Step B-2 (GREEN) compares `verification_cmd` output against `expected_output` when available.
- `deep-work.md` inline plan template updated: `failing_test: [to be determined during implementation]` → `[구현 시 결정 — inline mode]` with Completeness Policy exemption comment.
- `research-guide.md` quality criteria expanded from 4 to 8 items (RF/RA tags, code snippets per section, test patterns).
- `plan-templates.md` API Endpoint template upgraded to v5.8 exemplar with full slice format. Legacy templates marked with migration guide.
- `testability` dimension description clarified: `expected_output` is recommended, not required.

## [5.7.0] - 2026-04-08

### Added
- **W1: Sprint Contract 생성** — Phase 2 plan 승인 후, deep-review 플러그인이 설치되어 있으면 plan.md의 슬라이스에서 `.deep-review/contracts/SLICE-{NNN}.yaml` 자동 생성
- **W2-a: 슬라이스 리뷰 제안** — Phase 3에서 슬라이스 GREEN 도달 시 `/deep-review --contract SLICE-{NNN}` 실행 제안
- **W2-b: 전체 리뷰 제안** — Phase 4 진입 시 `/deep-review` 전체 리뷰 실행 제안
- **K1: 위키 ingest 제안** — Phase 4 완료 후 `/wiki-ingest report.md` 실행 제안

### Changed
- Sprint Contract 생성 시점을 plan 작성 직후에서 **plan 승인 후**로 이동 (최종 plan과 contract 일치 보장)
- 플러그인 감지를 cache + plugins 이중 경로로 통일 (설치 방식 무관)

## [5.6.0] - 2026-04-07

### Added
- **`/deep-fork` command**: Fork a deep-work session to explore different approaches while preserving the original session.
  - Git environment: worktree-based full replication with dirty state validation (`git stash --include-untracked`), session-ID-based branch suffix (race-condition-free), automatic worktree context switch (`FORK_PROJECT_ROOT`).
  - Non-git environment: artifacts-only replication with plan phase limit (implement/test blocked by phase guard).
  - Parent-child relationship tracking via `fork_info` and `fork_children` in state files.
  - `fork-snapshot.yaml` for comparison baseline at fork point.
  - Stale parent validation (commit existence for git, work_dir existence for non-git).
  - Fork generation limit: max 3 generations with warning.
- **`/deep-status --tree`**: Visualize fork relationship tree with UTF-8 tree characters.
- **`/deep-status --compare` auto-detection**: Auto-detect fork relationships when no session IDs given (parent↔child comparison).
- **`/deep-status` fork info display**: Show `fork_info` and `fork_children` in default status output.
- **`/deep-cleanup` fork support**: Scan for idle fork sessions, batch cleanup when parent + all children are idle.
- **Phase guard**: Block implement/test phases for `artifacts-only` fork sessions with actionable error message.
- **Fork utility functions** in `utils.sh`: `validate_fork_target`, `get_fork_generation`, `update_parent_fork_children`, `register_fork_session` (atomic registry + parent update).
- **`session-end.sh`**: Update parent's `fork_children` status to idle when fork session ends.
- **Fork integration tests**: 18 integration tests covering atomic registration, multi-fork, phase-guard integration, edge cases, and git worktree fork.

### Changed
- `deep-work-sessions.json` registry: Added `fork_parent` and `fork_generation` fields per session entry.
- State file YAML frontmatter: Added `fork_info` (parent relationship) and `fork_children` (child list) sections.

## [5.5.2] - 2026-04-06

### Added
- **Extended bash file-write detection**: 20+ new FILE_WRITE_PATTERNS including perl in-place (`perl -pi -e`), runtime language writes (node -e `fs.writeFileSync`, python -c `open().write()`, ruby -e `File.write`), awk in-place, swift, truncate, sponge, destructive git operations (`reset --hard`, `clean -f`), curl/wget output, ln, tar/unzip/cpio extraction, rsync, and generic `writeFile` detection.
- **Extended safe command patterns**: docker/kubectl read-only, cargo build/check/bench, go build/vet, deno test/check, bun run/x, python unittest, tsc --noEmit, stat/du/df/free/uname/hostname, diff/file, env/printenv, rmdir.
- **Extended test file patterns**: Dart (`.test.dart`, `_test.dart`), Elixir (`_test.exs`), Lua (`.test.lua`), Vue (`.test.vue`), `fixtures/`, `__fixtures__/`, `__mocks__/`, `spec/` directories.
- **Extended TDD exempt patterns**: `.toml`, `.ini`, `.cfg`, `.lock`, `.editorconfig`, `.svg`, `.png`, `.jpg`, `.gif`.
- **TDD state validation**: Unknown TDD states are now blocked with actionable error message in processHook.
- **Backtick and subshell handling**: `splitCommands` now correctly handles backtick quoting and `$()` subshell depth tracking, preventing false splits inside nested expressions.
- **Perl target file extraction**: `extractBashTargetFile` now extracts target files from `perl -pi -e` commands for accurate TDD enforcement.

### Fixed
- **Security: file-write-first detection order**: FILE_WRITE_PATTERNS are now checked before SAFE_COMMAND_PATTERNS, preventing safe patterns from masking file writes (e.g., `node -e` with `fs.writeFileSync` was previously bypassed).
- **file-tracker.sh Node.js 25 argv compatibility**: Fixed `process.argv` indexing — Node.js 25 no longer includes `[eval]` marker, causing receipt creation to silently fail. Now uses `process.argv.filter(a => a !== '[eval]')` for cross-version compatibility.
- **assumption-engine.js quality-timeline CLI**: Fixed reference to raw `input` string instead of parsed `parsed` object, causing the CLI action to always return empty results.
- **assumption-engine.js evalSignal threshold passing**: Signal evaluator `threshold` field is now correctly passed to `fn()` instead of relying on hardcoded default parameters.
- **assumption-engine.js readHistory dedup order**: Changed from keep-first to keep-latest when deduplicating by `session_id`, preventing finalized records from being ignored in favor of earlier active records.
- **assumption-engine.js input guards**: Added `Array.isArray` checks in `isSessionDuplicate`, `detectStaleness`, `detectNewModel`, and `generateReport` to prevent crashes on non-array inputs.
- **session-end.sh JSON validation**: Added JSON validation before JSONL append to prevent malformed entries from corrupting harness-sessions.jsonl.
- **session-end.sh session ID fallback**: Falls back to `DEEP_WORK_SESSION_ID` env var when `started_at` field is missing from state file.
- **session-end.sh error logging**: Errors now logged to `.claude/deep-work-guard-errors.log` instead of suppressed via `/dev/null`.
- **phase-guard.sh error logging**: Node.js errors now appended to `.claude/deep-work-guard-errors.log` instead of discarded.
- **utils.sh matchGlob trailing slash**: Normalized trailing slashes in exact path comparison.
- **utils.sh session pointer safety**: Added `mkdir -p` before writing session pointer file.
- **utils.sh session ID generation**: Fixed tab character stripping in hex generation from `/dev/urandom`.

### Changed
- **Redirect detection broadened**: General output redirection pattern changed from `(?:^|\|)` prefix to `(?:^|[|;]|\s)` to catch mid-command redirects (e.g., `cat << EOF > file`).
- **`node -e` removed from safe patterns**: Previously treated as safe, now evaluated against file-write patterns like any other command.
- **Model name sanitization**: `validateModelName` now strips non-alphanumeric characters; `lookupModel` adds `toString().trim()` for robust size normalization.
- **Signal evaluator thresholds**: Made configurable via `threshold` field on evaluator definitions (previously hardcoded as default parameters).
- **Broader redirect pattern**: Mid-command redirects (heredoc, after whitespace) now correctly detected.

## [5.5.1] - 2026-04-03

### Changed
- **Plan phase team research cross-verification**: When `team_mode: team`, the plan phase now loads partial research files (`research-architecture.md`, `research-patterns.md`, `research-dependencies.md`) as supplementary references. Claude self-review (Section 3.4.5) cross-checks plan decisions against these specialized analyses to catch details lost during synthesis.
- **TDD state update enforcement**: B-1 (RED_VERIFIED) and B-2 (GREEN) state file updates in `deep-implement.md` are now marked as mandatory with explicit phase guard blocking warnings.

### Fixed
- **phase-guard.sh input parsing**: Switched JSON input building from `process.argv` to stdin pipe to avoid `set -e` failures on large tool inputs.

## [5.5.0] - 2026-04-02

### Added
- **Research Cross-Model Review**: codex/gemini adversarial review now applies to research phase (previously plan-only). Uses dedicated research rubric (completeness, accuracy, relevance, risk_identification, actionability).
- **Claude Self-Review for Plan**: Automatic quality check after plan creation — scans for placeholders, internal inconsistencies, research alignment, scope creep, and missing rollback coverage. Auto-fixes obvious defects before structural review.
- **Consolidated Judgment Protocol**: Replaces per-conflict AskUserQuestion with Claude's synthesized judgment + user bulk confirmation. Applied to both research and plan cross-model reviews.
- **Auto-fix Snapshot Contract**: Mandatory snapshots before each auto-fix iteration with score-regression rollback. Research: `research.v{N}.md`, Plan: `plan.autofix-v{N}.md`.
- **Degraded Mode for Reviewers**: Failed cross-model reviewers are explicitly tracked (`reviewer_status` field). Consensus/conflict classification requires 2+ successful reviewers; single-reviewer results classified as standalone issues only.
- **State Schema Migration (v5.5)**: New fields `review_results.{phase}.judgments`, `judgments_timestamp`, `reviewer_status`. Auto-initialization for old state files. Resume validation compares document mtime vs judgments_timestamp.

### Changed
- **Structural Review threshold**: Auto-fix trigger raised from score < 5 to score < 7 for both research and plan phases. Max iterations increased to 3 for research.
- **Research user feedback gate**: Integrated into consolidated judgment step (Step 4.7). Removed duplicate AskUserQuestion from Step 5 and auto-flow Step 9-3.
- **deep-review.md**: Updated to use consolidated judgment protocol instead of per-conflict UX.
- **deep-resume.md**: Resume with `review_state: in_progress` now routes to new review flow with judgments_timestamp validation.

## [5.3.0] - 2026-03-31

### Added
- **Document Intelligence**: Automatic deduplication and pruning when feedback is applied to research.md/plan.md. 3-step protocol: Apply → Deduplicate → Prune with refinement log tracking.
- **Session Relevance Detection**: Scope check before applying feedback — detects out-of-scope requests and offers to start a new session or save to backlog (`deep-work/backlog.md`).
- **Plan Fidelity Score**: Numeric 0-100 score measuring implementation faithfulness to the approved plan. Integrated into drift-check and deep-test inline verification.
- **Session Quality Score**: Automatic quality score (0-100) at session completion. Core metrics: Test Pass Rate (35%), Rework Cycles (30%), Plan Fidelity (35%). Diagnostic metrics (Code Efficiency, Phase Balance) shown for reference only.
- **Assumption Snapshot**: Per-session capture of each assumption's enforcement level at session start. Enables accurate active/inactive cohort analysis.
- **Assumption Engine Quality Integration**: Quality scores fed into assumption evaluation. Cohort analysis with 3-session minimum gate per cohort. Quality impact displayed in `/deep-status --assumptions`.
- **Cross-Session Quality Trend**: ASCII chart showing quality score evolution over sessions. Available via `/deep-status --history`.
- **Quality Badge**: shields.io badge generation for README display. Available via `/deep-status --badge`. Badges: quality score, session count, plan fidelity.
- **Authoritative JSONL write**: `deep-finish` performs the authoritative write to `harness-sessions.jsonl` with atomic upsert (lock pattern). `session-end.sh` writes provisional records only.

### Fixed
- **JSONL path**: `session-end.sh` now writes to shared `deep-work/harness-history/` instead of per-session folder. Fixes bug where session data was invisible to trend/assumption commands.

### Changed
- **README renewal**: Removed demo GIFs. Restructured to problem-solution narrative. Added Quality Measurement and Self-Evolving Rules sections.
- **exportBadge()**: Returns `{ harness, quality, sessions, fidelity }` object instead of flat badge. Breaking change for direct consumers — tests updated.
- **hooks.json**: Description updated to "v5.3 Precision + Evidence Protocol".

## [5.2.0] - 2026-03-31

### Added
- **Auto-flow orchestration**: `/deep-work` now automatically chains all phases (brainstorm → research → plan → implement → test → finish). Plan approval is the only required user interaction
- **Unified `/deep-status`**: New flags `--receipts`, `--history`, `--report`, `--assumptions`, `--all` consolidate 5 separate commands into one
- **Auto-run test gates**: Drift Check (required), SOLID Review (advisory), and Insight Analysis run automatically during `/deep-test` without Quality Gates table configuration

### Changed
- 13 auxiliary commands marked as deprecated (still functional, deprecation notice added)
- `/deep-work` Step 1: session detection now offers resume/new/cancel instead of overwrite warning
- `/deep-test`: Quality Gates table in plan.md is now optional override (auto-detection is default)
- `phase-guard-core.js`: TDD block messages now include auto-flow alternative note
- SKILL.md trimmed from 461 to ~250 lines (version history sections removed)
- plugin.json keywords reduced from 36 to 12

### Deprecated
- `/deep-brainstorm` — auto-runs in `/deep-work` flow
- `/deep-review` — auto-runs in `/deep-plan`
- `/deep-receipt` — use `/deep-status --receipts`
- `/deep-slice` — auto-managed in `/deep-implement`
- `/deep-insight` — auto-runs in `/deep-test`
- `/deep-finish` — auto-runs at end of `/deep-work` flow
- `/deep-cleanup` — auto-detected in `/deep-work` init
- `/deep-history` — use `/deep-status --history`
- `/deep-assumptions` — use `/deep-status --assumptions`
- `/deep-resume` — auto-detected in `/deep-work` init
- `/deep-report` — use `/deep-status --report`
- `/drift-check` — auto-runs in `/deep-test`
- `/solid-review` — auto-runs in `/deep-test`

## [5.1.2] - 2026-03-30

### Added
- **Team mode auto-setup**: When user selects Team mode without the required environment variable, Claude Code now offers to automatically configure `~/.claude/settings.json` instead of only showing manual instructions
- **Team mode runtime validation**: All phases (research, plan, implement) now re-check `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` before attempting team operations, with automatic Solo fallback if unavailable

### Fixed
- **Team mode Solo fallback**: Team mode selection without proper configuration now reliably falls back to Solo mode across all phases, not just at initialization

## [5.1.1] - 2026-03-30

### Fixed
- **CRITICAL: Phase guard fail-closed** — `phase-guard-core.js` catch block now blocks (not allows) on internal errors, preventing TDD/phase enforcement bypass
- **CRITICAL: Receipt atomic writes** — Receipt JSON updates use temp-file + rename pattern to prevent data corruption from concurrent PostToolUse hooks
- **HIGH: Command chain bypass** — `detectBashFileWrite` now splits chained commands (`&&`, `||`, `;`, `|`) and checks each sub-command independently; safe prefix no longer shields file-write suffixes
- **HIGH: Bash TDD target extraction** — New `extractBashTargetFile()` extracts actual destination file from bash commands instead of matching test/exempt patterns against the entire command string
- **HIGH: Skipped phases exact matching** — Substring match replaced with comma-delimited exact match to prevent false positives
- **HIGH: Write/Edit fail-closed on missing file_path** — File editing tools now block (not allow) when file path cannot be extracted from tool input
- **MEDIUM: JSONL history locking** — `session-end.sh` uses mkdir-based locking for concurrent JSONL appends
- **MEDIUM: Cross-platform timestamp parsing** — Duration calculation replaced with Node.js `Date.parse` (removes macOS/GNU date branching)
- **MEDIUM: Notification JSON escaping** — Webhook payloads use `JSON.stringify` for proper newline/unicode escaping
- **MEDIUM: Path normalization** — `normalize_path` resolves `..` segments via `path.resolve` when present
- **MEDIUM: YAML field extraction** — `read_frontmatter_field` uses literal prefix matching instead of regex interpolation
- **MEDIUM: Receipt initial creation** — Heredoc replaced with `JSON.stringify` to prevent slice ID injection

### Changed
- `SIGNAL_EVALUATORS` in assumption engine now use `{ scope, fn }` format; session-scoped signals evaluate once per session, slice-scoped signals aggregate via any-true
- `TEST_FILE_PATTERNS` extended with Rust, Java, C#, Kotlin, Swift patterns
- New exports: `splitCommands`, `extractBashTargetFile` in phase-guard-core.js

## [5.1.0] - 2026-03-30

### Added
- **Auto-Loop Evaluation**: Plan review and test phase auto-retry with max retries and user escalation
- **Contract Negotiation**: Testable `contract` and `acceptance_threshold` fields in slice definitions
- **Assumption Engine Auto-Apply**: Automatic rule adjustment at session start based on Wilson Score evidence
- **Adaptive Evaluator Model**: All evaluator subagents use configurable model (default: sonnet), auto-adjustable by Assumption Engine
- **Phase Skip Flexibility**: `--skip-to-implement` flag for quick fixes, inline slice generation
- **Bidirectional adjustment**: Assumption Engine can tighten rules back when evidence supports it

### Changed
- Structural review now auto-loops on failure (up to 3 attempts) before escalating
- Test phase auto-returns to implement for targeted slice re-execution
- Assumption health report shows active auto-adjustments
- Slice format now includes `contract` and `acceptance_threshold` fields
- Default evaluator model changed from haiku to sonnet

### Fixed
- Assumption Engine report no longer says "Auto-application is a Phase 2 feature"

## [5.0.0] - 2026-03-30

### Added
- **Self-Evolving Harness (Assumption Engine)**: Every enforcement rule is now a falsifiable hypothesis with machine-readable evidence signals. deep-work studies its own assumptions using session data.
- **`assumptions.json`**: Registry of 5 core assumptions (phase_guard, tdd, research, cross_model_review, receipt_collection) with evidence signals, adjustable enforcement levels, and minimum session thresholds.
- **`assumption-engine.js`**: Core analysis module with Wilson Score confidence, model-aware splitting, staleness detection, new model detection, per-slice signal evaluation, report generation, ASCII timeline, and shields.io badge export. 42 unit tests.
- **`/deep-assumptions` command**: Report (default + --verbose), history (ASCII timeline), export (--format=badge), and --rebuild (regenerate JSONL from receipts).
- **`harness_metadata` in receipts**: Per-slice metadata (model_id, assumption_overrides, rework_count, tests_passed_first_try, bugs_caught_in_red_phase, review_defects_found, research_references_used, cross_model_unique_findings). Backward-compatible.
- **Session history JSONL**: `harness-sessions.jsonl` appended at session termination via Stop hook. Per-slice data, session dedupe, cross-platform date math. Disk error handling (stderr log, never blocks).
- **Health summary on session init**: `/deep-work` shows assumption health if sufficient history exists. New model detection with cold start warning.
- **Assumption Health in reports**: `/deep-report` includes assumption confidence table and per-session harness metadata aggregation.

## [4.2.1] - 2026-03-26

### Added
- **TDD Override**: When TDD blocks a production file edit during implementation, Claude now detects the block, explains the reason to the user, and offers an interactive choice — write the test first (recommended), or skip TDD for this slice with a recorded reason (config change, untestable code, urgent fix). Override is slice-scoped and auto-clears on slice transition.
- **Escape hatch guidance in block messages**: Both strict and coaching TDD block messages now show `/deep-slice spike` and `/deep-slice reset` as alternatives, so users know how to bypass TDD when needed.
- **`tdd_override` state field**: New state file field tracks which slice has an active TDD override. Hook reads this field for fast-path allow decisions.
- **Override in receipts**: Overridden slices are recorded with `tdd_override: true` and `tdd_override_reason` in receipt JSON. Receipt dashboard shows `override` status distinct from `spike` (merge-eligible with warning).
- 9 new unit tests for TDD override (total: 56 tests)

### Changed
- `phase-guard-core.js`: `checkTddEnforcement` accepts new `tddOverride` parameter; `processHook` passes `state.tdd_override`
- `phase-guard.sh`: Reads `tdd_override` from state file; adds fast-path for override matching active slice; passes override to Node.js
- `deep-implement.md`: New "TDD Override" section with AskUserQuestion flow (main model routing only)
- `deep-receipt.md`: Override icon, count, and JSON schema updated
- `deep-finish.md`: `tdd_compliance` includes `override` count
- `deep-history.md`: `tdd_compliance` and TDD compliance display include `override`

## [4.2.0] - 2026-03-25

### Added
- **Structural Review**: All phase documents (brainstorm, research, plan) now undergo structural review via Claude haiku subagent with phase-specific dimensions
- **Adversarial Cross-Model Review**: Plan documents are independently reviewed by codex and/or gemini-cli for architecture, assumptions, and risk coverage
- **Conflict Resolution UX**: When models disagree, conflicts are transparently shown to users who decide the resolution (accept, waiver, or manual edit)
- **Review Gate**: Structural review score <5 or critical consensus issues block auto-implement transition
- **`/deep-review` command**: Manually trigger structural or adversarial review at any time
- **`--skip-review` flag**: Skip all reviews for spike/experimental sessions
- **Cross-model tool auto-detection**: Automatically detects codex/gemini-cli at session init
- **Profile `cross_model_preference`**: Save cross-model preference (always/never/ask) in presets
- **Review state in resume/status**: `/deep-resume` recognizes review state; `/deep-status` displays review results
- **JSON Schema normalization**: All review results stored as structured JSON (`{phase}-review.json`)

### Changed
- `deep-brainstorm.md`: Spec review replaced with review-gate protocol reference
- `deep-research.md`: Added structural review after research completion
- `deep-plan.md`: Added structural + adversarial review before approval
- `phase-guard-core.js`: Added codex/gemini/mktemp to SAFE_COMMAND_PATTERNS
- State file: Added `review_state`, `cross_model_tools`, `cross_model_enabled`, `review_results` fields
- Profile: Added `cross_model_preference` to preset schema

### Fixed
- `.gitignore`: Added `deep-work-workflow-workspace/` to prevent venv from being tracked

## [4.1.0] - 2026-03-25

### Added
- **Worktree isolation**: Sessions now run in isolated git worktrees by default. `/deep-work` creates a worktree at `.worktrees/dw/<slug>/`, keeping main branch clean. Opt-out with `--no-branch` or `git_branch: false` in preset.
- **Model auto-routing by slice complexity**: Implement phase automatically selects the optimal model (haiku/sonnet/opus) based on each slice's size (S/M/L/XL). Override per-slice with `/deep-slice model SLICE-NNN <model>`. Customizable routing table in presets.
- **Session completion workflow** (`/deep-finish`): 4 explicit options at session end — merge to base branch, create PR, keep branch for later, or discard. Generates `session-receipt.json` with full session summary.
- **CI/CD receipt validation**: `validate-receipt.sh` validates receipt chain integrity. `templates/deep-work-ci.yml` provides a GitHub Actions workflow template. `/deep-receipt export --format=ci` for CI-friendly bundle export.
- **Session history dashboard** (`/deep-history`): Cross-session trends showing model usage, TDD compliance rates, completion rates, and cost tracking.
- **Worktree cleanup** (`/deep-cleanup`): Scans for stale deep-work worktrees (7+ days, no active session) and offers batch or individual cleanup.
- **Receipt schema v1.0**: New fields — `schema_version`, `model_used`, `model_auto_selected`, `worktree_branch`, `git_before`, `git_after`, `estimated_cost`. Session receipt is a derived cache; slice receipts are the canonical source of truth.
- **Receipt migration helper** (`receipt-migration.js`): Auto-converts pre-v4.1 receipts to schema v1.0 with atomic writes and corrupted file backup.
- **Worktree-aware resume** (`/deep-resume`): Detects worktree path on session resume and restores working directory context. Handles deleted worktrees gracefully.
- **Model cost tracking**: `estimated_cost` field in slice and session receipts for per-session AI model spending visibility.
- **Shell utilities extraction** (`utils.sh`): Shared functions (`find_project_root`, `normalize_path`, `read_frontmatter_field`, `init_deep_work_state`) extracted from 3 hook scripts into a single source file, eliminating code duplication.
- **Model routing tests**: 11 new unit tests for routing table lookup, model name validation, and custom table overrides (total: 48 tests across 2 test files).

### Changed
- Default `model_routing.implement` changed from `"sonnet"` to `"auto"` (size-based routing)
- Default `git_branch` in presets changed to `true` (worktree isolation enabled by default)
- `session-end.sh` now shows worktree branch info and suggests `/deep-finish` for cleanup
- `validate-receipt.sh` uses `set -eo pipefail` instead of `set -euo pipefail` for macOS Bash 3.2 compatibility

## [4.0.1] - 2026-03-25

### Added
- **Git-based auto-update check**: SessionStart hook checks GitHub for newer versions on every session start. Supports auto-update, snooze (escalating backoff: 24h→48h→1w), and opt-out. Modeled after gstack's update-check pattern.
- **Shell injection prevention**: phase-guard.sh and file-tracker.sh now pass values via `process.argv` instead of string interpolation, preventing injection from file paths containing special characters.

### Fixed
- macOS compatibility: removed `timeout` command usage (not available on macOS)
- Version consistency: CLAUDE.md and TODOS.md now reflect correct v4.0 version

## [4.0.0] - 2026-03-25

### BREAKING — Evidence-Driven Development Protocol

deep-work is now an **evidence-driven development protocol**. Every code change carries proof: failing test output, passing test output, git diff, spec compliance check, and code review — all collected as JSON receipts.

### Added
- **Phase 0: Brainstorm** (`/deep-brainstorm`): Explore "why" before "how" — problem definition, approach comparison, spec-reviewer validation. Skip with `--skip-brainstorm`.
- **Slice-based execution**: Plan tasks are now "slices" — self-contained units with TDD cycles, file scope, verification commands, and spec checklists.
- **TDD enforcement**: Hook-enforced state machine (PENDING→RED→RED_VERIFIED→GREEN_ELIGIBLE→GREEN→REFACTOR). Production code edits blocked until failing test exists. Modes: `strict`, `relaxed`, `coaching`, `spike`.
- **Receipt system**: JSON evidence per slice in `receipts/SLICE-NNN.json` — test output, git diff, lint results, spec checklist, code review.
- **Bash tool monitoring**: PreToolUse hook now intercepts Bash commands, blocking file-writing patterns (`echo >`, `sed -i`, `cp`, `tee`) during non-implement phases. Closes the bypass gap where AI could use shell redirects instead of Write/Edit.
- **Systematic debugging** (`/deep-debug`): 4-phase root-cause investigation (investigate→analyze→hypothesize→fix). Auto-triggers on unexpected test failures. Escalates after 3 failed hypotheses.
- **Slice management** (`/deep-slice`): Dashboard with ASCII progress visualization, manual activation, spike mode entry, slice reset with git stash.
- **Receipt management** (`/deep-receipt`): Dashboard view, per-slice detail, export as JSON (CI/CD) or markdown (PR descriptions).
- **2-stage code review**: Spec Compliance Review (required gate) + Code Quality Review (advisory gate) via subagents in test phase.
- **Receipt Completeness Gate**: Required gate — blocks test phase if any slice lacks a receipt.
- **Verification Evidence Gate**: Required gate — ensures actual test execution output exists.
- **TDD Coaching mode**: Guides beginners through TDD with educational messages instead of hard blocks.
- **Spike Mode Guard**: Auto-stashes spike code and resets slice on mode exit.
- **29 unit tests**: Node.js test suite for phase-guard-core.js (TDD state machine, Bash detection, slice scope, receipt validation).

### Changed
- Hook architecture: bash+Node.js hybrid — fast path in bash (~50ms), complex logic in Node.js subprocess (~200ms).
- Plan format: Task Checklist → Slice Checklist with per-slice metadata.
- `hooks.json`: Added `Bash` to PreToolUse and PostToolUse matchers.
- `phase-guard.sh`: Full rewrite as bash+Node hybrid.
- `file-tracker.sh`: Extended for receipt collection and active slice mapping.
- `deep-implement.md`: Full rewrite — slice-unit TDD execution.
- `deep-test.md`: 4 new quality gates (Receipt, Spec, Quality, Evidence).
- `deep-plan.md`: Slice format with TDD fields.
- `deep-work.md`: Phase 0 option, `--tdd=MODE` flag, `--skip-brainstorm` flag.
- `package.json`: Version 4.0.0.

## [3.3.3] - 2026-03-24

### Added
- **Multi-Preset Profile System**: Named presets for different work styles (e.g., `dev`, `quick`, `review`).
  - Profile v2 format with `presets:` key (single YAML file, multiple named presets)
  - Auto-migration from v1 to v2 (existing single profile → `default` preset)
  - `/deep-work --setup` now opens preset management UI (create, edit presets)
  - `/deep-work --profile=X "task"` for direct preset selection (skip interactive)
  - Interactive preset selection via AskUserQuestion when multiple presets exist
  - Single preset auto-applied without prompting
- **Trigger Evaluation Optimization**: Expanded trigger-eval.json and refined SKILL.md description.
  - trigger-eval.json expanded from 20 to 31 queries (16 true + 15 false)
  - Added coverage for v3.3.2 features: profile, preset, resume, checkpoint keywords
  - Added false-positive guards for ambiguous terms (profile picture, resume template, deep copy, etc.)
  - SKILL.md description optimized: removed generic keywords, added preset/프리셋

### Changed
- `deep-work.md` Step 1.5 rewritten for v2 profile: version check (v1 auto-migrate, v2 proceed, other reject), preset selection logic, field-to-variable mapping
- `deep-work.md` Step 1.5a flag table: added `--profile=X`
- `deep-work.md` Step 1.5b: `--setup` now shows preset management UI (with or without task)
- `deep-work.md` Step 1.5d: New preset management UI section (edit existing, create new)
- `deep-work.md` Step 7: State file template includes `preset` field
- `deep-work.md` Step 7.5: Profile save format changed from v1 (`defaults.*`) to v2 (`presets.default.*`)
- `deep-work.md` Step 8: Confirmation message shows preset name (🎯 프리셋: [name])
- `deep-resume.md` Step 1: Extracts `preset` field from state file
- `deep-resume.md` Step 3: Resume status display shows preset name
- SKILL.md Profile System section updated with multi-preset documentation
- SKILL.md v3.3.3 Features section added

## [3.3.2] - 2026-03-22

### Added
- **Profile System**: Automatic profile save/load for zero-question session initialization.
  - First `/deep-work` run saves setup answers to `.claude/deep-work-profile.yaml`
  - Subsequent runs skip all setup questions, apply saved profile instantly
  - Override flags for single-session changes: `--team`, `--zero-base`, `--skip-research`, `--no-branch`
  - Profile re-setup: `/deep-work --setup`
  - Profile version field (`version: 1`) for future migration support
- **Session Resume (`/deep-resume`)**: Resume interrupted sessions with full context restoration.
  - Auto-detects active session from `.claude/deep-work.local.md`
  - Restores AI context from artifacts: research.md (summary), plan.md (full), test-results.md (failures)
  - Auto-continues from current phase: research → plan review → implement checkpoint → test
  - Implement phase always uses checkpoint-based resume (bypasses model routing re-delegation for safety)
- **Checkpoint Verification**: Post-agent implementation integrity check.
  - Uses `git diff --name-only` as primary verification source
  - Auto-corrects plan.md `[x]` markers when git changes exist but task was unmarked
  - Falls back gracefully when `file-changes.log` is unavailable (agent delegation mode)

### Changed
- `deep-work.md` restructured with Step 1.5 (profile load/flag parse) and Step 7.5 (profile save)
- `deep-work.md` Step 2-1 (git branch) now auto-creates/skips based on profile setting
- `deep-implement.md` Section 0-pre agent prompt includes checkpoint mandate
- `deep-implement.md` Section 0-pre adds post-agent checkpoint verification step
- SKILL.md description extended with resume/profile trigger keywords
- SKILL.md updated with Profile System, Session Resume, and v3.3.2 Features sections

## [3.3.0] - 2026-03-22

### Added
- **Insight Tier Quality Gate**: Third and final tier of the 3-tier Quality Gate system. Provides informational code metrics and analysis without blocking workflow.
  - `/deep-insight` command with standalone/workflow dual mode
  - Built-in analyses: file metrics, complexity indicators, dependency graph, change summary
  - Custom ℹ️ gates in plan.md Quality Gates table
  - Produces `insight-report.md` artifact
  - Automatically runs during `/deep-test` after Required and Advisory gates
- **PostToolUse File Tracking**: `file-tracker.sh` hook automatically logs file modifications during Implement phase to `$WORK_DIR/file-changes.log` with timestamps. Used by `/deep-report` and `/deep-insight`.
- **Stop Hook — Session End Handler**: `session-end.sh` hook fires on CLI session close. If a deep-work session is active, outputs a reminder message and sends notification via configured channels.
- **insight-guide.md**: Reference guide for Insight tier — analysis interpretation, custom gate definition, limitations

### Changed
- `hooks.json` expanded from PreToolUse-only to PreToolUse + PostToolUse + Stop events
- `/deep-test` Section 2-1 now parses ℹ️ (insight) markers in Quality Gates table alongside ✅ (required) and ⚠️ (advisory)
- `/deep-test` Section 4 adds new "4-2. Built-in Insight Analysis" step after Required/Advisory gates
- `quality-gates.md` output format includes new "Insight Gates" section and insight count in verdict
- `/deep-report` reads `insight-report.md` and `file-changes.log` for enriched reports
- `/deep-status` artifact checklist includes `insight-report.md` and `file-changes.log`
- `/deep-implement` notes PostToolUse file tracking in Solo Mode instructions
- SKILL.md Phase Enforcement section updated to document all three hook types
- SKILL.md description extended with insight/metrics/tracking trigger keywords

## [3.2.2] - 2026-03-21

### Added
- **Internationalization (i18n)**: All 9 command files now detect the user's language from their messages or Claude Code's `language` setting, and output all user-facing messages in the detected language. Korean templates are preserved as the reference format; Claude translates naturally to the user's language while preserving emoji, formatting, and structure. This enables English, Japanese, Chinese, and any other language users to use the plugin without modification.
- Internationalization section added to SKILL.md documentation.

## [3.2.1] - 2026-03-21

### Fixed
- **SKILL.md description trimmed**: Reduced from ~1,500 chars to ~450 chars (3x over budget). Removes sub-feature trigger phrases that diluted matching precision and wasted prompt budget on every conversation.
- **SKILL.md changelog bloat removed**: Removed v3.1.0/v3.2.0 Features sections (~400 words) that duplicated content already covered in the body. Moved `compatibility` frontmatter (non-standard field) into body section.
- **deep-research.md section numbering**: Renumbered steps 0, 0-1, 0-2 to 1-1, 1-2, 1-3 to match logical execution order.
- **deep-test.md allowed-tools**: Removed `Edit` from allowed-tools — code modifications are blocked during Test phase by Phase Guard.
- **Command description language consistency**: Standardized `drift-check.md` and `solid-review.md` descriptions to English (matching the other 7 commands).
- **notify.sh JSON safety**: Added `MESSAGE` variable escaping (double quotes and backslashes) before JSON interpolation to prevent malformed payloads.
- **Phase Guard path reference**: Added explicit `hooks/scripts/phase-guard.sh` path in SKILL.md for discoverability.

### Added
- `.gitignore` file mirroring `.npmignore` patterns to prevent accidental commits of state files and session artifacts.

## [3.2.0] - 2026-03-18

### Added
- **3-Tier Quality Gate System**: Quality Gates now support three tiers — Required (blocking), Advisory (warning), and Insight (informational, planned for v3.3).
- **Plan Alignment / Drift Detection**: `/drift-check` command and built-in Required gate in `/deep-test`. Automatically compares plan.md items against actual git diff to detect unimplemented items, out-of-scope changes, and design decision drift. Produces `drift-report.md`.
- **SOLID Design Review**: `/solid-review` command and Advisory Quality Gate. Evaluates code against 5 SOLID principles (SRP, OCP, LSP, ISP, DIP) with per-file scorecards, overall verdict, and top-5 refactoring suggestions. Produces `solid-review.md`.
- **solid-guide.md**: Framework-agnostic SOLID review checklist with severity levels and KISS balance criteria
- **solid-prompt-guide.md**: Guide for requesting SOLID-compliant code from AI tools and verifying AI output

### Changed
- `/deep-test` now automatically runs Plan Alignment check before other Quality Gates when plan.md exists (no configuration needed)
- SKILL.md restructured: moved Plan Alignment, SOLID Review, and Session Report under new "Quality Gates & Utilities" section (previously misplaced under "The Four Phases")
- SKILL.md description optimized: consolidated ~40 granular trigger keywords into ~10 representative phrases for better signal-to-noise ratio
- v3.2.0 Features section added to SKILL.md with English-consistent language
- `plan_approved_at` field added to state schema (optional, used by Drift Detection baseline)

## [3.1.0] - 2026-03-17

### Breaking Changes
- **Repository structure overhaul**: Migrated from root-level plugin to `plugins/deep-work/` subdirectory pattern. Existing users must reinstall.

### Added
- **Model Routing (F1)**: Optimal model assignment per phase (Research=sonnet, Plan=main, Implement=sonnet, Test=haiku). Agent delegation pattern reduces tokens by 30-40%.
- **Multi-channel Notifications (F2)**: OS native + Slack/Discord/Telegram/custom Webhook notifications on phase completion. Fire-and-forget pattern.
- **Incremental Research (F3)**: `/deep-research --incremental` — re-analyzes only changed areas based on git diff. Saves 60-80% of research time.
- **Quality Gate System (F4)**: Define Quality Gates in plan.md, then execute required/advisory gates. Produces `quality-gates.md` artifact.
- **Plan Diff Visualization (F5)**: Automatically visualizes structural changes when a plan is rewritten. Produces `plan-diff.md` artifact.
- **model-routing-guide.md**: Model routing configuration guide
- **notification-guide.md**: Notification channel setup guide

### Changed
- Added model routing/notification configuration options to `/deep-work` initialization
- Added model routing, notification, and Quality Gate status display to `/deep-status`
- Added Quality Gate results and Plan Diff summary sections to `/deep-report`
- Added `model_routing`, `notifications`, `last_research_commit`, `quality_gates_passed` fields to state schema
- Changed marketplace.json source path from `"./"` to `"./plugins/deep-work"`

## [3.0.0] - 2026-03-13

### Added

#### Phase 4: Test (`/deep-test`)
- **P-1**: New Test phase added (`implement → test → idle`)
- Auto-detects test/lint/type-check commands from project config files (package.json, pyproject.toml, Makefile, Cargo.toml, go.mod)
- On test failure, automatically returns to implement phase; fix-and-retest loop (up to 3 retries)
- Cumulative per-attempt verification results recorded in `test-results.md`
- Code modifications blocked during Test phase (Phase Guard)

#### Zero-Base Mode
- **P-3**: Zero-Base mode for designing new projects from scratch
- Research covers 6 areas: tech stack selection, coding conventions, data models, API design, scaffolding, dependency evaluation
- Plan provides "Files to Create" + "Project Structure" + "Setup Instructions"
- New `references/zero-base-guide.md` guide added

#### Interactive Plan Review
- **A-7**: Provide feedback via chat and plan.md is automatically updated (no need to edit the file directly)
- Changes are highlighted, then awaits re-review

#### Plan Enhancements
- **A-6**: Previous plan versions backed up as `plan.v{N}.md` on rewrite, with Change Log section added
- **A-11**: 6 plan templates by task type (API endpoint, UI component, DB migration, refactoring, bug fix, Full Stack feature)
- **P-2**: Automatic Team/Solo mode switch suggestion on plan approval (based on task count and file count)

#### Research Enhancements
- **A-8**: Partial research re-run — `/deep-research --scope=api,data` to re-analyze specific areas only
- **A-9**: Research caching — uses previous session's research.md as baseline, re-analyzes only changed areas based on git diff

#### Git Integration
- **A-10**: Suggests creating a `deep-work/[slug]` branch at session start
- Auto-generates commit message and suggests commit on session completion (tests passed)

#### Phase Skip
- **A-1**: Option to skip Research and start from Plan during session initialization
- Eliminates unnecessary Research for familiar codebases

#### Implement Checkpoints
- **A-4**: On resume after interruption during implementation, automatically skips completed tasks and resumes from unfinished ones

#### Time Tracking
- **A-12**: Records start/completion timestamps for all phases
- Adds per-phase elapsed time table to session report

#### Team Mode Progress Notifications
- **A-13**: In Team mode, progress notifications on agent task completion in the format `[2/3] pattern-analyst completed`

#### Session Comparison
- **A-14**: `/deep-status --compare` to compare approaches, modified files, and verification results between two sessions

#### New Files
- `commands/deep-test.md` — Test Phase command
- `references/testing-guide.md` — Test Phase detailed guide
- `references/plan-templates.md` — Plan template collection
- `references/zero-base-guide.md` — Zero-Base Research guide
- `CHANGELOG.md` — Changelog file

### Changed

#### Output Format Improvements
- **P-5**: Placed Executive Summary, Key Findings, and Risk & Blockers at the top of research.md (pyramid principle)
- **P-5**: Placed Plan Summary (approach, scope of changes, risks, key decisions) at the top of plan.md

#### Phase Guard Message Improvements
- **A-2**: Added phase-specific "next step" guidance to block messages
- Research: "→ Run /deep-plan or /deep-research"
- Plan: "→ Approve the plan or re-run /deep-plan"
- Test: "→ Handled automatically on test pass/fail, see test-results.md"

#### Phase Flow Changes
- `research → plan → implement → idle` → `research → plan → implement → test ⟲ → idle`
- Auto-transitions to test phase after implement completion instead of idle
- Retry loop returning to implement on test failure

#### State File Schema Extensions
- New fields: `project_type`, `git_branch`, `test_retry_count`, `max_test_retries`, `test_passed`
- New timestamps: `research_started_at/completed_at`, `plan_started_at/completed_at`, `implement_started_at/completed_at`, `test_started_at/completed_at`

#### Version Unification
- **A-3**: Unified `plugin.json` and `package.json` versions to 3.0.0

#### SKILL.md Updates
- Reflects 4-phase workflow
- Added Zero-Base mode trigger keywords ("new project", "zero-base", "from scratch")
- Added descriptions for new features (Research caching, partial re-run, Plan templates, interactive review, etc.)

#### Reference Guide Updates
- `research-guide.md` — Added Executive Summary/Key Findings output format, link to Zero-Base guide
- `planning-guide.md` — Added Plan Summary output format, link to templates guide
- `implementation-guide.md` — Updated Completion Protocol to transition to Test phase

## [2.0.0] - 2026-03-07

### Added
- Per-task folder history (`deep-work/YYYYMMDD-HHMMSS-slug/`)
- Auto-starts implementation on plan approval
- Auto-generates session report (`report.md`)
- `/deep-report` command (view/regenerate report)
- `/deep-status` command (status, progress, session history)
- Solo/Team mode selection
- Team mode: 3-agent parallel Research, file-ownership-based parallel Implement, cross-review

### Changed
- Added `work_dir`, `team_mode`, `started_at` fields to state file
- Phase Guard now allows document edits within `deep-work/` directory

## [1.1.0] - 2026-03-01

### Added
- Phase Guard (PreToolUse hook) — Blocks code file modifications during Research/Plan phases
- State-file-based phase management

### Changed
- Migrated from simple prompt-based approach to hook-based enforcement

## [1.0.0] - 2026-02-15

### Added
- Initial release
- 3-phase workflow: Research → Plan → Implement
- `/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement` commands
- `research.md` and `plan.md` artifact generation
- Iterative Plan review support
