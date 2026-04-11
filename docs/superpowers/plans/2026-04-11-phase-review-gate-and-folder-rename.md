# Phase Review Gate & Work Folder Rename — v6.0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unified Phase Review Gate at every phase transition and rename session folder from `deep-work/` to `.deep-work/`.

**Architecture:** Two independent changes executed sequentially. Folder rename first (avoids double-editing), then Phase Review Gate. All command files are markdown instruction files (not executable code) — the hooks (`phase-guard.sh`, `file-tracker.sh`) are the only executable code changed. Tests exist only for hooks.

**Tech Stack:** Markdown (command instructions), Bash (hooks), JavaScript (tests via Node.js built-in test runner)

**Spec:** `docs/superpowers/specs/2026-04-11-phase-review-gate-and-folder-rename-design.md`

---

## File Structure

### Modified Files

| File | Responsibility | Task |
|------|---------------|------|
| `hooks/scripts/phase-guard.sh` | Path allowlist for phase blocking | 1 |
| `hooks/scripts/file-tracker.sh` | Path exclusion for file tracking | 1 |
| `commands/deep-work.md` | Session init, mkdir, WORK_DIR, migration | 2 |
| `commands/deep-fork.md` | Fork session work dir | 3 |
| `commands/deep-status.md` | Session listing, history scanning | 3 |
| `commands/deep-finish.md` | JSONL history path | 3 |
| `commands/deep-research.md` | Previous session search, backlog | 3, 8 |
| `commands/deep-plan.md` | Backlog path, review sections | 3, 9 |
| `commands/deep-report.md` | JSONL history path | 3 |
| `commands/deep-history.md` | Session receipt search | 3 |
| `hooks/scripts/phase-guard-core.test.js` | Hook test paths | 4 |
| `hooks/scripts/fork-utils.test.js` | Fork test paths | 4 |
| `hooks/scripts/fork-integration.test.js` | Fork integration test paths | 4 |
| `skills/deep-work-workflow/SKILL.md` | Main skill documentation | 5, 12 |
| `README.md` | Project documentation | 5 |
| `README.ko.md` | Korean documentation | 5 |
| `commands/deep-brainstorm.md` | Brainstorm phase command | 7 |
| `commands/deep-implement.md` | Implement phase command | 10 |
| `commands/deep-phase-review.md` | Manual review command | 11 |

### New Files

| File | Responsibility | Task |
|------|---------------|------|
| `skills/deep-work-workflow/references/phase-review-gate.md` | Unified review gate protocol | 6 |

---

## Task 1: Folder Rename — Hook Scripts

**Files:**
- Modify: `hooks/scripts/phase-guard.sh:163-164`
- Modify: `hooks/scripts/file-tracker.sh:80-81`

- [ ] **Step 1: Update phase-guard.sh path pattern**

In `hooks/scripts/phase-guard.sh`, change the allowlist pattern:

```bash
# Line 163-164: Change from:
  # Allow deep-work/ directory and state file
  if [[ "$RESOLVED_PATH_NORM" == *"/deep-work/"* ]]; then

# To:
  # Allow .deep-work/ directory and state file
  if [[ "$RESOLVED_PATH_NORM" == *"/.deep-work/"* ]]; then
```

- [ ] **Step 2: Update file-tracker.sh path pattern**

In `hooks/scripts/file-tracker.sh`, change the exclusion pattern:

```bash
# Line 80-81: Change from:
  # deep-work/ 디렉토리 내 문서 파일 제외
  if [[ "$RESOLVED_PATH_NORM" == *"/deep-work/"* ]]; then

# To:
  # .deep-work/ 디렉토리 내 문서 파일 제외
  if [[ "$RESOLVED_PATH_NORM" == *"/.deep-work/"* ]]; then
```

- [ ] **Step 3: Commit**

```bash
git add hooks/scripts/phase-guard.sh hooks/scripts/file-tracker.sh
git commit -m "refactor: rename deep-work/ path pattern to .deep-work/ in hooks"
```

---

## Task 2: Folder Rename — Session Init & Migration (deep-work.md)

**Files:**
- Modify: `commands/deep-work.md:317,320,385,391,394`

- [ ] **Step 1: Update mkdir and WORK_DIR paths**

In `commands/deep-work.md`:

```markdown
# Line 317: Change from:
mkdir -p "deep-work/${TASK_FOLDER}"
# To:
mkdir -p ".deep-work/${TASK_FOLDER}"

# Line 320: Change from:
Set `WORK_DIR` to `deep-work/${TASK_FOLDER}`.
# To:
Set `WORK_DIR` to `.deep-work/${TASK_FOLDER}`.
```

- [ ] **Step 2: Update harness-history paths**

```markdown
# Line 385: Change from:
1. **Locate history file**: Look for `$WORK_DIR/../harness-history/harness-sessions.jsonl` (shared across sessions in the `deep-work/` directory). If no history file exists, skip this step silently.
# To:
1. **Locate history file**: Look for `$WORK_DIR/../harness-history/harness-sessions.jsonl` (shared across sessions in the `.deep-work/` directory). If no history file exists, skip this step silently.

# Line 391: Change from:
echo '{"action":"report","registryPath":"<PLUGIN_DIR>/assumptions.json","historyPath":"deep-work/harness-history/harness-sessions.jsonl","options":{"splitByModel":true}}' | node <PLUGIN_DIR>/hooks/scripts/assumption-engine.js
# To:
echo '{"action":"report","registryPath":"<PLUGIN_DIR>/assumptions.json","historyPath":".deep-work/harness-history/harness-sessions.jsonl","options":{"splitByModel":true}}' | node <PLUGIN_DIR>/hooks/scripts/assumption-engine.js

# Line 394: Change from:
echo '{"action":"detect-model","historyPath":"deep-work/harness-history/harness-sessions.jsonl","model":"<CURRENT_MODEL_ID>"}' | node <PLUGIN_DIR>/hooks/scripts/assumption-engine.js
# To:
echo '{"action":"detect-model","historyPath":".deep-work/harness-history/harness-sessions.jsonl","model":"<CURRENT_MODEL_ID>"}' | node <PLUGIN_DIR>/hooks/scripts/assumption-engine.js
```

**Note:** Lines 482 and 528 reference `deep-work/[SLUG]` as git branch names — do NOT change these. Branch naming stays as `deep-work/`.

- [ ] **Step 3: Add migration logic**

Insert a new section **before** the `mkdir -p` line (before current line 317). Add as a new step in the session initialization flow:

```markdown
### Migration: deep-work/ → .deep-work/

Before creating the session folder, check for legacy `deep-work/` directory:

1. Check if `deep-work/` directory exists in the project root:
   ```bash
   ls -d deep-work/ 2>/dev/null
   ```

2. **If `deep-work/` exists AND `.deep-work/` does NOT exist:**
   - Check for active worktrees referencing `deep-work/`:
     ```bash
     git worktree list 2>/dev/null | grep "deep-work/"
     ```
   - If worktree found: warn user and skip auto-migration:
     ```
     ⚠️ deep-work/ 폴더를 참조하는 활성 worktree가 있습니다.
        수동으로 마이그레이션해주세요: mv deep-work/ .deep-work/
     ```
   - If no worktree: proceed with migration:
     ```
     📦 기존 deep-work/ 폴더를 .deep-work/로 마이그레이션합니다.
     ```
     ```bash
     mv deep-work/ .deep-work/
     ```
   - Update state file paths:
     ```bash
     for f in .claude/deep-work.*.md; do
       sed -i '' 's|work_dir: deep-work/|work_dir: .deep-work/|g' "$f" 2>/dev/null
     done
     ```
   - Update JSONL history paths (if exists):
     ```bash
     if [ -f .deep-work/harness-history/harness-sessions.jsonl ]; then
       sed -i '' 's|"deep-work/|".deep-work/|g' .deep-work/harness-history/harness-sessions.jsonl
     fi
     ```

3. **If BOTH `deep-work/` AND `.deep-work/` exist:**
   - AskUserQuestion:
     ```
     deep-work/와 .deep-work/ 폴더가 모두 존재합니다.
       a) deep-work/ 내용을 .deep-work/에 병합 후 삭제
       b) .deep-work/만 사용 (deep-work/ 유지)
       c) 직접 처리하겠습니다
     ```
   - If (a): `cp -r deep-work/* .deep-work/ && rm -rf deep-work/` + state file path update
   - If (b) or (c): continue without migration

4. **Update .gitignore** (if not already configured):
   - Check if `.deep-work/20*/` pattern exists in `.gitignore`
   - If not, suggest adding:
     ```
     .gitignore에 .deep-work 세션 폴더 제외 패턴을 추가할까요?
     ```
   - If accepted, add:
     ```gitignore
     # deep-work session artifacts
     .deep-work/20*/
     .deep-work/harness-history/
     ```
   - If old `deep-work/` entry exists in `.gitignore`, remove it
```

- [ ] **Step 4: Commit**

```bash
git add commands/deep-work.md
git commit -m "feat: rename session folder to .deep-work/ with migration logic"
```

---

## Task 3: Folder Rename — Other Command Files

**Files:**
- Modify: `commands/deep-fork.md:147`
- Modify: `commands/deep-status.md:34,101,256,259,266,267,277,302,310,432`
- Modify: `commands/deep-finish.md:142,148`
- Modify: `commands/deep-research.md:118,124,200,205`
- Modify: `commands/deep-plan.md:642,647`
- Modify: `commands/deep-report.md:67,214`
- Modify: `commands/deep-history.md:24`

- [ ] **Step 1: Update deep-fork.md**

```markdown
# Line 147: Change from:
NEW_WORK_DIR="deep-work/${TIMESTAMP}-${TASK_SLUG}-fork-${FORK_SUFFIX}"
# To:
NEW_WORK_DIR=".deep-work/${TIMESTAMP}-${TASK_SLUG}-fork-${FORK_SUFFIX}"
```

- [ ] **Step 2: Update deep-status.md**

Apply `deep-work/` → `.deep-work/` replacement on all instances at lines 34, 101, 256, 259, 266, 267, 277, 302, 310, 432. These are all documentation/instruction text, not branch names.

Key changes:
```markdown
# Line 259: Change from:
ls -d deep-work/*/  2>/dev/null
# To:
ls -d .deep-work/*/  2>/dev/null

# Line 266-267: Change from:
   - deep-work/20260307-143022-jwt-기반-인증/ [report.md 존재 여부]
   - deep-work/20260306-091500-api-리팩토링/ [report.md 존재 여부]
# To:
   - .deep-work/20260307-143022-jwt-기반-인증/ [report.md 존재 여부]
   - .deep-work/20260306-091500-api-리팩토링/ [report.md 존재 여부]

# Line 310: Change from:
1. Read `deep-work/harness-history/harness-sessions.jsonl` (shared path)
# To:
1. Read `.deep-work/harness-history/harness-sessions.jsonl` (shared path)
```

All other lines: same pattern — replace `deep-work/` with `.deep-work/` in instruction text, NOT in branch name references.

- [ ] **Step 3: Update deep-finish.md**

```markdown
# Line 142: Change from:
**JSONL path**: Use the shared path `deep-work/harness-history/harness-sessions.jsonl` (NOT the per-session folder). This matches all consumers (deep-status, deep-assumptions, deep-report).
# To:
**JSONL path**: Use the shared path `.deep-work/harness-history/harness-sessions.jsonl` (NOT the per-session folder). This matches all consumers (deep-status, deep-assumptions, deep-report).

# Line 148: Change from:
JSONL_FILE="deep-work/harness-history/harness-sessions.jsonl"
# To:
JSONL_FILE=".deep-work/harness-history/harness-sessions.jsonl"
```

- [ ] **Step 4: Update deep-research.md**

```markdown
# Line 118: Change from:
Search the `deep-work/` directory for the most recent `research.md` from a previous session (not the current session).
# To:
Search the `.deep-work/` directory for the most recent `research.md` from a previous session (not the current session).

# Line 124: Change from:
   경로: deep-work/[이전 세션]/research.md
# To:
   경로: .deep-work/[이전 세션]/research.md

# Lines 200, 205: Change `deep-work/backlog.md` to `.deep-work/backlog.md`
```

- [ ] **Step 5: Update deep-plan.md**

```markdown
# Lines 642, 647: Change `deep-work/backlog.md` to `.deep-work/backlog.md`
```

- [ ] **Step 6: Update deep-report.md**

```markdown
# Line 67: Change from:
- `deep-work/harness-history/harness-sessions.jsonl` — assumption engine session history (if exists)
# To:
- `.deep-work/harness-history/harness-sessions.jsonl` — assumption engine session history (if exists)

# Line 214: Change `deep-work/harness-history/` to `.deep-work/harness-history/`
```

- [ ] **Step 7: Update deep-history.md**

```markdown
# Line 24: Change from:
find . -path "*/deep-work/*/session-receipt.json" -type f 2>/dev/null | sort -r
# To:
find . -path "*/.deep-work/*/session-receipt.json" -type f 2>/dev/null | sort -r
```

- [ ] **Step 8: Commit**

```bash
git add commands/deep-fork.md commands/deep-status.md commands/deep-finish.md commands/deep-research.md commands/deep-plan.md commands/deep-report.md commands/deep-history.md
git commit -m "refactor: rename deep-work/ to .deep-work/ across all command files"
```

---

## Task 4: Folder Rename — Test Files

**Files:**
- Modify: `hooks/scripts/phase-guard-core.test.js:847`
- Modify: `hooks/scripts/fork-utils.test.js:154`
- Modify: `hooks/scripts/fork-integration.test.js:91,129,130,167,174,302`

- [ ] **Step 1: Update phase-guard-core.test.js**

```javascript
// Line 847: Change from:
      toolInput: { file_path: 'deep-work/plan.md' },
// To:
      toolInput: { file_path: '.deep-work/plan.md' },
```

- [ ] **Step 2: Update fork-utils.test.js**

```javascript
// Line 154: Change from:
    bash('register_fork_session "s-child001" "s-parent01" 1 "test task" "deep-work/20260407-fork/"');
// To:
    bash('register_fork_session "s-child001" "s-parent01" 1 "test task" ".deep-work/20260407-fork/"');
```

- [ ] **Step 3: Update fork-integration.test.js**

Replace `"deep-work/` with `".deep-work/` on lines 91, 129, 130, 167, 174, 302 (work dir arguments in `register_fork_session` calls).

```javascript
// Line 91: "deep-work/fork-1/" → ".deep-work/fork-1/"
// Line 129: "deep-work/fork-a/" → ".deep-work/fork-a/"
// Line 130: "deep-work/fork-b/" → ".deep-work/fork-b/"
// Line 167: "deep-work/gen1/" → ".deep-work/gen1/"
// Line 174: "deep-work/gen2/" → ".deep-work/gen2/"
// Line 302: "deep-work/orphan/" → ".deep-work/orphan/"
```

**Note:** Lines 387 and 446 reference `'deep-work/fork/s-wt...'` — these are git branch names, do NOT change.

- [ ] **Step 4: Run tests**

```bash
cd /Users/sungmin/Dev/deep-work && node --test hooks/scripts/phase-guard-core.test.js hooks/scripts/fork-utils.test.js hooks/scripts/fork-integration.test.js
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/scripts/phase-guard-core.test.js hooks/scripts/fork-utils.test.js hooks/scripts/fork-integration.test.js
git commit -m "test: update test paths from deep-work/ to .deep-work/"
```

---

## Task 5: Folder Rename — Documentation

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md:280-282`
- Modify: `README.md` (all `deep-work/` session path references)
- Modify: `README.ko.md` (same)

- [ ] **Step 1: Update SKILL.md session history example**

```markdown
# Lines 280-282: Change from:
Each session creates a unique task folder under `deep-work/`:
```
deep-work/

# To:
Each session creates a unique task folder under `.deep-work/`:
```
.deep-work/
```

Also update the example paths inside the code block (lines ~283-294) from `deep-work/` to `.deep-work/`.

- [ ] **Step 2: Update README.md and README.ko.md**

Search and replace all session folder path references from `deep-work/` to `.deep-work/`. Do NOT change:
- Git branch references (e.g., `deep-work/[SLUG]`)
- Plugin repository references (e.g., `claude-deep-work`)
- npm package references

- [ ] **Step 3: Commit**

```bash
git add skills/deep-work-workflow/SKILL.md README.md README.ko.md
git commit -m "docs: update session folder paths from deep-work/ to .deep-work/"
```

---

## Task 6: Phase Review Gate — Create Reference Document

**Files:**
- Create: `skills/deep-work-workflow/references/phase-review-gate.md`

- [ ] **Step 1: Write phase-review-gate.md**

Create `skills/deep-work-workflow/references/phase-review-gate.md` with:

```markdown
# Phase Review Gate Protocol

## 개요

모든 Phase(0 Brainstorm, 1 Research, 2 Plan, 3 Implement) 종료 시 자동으로 실행되는 통합 리뷰 게이트.
Phase 4(Test)는 최종 단계이므로 제외.

이 프로토콜은 각 커맨드 파일의 Phase 전환 시점에서 참조된다.
수동 리뷰(`/deep-phase-review`)도 이 프로토콜을 사용한다.

---

## 1. 리뷰어 Fallback 체인

### Phase 0~2 (문서 산출물: brainstorm.md, research.md, plan.md)

deep-review 플러그인은 코드 diff 리뷰어이므로 문서 Phase에는 사용하지 않는다.
기존 `review-gate.md`의 Structural Review + Adversarial Review 패턴을 활용한다.

```
① codex / gemini CLI 설치 확인
    ├─ 하나 이상 설치됨 → Structural Review + Adversarial Review(codex/gemini)
    │                     + 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
    └─ 둘 다 미설치 → ②로
        ↓
② 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
```

**Structural Review + Adversarial Review:**
기존 `review-gate.md`의 프로토콜을 그대로 따른다:
- Structural Review: `review-gate.md` Section 1-2 참조
- Adversarial Review: `review-gate.md` Section 3 참조 (codex/gemini CLI 필요)

### Phase 3 (코드 산출물: 구현된 코드 전체)

```
① deep-review 플러그인 설치 확인
    ├─ 설치됨 → deep-review + 셀프 리뷰 (병렬)
    └─ 미설치 → ②로
        ↓
② codex / gemini CLI 설치 확인
    ├─ 하나 이상 설치됨 → 크로스 모델 리뷰 + 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
    └─ 둘 다 미설치 → ③으로
        ↓
③ 셀프 리뷰 + Opus 서브에이전트 리뷰 (병렬)
```

**deep-review 설치 확인:**
```bash
ls "$HOME/.claude/plugins/cache/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null || \
  ls "$HOME/.claude/plugins/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null
```

설치됨: `/deep-review` 실행 (Agent subagent, 백그라운드)
미설치: 다음 fallback으로 진행

---

## 2. Opus 서브에이전트 리뷰

Claude Code의 Agent tool로 독립 리뷰 서브에이전트를 직접 스폰한다 (백그라운드).
플러그인 의존 없이, 현재 Phase 산출물과 리뷰 관점을 프롬프트로 전달한다.

**스폰 방법:**
```
Agent({
  description: "Phase review - ${phase}",
  model: "opus",
  run_in_background: true,
  prompt: "${phase_document} 를 독립적으로 리뷰해줘.
    관점: ${review_checklist}
    이슈 목록을 severity(high/medium/low)와 함께 반환.
    200단어 이내로 간결하게."
})
```

---

## 3. 셀프 리뷰 체크리스트

Phase별로 Claude가 직접 산출물을 재검토한다:

| Phase | 산출물 | 셀프 리뷰 관점 |
|-------|--------|---------------|
| 0 Brainstorm | brainstorm.md | 문제 정의 명확성, 접근법 비교 충실도, 성공 기준 존재 |
| 1 Research | research.md | 아키텍처 분석 완성도, 패턴 식별, 리스크 누락 |
| 2 Plan | plan.md | placeholder 없음, 연구-계획 추적성, 슬라이스 완성도 |
| 3 Implement | 구현 코드 전체 | 계획 충실도, 크로스 슬라이스 일관성, 미구현 항목 |

---

## 4. 실행 흐름

```
Phase 작업 완료
    ↓
① Fallback 체인에 따라 리뷰어 결정 + 실행 (병렬)
    ↓
② 리뷰 결과 종합 요약 생성
    ↓
③ 사용자에게 결과 제시 + 선택지
    ├─ "자동 수정 후 진행" → 이슈 자동 수정 → 다음 Phase
    ├─ "현재 상태로 진행" → 수정 없이 다음 Phase
    └─ "상세 보기" → 전체 이슈 목록 → 항목별 수정/스킵 → 다음 Phase
```

---

## 5. 사용자 확인 UX

### 기본 표시 (요약)

```
📋 ${Phase} 리뷰 완료
  - 리뷰어: ${reviewer_list}
  - 셀프 리뷰: ${self_count}건 발견
  - 외부 리뷰: ${external_count}건 발견

  1) 자동 수정 후 진행
  2) 현재 상태로 진행
  3) 상세 보기
```

### "상세 보기" 선택 시

전체 이슈 목록을 펼쳐서 표시한다:

```
📋 ${Phase} 리뷰 상세

셀프 리뷰:
  [S-1] ${severity}: ${description}
  [S-2] ${severity}: ${description}

외부 리뷰 (${reviewer}):
  [E-1] ${severity}: ${description}
  [E-2] ${severity}: ${description}

각 항목에 대해 (수정/스킵):
```

AskUserQuestion으로 항목별 수정/스킵을 선택받은 후 수정 진행.

---

## 6. 실패/타임아웃 처리 (Degraded Mode)

기존 `review-gate.md` Section 3의 Degraded Mode 패턴을 재사용한다:

- **리뷰어 실패 시** (JSON 파싱 실패, timeout 120초 초과, CLI 에러):
  1. 해당 리뷰어를 `failed` 상태로 기록
  2. 나머지 성공한 리뷰어 결과만으로 진행
  3. 사용자에게 degraded 상태 명시 표시:
     ```
     ⚠️ ${reviewer} 리뷰 실패 (${reason}). 나머지 결과만으로 판단합니다.
     ```

- **deep-review 설치됐지만 실패**: Fallback ②로 자동 전환 (codex/gemini + Opus)
- **codex/gemini 중 일부만 성공**: 성공한 리뷰어 결과만 사용
- **모든 외부 리뷰어 실패**: 셀프 리뷰 + Opus 서브에이전트만으로 진행

---

## 7. 상태 추적

state 파일 YAML frontmatter에 `phase_review` 필드를 추가/업데이트한다:

```yaml
phase_review:
  ${phase}:
    reviewed: true
    reviewers: ["self", "opus-subagent"]  # 또는 ["self", "deep-review"], ["self", "codex", "opus-subagent"] 등
    self_issues: 1
    external_issues: 2
    resolved: 3
```

기존 세션 resume 시 `phase_review` 필드가 없으면 빈 객체 `{}` 로 자동 초기화한다.

기존 `review_results.{phase}` 필드가 있는 경우:
- `phase_review.{phase}.reviewed: true` 로 마이그레이션
- `review_results` 필드는 하위 호환성을 위해 유지 (읽기만, 신규 쓰기는 `phase_review`로)
```

- [ ] **Step 2: Verify the new file references review-gate.md correctly**

Read `skills/deep-work-workflow/references/review-gate.md` and confirm:
- Section 1-2 (Structural Review) is referenced for Phase 0~2
- Section 3 (Adversarial Review) is referenced for Phase 0~2 with codex/gemini
- Degraded Mode patterns in Section 3 are referenced for failure handling

- [ ] **Step 3: Commit**

```bash
git add skills/deep-work-workflow/references/phase-review-gate.md
git commit -m "feat: add phase-review-gate.md unified review gate protocol"
```

---

## Task 7: Phase Review Gate — Brainstorm Command

**Files:**
- Modify: `commands/deep-brainstorm.md`

- [ ] **Step 1: Find the phase transition point**

Read `commands/deep-brainstorm.md` and locate where brainstorm phase completes and transitions to Research. Look for the section that writes brainstorm.md and transitions.

- [ ] **Step 2: Add Phase Review Gate reference**

Insert before the phase transition to Research:

```markdown
### Phase Review Gate

brainstorm.md 작성 완료 후, Phase Review Gate를 실행한다.

Read `references/phase-review-gate.md` and follow the protocol with:
- **Phase**: `brainstorm`
- **Document**: `$WORK_DIR/brainstorm.md`
- **Self-review checklist**: 문제 정의 명확성, 접근법 비교 충실도, 성공 기준 존재

Phase Review Gate 완료 후 Research로 자동 전환한다.
```

- [ ] **Step 3: Commit**

```bash
git add commands/deep-brainstorm.md
git commit -m "feat: add Phase Review Gate to brainstorm command"
```

---

## Task 8: Phase Review Gate — Research Command

**Files:**
- Modify: `commands/deep-research.md:537-637`

- [ ] **Step 1: Read the existing review sections**

Read `commands/deep-research.md` lines 537-650 to understand the current Structural Review (4.5), Cross-Model Review (4.6), and 종합 판단 (4.7) sections.

- [ ] **Step 2: Replace sections 4.5-4.7 with Phase Review Gate reference**

Replace the three sections (4.5 Structural Review, 4.6 Cross-Model Review, 4.7 종합 판단) with:

```markdown
### 4.5. Phase Review Gate

research.md 작성 완료 후, Phase Review Gate를 실행한다.

Read `references/phase-review-gate.md` and follow the protocol with:
- **Phase**: `research`
- **Document**: `$WORK_DIR/research.md`
- **Self-review checklist**: 아키텍처 분석 완성도, 패턴 식별, 리스크 누락

**Phase 0~2 Fallback 체인 적용:**
- codex/gemini 설치 시: Structural Review + Adversarial Review + 셀프 리뷰 + Opus 서브에이전트 (병렬)
- 미설치 시: 셀프 리뷰 + Opus 서브에이전트 (병렬)

**사용자 확인 후:**
- "자동 수정 후 진행" 또는 "현재 상태로 진행" → Plan으로 자동 전환
- "상세 보기" → 항목별 수정/스킵 후 전환

**Research 전용 추가 옵션:**
사용자 확인 시 추가 선택지:
```
  4) 특정 영역 재분석 — 지정 영역만 재분석 후 리뷰 재진행
```
옵션 4 선택 시: 기존 review-gate.md Section 4-1의 Research 전용 옵션 처리를 따른다.

**상태 업데이트:**
`phase_review.research` 필드를 업데이트한다 (phase-review-gate.md Section 7 참조).
```

- [ ] **Step 3: Commit**

```bash
git add commands/deep-research.md
git commit -m "feat: replace research review sections with Phase Review Gate"
```

---

## Task 9: Phase Review Gate — Plan Command

**Files:**
- Modify: `commands/deep-plan.md:427-580`

- [ ] **Step 1: Read the existing review sections**

Read `commands/deep-plan.md` lines 427-580 to understand the current Claude 자체 재검토 (3.4.5), Structural Review (3.5), Adversarial Cross-Model Review (3.6), and Claude 종합 판단 (3.7) sections.

- [ ] **Step 2: Replace sections 3.4.5-3.7 with Phase Review Gate reference**

Replace sections 3.4.5 through 3.7 with:

```markdown
### 3.4.5. Phase Review Gate

plan.md 작성 완료 후, Phase Review Gate를 실행한다.

Read `references/phase-review-gate.md` and follow the protocol with:
- **Phase**: `plan`
- **Document**: `$WORK_DIR/plan.md`
- **Self-review checklist**: placeholder 없음, 연구-계획 추적성, 슬라이스 완성도

**Phase 0~2 Fallback 체인 적용:**
- codex/gemini 설치 시: Structural Review + Adversarial Review + 셀프 리뷰 + Opus 서브에이전트 (병렬)
- 미설치 시: 셀프 리뷰 + Opus 서브에이전트 (병렬)

**기존 Plan 전용 동작 유지:**
- Claude 자체 재검토 (placeholder/일관성/누락)는 셀프 리뷰 체크리스트에 통합
- Structural Review의 auto-fix 스냅샷 계약(review-gate.md Section 1)은 그대로 적용
- Score < 7 auto-fix 및 반복 제한(3회)은 review-gate.md 프로토콜을 따름

**사용자 확인 후:**
- "자동 수정 후 진행" 또는 "현재 상태로 진행" → Plan 승인 인터랙션으로 진행
- "상세 보기" → 항목별 수정/스킵 후 승인 인터랙션으로 진행

**Note:** Phase Review Gate 통과 후에도 Plan 승인 인터랙션(기존 Section 4)은 별도로 진행된다. 리뷰 게이트는 품질 검증이고, 승인은 사용자의 방향 확인이다.

**상태 업데이트:**
`phase_review.plan` 필드를 업데이트한다 (phase-review-gate.md Section 7 참조).
```

- [ ] **Step 3: Commit**

```bash
git add commands/deep-plan.md
git commit -m "feat: replace plan review sections with Phase Review Gate"
```

---

## Task 10: Phase Review Gate — Implement Command

**Files:**
- Modify: `commands/deep-implement.md`

- [ ] **Step 1: Find the phase transition point**

Read `commands/deep-implement.md` and locate where all slices complete and the phase transitions to Test. Look for the section that handles "모든 슬라이스 완료" → Test 전환.

- [ ] **Step 2: Add Phase Review Gate before Test transition**

Insert before the Test phase transition:

```markdown
### Phase Review Gate (전체 구현 완료 후)

모든 슬라이스가 완료된 후, Test 전환 전에 Phase Review Gate를 실행한다.

> **Note:** 이 리뷰는 per-slice Slice Review(Section C-2)와 별개이다. Slice Review는 개별 슬라이스의 spec 준수를 검증하고, Phase Review Gate는 전체 구현의 계획 충실도와 크로스 슬라이스 일관성을 검증한다.

Read `references/phase-review-gate.md` and follow the protocol with:
- **Phase**: `implement`
- **Document**: 구현된 코드 전체 (git diff 기준)
- **Self-review checklist**: 계획 충실도, 크로스 슬라이스 일관성, 미구현 항목

**Phase 3 Fallback 체인 적용:**
1. deep-review 플러그인 설치 시: `/deep-review` + 셀프 리뷰 (병렬)
2. codex/gemini 설치 시: 크로스 모델 리뷰 + 셀프 리뷰 + Opus 서브에이전트 (병렬)
3. 둘 다 미설치: 셀프 리뷰 + Opus 서브에이전트 (병렬)

**사용자 확인 후:**
- "자동 수정 후 진행" 또는 "현재 상태로 진행" → Test로 자동 전환
- "상세 보기" → 항목별 수정/스킵 후 전환

**상태 업데이트:**
`phase_review.implement` 필드를 업데이트한다 (phase-review-gate.md Section 7 참조).
```

- [ ] **Step 3: Commit**

```bash
git add commands/deep-implement.md
git commit -m "feat: add Phase Review Gate to implement command before test transition"
```

---

## Task 11: Phase Review Gate — Manual Review Command

**Files:**
- Modify: `commands/deep-phase-review.md:69-71,165-193`

- [ ] **Step 1: Update review protocol reference**

In `commands/deep-phase-review.md`, section "3. Load review protocol" (line 69-71):

```markdown
# Change from:
### 3. Load review protocol

Read `references/review-gate.md` from the skill directory. Follow its protocol exactly for all review operations.

# To:
### 3. Load review protocol

Read `references/phase-review-gate.md` from the skill directory. This protocol defines the unified Fallback chain for all phases.
Also read `references/review-gate.md` for Structural Review and Adversarial Review details (referenced by phase-review-gate.md).

Follow the Phase Review Gate protocol for reviewer selection:
- Phase 0~2 (brainstorm, research, plan): Structural + Adversarial + 셀프 + Opus 서브에이전트
- Phase 3 (implement — manual review only): deep-review → codex/gemini + Opus → Opus only
```

- [ ] **Step 2: Update state field from review_results to phase_review**

In section "8. Update state file" (lines 184-193), change `review_results.{phase}` references to `phase_review.{phase}`:

```markdown
# Change from:
- Add or update `review_results.{phase}` (where `{phase}` is the target phase — `research` or `plan`) with:
# To:
- Add or update `phase_review.{phase}` (where `{phase}` is the target phase) with:
  - `reviewed`: true
  - `reviewers`: array of reviewer names (e.g., ["self", "opus-subagent", "codex"])
  - `self_issues`: count of self-review issues
  - `external_issues`: count of external review issues
  - `resolved`: count of resolved issues
```

Keep backward compatibility: if `review_results.{phase}` exists from a previous session, read from it but write to `phase_review.{phase}`.

- [ ] **Step 3: Commit**

```bash
git add commands/deep-phase-review.md
git commit -m "feat: unify deep-phase-review with Phase Review Gate protocol"
```

---

## Task 12: State Schema & SKILL.md Documentation

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md`

- [ ] **Step 1: Add Phase Review Gate to SKILL.md**

In `skills/deep-work-workflow/SKILL.md`, add a new section after the "v5.5 Review Flow Enhancement" block (after line 57):

```markdown
## v6.0.2 Phase Review Gate & Folder Rename

**v6.0.2 신규 기능:**
- **Phase Review Gate**: 모든 Phase(0~3) 종료 시 통합 리뷰 게이트 자동 실행. 셀프 리뷰 + 외부 리뷰(deep-review/codex/gemini/Opus) 후 사용자 확인
- **Phase별 Fallback 체인**: Phase 0~2(문서)는 Structural+Adversarial, Phase 3(코드)는 deep-review 우선
- **사용자 확인 UX**: 요약 → 선택지(자동 수정/현재 진행/상세 보기)
- **Degraded Mode**: 외부 리뷰어 실패 시 자동 fallback
- **세션 폴더 이름 변경**: `deep-work/` → `.deep-work/` (숨김 폴더). 마이그레이션 자동 처리
- **State 스키마 확장**: `phase_review` 필드 추가 (기존 `review_results` 하위 호환)
```

- [ ] **Step 2: Update Phase descriptions**

Update Phase 0 (Brainstorm), Phase 1 (Research), Phase 2 (Plan), Phase 3 (Implement) descriptions to mention Phase Review Gate:

For each phase, add to the "What happens" bullet list:
```markdown
- **Phase Review Gate**: Phase 완료 시 셀프 리뷰 + 외부 리뷰 자동 실행, 사용자 확인 후 전환
```

- [ ] **Step 3: Update Session History example paths**

Already done in Task 5. Verify the `.deep-work/` paths are correct.

- [ ] **Step 4: Update version number**

```markdown
# Line 3: Change from:
version: "6.0.1"
# To:
version: "6.0.2"
```

- [ ] **Step 5: Commit**

```bash
git add skills/deep-work-workflow/SKILL.md
git commit -m "docs: update SKILL.md with Phase Review Gate and .deep-work/ paths (v6.0.2)"
```

---

## Task 13: CHANGELOG Update

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CHANGELOG.ko.md`

- [ ] **Step 1: Add v6.0.2 entry to CHANGELOG.md**

Add at the top of the changelog (after the header):

```markdown
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
```

- [ ] **Step 2: Add v6.0.2 entry to CHANGELOG.ko.md**

Same content translated to Korean.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md CHANGELOG.ko.md
git commit -m "docs: add v6.0.2 changelog entries"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Run all tests**

```bash
cd /Users/sungmin/Dev/deep-work && node --test hooks/scripts/*.test.js
```

Expected: All tests PASS.

- [ ] **Step 2: Verify no remaining `deep-work/` session path references**

```bash
cd /Users/sungmin/Dev/deep-work && grep -rn '"deep-work/' commands/ hooks/scripts/ skills/ --include='*.md' --include='*.sh' | grep -v 'deep-work/\[' | grep -v 'checkout.*deep-work/' | grep -v 'claude-deep-work' | grep -v 'deep-work/fork/' | head -20
```

Expected: No matches (only branch-name references should remain).

- [ ] **Step 3: Verify phase-review-gate.md is complete**

```bash
wc -l skills/deep-work-workflow/references/phase-review-gate.md
```

Expected: File exists and has content.

- [ ] **Step 4: Commit any remaining fixes**

If verification found issues, fix and commit.
