# Deprecated Commands Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** deep-work v6.2.1에서 11개 커맨드 파일의 부정확한 "Deprecated in v5.2" 블록을 Quality Gate / Internal / Escape hatch / Utility 4개 라벨로 정확히 재분류하고, hook/skill/README 안내 문자열을 `/deep-status` 플래그로 일관화한다. 커맨드 파일은 삭제하지 않는다.

**Architecture:** 순수 문서/문자열 정리. Functional 동작 변경 없음(기존 커맨드는 계속 동작). 각 커맨드 파일의 frontmatter 바로 아래 quote block(`> ...`)만 교체/삽입하며, Claude Code 커맨드 등록 메타데이터(frontmatter)는 건드리지 않는다.

**Tech Stack:** Markdown(.md), YAML frontmatter, Node.js(hooks), Bash(hooks), JSON(plugin manifest).

**Spec reference:** `specs/2026-04-15-deprecated-commands-cleanup-design.md` (v2, commit `bc08683`).

---

## File Structure

변경 대상 파일 (24개, 카테고리별):

**Quality Gate 3개** — `commands/drift-check.md`, `commands/solid-review.md`, `commands/deep-insight.md` (L7-8 블록 교체).

**Internal (block-replace) 5개** — `commands/deep-finish.md`, `commands/deep-report.md`, `commands/deep-receipt.md`, `commands/deep-history.md`, `commands/deep-assumptions.md` (L6-7 블록 교체 + 참조처 한 줄).

**Internal (block-insert) 1개** — `commands/deep-brainstorm.md` (frontmatter `---` 뒤, `# /deep-brainstorm` 앞에 삽입).

**Escape hatch 1개** — `commands/deep-slice.md` (L6-7 블록 교체).

**Utility 2개** — `commands/deep-cleanup.md`, `commands/deep-resume.md` (L6-7 블록 교체).

**Hook 2개** — `hooks/scripts/assumption-engine.js` (L1247), `hooks/scripts/session-end.sh` (L64).

**Skill 2개** — `skills/deep-test/SKILL.md` (L150), `skills/deep-work-workflow/SKILL.md` (L83-87, L238-253, L318-321).

**README 2개** — `README.md` (L54, L80-98, L335-336, L575), `README.ko.md` (L54, L80-98, L460-461, L566).

**CHANGELOG 2개** — `CHANGELOG.md`, `CHANGELOG.ko.md` (v6.2.1 섹션 신설).

**Manifest 3개** — `.claude-plugin/plugin.json`, `package.json`, `CLAUDE.md` (버전 bump).

---

## Task 1: Quality Gate 블록 교체 — drift-check

**Files:**
- Modify: `commands/drift-check.md:7-8`

- [ ] **Step 1: 블록 교체**

Edit `commands/drift-check.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Quality Gate (v6.2.1)** — `/deep-test`가 Required Gate로 자동 실행합니다. 특정 plan 파일에 대한 독립 검증이 필요할 때 직접 사용하세요.
> Standalone: `/drift-check [plan-file]`
```

- [ ] **Step 2: 검증**

Run: `grep -n "Quality Gate (v6.2.1)" /Users/sungmin/Dev/deep-work/commands/drift-check.md`
Expected: `7:> **Quality Gate (v6.2.1)** — ...`

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/drift-check.md`
Expected: (empty — no match)

---

## Task 2: Quality Gate 블록 교체 — solid-review

**Files:**
- Modify: `commands/solid-review.md:7-8`

- [ ] **Step 1: 블록 교체**

Edit `commands/solid-review.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Quality Gate (v6.2.1)** — `/deep-test`가 Advisory Gate로 자동 실행합니다. 특정 파일/디렉터리에 대한 독립 SOLID 검증이 필요할 때 직접 사용하세요.
> Standalone: `/solid-review [target]`
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/solid-review.md`
Expected: (empty)

---

## Task 3: Quality Gate 블록 교체 — deep-insight

**Files:**
- Modify: `commands/deep-insight.md:7-8`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-insight.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Quality Gate (v6.2.1)** — `/deep-test`가 Insight Tier로 자동 실행합니다 (차단 없음). 특정 대상의 메트릭/복잡도/의존성 분석이 필요할 때 직접 사용하세요.
> Standalone: `/deep-insight [target]`
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/deep-insight.md`
Expected: (empty)

---

## Task 4: Quality Gate 커밋

- [ ] **Step 1: 커밋**

```bash
cd /Users/sungmin/Dev/deep-work
git add commands/drift-check.md commands/solid-review.md commands/deep-insight.md
git commit -m "docs(commands): relabel Quality Gate commands (drift-check, solid-review, deep-insight)"
```

Expected: 3 files changed.

---

## Task 5: Internal 블록 교체 — deep-finish

**Files:**
- Modify: `commands/deep-finish.md:6-7`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-finish.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Internal (v6.2.1)** — orchestrator 또는 `/deep-status`가 이 파일의 로직을 참조합니다. 자동 호출이 주 경로이며, 수동 호출도 공식 경로입니다(특히 test 통과 후 세션 완료 시).
> 참조처: `skills/deep-work-orchestrator/SKILL.md` Step 3-6 (`Read "/deep-finish"`). `skills/deep-test/SKILL.md`가 test pass 후 수동 호출을 안내.
```

- [ ] **Step 2: 검증**

Run: `grep -n "Internal (v6.2.1)" /Users/sungmin/Dev/deep-work/commands/deep-finish.md`
Expected: `6:> **Internal (v6.2.1)** — ...`

---

## Task 6: Internal 블록 교체 — deep-report

**Files:**
- Modify: `commands/deep-report.md:6-7`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-report.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Internal (v6.2.1)** — `/deep-status --report`가 이 파일의 로직을 `Read`하여 실행합니다. 자동 호출이 주 경로이며, 직접 호출도 지원됩니다.
> 참조처: `commands/deep-status.md` §8 (`Read the /deep-report command file and follow its logic`).
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/deep-report.md`
Expected: (empty)

---

## Task 7: Internal 블록 교체 — deep-receipt

**Files:**
- Modify: `commands/deep-receipt.md:6-7`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-receipt.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Internal (v6.2.1)** — `/deep-status --receipts`가 이 파일의 display logic을 `Read`하여 실행합니다. 자동 호출이 주 경로이며, 직접 호출도 지원됩니다.
> 참조처: `commands/deep-status.md` §6 (`Read the /deep-receipt command file and follow its display logic inline`).
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/deep-receipt.md`
Expected: (empty)

---

## Task 8: Internal 블록 교체 — deep-history

**Files:**
- Modify: `commands/deep-history.md:6-7`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-history.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Internal (v6.2.1)** — `/deep-status --history`가 이 파일의 로직을 `Read`하여 실행합니다. 자동 호출이 주 경로이며, 직접 호출도 지원됩니다.
> 참조처: `commands/deep-status.md` §7 (`Read the /deep-history command file and follow its display logic inline`).
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/deep-history.md`
Expected: (empty)

---

## Task 9: Internal 블록 교체 — deep-assumptions

**Files:**
- Modify: `commands/deep-assumptions.md:6-7`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-assumptions.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Internal (v6.2.1)** — `/deep-status --assumptions`가 이 파일의 로직을 `Read`하여 실행합니다. 자동 호출이 주 경로이며, 직접 호출도 지원됩니다.
> 참조처: `commands/deep-status.md` §9 (`Read the /deep-assumptions command file and follow its logic`).
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/deep-assumptions.md`
Expected: (empty)

---

## Task 10: Internal block-insert — deep-brainstorm

**Files:**
- Modify: `commands/deep-brainstorm.md:3-5`

현재 파일 구조 (9줄):
```
---
allowed-tools: Skill, Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion
---

# /deep-brainstorm

Phase 0: 문제 정의 및 접근법 탐색 — 왜(why)를 먼저 탐구.

Skill("deep-brainstorm", args="$ARGUMENTS")
```

- [ ] **Step 1: frontmatter 닫힘(`---`) 직후 quote block 삽입**

Edit `commands/deep-brainstorm.md`:

old_string:
```
---
allowed-tools: Skill, Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion
---

# /deep-brainstorm
```

new_string:
```
---
allowed-tools: Skill, Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion
---

> **Internal (v6.2.1)** — orchestrator §3-1이 `Skill("deep-brainstorm", ...)`로 호출하는 Phase 0 진입점. `/deep-work` auto-flow가 기본 경로이며, 특정 phase만 재실행할 때 수동 호출도 가능합니다.

# /deep-brainstorm
```

- [ ] **Step 2: 검증**

Run: `grep -n "Internal (v6.2.1)" /Users/sungmin/Dev/deep-work/commands/deep-brainstorm.md`
Expected: `5:> **Internal (v6.2.1)** — ...`

Run: `head -12 /Users/sungmin/Dev/deep-work/commands/deep-brainstorm.md`
Expected: frontmatter 보존 + 새 quote block + `# /deep-brainstorm` 유지.

---

## Task 11: Internal 커밋

- [ ] **Step 1: 커밋**

```bash
cd /Users/sungmin/Dev/deep-work
git add commands/deep-finish.md commands/deep-report.md commands/deep-receipt.md commands/deep-history.md commands/deep-assumptions.md commands/deep-brainstorm.md
git commit -m "docs(commands): relabel Internal commands with auto-call + manual-ok wording"
```

Expected: 6 files changed.

---

## Task 12: Escape hatch 블록 교체 — deep-slice

**Files:**
- Modify: `commands/deep-slice.md:6-7`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-slice.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Escape hatch utility (v6.2.1)** — TDD 블록 시 `phase-guard`가 안내하는 수동 slice 개입 경로 (`spike`, `reset`, `model`). `/deep-implement` auto-flow가 정상 동작할 때는 대부분 자동 관리됩니다.
> 참조처: `hooks/scripts/phase-guard-core.js` L110-L123 (TDD 블록 메시지에서 `/deep-slice spike/reset` 안내).
```

- [ ] **Step 2: 검증**

Run: `grep -n "Escape hatch utility" /Users/sungmin/Dev/deep-work/commands/deep-slice.md`
Expected: `6:> **Escape hatch utility (v6.2.1)** — ...`

---

## Task 13: Utility 블록 교체 — deep-cleanup

**Files:**
- Modify: `commands/deep-cleanup.md:6-7`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-cleanup.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Utility (v6.2.1)** — standalone 명령. `/deep-work` init이 stale 세션 일부를 감지하지만, `git worktree list` 스캔·stale/active 분류·dirty 트리 삭제 확인·fork worktree 및 registry 정리는 이 커맨드가 유일한 경로입니다.
> 향후 기능 이관 후 삭제 예정 (spec §7 follow-up).
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/deep-cleanup.md`
Expected: (empty)

---

## Task 14: Utility 블록 교체 — deep-resume

**Files:**
- Modify: `commands/deep-resume.md:6-7`

- [ ] **Step 1: 블록 교체**

Edit `commands/deep-resume.md`:

old_string:
```
> **Deprecated in v5.2** — 이 커맨드는 `/deep-work` auto-flow에서 자동 실행됩니다.
> 수동 호출도 여전히 가능합니다. 통합 워크플로우는 `/deep-work`을 참고하세요.
```

new_string:
```
> **Utility (v6.2.1)** — standalone 명령. `/deep-work` init은 stale 세션 감지만 수행하며, active 세션 선택·worktree 컨텍스트 복원·state 마이그레이션·phase cache 정리·phase별 resume dispatch는 이 커맨드가 유일한 경로입니다.
> 향후 기능 이관 후 삭제 예정 (spec §7 follow-up).
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated in v5.2" /Users/sungmin/Dev/deep-work/commands/deep-resume.md`
Expected: (empty)

---

## Task 15: Escape hatch + Utility 커밋

- [ ] **Step 1: 커밋**

```bash
cd /Users/sungmin/Dev/deep-work
git add commands/deep-slice.md commands/deep-cleanup.md commands/deep-resume.md
git commit -m "docs(commands): relabel deep-slice as escape hatch, deep-cleanup/resume as utility"
```

Expected: 3 files changed.

---

## Task 16: Hook 안내 — assumption-engine.js

**Files:**
- Modify: `hooks/scripts/assumption-engine.js:1247`

- [ ] **Step 1: 안내 문자열 교체**

Edit `hooks/scripts/assumption-engine.js`:

old_string:
```
    notification = `Assumption Engine auto-adjustment:\n${lines.join('\n')}\n  Floors guaranteed. Run /deep-assumptions for details.`;
```

new_string:
```
    notification = `Assumption Engine auto-adjustment:\n${lines.join('\n')}\n  Floors guaranteed. Run /deep-status --assumptions for details.`;
```

- [ ] **Step 2: 검증**

Run: `grep -n "deep-status --assumptions" /Users/sungmin/Dev/deep-work/hooks/scripts/assumption-engine.js`
Expected: `1247:    notification = ...Run /deep-status --assumptions for details...`

---

## Task 17: Hook 안내 — session-end.sh

**Files:**
- Modify: `hooks/scripts/session-end.sh:64`

주의: L85의 주석(`Consumers (deep-status, deep-work, deep-report, deep-assumptions) all read from this path`)은 **코드 참조 문서**이므로 유지한다.

- [ ] **Step 1: 안내 문자열 교체**

Edit `hooks/scripts/session-end.sh`:

old_string:
```
{"message":"Deep Work 세션이 활성 상태입니다.\n\n  Phase: ${PHASE_KO}\n  Task: ${TASK_DESC}${WORKTREE_MSG}\n\n다음 세션에서 /deep-status로 진행 상황을 확인하거나,\n작업이 완료되었다면 /deep-report로 리포트를 생성하세요."}
```

new_string:
```
{"message":"Deep Work 세션이 활성 상태입니다.\n\n  Phase: ${PHASE_KO}\n  Task: ${TASK_DESC}${WORKTREE_MSG}\n\n다음 세션에서 /deep-status로 진행 상황을 확인하거나,\n작업이 완료되었다면 /deep-status --report로 리포트를 확인하세요."}
```

- [ ] **Step 2: 검증**

Run: `grep -n "deep-status --report로 리포트" /Users/sungmin/Dev/deep-work/hooks/scripts/session-end.sh`
Expected: `64: ... /deep-status --report로 리포트를 확인하세요...`

Run: `grep -n "deep-report, deep-assumptions" /Users/sungmin/Dev/deep-work/hooks/scripts/session-end.sh`
Expected: `85:...Consumers (deep-status, deep-work, deep-report, deep-assumptions)...` (주석 보존 확인)

---

## Task 18: Skill 안내 — deep-test/SKILL.md

**Files:**
- Modify: `skills/deep-test/SKILL.md:150`

주의: L122·L125의 `/deep-finish` 안내는 **유지한다**(Internal이지만 수동 호출 공식 경로).

- [ ] **Step 1: 문자열 교체**

Edit `skills/deep-test/SKILL.md`:

old_string:
```
4. 안내: `/deep-test`로 재실행 또는 `/deep-report`로 결과 정리
```

new_string:
```
4. 안내: `/deep-test`로 재실행 또는 `/deep-status --report`로 결과 정리
```

- [ ] **Step 2: 검증**

Run: `grep -n "/deep-status --report로 결과" /Users/sungmin/Dev/deep-work/skills/deep-test/SKILL.md`
Expected: `150:4. 안내: .../deep-status --report로 결과 정리`

Run: `grep -n "/deep-finish" /Users/sungmin/Dev/deep-work/skills/deep-test/SKILL.md`
Expected: L122, L125 유지 확인.

---

## Task 19: Hook + Skill 커밋

- [ ] **Step 1: 커밋**

```bash
cd /Users/sungmin/Dev/deep-work
git add hooks/scripts/assumption-engine.js hooks/scripts/session-end.sh skills/deep-test/SKILL.md
git commit -m "refactor(hooks,skill): route user-facing guidance to /deep-status flags"
```

Expected: 3 files changed.

---

## Task 20: SKILL.md 분류 섹션 재작성 — deep-work-workflow

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md:83-86`

- [ ] **Step 1: 분류 섹션 전면 교체**

Edit `skills/deep-work-workflow/SKILL.md`:

old_string:
```
**Primary commands (7):** `/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement`, `/deep-test`, `/deep-status`, `/deep-debug`

**Deprecated commands (13):** 자동 흐름에 흡수됨. 수동 호출 가능하지만 불필요.
- brainstorm, review, receipt, slice, insight, finish, cleanup, history, assumptions, resume, report, drift-check, solid-review
```

new_string:
```
**Primary workflow (7):** `/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement`, `/deep-test`, `/deep-status`, `/deep-debug`

**Special utility (4):** `/deep-fork`, `/deep-mutation-test`, `/deep-phase-review`, `/deep-sensor-scan`

**Quality Gate (3):** `/drift-check`, `/solid-review`, `/deep-insight` — `/deep-test`가 자동 실행; standalone 호출 가능.

**Internal (6):** `/deep-brainstorm`, `/deep-finish`, `/deep-report`, `/deep-receipt`, `/deep-history`, `/deep-assumptions` — orchestrator 또는 `/deep-status`가 내부 참조. 수동 호출도 공식 경로.

**Escape hatch (1):** `/deep-slice` — `phase-guard`가 TDD 블록 시 안내 (`spike`, `reset`).

**Utility (2):** `/deep-cleanup`, `/deep-resume` — standalone 기능. 향후 이관 후 삭제 예정.
```

- [ ] **Step 2: 검증**

Run: `grep -n "Primary workflow (7)" /Users/sungmin/Dev/deep-work/skills/deep-work-workflow/SKILL.md`
Expected: L83.

Run: `grep -n "Deprecated commands (13)" /Users/sungmin/Dev/deep-work/skills/deep-work-workflow/SKILL.md`
Expected: (empty)

---

## Task 21: SKILL.md 섹션 제목 수정 — Plan Alignment Check

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md:238`

- [ ] **Step 1: 제목 교체**

Edit `skills/deep-work-workflow/SKILL.md`:

old_string:
```
### Plan Alignment Check (/drift-check) — *deprecated, auto-runs in /deep-test*
```

new_string:
```
### Plan Alignment Check (/drift-check) — *Quality Gate — auto-runs in /deep-test; standalone: /drift-check [plan-file]*
```

- [ ] **Step 2: 검증**

Run: `grep -n "Plan Alignment Check" /Users/sungmin/Dev/deep-work/skills/deep-work-workflow/SKILL.md`
Expected: L238 contains `Quality Gate`.

---

## Task 22: SKILL.md 섹션 제목 수정 — SOLID Design Review

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md:243`

- [ ] **Step 1: 제목 교체**

Edit `skills/deep-work-workflow/SKILL.md`:

old_string:
```
### SOLID Design Review (/solid-review) — *deprecated, auto-runs in /deep-test*
```

new_string:
```
### SOLID Design Review (/solid-review) — *Quality Gate — auto-runs in /deep-test; standalone: /solid-review [target]*
```

- [ ] **Step 2: 검증**

Run: `grep -n "SOLID Design Review" /Users/sungmin/Dev/deep-work/skills/deep-work-workflow/SKILL.md`
Expected: L243 contains `Quality Gate`.

---

## Task 23: SKILL.md 섹션 제목 수정 — Code Insight Analysis

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md:248`

- [ ] **Step 1: 제목 교체**

Edit `skills/deep-work-workflow/SKILL.md`:

old_string:
```
### Code Insight Analysis (/deep-insight) — *deprecated, auto-runs in /deep-test*
```

new_string:
```
### Code Insight Analysis (/deep-insight) — *Quality Gate — auto-runs in /deep-test; standalone: /deep-insight [target]*
```

- [ ] **Step 2: 검증**

Run: `grep -n "Code Insight Analysis" /Users/sungmin/Dev/deep-work/skills/deep-work-workflow/SKILL.md`
Expected: L248 contains `Quality Gate`.

---

## Task 24: SKILL.md 섹션 제목 수정 — Session Report

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md:253`

- [ ] **Step 1: 제목 교체**

Edit `skills/deep-work-workflow/SKILL.md`:

old_string:
```
### Session Report (/deep-report) — *deprecated, use /deep-status --report*
```

new_string:
```
### Session Report (/deep-report) — *Internal — auto-generated after test pass; manual: /deep-status --report*
```

- [ ] **Step 2: 검증**

Run: `grep -n "Session Report" /Users/sungmin/Dev/deep-work/skills/deep-work-workflow/SKILL.md`
Expected: L253 contains `Internal`.

---

## Task 25: SKILL.md Session Resume 섹션 재작성

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md:318-321`

- [ ] **Step 1: 섹션 교체**

Edit `skills/deep-work-workflow/SKILL.md`:

old_string:
```
## Session Resume — *deprecated, auto-detected in /deep-work*

`/deep-work` 실행 시 기존 활성 세션이 감지되면 자동으로 resume 옵션을 제시합니다.
`/deep-resume`는 여전히 수동으로 호출 가능합니다.
```

new_string:
```
## Session Resume (/deep-resume)

`/deep-work` 진입 시 stale 세션은 자동 감지되지만, active 세션 선택·worktree 컨텍스트 복원·phase별 resume dispatch는 `/deep-resume`을 통해서만 가능합니다.
```

- [ ] **Step 2: 검증**

Run: `grep -n "## Session Resume" /Users/sungmin/Dev/deep-work/skills/deep-work-workflow/SKILL.md`
Expected: L318 = `## Session Resume (/deep-resume)` (no `deprecated`).

Run: `grep -c "deprecated" /Users/sungmin/Dev/deep-work/skills/deep-work-workflow/SKILL.md`
Expected: `0`

---

## Task 26: SKILL.md 커밋

- [ ] **Step 1: 커밋**

```bash
cd /Users/sungmin/Dev/deep-work
git add skills/deep-work-workflow/SKILL.md
git commit -m "docs(skill): rewrite deep-work-workflow classification into 6 categories"
```

Expected: 1 file changed.

---

## Task 27: README.md — L54 주석

**Files:**
- Modify: `README.md:54`

- [ ] **Step 1: 주석 교체**

Edit `README.md`:

old_string:
```
# Check unified status (replaces /deep-report, /deep-receipt, /deep-history, /deep-assumptions)
```

new_string:
```
# Unified status — flags route to the same implementations as the standalone /deep-report, /deep-receipt, /deep-history, /deep-assumptions
```

- [ ] **Step 2: 검증**

Run: `grep -n "Unified status" /Users/sungmin/Dev/deep-work/README.md`
Expected: L54.

---

## Task 28: README.md — 표 섹션 재구성

**Files:**
- Modify: `README.md:80-98`

- [ ] **Step 1: 표 전체 교체**

Edit `README.md`:

old_string:
```
### Deprecated Commands (13)

These commands still work but are now absorbed into the auto-flow. You no longer need to call them manually.

| Command | Absorbed into |
|---------|---------------|
| `/deep-brainstorm` | `/deep-work` auto-flow (Phase 0) |
| `/deep-phase-review` | Phase document review (standalone command) |
| `/deep-receipt` | `/deep-status --receipts` |
| `/deep-slice` | `/deep-implement` (auto-managed internally) |
| `/deep-insight` | `/deep-test` (auto-runs as advisory gate) |
| `/deep-finish` | `/deep-work` (final stage of auto-flow) |
| `/deep-cleanup` | `/deep-work` init (auto-runs at session start) |
| `/deep-history` | `/deep-status --history` |
| `/deep-assumptions` | `/deep-status --assumptions` |
| `/deep-resume` | `/deep-work` (auto-detects active session) |
| `/deep-report` | `/deep-status --report` |
| `/drift-check` | `/deep-test` (auto-runs as required gate) |
| `/solid-review` | `/deep-test` (auto-runs as advisory gate) |
```

new_string:
```
### Special Utility (4)

Phase or toolchain helpers, run manually when needed.

| Command | Purpose |
|---------|---------|
| `/deep-fork` | Fork a session to explore a different approach |
| `/deep-mutation-test` | Mutation testing on changed files |
| `/deep-phase-review` | Manual Phase document review (brainstorm/research/plan) |
| `/deep-sensor-scan` | Run linters, type checkers, coverage tools independently |

### Quality Gate (3) — auto-runs in /deep-test, standalone available

| Command | Role in /deep-test | Standalone |
|---------|---------------------|------------|
| `/drift-check` | Required Gate — plan alignment | `/drift-check [plan-file]` |
| `/solid-review` | Advisory Gate — SOLID principles | `/solid-review [target]` |
| `/deep-insight` | Insight Tier — metrics/complexity | `/deep-insight [target]` |

### Internal (6) — auto-runs, manual supported

These commands are called by the orchestrator or `/deep-status`. Manual invocation remains a first-class path (especially `/deep-finish` after tests pass).

| Command | Called by |
|---------|-----------|
| `/deep-brainstorm` | orchestrator Phase 0 (`Skill` dispatch) |
| `/deep-finish` | orchestrator Step 3-6 (`Read`); manual after test pass |
| `/deep-report` | `/deep-status --report` (`Read`) |
| `/deep-receipt` | `/deep-status --receipts` (`Read`) |
| `/deep-history` | `/deep-status --history` (`Read`) |
| `/deep-assumptions` | `/deep-status --assumptions` (`Read`) |

### Escape Hatch (1)

| Command | Surfaced by |
|---------|-------------|
| `/deep-slice` | `phase-guard` TDD block message (`spike`, `reset`) |

### Utility (2) — standalone, feature migration pending

These commands are the sole path for certain behaviors. They will be removed once their functionality is migrated (see `/deep-work --resume=<session-id>` and `/deep-status --cleanup` roadmap).

| Command | Unique capability |
|---------|-------------------|
| `/deep-cleanup` | `git worktree list` scan, stale/active classification, fork/registry cleanup |
| `/deep-resume` | Active session selection, worktree context restore, phase-specific resume dispatch |
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated Commands" /Users/sungmin/Dev/deep-work/README.md`
Expected: (empty)

Run: `grep -n "^### " /Users/sungmin/Dev/deep-work/README.md | head -8`
Expected: 5 new categories appear in order.

---

## Task 29: README.md — 본문 L335-336 보강

**Files:**
- Modify: `README.md:335-336`

- [ ] **Step 1: 본문 교체**

Edit `README.md`:

old_string:
```
- `/deep-cleanup` removes stale worktrees (7+ days old, no active session)
- `/deep-resume` automatically detects and restores worktree context
```

new_string:
```
- `/deep-cleanup` removes stale worktrees (7+ days old, no active session) — **standalone utility**
- `/deep-resume` restores worktree context and dispatches into the correct phase — **standalone utility**; `/deep-work` init also auto-detects stale sessions
```

- [ ] **Step 2: 검증**

Run: `grep -n "standalone utility" /Users/sungmin/Dev/deep-work/README.md`
Expected: 2 matches around L335-336.

---

## Task 30: README.md — L575 호환성 문구

**Files:**
- Modify: `README.md:575`

- [ ] **Step 1: 문구 교체**

Edit `README.md`:

old_string:
```
No action needed. Your existing presets and session state are fully compatible. Deprecated commands still work — they just invoke the same logic that the auto-flow would.
```

new_string:
```
No action needed. Your existing presets and session state are fully compatible. Previously "deprecated" commands are reclassified in v6.2.1 as Quality Gate / Internal / Escape hatch / Utility — they continue to work and remain first-class where auto-flow hands control back to you (e.g., `/deep-finish` after tests pass).
```

- [ ] **Step 2: 검증**

Run: `grep -n "reclassified in v6.2.1" /Users/sungmin/Dev/deep-work/README.md`
Expected: 1 match.

---

## Task 31: README.ko.md — L54 주석

**Files:**
- Modify: `README.ko.md:54`

- [ ] **Step 1: 주석 교체**

Edit `README.ko.md`:

old_string:
```
# 통합 상태 조회 (/deep-report, /deep-receipt, /deep-history, /deep-assumptions 대체)
```

new_string:
```
# 통합 상태 조회 — 플래그는 standalone /deep-report, /deep-receipt, /deep-history, /deep-assumptions와 동일한 구현으로 라우팅됨
```

- [ ] **Step 2: 검증**

Run: `grep -n "플래그는 standalone" /Users/sungmin/Dev/deep-work/README.ko.md`
Expected: L54.

---

## Task 32: README.ko.md — 표 섹션 재구성

**Files:**
- Modify: `README.ko.md:80-98`

- [ ] **Step 1: 표 전체 교체**

Edit `README.ko.md`:

old_string:
```
### Deprecated 커맨드 (13개)

이 커맨드들은 여전히 동작하지만, auto-flow에 흡수되어 수동 호출이 더 이상 필요하지 않습니다.

| 커맨드 | 흡수된 위치 |
|--------|------------|
| `/deep-brainstorm` | `/deep-work` auto-flow (Phase 0) |
| `/deep-phase-review` | Phase 문서 전용 리뷰 (독립 커맨드) |
| `/deep-receipt` | `/deep-status --receipts` |
| `/deep-slice` | `/deep-implement` 내부 자동 관리 |
| `/deep-insight` | `/deep-test` advisory 게이트 |
| `/deep-finish` | `/deep-work` 마지막 단계 |
| `/deep-cleanup` | `/deep-work` init 자동 실행 |
| `/deep-history` | `/deep-status --history` |
| `/deep-assumptions` | `/deep-status --assumptions` |
| `/deep-resume` | `/deep-work` 세션 감지 자동 |
| `/deep-report` | `/deep-status --report` |
| `/drift-check` | `/deep-test` required 게이트 |
| `/solid-review` | `/deep-test` advisory 게이트 |
```

new_string:
```
### Special Utility (4개)

Phase나 툴체인 헬퍼. 필요할 때 수동으로 호출합니다.

| 커맨드 | 용도 |
|--------|------|
| `/deep-fork` | 세션을 fork하여 다른 접근법 탐색 |
| `/deep-mutation-test` | 변경 파일 대상 mutation testing |
| `/deep-phase-review` | brainstorm/research/plan 문서 수동 리뷰 |
| `/deep-sensor-scan` | 린터/타입체커/커버리지를 독립 실행 |

### Quality Gate (3개) — /deep-test 자동 실행, standalone 가능

| 커맨드 | /deep-test 내 역할 | Standalone |
|--------|---------------------|------------|
| `/drift-check` | Required Gate — plan 정합성 | `/drift-check [plan-file]` |
| `/solid-review` | Advisory Gate — SOLID 원칙 | `/solid-review [target]` |
| `/deep-insight` | Insight Tier — 메트릭/복잡도 | `/deep-insight [target]` |

### Internal (6개) — 자동 호출, 수동도 공식 경로

orchestrator 또는 `/deep-status`가 호출합니다. 수동 호출도 일등급 경로입니다 (특히 test 통과 후 `/deep-finish`).

| 커맨드 | 호출 주체 |
|--------|-----------|
| `/deep-brainstorm` | orchestrator Phase 0 (`Skill` dispatch) |
| `/deep-finish` | orchestrator Step 3-6 (`Read`); test 통과 후 수동 호출 |
| `/deep-report` | `/deep-status --report` (`Read`) |
| `/deep-receipt` | `/deep-status --receipts` (`Read`) |
| `/deep-history` | `/deep-status --history` (`Read`) |
| `/deep-assumptions` | `/deep-status --assumptions` (`Read`) |

### Escape Hatch (1개)

| 커맨드 | 노출 위치 |
|--------|-----------|
| `/deep-slice` | `phase-guard` TDD 블록 안내 메시지 (`spike`, `reset`) |

### Utility (2개) — standalone, 기능 이관 예정

특정 동작의 유일한 경로인 커맨드. 기능이 이관되면 삭제 예정 (`/deep-work --resume=<session-id>`, `/deep-status --cleanup` 로드맵 참고).

| 커맨드 | 고유 기능 |
|--------|-----------|
| `/deep-cleanup` | `git worktree list` 스캔, stale/active 분류, fork/registry 정리 |
| `/deep-resume` | active 세션 선택, worktree 컨텍스트 복원, phase별 resume dispatch |
```

- [ ] **Step 2: 검증**

Run: `grep -n "Deprecated 커맨드" /Users/sungmin/Dev/deep-work/README.ko.md`
Expected: (empty)

---

## Task 33: README.ko.md — 본문 L460-461 보강

**Files:**
- Modify: `README.ko.md:460-461`

- [ ] **Step 1: 본문 교체**

Edit `README.ko.md`:

old_string:
```
- `/deep-cleanup`으로 오래된 worktree 정리 (7일 이상, 비활성 세션)
- `/deep-resume`이 자동으로 worktree 컨텍스트 감지 및 복원
```

new_string:
```
- `/deep-cleanup`으로 오래된 worktree 정리 (7일 이상, 비활성 세션) — **standalone utility**
- `/deep-resume`으로 worktree 컨텍스트 복원 및 phase 자동 dispatch — **standalone utility**; `/deep-work` init도 stale 세션을 자동 감지
```

- [ ] **Step 2: 검증**

Run: `grep -n "standalone utility" /Users/sungmin/Dev/deep-work/README.ko.md`
Expected: 2 matches around L460-461.

---

## Task 34: README.ko.md — L566 호환성 문구

**Files:**
- Modify: `README.ko.md:566`

- [ ] **Step 1: 문구 교체**

Edit `README.ko.md`:

old_string:
```
별도 작업 불필요. 기존 프리셋과 세션 상태는 완전히 호환됩니다. Deprecated 커맨드도 그대로 동작합니다 — auto-flow와 동일한 로직을 호출합니다.
```

new_string:
```
별도 작업 불필요. 기존 프리셋과 세션 상태는 완전히 호환됩니다. 이전에 "Deprecated"로 표기되었던 커맨드는 v6.2.1에서 Quality Gate / Internal / Escape hatch / Utility로 재분류되었고, 수동 호출이 여전히 공식 경로인 경우도 있습니다 (예: test 통과 후 `/deep-finish`).
```

- [ ] **Step 2: 검증**

Run: `grep -n "v6.2.1에서 Quality Gate" /Users/sungmin/Dev/deep-work/README.ko.md`
Expected: 1 match.

---

## Task 35: README 커밋

- [ ] **Step 1: 커밋**

```bash
cd /Users/sungmin/Dev/deep-work
git add README.md README.ko.md
git commit -m "docs(readme): restructure command tables into 5 categories, revise body references"
```

Expected: 2 files changed.

---

## Task 36: CHANGELOG.md v6.2.1 항목 추가

**Files:**
- Modify: `CHANGELOG.md` (상단 Unreleased/최상위 바로 아래, v6.2.0 바로 위)

- [ ] **Step 1: 현재 최상위 확인**

Run: `head -20 /Users/sungmin/Dev/deep-work/CHANGELOG.md`
Expected: `# Changelog` 헤더 + 이후 v6.2.0 또는 Unreleased 섹션.

- [ ] **Step 2: v6.2.1 섹션 삽입**

`CHANGELOG.md` 파일의 `# Changelog` 헤더 바로 아래에 다음 블록을 삽입한다 (기존 최상위 엔트리 앞).

Edit `CHANGELOG.md`:

old_string:
```
# Changelog
```

new_string:
```
# Changelog

## [6.2.1] — 2026-04-15

### Changed
- **Command classification cleanup**: 11 commands previously labeled `Deprecated in v5.2` and 2 more (`deep-brainstorm`, `deep-phase-review`) in the same table are now reclassified into five accurate categories: Quality Gate (3), Internal (6), Escape hatch (1), Utility (2), and Special utility (`/deep-phase-review` moved out).
- **`/deep-finish` framing**: now described as "auto-call is primary, manual invocation remains a first-class path after test pass" rather than deprecated.
- **Hook/skill user-facing guidance** now routes to `/deep-status` flags:
  - `hooks/scripts/assumption-engine.js`: `/deep-assumptions` → `/deep-status --assumptions`
  - `hooks/scripts/session-end.sh`: `/deep-report` → `/deep-status --report`
  - `skills/deep-test/SKILL.md`: same alignment
- **README** (en/ko): "Deprecated Commands (13)" single table replaced by five category tables; body references to `/deep-cleanup`/`/deep-resume` in the Worktree Isolation section reframed as standalone utilities.
- **`skills/deep-work-workflow/SKILL.md`** classification section rewritten into 6 categories (Primary / Special / Quality Gate / Internal / Escape hatch / Utility).

### Not changed
- **No commands removed.** `/deep-cleanup` and `/deep-resume` continue to be the sole path for worktree scan/fork cleanup and for active-session selection/worktree restore/phase dispatch respectively. Their feature migration is tracked as a follow-up.
- **No functional behavior changed.** Existing slash commands continue to work exactly as before; only labels, wordings, and version numbers changed.
- Historical `v5.2` deprecated notes in earlier sections are preserved as-is.
```

- [ ] **Step 3: 검증**

Run: `grep -n "## \[6.2.1\]" /Users/sungmin/Dev/deep-work/CHANGELOG.md`
Expected: 1 match near top.

---

## Task 37: CHANGELOG.ko.md v6.2.1 항목 추가

**Files:**
- Modify: `CHANGELOG.ko.md`

- [ ] **Step 1: v6.2.1 섹션 삽입**

Edit `CHANGELOG.ko.md`:

old_string:
```
# 변경 로그
```

new_string:
```
# 변경 로그

## [6.2.1] — 2026-04-15

### 변경됨
- **커맨드 분류 정리**: `Deprecated in v5.2` 블록을 가진 11개 커맨드와 같은 표에 함께 분류되었던 2개(`deep-brainstorm`, `deep-phase-review`)를 5개 카테고리로 재분류 — Quality Gate(3), Internal(6), Escape hatch(1), Utility(2), Special utility(`/deep-phase-review` 이동).
- **`/deep-finish` 표현**: "자동 호출이 주 경로이며, test 통과 후 수동 호출도 공식 경로"로 재서술 (deprecated 아님).
- **Hook/skill 사용자 안내**가 `/deep-status` 플래그로 라우팅:
  - `hooks/scripts/assumption-engine.js`: `/deep-assumptions` → `/deep-status --assumptions`
  - `hooks/scripts/session-end.sh`: `/deep-report` → `/deep-status --report`
  - `skills/deep-test/SKILL.md`: 동일 정렬
- **README**(en/ko): "Deprecated Commands (13)" 단일 표를 5개 카테고리 표로 분리; Worktree Isolation 섹션의 `/deep-cleanup`/`/deep-resume` 본문을 standalone utility로 재서술.
- **`skills/deep-work-workflow/SKILL.md`** 분류 섹션을 6개 카테고리로 재작성.

### 변경 없음
- **삭제된 커맨드 없음.** `/deep-cleanup`과 `/deep-resume`은 각각 worktree 스캔/fork 정리, active 세션 선택/worktree 복원/phase dispatch의 유일한 경로로 계속 남습니다. 기능 이관은 follow-up으로 추적.
- **functional 동작 변경 없음.** 기존 슬래시 커맨드는 모두 이전과 동일하게 동작; 라벨·문구·버전 번호만 변경.
- 이전 섹션의 `v5.2` deprecated 기록은 역사로 보존.
```

- [ ] **Step 2: 검증**

Run: `grep -n "## \[6.2.1\]" /Users/sungmin/Dev/deep-work/CHANGELOG.ko.md`
Expected: 1 match near top.

---

## Task 38: CHANGELOG 커밋

- [ ] **Step 1: 커밋**

```bash
cd /Users/sungmin/Dev/deep-work
git add CHANGELOG.md CHANGELOG.ko.md
git commit -m "docs(changelog): add v6.2.1 entry for command classification cleanup"
```

Expected: 2 files changed.

---

## Task 39: 버전 bump — plugin.json

**Files:**
- Modify: `.claude-plugin/plugin.json:3`

- [ ] **Step 1: 버전 교체**

Edit `.claude-plugin/plugin.json`:

old_string:
```
  "version": "6.2.0",
```

new_string:
```
  "version": "6.2.1",
```

- [ ] **Step 2: 검증**

Run: `grep -n '"version"' /Users/sungmin/Dev/deep-work/.claude-plugin/plugin.json`
Expected: `3:  "version": "6.2.1",`

---

## Task 40: 버전 bump — package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 현재 내용 확인**

Run: `cat /Users/sungmin/Dev/deep-work/package.json`
Expected: `"version": "6.2.0"` 존재.

- [ ] **Step 2: 버전 교체**

Edit `package.json`:

old_string:
```
  "version": "6.2.0",
```

new_string:
```
  "version": "6.2.1",
```

- [ ] **Step 3: 검증**

Run: `grep -n '"version"' /Users/sungmin/Dev/deep-work/package.json`
Expected: `... "version": "6.2.1",`

---

## Task 41: 버전 bump — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:1`

- [ ] **Step 1: 버전 교체**

Edit `CLAUDE.md`:

old_string:
```
# deep-work v6.2.0
```

new_string:
```
# deep-work v6.2.1
```

- [ ] **Step 2: 검증**

Run: `head -1 /Users/sungmin/Dev/deep-work/CLAUDE.md`
Expected: `# deep-work v6.2.1`

---

## Task 42: 버전 bump 커밋

- [ ] **Step 1: 커밋**

```bash
cd /Users/sungmin/Dev/deep-work
git add .claude-plugin/plugin.json package.json CLAUDE.md
git commit -m "chore: bump to v6.2.1"
```

Expected: 3 files changed.

---

## Task 43: 검증 — phase-guard-core.test.js 실행

**Files:**
- Test: `hooks/scripts/phase-guard-core.test.js`

- [ ] **Step 1: 테스트 실행**

Run: `cd /Users/sungmin/Dev/deep-work && node --test hooks/scripts/phase-guard-core.test.js`
Expected: 모든 테스트 통과 (특히 `/deep-slice spike` 포함 assertion이 L44, L61에서 통과).

- [ ] **Step 2: 실패 시 대응**

If any assertion fails: 수정된 파일 diff 확인 후 `hooks/scripts/phase-guard-core.js`의 문자열이 의도치 않게 변경되지 않았는지 확인. (본 plan은 해당 파일을 수정하지 않음 — 테스트 실패는 회귀를 의미.)

---

## Task 44: 검증 — grep 체크리스트

- [ ] **Step 1: 잔존 "Deprecated in v5.2" 검색**

Run: `cd /Users/sungmin/Dev/deep-work && grep -rn "Deprecated in v5.2" commands/ skills/ README.md README.ko.md 2>/dev/null`
Expected: (empty — no matches)

- [ ] **Step 2: 잔존 "Deprecated commands (13)" 검색**

Run: `cd /Users/sungmin/Dev/deep-work && grep -rn "Deprecated commands (13)\|Deprecated 커맨드 (13개)" skills/ README.md README.ko.md 2>/dev/null`
Expected: (empty)

- [ ] **Step 3: /deep-report / /deep-assumptions 사용자 안내 확인 (Internal 본문 참조는 유지 OK)**

Run: `cd /Users/sungmin/Dev/deep-work && grep -rn "/deep-report\|/deep-assumptions" hooks/ skills/deep-test/SKILL.md`
Expected: hook 문자열(`/deep-report`, `/deep-assumptions`)은 남지 않음. skills/deep-test/SKILL.md L122·L125의 `/deep-finish`는 존재; L150은 `/deep-status --report`로 변경됨.

- [ ] **Step 4: 버전 일관성 확인**

Run: `cd /Users/sungmin/Dev/deep-work && grep -Hn '"version"\|deep-work v' .claude-plugin/plugin.json package.json CLAUDE.md | head -5`
Expected: 모두 v6.2.1.

---

## Task 45: 검증 — /deep-status smoke test (수동)

**사용자 수동 검증.** 본 plan은 파일 수정만 수행하므로 smoke test는 사용자 또는 reviewer가 다음을 수동 실행한다.

- [ ] **Step 1: 활성 세션 없이 `/deep-status --all` 호출** → `ℹ️ 활성화된 Deep Work 세션이 없습니다` 메시지 + 플래그 기반 과거 이력 표시가 정상 작동하는지 확인 (Internal 커맨드 파일을 `Read`해서 로직 흡수).

- [ ] **Step 2: 테스트 픽스처가 있다면 `/deep-status --receipts`, `--history`, `--report`, `--assumptions`를 각각 호출**하여 display logic 섹션(본 plan이 건드리지 않은 부분)이 정상 렌더되는지 확인.

- [ ] **Step 3: 문제 발견 시** — 해당 커맨드 파일의 display logic 섹션이 본 plan 수정으로 인해 영향받지 않았음을 `git diff 5dd4e8b..HEAD -- commands/deep-receipt.md` 등으로 재확인. 블록 교체 규칙을 준수했으면 회귀 없음.

---

## Task 46: 최종 log 확인 및 브랜치 정리

- [ ] **Step 1: 커밋 히스토리 확인**

Run: `cd /Users/sungmin/Dev/deep-work && git log --oneline 5dd4e8b..HEAD`
Expected (approximate):
```
<sha> chore: bump to v6.2.1
<sha> docs(changelog): add v6.2.1 entry for command classification cleanup
<sha> docs(readme): restructure command tables into 5 categories, revise body references
<sha> docs(skill): rewrite deep-work-workflow classification into 6 categories
<sha> refactor(hooks,skill): route user-facing guidance to /deep-status flags
<sha> docs(commands): relabel deep-slice as escape hatch, deep-cleanup/resume as utility
<sha> docs(commands): relabel Internal commands with auto-call + manual-ok wording
<sha> docs(commands): relabel Quality Gate commands (drift-check, solid-review, deep-insight)
<sha> docs(spec): v2 — narrow to relabeling-only after 3-way review
<sha> docs(spec): cleanup of deprecated command labels for v6.3.0  [v1 spec, pre-review]
```

- [ ] **Step 2: diff 요약 확인**

Run: `cd /Users/sungmin/Dev/deep-work && git diff 5dd4e8b..HEAD --stat`
Expected: 11 command files + 2 README + 2 CHANGELOG + 2 hook + 2 skill + 3 manifest + 1-2 spec/plan = 약 21-23 파일 변경.

- [ ] **Step 3: 구현 완료 후 spec/plan 이동 (사용자 지시대로)**

사용자는 구현 완료 후 `specs/`, `plans/`를 `docs/`로 이동 및 git 정리한다고 명시했다. 본 구현이 종료된 시점 이후, 사용자 지시에 따라 다음을 수행:
- `specs/*.md`, `plans/*.md`를 `docs/`로 이동
- git에서 `specs/` 트래킹 제거 (git rm --cached)
- `.gitignore`의 `docs/` 규칙과 일관되게 정리

이 단계는 plan scope 바깥이므로 사용자의 명시적 승인 후 별도 커밋으로 진행한다.

---

## Self-Review

**1. Spec 커버리지:**
- §3 A/B (Primary/Special) — 변경 없음, covered.
- §3 C (Quality Gate 3) — Task 1-4.
- §3 D-1 (Internal 5) — Task 5-9, 11.
- §3 D-2 (Internal 1, deep-brainstorm 삽입) — Task 10-11.
- §3 E (Escape hatch 1) — Task 12, 15.
- §3 F (Utility 2) — Task 13-15.
- §4.1 SKILL.md — Task 20-26.
- §4.2 README 3블록 × 2종 — Task 27-35.
- §4.3 Hook 2개 — Task 16-17, 19.
- §4.4 Skill 안내 — Task 18-19.
- §4.5 CHANGELOG — Task 36-38.
- §4.6 Plugin manifest + package.json — Task 39-40, 42.
- §4.7 CLAUDE.md — Task 41-42.
- §5 Step 15 검증 체크리스트 — Task 43-45.

**2. Placeholder scan:**
- "TBD" / "TODO" — 없음.
- "적절히 처리" 류 추상 표현 — 없음. 각 Edit은 exact old_string/new_string 블록을 담음.
- "Similar to Task N" — 없음. 각 Task는 독립 실행 가능.

**3. Type/naming 일관성:**
- 블록 내 `v6.2.1` 버전 문자열 모든 Task에서 동일.
- `Quality Gate` / `Internal` / `Escape hatch utility` / `Utility` 카테고리 명칭 Task 전체에서 일관.
- 참조처 문법 (`orchestrator §3-1`, `commands/deep-status.md §6` 등) 일관.

**4. 누락 리스크:**
- `README.md` L575 / `README.ko.md` L566 "Deprecated commands still work" 문구는 스펙 §4.2에 명시되지 않았지만 본 plan Task 30·34에서 커버 (일관성 유지).
- `session-end.sh` L85의 주석 `Consumers (deep-status, deep-work, deep-report, deep-assumptions) all read from this path`는 코드 참조이므로 유지 (Task 17 Step 2 검증에 명시).
- Spec §7 Out-of-scope의 실제 기능 이관 작업은 본 plan에서 수행하지 않음(의도됨).

---

## Execution Handoff

Plan complete and saved to `plans/2026-04-15-deprecated-commands-cleanup.md` (`docs/`가 gitignored이므로 임시 보관; 구현 완료 후 이동 예정).

Two execution options:

**1. Subagent-Driven (recommended)** — 태스크별 fresh subagent, 태스크 간 리뷰, 빠른 반복.

**2. Inline Execution** — 현재 세션에서 executing-plans로 체크포인트 기반 일괄 실행.

어느 방식으로 진행할까요?
