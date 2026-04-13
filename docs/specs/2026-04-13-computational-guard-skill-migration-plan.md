# v6.1.0 Computational Guard + Skill Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worktree 경로 hard block + phase 전환 조건 injection hook을 추가하고, 6개 core phase command를 독립 Skill로 전환하여 inferential enforcement 실패를 구조적으로 해결한다.

**Architecture:** 3-Layer Design (Commands → thin wrappers | Skills → execution logic | Hooks → computational enforcement). P0 worktree guard는 PreToolUse hook에서 경로를 hard block하고, P1 phase transition injector는 PostToolUse hook에서 조건을 LLM context에 주입한다. 각 phase는 독립 Skill로 분리되어 context 축소 + 명시적 args 전달을 제공한다.

**Tech Stack:** Bash (hooks), Node.js `node:test` (tests), Markdown (skills/commands)

**Spec:** `docs/specs/2026-04-13-computational-guard-skill-migration-design.md`

---

## Phase A: Computational Guard Hooks

### Task 1: P0 — Worktree 변수 파싱 추가

**Files:**
- Modify: `hooks/scripts/phase-guard.sh:50-57`

- [ ] **Step 1: state 파싱 블록에 worktree 변수 추가**

`phase-guard.sh`의 기존 frontmatter 파싱 블록 (line 50-56) 뒤에 worktree 변수 2줄을 추가한다.

```bash
# 기존 line 56 뒤에 추가:
WORKTREE_ENABLED="$(read_frontmatter_field "$STATE_FILE" "worktree_enabled")"
WORKTREE_PATH="$(read_frontmatter_field "$STATE_FILE" "worktree_path")"
```

이 변수들은 이후 Task 2에서 사용된다. `read_frontmatter_field`는 `utils.sh`에 이미 정의되어 있으며, YAML frontmatter에서 값을 추출한다.

- [ ] **Step 2: Commit**

```bash
git add hooks/scripts/phase-guard.sh
git commit -m "feat(hooks): parse worktree_enabled and worktree_path from state file"
```

---

### Task 2: P0 — Worktree 경로 guard 로직 삽입

**Files:**
- Modify: `hooks/scripts/phase-guard.sh:108-109` (ownership check 직후, fast path 이전)

- [ ] **Step 1: P0 worktree guard 블록 삽입**

`phase-guard.sh`에서 ownership check 블록이 끝나는 `fi` (line 108) 직후, 첫 번째 fast path 주석 (line 110) 직전에 다음 블록을 삽입한다:

```bash
# ─── P0: WORKTREE PATH ENFORCEMENT ─────────────────────────
# Blocks Write/Edit/Bash to files outside the active worktree path.
# Meta directories (.claude/, .deep-work/, .deep-review/, .deep-wiki/) are exempt.

if [[ "$WORKTREE_ENABLED" == "true" && -n "$WORKTREE_PATH" && -n "$_OWN_FILE_NORM" ]]; then
  WORKTREE_PATH_NORM="$(normalize_path "$WORKTREE_PATH")"

  if [[ "$_OWN_FILE_NORM" != "$WORKTREE_PATH_NORM"/* && "$_OWN_FILE_NORM" != "$WORKTREE_PATH_NORM" ]]; then
    # Meta directory exceptions — anchored to PROJECT_ROOT (C-3: prevents bypass via external .claude/ paths)
    _IS_META=false
    _PROJECT_ROOT_NORM="$(normalize_path "$PROJECT_ROOT")"
    for _meta_pat in ".claude/" ".deep-work/" ".deep-review/" ".deep-wiki/"; do
      if [[ "$_OWN_FILE_NORM" == "$_PROJECT_ROOT_NORM/$_meta_pat"* ]]; then
        _IS_META=true
        break
      fi
    done

    if [[ "$_IS_META" == "false" ]]; then
      cat <<JSON
{"decision":"block","reason":"⛔ Worktree Guard: worktree 외부 파일 수정 차단\n\n대상: $_OWN_FILE\n허용 경로: $WORKTREE_PATH/\n\nworktree 내에서 작업해주세요."}
JSON
      exit 2
    fi
  fi
fi
```

**주의**: 이 블록은 `$_OWN_FILE_NORM`이 설정된 경우에만 동작한다. `$_OWN_FILE_NORM`은 implement phase에서만 설정되는 기존 ownership check 흐름 (line 72-107)에 의존한다. 그러나 P0는 **모든 phase**에서 작동해야 하므로, non-implement phase에서도 파일 경로 추출이 필요하다.

- [ ] **Step 2: Non-implement phase에서도 파일 경로 추출 확장**

현재 파일 경로 추출 (line 72-107)은 `if [[ "$CURRENT_PHASE" == "implement" ]]` 블록 안에 있다. P0가 모든 phase에서 작동하려면, 파일 경로 추출을 implement 조건 밖으로 이동해야 한다.

`phase-guard.sh`의 line 72 `if [[ "$CURRENT_PHASE" == "implement" && -n "$CURRENT_SESSION_ID" ]]; then`을 다음과 같이 수정:

```bash
# ─── File path extraction (all phases, for worktree guard + ownership) ──
# NOTE: 파일 경로 추출은 CURRENT_SESSION_ID와 무관하게 실행해야 한다 (F-02).
# Session ID가 없어도 P0 worktree guard는 작동해야 하므로, 경로 추출을
# session ID 조건 밖으로 분리하고, ownership check만 session ID 안에 유지한다.
_OWN_FILE=""
if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "MultiEdit" ]]; then
  if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
    _OWN_FILE="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  fi
elif [[ "$TOOL_NAME" == "Bash" ]]; then
  _BASH_CMD="$(echo "$TOOL_INPUT" | node -e "
    process.stdin.setEncoding('utf8');let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).command||'')}catch(e){}});
  " 2>/dev/null || echo "")"
  if [[ -n "$_BASH_CMD" ]]; then
    _OWN_FILE="$(printf '%s' "$_BASH_CMD" | node -e "
      const {detectBashFileWrite,extractBashTargetFile}=require(process.argv[1]);
      let d='';process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{
        const r=detectBashFileWrite(d);
        if(r.isFileWrite){const f=extractBashTargetFile(d);if(f)process.stdout.write(f);}
      });
    " "$SCRIPT_DIR/phase-guard-core.js" 2>/dev/null || echo "")"
  fi
fi

if [[ -n "$_OWN_FILE" ]]; then
  _OWN_FILE_NORM="$(normalize_path "$_OWN_FILE")"
  if [[ "$_OWN_FILE_NORM" =~ ^[A-Za-z]:/ ]] || [[ "$_OWN_FILE_NORM" == /* ]]; then
    : # already absolute
  else
    _OWN_FILE_NORM="$(normalize_path "$(normalize_path "$PROJECT_ROOT")/$_OWN_FILE_NORM")"
  fi
fi

# Ownership check: implement phase + session ID required
if [[ -n "$CURRENT_SESSION_ID" && -n "$_OWN_FILE_NORM" ]]; then
  if [[ "$CURRENT_PHASE" == "implement" ]]; then
    OWNERSHIP_RESULT=""
    if ! OWNERSHIP_RESULT="$(check_file_ownership "$CURRENT_SESSION_ID" "$_OWN_FILE_NORM" 2>/dev/null)"; then
      block_ownership "$_OWN_FILE" "$OWNERSHIP_RESULT"
    fi
  fi
fi
```

핵심 변경:
- 파일 경로 추출을 session ID 및 implement 조건 밖으로 이동 (F-02: session ID 없어도 P0 작동)
- Ownership check만 session ID + implement 안에 유지
- **F-17: non-implement 블록(기존 line 131-209)의 `FILE_PATH` 추출도 상단의 `_OWN_FILE_NORM`으로 통합해야 함.** 기존 코드의 `FILE_PATH` 변수를 `_OWN_FILE_NORM`으로 교체하고, 중복 추출 코드를 제거한다.

- [ ] **Step 3: Commit**

```bash
git add hooks/scripts/phase-guard.sh
git commit -m "feat(hooks): add P0 worktree path guard — blocks Write/Edit outside worktree"
```

---

### Task 3: P0 — Worktree guard 테스트

**Files:**
- Create: `hooks/scripts/worktree-guard.test.js`

- [ ] **Step 1: 테스트 파일 작성**

기존 `multi-session.test.js`의 패턴을 따라 테스트를 작성한다.

```javascript
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PHASE_GUARD = path.resolve(__dirname, 'phase-guard.sh');

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-guard-'));
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
}

function cleanup() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
}

function writeStateFile(sessionId, fields) {
  const yaml = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  const content = `---\n${yaml}\n---\n`;
  fs.writeFileSync(
    path.join(tmpDir, '.claude', `deep-work.${sessionId}.md`),
    content
  );
}

function writePointerFile(sessionId) {
  fs.writeFileSync(
    path.join(tmpDir, '.claude', 'deep-work-current-session'),
    sessionId
  );
}

function runPhaseGuard(toolName, toolInput, env = {}) {
  try {
    const result = execFileSync('bash', ['-c', `echo '${JSON.stringify(toolInput).replace(/'/g, "'\\''")}' | CLAUDE_TOOL_NAME=${toolName} bash "${PHASE_GUARD}"`], {
      encoding: 'utf8',
      cwd: tmpDir,
      env: { ...process.env, ...env },
      timeout: 10000,
    });
    return { exitCode: 0, stdout: result };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '' };
  }
}

describe('P0: Worktree Path Guard', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('blocks Write outside worktree path', () => {
    const sid = 's-test1';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(tmpDir, 'src', 'outside.ts'),
    });

    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout.includes('Worktree Guard'));
  });

  it('allows Write inside worktree path', () => {
    const sid = 's-test2';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(worktreePath, 'src', 'inside.ts'),
    });

    assert.equal(result.exitCode, 0);
  });

  it('allows meta directory writes (.claude/, .deep-work/) outside worktree', () => {
    const sid = 's-test3';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(tmpDir, '.claude', 'some-config.json'),
    });

    assert.equal(result.exitCode, 0);
  });

  it('skips guard when worktree_enabled is false', () => {
    const sid = 's-test4';

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'false',
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(tmpDir, 'src', 'any-file.ts'),
    });

    assert.equal(result.exitCode, 0);
  });

  it('blocks in non-implement phases too with Worktree Guard reason (F-09)', () => {
    const sid = 's-test5';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'research',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
    });
    writePointerFile(sid);

    const result = runPhaseGuard('Write', {
      file_path: path.join(tmpDir, 'src', 'outside.ts'),
    });

    assert.equal(result.exitCode, 2);
    // F-09: Verify it's the Worktree Guard blocking, not the phase guard
    assert.ok(result.stdout.includes('Worktree Guard'));
  });

  // F-08: Bash tool worktree guard tests
  it('blocks Bash file write outside worktree path', () => {
    const sid = 's-test6';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    const outsidePath = path.join(tmpDir, 'src', 'outside.ts');
    const result = runPhaseGuard('Bash', {
      command: `echo "content" > "${outsidePath}"`,
    });

    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout.includes('Worktree Guard'));
  });

  it('blocks external .claude/ path (C-3: prevents substring bypass)', () => {
    const sid = 's-test7';
    const worktreePath = path.join(tmpDir, '.worktrees', 'dw', 'test-branch');
    fs.mkdirSync(worktreePath, { recursive: true });

    writeStateFile(sid, {
      current_phase: 'implement',
      worktree_enabled: 'true',
      worktree_path: `"${worktreePath}"`,
      tdd_mode: 'relaxed',
    });
    writePointerFile(sid);

    // External .claude/ path should NOT be allowed — only PROJECT_ROOT/.claude/ is exempt
    const result = runPhaseGuard('Write', {
      file_path: '/tmp/evil/.claude/malicious-config.json',
    });

    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout.includes('Worktree Guard'));
  });
});
```

- [ ] **Step 2: 테스트 실행 및 통과 확인**

Run: `cd /Users/sungmin/Dev/deep-work && node --test hooks/scripts/worktree-guard.test.js`
Expected: 8 tests pass (원래 5건 + Bash 1건 + non-implement guard 구분 1건 + 외부 .claude 우회 방지 1건)

- [ ] **Step 3: Commit**

```bash
git add hooks/scripts/worktree-guard.test.js
git commit -m "test(hooks): add P0 worktree guard unit tests"
```

---

### Task 4: P1 — phase-transition.sh 생성

**Files:**
- Create: `hooks/scripts/phase-transition.sh`

- [ ] **Step 1: phase-transition.sh 작성**

```bash
#!/usr/bin/env bash
# phase-transition.sh — PostToolUse hook: phase 전환 감지 → 조건 checklist injection
#
# state 파일의 current_phase가 변경되면 worktree_path, team_mode 등
# 핵심 조건을 stdout으로 출력하여 LLM context에 주입한다.
#
# Exit codes:
#   0 = always (PostToolUse hooks are informational, never block)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

init_deep_work_state

# ─── Read tool input from environment variable (F-04) ───────
# PostToolUse hooks 배열에서 앞선 hook(file-tracker.sh)이 stdin을 소비할 수 있으므로,
# stdin 대신 환경변수 $CLAUDE_TOOL_INPUT을 통해 tool input을 받는다.
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
[[ -z "$TOOL_INPUT" ]] && exit 0

# ─── 1. State 파일 대상인지 확인 ────────────────────────────
FILE_PATH=""
if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
  FILE_PATH="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
fi

[[ -z "$FILE_PATH" ]] && exit 0
[[ "$FILE_PATH" != *".claude/deep-work."*".md" ]] && exit 0

# ─── 2. Session ID 추출 ────────────────────────────────────
SESSION_ID="$(echo "$FILE_PATH" | grep -o 'deep-work\.[^.]*' | sed 's/deep-work\.//')"
[[ -z "$SESSION_ID" ]] && exit 0

# ─── 3. 현재 phase 읽기 ────────────────────────────────────
[[ ! -f "$FILE_PATH" ]] && exit 0
NEW_PHASE="$(read_frontmatter_field "$FILE_PATH" "current_phase")"
[[ -z "$NEW_PHASE" ]] && exit 0

# ─── 4. Cache 비교 ─────────────────────────────────────────
CACHE_DIR="$PROJECT_ROOT/.claude"
CACHE_FILE="$CACHE_DIR/.phase-cache-${SESSION_ID}"
OLD_PHASE=""
[[ -f "$CACHE_FILE" ]] && OLD_PHASE="$(cat "$CACHE_FILE")"
[[ "$NEW_PHASE" == "$OLD_PHASE" ]] && exit 0

# ─── 5. Cache 업데이트 ─────────────────────────────────────
echo "$NEW_PHASE" > "$CACHE_FILE"

# ─── 6. State에서 조건 읽기 ────────────────────────────────
WORKTREE_ENABLED="$(read_frontmatter_field "$FILE_PATH" "worktree_enabled")"
WORKTREE_PATH="$(read_frontmatter_field "$FILE_PATH" "worktree_path")"
TEAM_MODE="$(read_frontmatter_field "$FILE_PATH" "team_mode")"
# C-4: 기존 state schema는 cross_model_enabled (bool) + cross_model_tools (list)를 사용
CROSS_MODEL_ENABLED="$(read_frontmatter_field "$FILE_PATH" "cross_model_enabled")"
TDD_MODE="$(read_frontmatter_field "$FILE_PATH" "tdd_mode")"

# ─── 7. Checklist injection (stdout → LLM context) ────────
HAS_CONDITIONS=false

OUTPUT=""
OUTPUT+=$'\n'"━━━ Phase Transition: ${OLD_PHASE:-init} → ${NEW_PHASE} ━━━"$'\n\n'

if [[ "$WORKTREE_ENABLED" == "true" && -n "$WORKTREE_PATH" ]]; then
  OUTPUT+="📂 worktree_path: $WORKTREE_PATH"$'\n'
  OUTPUT+="   → 모든 파일 작업은 이 경로 내에서 수행"$'\n'
  HAS_CONDITIONS=true
fi

if [[ "$TEAM_MODE" == "team" ]]; then
  OUTPUT+="👥 team_mode: team"$'\n'
  OUTPUT+="   → TeamCreate 사용하여 병렬 에이전트 실행"$'\n'
  HAS_CONDITIONS=true
fi

if [[ "$CROSS_MODEL_ENABLED" == "true" ]]; then
  OUTPUT+="🔄 cross_model_enabled: true"$'\n'
  OUTPUT+="   → 교차 검증 실행 필요"$'\n'
  HAS_CONDITIONS=true
fi

if [[ "$NEW_PHASE" == "implement" ]]; then
  OUTPUT+="🧪 tdd_mode: ${TDD_MODE:-strict}"$'\n'
  OUTPUT+="   → TDD 프로토콜 준수 (테스트 먼저)"$'\n'
  HAS_CONDITIONS=true
fi

OUTPUT+=$'\n'"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 조건이 있을 때만 출력
if [[ "$HAS_CONDITIONS" == "true" ]]; then
  printf '%s' "$OUTPUT"
fi

exit 0
```

- [ ] **Step 2: 실행 권한 부여**

```bash
chmod +x hooks/scripts/phase-transition.sh
```

- [ ] **Step 3: Commit**

```bash
git add hooks/scripts/phase-transition.sh
git commit -m "feat(hooks): add P1 phase transition injector — condition context injection"
```

---

### Task 5: P1 — hooks.json에 등록

**Files:**
- Modify: `hooks/hooks.json`

- [ ] **Step 1: PostToolUse에 phase-transition hook 추가**

`hooks/hooks.json`의 PostToolUse hooks 배열 (line 36-47)에 새 hook을 추가한다. 기존 `file-tracker.sh`와 `sensor-trigger.js` 뒤에 추가:

P1 phase-transition hook은 **별도 PostToolUse 항목**으로 등록한다. 이유:
- **F-18**: State 파일은 Write/Edit으로만 수정되므로 Bash를 matcher에서 제외하여 불필요한 hook 실행 방지
- **F-04**: stdin 소비 문제를 회피하기 위해 `CLAUDE_TOOL_INPUT`을 환경변수로 전달

기존 PostToolUse 배열 **뒤에** 새 항목을 추가:

```json
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "DEEP_WORK_SESSION_ID=${DEEP_WORK_SESSION_ID:-} CLAUDE_TOOL_NAME=$CLAUDE_TOOL_USE_TOOL_NAME bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/file-tracker.sh",
            "timeout": 3
          },
          {
            "type": "command",
            "command": "DEEP_WORK_SESSION_ID=${DEEP_WORK_SESSION_ID:-} node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/sensor-trigger.js",
            "timeout": 3
          }
        ]
      },
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "DEEP_WORK_SESSION_ID=${DEEP_WORK_SESSION_ID:-} CLAUDE_TOOL_INPUT=$CLAUDE_TOOL_USE_INPUT bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/phase-transition.sh",
            "timeout": 3
          }
        ]
      }
    ],
```

**Note**: `phase-transition.sh`는 `$CLAUDE_TOOL_INPUT` 환경변수에서 tool input을 읽는다 (stdin 아님). `$CLAUDE_TOOL_USE_INPUT`은 Claude Code hook 런타임이 제공하는 환경변수.

- [ ] **Step 2: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat(hooks): register P1 phase-transition hook in hooks.json"
```

---

### Task 6: P1 — Stale cache 방지 (session-end.sh)

**Files:**
- Modify: `hooks/scripts/session-end.sh`

- [ ] **Step 1: session-end.sh에 cache 파일 정리 추가**

`session-end.sh`의 `CURRENT_PHASE` 추출 블록 (line 23) 직후, idle 체크 (line 27) 직전에 cache 정리 로직을 추가:

```bash
# ─── Phase cache cleanup ──────────────────────────────────
# Prevent stale cache on next resume
SESSION_ID="${DEEP_WORK_SESSION_ID:-}"
if [[ -z "$SESSION_ID" ]]; then
  _PTR="$PROJECT_ROOT/.claude/deep-work-current-session"
  [[ -f "$_PTR" ]] && SESSION_ID="$(tr -d '\n\r' < "$_PTR")"
fi
if [[ -n "$SESSION_ID" ]]; then
  PHASE_CACHE="$PROJECT_ROOT/.claude/.phase-cache-${SESSION_ID}"
  [[ -f "$PHASE_CACHE" ]] && rm -f "$PHASE_CACHE"
fi
```

- [ ] **Step 2: Commit**

```bash
git add hooks/scripts/session-end.sh
git commit -m "feat(hooks): clean up phase cache on session end — prevents stale P1 injection"
```

---

### Task 7: P1 — Phase transition 테스트

**Files:**
- Create: `hooks/scripts/phase-transition.test.js`

- [ ] **Step 1: 테스트 파일 작성**

```javascript
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'phase-transition.sh');

let tmpDir;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-test-'));
  fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
}

function cleanup() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
}

function writeStateFile(sessionId, fields) {
  const yaml = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n');
  const content = `---\n${yaml}\n---\n`;
  const filePath = path.join(tmpDir, '.claude', `deep-work.${sessionId}.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writePointerFile(sessionId) {
  fs.writeFileSync(
    path.join(tmpDir, '.claude', 'deep-work-current-session'),
    sessionId
  );
}

function runHook(toolInput) {
  try {
    const result = execFileSync('bash', ['-c', `echo '${JSON.stringify(toolInput).replace(/'/g, "'\\''")}' | bash "${SCRIPT}"`], {
      encoding: 'utf8',
      cwd: tmpDir,
      env: { ...process.env },
      timeout: 10000,
    });
    return { exitCode: 0, stdout: result };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '' };
  }
}

describe('P1: Phase Transition Injector', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('injects checklist on phase transition', () => {
    const sid = 's-pt1';
    const stateFile = writeStateFile(sid, {
      current_phase: 'plan',
      worktree_enabled: 'true',
      worktree_path: '"/tmp/wt/test"',
      team_mode: 'team',
    });
    writePointerFile(sid);

    const result = runHook({ file_path: stateFile });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Phase Transition'));
    assert.ok(result.stdout.includes('worktree_path'));
    assert.ok(result.stdout.includes('team_mode: team'));
  });

  it('does not inject on same phase (no transition)', () => {
    const sid = 's-pt2';
    const stateFile = writeStateFile(sid, {
      current_phase: 'research',
      team_mode: 'solo',
    });
    writePointerFile(sid);

    // First call: creates cache
    runHook({ file_path: stateFile });

    // Second call: same phase, no injection
    const result = runHook({ file_path: stateFile });

    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes('Phase Transition'));
  });

  it('ignores non-state file writes', () => {
    const sid = 's-pt3';
    writeStateFile(sid, { current_phase: 'implement' });
    writePointerFile(sid);

    const result = runHook({ file_path: '/tmp/some-other-file.ts' });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
  });

  it('shows tdd_mode on implement transition', () => {
    const sid = 's-pt4';
    const stateFile = writeStateFile(sid, {
      current_phase: 'implement',
      tdd_mode: 'strict',
      worktree_enabled: 'false',
      team_mode: 'solo',
    });
    writePointerFile(sid);

    const result = runHook({ file_path: stateFile });

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('tdd_mode: strict'));
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `cd /Users/sungmin/Dev/deep-work && node --test hooks/scripts/phase-transition.test.js`
Expected: 4 tests pass

- [ ] **Step 3: Commit**

```bash
git add hooks/scripts/phase-transition.test.js
git commit -m "test(hooks): add P1 phase transition injector unit tests"
```

---

### Task 8: Phase A 통합 테스트 — 기존 테스트 회귀 확인

**Files:**
- (no new files)

- [ ] **Step 1: 기존 hook 테스트 전체 실행**

```bash
cd /Users/sungmin/Dev/deep-work && node --test hooks/scripts/*.test.js
```

Expected: 모든 기존 테스트 + 신규 테스트 pass. P0의 파일 경로 추출 범위 확대가 기존 `multi-session.test.js`나 `phase-guard-core.test.js`를 깨뜨리지 않는지 확인.

- [ ] **Step 2: 실패 시 수정 후 재실행**

기존 테스트가 실패하면, P0의 파일 경로 추출 리팩토링(Task 2 Step 2)이 기존 ownership check의 동작을 변경하지 않도록 수정한다. ownership check를 implement phase 조건 안에 유지한 것이 핵심.

- [ ] **Step 3: Commit (수정 있을 경우)**

```bash
git add hooks/scripts/
git commit -m "fix(hooks): resolve test regressions from P0 path extraction refactor"
```

---

## Phase B: Skill 인프라 구축

### Task 9: References 이동

**Files:**
- Move: `skills/deep-work-workflow/references/*` → `skills/shared/references/`

- [ ] **Step 1: shared/references 디렉토리 생성 및 파일 이동**

```bash
mkdir -p skills/shared/references
cp skills/deep-work-workflow/references/*.md skills/shared/references/
```

기존 `skills/deep-work-workflow/references/`는 이 시점에서 삭제하지 않는다 (Phase C에서 모든 command가 thin wrapper로 전환된 후 삭제).

- [ ] **Step 2: Commit**

```bash
git add skills/shared/references/
git commit -m "feat(skills): copy references to skills/shared/references/"
```

---

### Task 10: Utility commands의 references 경로 업데이트

**Files:**
- Modify: `commands/deep-brainstorm.md` (2곳)
- Modify: `commands/deep-phase-review.md` (2곳)
- Modify: `commands/solid-review.md` (2곳)
- Modify: `commands/deep-research.md` (1곳)
- Modify: `commands/deep-implement.md` (1곳)
- Modify: `commands/deep-plan.md` (1곳)

- [ ] **Step 1: 경로 패턴 확인 및 일괄 수정**

Grep 결과에서 확인된 참조 패턴별로 수정:

**패턴 1**: `skills/deep-work-workflow/references/` (절대 경로)
```
solid-review.md:76   → ${CLAUDE_PLUGIN_ROOT}/skills/shared/references/solid-guide.md
solid-review.md:142  → ${CLAUDE_PLUGIN_ROOT}/skills/shared/references/solid-prompt-guide.md
deep-brainstorm.md:172 → skills/shared/references/review-gate.md
```

**패턴 2**: `references/` (상대 경로, skill 디렉토리 기준)
```
deep-brainstorm.md:205    → Read `skills/shared/references/phase-review-gate.md`
deep-phase-review.md:71   → Read `skills/shared/references/phase-review-gate.md`
deep-phase-review.md:72   → Read `skills/shared/references/review-gate.md`
deep-research.md:541      → Read `skills/shared/references/phase-review-gate.md`
deep-implement.md:843     → Read `skills/shared/references/phase-review-gate.md`
deep-plan.md:124          → Read `skills/shared/references/plan-templates.md`
deep-plan.md:431          → Read `skills/shared/references/phase-review-gate.md`
```

각 파일에서 old path를 new path로 교체한다.

- [ ] **Step 2: 교체 검증**

```bash
grep -rn "deep-work-workflow/references" commands/ && echo "FAIL: old paths remain" || echo "OK: no old paths"
```

Expected: `OK: no old paths`

- [ ] **Step 3: Commit**

```bash
git add commands/
git commit -m "refactor(commands): update references paths to skills/shared/references/"
```

---

### Task 11: review-approval-workflow.md 신규 생성

**Files:**
- Create: `skills/shared/references/review-approval-workflow.md`

- [ ] **Step 1: 파일 작성**

Spec의 "Review + Approval Workflow" 상세 프로토콜을 reference 파일로 작성:

```markdown
# Review + Approval Workflow

Research와 Plan phase 완료 후 Orchestrator가 실행하는 6단계 리뷰/승인 프로토콜.

## Step 1: 산출물 로드

- Phase Skill 완료 후, Orchestrator가 산출물(research.md / plan.md)을 Read
- 산출물의 핵심 내용을 context에 확보
- 산출물 경로: `.deep-work/{SESSION_ID}/research.md` 또는 `.deep-work/{SESSION_ID}/plan.md`

## Step 2: Auto Review

병렬로 두 리뷰어를 실행:

1. **Agent(subagent_type="deep-review:code-reviewer")**:
   - 산출물 경로 전달
   - 구조적 리뷰 (누락, 불완전, 모순 검출)

2. **Agent(codex:rescue)** (codex 설치된 경우):
   - 교차 검증 (독립적 관점)
   - codex 미설치 시 skip

두 리뷰어의 findings를 수집한다.

## Step 3: Main 에이전트 판단

Main 에이전트가 모든 findings를 읽고 자체 판단:

- 각 finding에 대해 **동의/비동의** 결정
- 동의 시: 수정 대상으로 분류 + 동의 근거
- 비동의 시: 비동의 근거 기록
- 판단 기준: 산출물의 목적, 현재 task의 맥락, 기술적 타당성

## Step 4: 1차 승인 요청 (수정 항목)

AskUserQuestion으로 사용자에게 제시:

```
리뷰 결과 중 반영이 필요하다고 판단한 항목:

반영 제안:
1. {finding} — (동의 근거)
2. {finding} — (동의 근거)

반영하지 않는 항목:
- {finding} — (비동의 근거)

선택:
1) 전체 승인 — 모든 제안 반영
2) 선택 승인 — 번호 지정
3) 수정 없이 진행
```

## Step 5: 수정 적용

- 사용자가 승인한 항목만 산출물(research.md / plan.md)에 반영
- 수정 후 변경 요약 출력

## Step 6: 2차 승인 요청 (최종 확인 + 다음 phase)

AskUserQuestion으로 사용자에게 제시:

```
수정 완료. 최종 문서를 확인해주세요.
1) 승인 — 다음 phase로 진행
2) 추가 수정 요청
3) 이 phase 재실행
```

- **승인** → Orchestrator가 `current_phase` 업데이트 → 다음 Skill 호출
- **추가 수정** → Step 5로 복귀
- **재실행** → Phase Skill을 다시 호출 (Step 1로 복귀)
```

- [ ] **Step 2: Commit**

```bash
git add skills/shared/references/review-approval-workflow.md
git commit -m "feat(skills): add review-approval-workflow reference — 6-step protocol"
```

---

### Task 12: Phase Skill 디렉토리 + SKILL.md 생성 — deep-brainstorm

**Files:**
- Create: `skills/deep-brainstorm/SKILL.md`

- [ ] **Step 1: 디렉토리 생성 + SKILL.md 작성**

기존 `commands/deep-brainstorm.md` (217줄)에서 핵심 흐름만 추출하여 ~100줄의 SKILL.md를 작성한다.

```bash
mkdir -p skills/deep-brainstorm
```

SKILL.md를 작성한다. 핵심 구조:
- Section 1: State 로드 (공통 템플릿)
- Section 2: Phase 실행 — 기존 deep-brainstorm.md의 Step 1-7을 축약
- Section 3: 완료 — current_phase를 research로 업데이트

기존 `commands/deep-brainstorm.md`를 Read하여 핵심 로직(문제 정의, 접근법 비교, 선택)을 Section 2에 포함하고, review gate 호출은 `Read("skills/shared/references/phase-review-gate.md")`로 위임.

- [ ] **Step 2: Commit**

```bash
git add skills/deep-brainstorm/
git commit -m "feat(skills): create deep-brainstorm skill — Phase 0"
```

---

### Task 13: Phase Skill — deep-research

**Files:**
- Create: `skills/deep-research/SKILL.md`

- [ ] **Step 1: 디렉토리 생성 + SKILL.md 작성**

```bash
mkdir -p skills/deep-research
```

기존 `commands/deep-research.md` (612줄)에서 추출. ~150줄.

핵심 구조:
- Section 1: State 로드
- Section 2: 모드 결정 (`team_mode` → Solo/Team 분기)
- Section 3 (Solo): Explore 에이전트로 codebase 분석 → research.md 작성
- Section 4 (Team): TeamCreate + 3 에이전트 (arch/pattern/risk) → 합성
- Section 5: 완료 — research.md 검증. **current_phase 변경하지 않음** (Orchestrator가 리뷰+승인 후 변경)

상세 지침은 `Read("skills/shared/references/research-guide.md")`로 위임.

- [ ] **Step 2: Commit**

```bash
git add skills/deep-research/
git commit -m "feat(skills): create deep-research skill — Phase 1"
```

---

### Task 14: Phase Skill — deep-plan

**Files:**
- Create: `skills/deep-plan/SKILL.md`

- [ ] **Step 1: 디렉토리 생성 + SKILL.md 작성**

```bash
mkdir -p skills/deep-plan
```

기존 `commands/deep-plan.md` (736줄)에서 추출. ~150줄.

핵심 구조:
- Section 1: State 로드 + research.md Read
- Section 2: 계획 수립 (슬라이스 분해, 의존성, 파일 매핑)
- Section 3: Team 모드 분기 (mode re-evaluation 포함)
- Section 4: 완료 — plan.md 검증. **current_phase 변경하지 않음**

상세 지침은 `Read("skills/shared/references/planning-guide.md")` + `Read("skills/shared/references/plan-templates.md")`로 위임.

- [ ] **Step 2: Commit**

```bash
git add skills/deep-plan/
git commit -m "feat(skills): create deep-plan skill — Phase 2"
```

---

### Task 15: Phase Skill — deep-implement

**Files:**
- Create: `skills/deep-implement/SKILL.md`

- [ ] **Step 1: 디렉토리 생성 + SKILL.md 작성**

```bash
mkdir -p skills/deep-implement
```

기존 `commands/deep-implement.md` (890줄)에서 추출. ~200줄. 가장 복잡한 phase.

핵심 구조:
- Section 1: State 로드 + plan.md Read
- Section 2: 슬라이스 루프 (TDD: RED → GREEN → REFACTOR)
- Section 3: Team 모드 분기 (슬라이스 클러스터링, 에이전트 분배)
- Section 4: 완료 — receipt 수집, current_phase → test 업데이트

상세 지침은 `Read("skills/shared/references/implementation-guide.md")`로 위임. Rationalization prevention Red Flags table은 SKILL.md에 직접 포함 (attention이 필요한 핵심 규칙이므로).

- [ ] **Step 2: Commit**

```bash
git add skills/deep-implement/
git commit -m "feat(skills): create deep-implement skill — Phase 3"
```

---

### Task 16: Phase Skill — deep-test

**Files:**
- Create: `skills/deep-test/SKILL.md`

- [ ] **Step 1: 디렉토리 생성 + SKILL.md 작성**

```bash
mkdir -p skills/deep-test
```

기존 `commands/deep-test.md` (726줄)에서 추출. ~120줄.

핵심 구조:
- Section 1: State 로드
- Section 2: 테스트 실행 (센서, 드리프트, 커버리지)
- Section 3: 실패 시 implement로 복귀 (retry loop)
- Section 4: 완료 — current_phase → idle 업데이트

상세 지침은 `Read("skills/shared/references/testing-guide.md")`로 위임.

- [ ] **Step 2: Commit**

```bash
git add skills/deep-test/
git commit -m "feat(skills): create deep-test skill — Phase 4"
```

---

### Task 17: Orchestrator Skill 생성

**Files:**
- Create: `skills/deep-work-orchestrator/SKILL.md`

- [ ] **Step 1: 디렉토리 생성 + SKILL.md 작성**

```bash
mkdir -p skills/deep-work-orchestrator
```

~250줄. 기존 `commands/deep-work.md` (1,193줄)에서 초기화 로직 + auto-flow dispatch만 추출.

핵심 구조:
- Step 1: 세션 초기화 (기존 deep-work.md Step 1-8의 축약)
- Step 2: 조건 변수 조립 (ARGS 문자열 구성)
- Step 3: Auto-flow Dispatch
  - 3-1. Brainstorm (skip 가능)
  - 3-2. Research → Review + Approval (reference 참조)
  - 3-3. Plan → Review + Approval (reference 참조)
  - 3-4. Implement
  - 3-5. Test (retry loop)
  - 3-6. Finish

Review + Approval 요약만 포함, 상세는 `Read("skills/shared/references/review-approval-workflow.md")`로 위임.

- [ ] **Step 2: Commit**

```bash
git add skills/deep-work-orchestrator/
git commit -m "feat(skills): create deep-work-orchestrator skill — auto-flow dispatch"
```

---

## Phase B-1: Resume 호환성 (C-2, F-12)

### Task 17-A: deep-resume를 Skill dispatch 기반으로 수정

**Files:**
- Modify: `commands/deep-resume.md`

- [ ] **Step 1: deep-resume의 phase command 직접 참조를 Skill 호출로 교체**

현재 `deep-resume.md`는 phase command 파일을 직접 Read하여 특정 Step부터 이어서 실행한다 (line 221-262). Phase C에서 이 파일들이 thin wrapper로 바뀌면 resume이 깨진다 (C-2).

수정 방향:
- Resume 시 `current_phase`를 확인하고, 해당 phase의 **Skill**을 호출하도록 변경
- `Skill("deep-research", args="--session={SESSION_ID} --resume")` 형태
- 각 phase Skill의 State 로드 섹션에서 `--resume` 플래그를 인식하여 기존 산출물을 이어서 작업
- Phase command 파일의 특정 Step을 직접 참조하는 모든 코드를 Skill 호출로 교체

- [ ] **Step 2: Phase cache 재초기화 로직 추가 (F-12)**

Resume 시 stale cache를 방지하기 위해 cache를 현재 phase로 재초기화:

```markdown
# deep-resume.md 내 cache 재초기화 지시 추가:
Resume 시 첫 동작으로:
1. Session ID 확인
2. `.claude/.phase-cache-{SESSION_ID}` 파일이 있으면 삭제 (다음 phase 전환 시 P1이 정상 발동하도록)
```

- [ ] **Step 3: Commit**

```bash
git add commands/deep-resume.md
git commit -m "refactor(commands): update deep-resume to Skill dispatch — prevents C-2 breakage"
```

---

## Phase C: Command → Thin Wrapper 전환

### Task 18: deep-brainstorm.md → thin wrapper

**Files:**
- Modify: `commands/deep-brainstorm.md`

- [ ] **Step 1: 기존 내용 백업 확인 (git에 이미 있음)**

기존 내용은 git history에 보존되어 있다. thin wrapper로 교체:

```markdown
---
allowed-tools: Skill, Read, Write, Bash, Glob, Grep, Agent, AskUserQuestion
---

# /deep-brainstorm

Phase 0: 문제 정의 및 접근법 탐색 — 왜(why)를 먼저 탐구.

Skill("deep-brainstorm", args="$ARGUMENTS")
```

> **C-1**: 모든 thin wrapper의 `allowed-tools`에 `Skill`을 명시적으로 포함해야 한다. Skill tool이 allowlist에 없으면 dispatch가 차단된다.

- [ ] **Step 2: Commit**

```bash
git add commands/deep-brainstorm.md
git commit -m "refactor(commands): convert deep-brainstorm to thin wrapper → Skill dispatch"
```

---

### Task 19: deep-research.md → thin wrapper

**Files:**
- Modify: `commands/deep-research.md`

- [ ] **Step 1: thin wrapper로 교체**

```markdown
---
allowed-tools: Skill, Read, Grep, Glob, Agent, Write, Bash, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
---

# /deep-research

Phase 1: 코드베이스 심층 분석 — Solo/Team 자동 분기.

Skill("deep-research", args="$ARGUMENTS")
```

- [ ] **Step 2: Commit**

```bash
git add commands/deep-research.md
git commit -m "refactor(commands): convert deep-research to thin wrapper → Skill dispatch"
```

---

### Task 20: deep-plan.md → thin wrapper

**Files:**
- Modify: `commands/deep-plan.md`

- [ ] **Step 1: thin wrapper로 교체**

```markdown
---
allowed-tools: Skill, Read, Write, Edit, Bash, Grep, Glob, Agent, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
---

# /deep-plan

Phase 2: 구현 계획 수립 — 슬라이스 분해, 의존성 매핑.

Skill("deep-plan", args="$ARGUMENTS")
```

- [ ] **Step 2: Commit**

```bash
git add commands/deep-plan.md
git commit -m "refactor(commands): convert deep-plan to thin wrapper → Skill dispatch"
```

---

### Task 21: deep-test.md → thin wrapper

**Files:**
- Modify: `commands/deep-test.md`

- [ ] **Step 1: thin wrapper로 교체**

```markdown
---
allowed-tools: Skill, Bash, Read, Write, Glob, Grep, Agent
---

# /deep-test

Phase 4: 종합 검증 — 센서, 드리프트, 커버리지.

Skill("deep-test", args="$ARGUMENTS")
```

- [ ] **Step 2: Commit**

```bash
git add commands/deep-test.md
git commit -m "refactor(commands): convert deep-test to thin wrapper → Skill dispatch"
```

---

### Task 22: deep-implement.md → thin wrapper

**Files:**
- Modify: `commands/deep-implement.md`

- [ ] **Step 1: thin wrapper로 교체**

```markdown
---
allowed-tools: Skill, Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
---

# /deep-implement

Phase 3: TDD 기반 슬라이스 구현 — RED → GREEN → REFACTOR.

Skill("deep-implement", args="$ARGUMENTS")
```

- [ ] **Step 2: Commit**

```bash
git add commands/deep-implement.md
git commit -m "refactor(commands): convert deep-implement to thin wrapper → Skill dispatch"
```

---

## Phase D: Orchestrator 전환

### Task 23: deep-work.md → thin wrapper

**Files:**
- Modify: `commands/deep-work.md`

- [ ] **Step 1: thin wrapper로 교체**

```markdown
---
allowed-tools: Skill, Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
---

# /deep-work

Evidence-Driven Development Protocol — Brainstorm → Research → Plan → Implement → Test 자동 진행.

Skill("deep-work-orchestrator", args="$ARGUMENTS")
```

- [ ] **Step 2: Commit**

```bash
git add commands/deep-work.md
git commit -m "refactor(commands): convert deep-work to thin wrapper → Orchestrator Skill dispatch"
```

---

## Phase E: 검증 + 정리

### Task 24: plugin.json 업데이트

**Files:**
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: version 범프 + description 업데이트**

```json
{
  "name": "deep-work",
  "version": "6.1.0",
  "description": "Evidence-Driven Development Protocol — 3-layer architecture with Skill-based phase dispatch, computational enforcement (worktree guard + phase transition injection), TDD enforcement, and receipt validation",
  "author": {
    "name": "sungmin"
  },
  "repository": "https://github.com/Sungmin-Cho/claude-deep-work",
  "license": "MIT",
  "keywords": [
    "workflow",
    "deep-work",
    "evidence-driven",
    "tdd",
    "auto-flow",
    "slice",
    "receipt",
    "quality-gate",
    "structured-development",
    "agent-team",
    "code-review",
    "session-lifecycle",
    "computational-guard",
    "skill-dispatch"
  ],
  "category": "productivity"
}
```

- [ ] **Step 2: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "chore: bump version to 6.1.0 — computational guard + skill migration"
```

---

### Task 25: SKILL.md 정리 — 기존 deep-work-workflow 업데이트

**Files:**
- Modify: `skills/deep-work-workflow/SKILL.md`

- [ ] **Step 1: SKILL.md를 v6.1.0 구조로 업데이트**

기존 SKILL.md는 changelog 형태의 문서였다. 이를 v6.1.0의 새 아키텍처를 반영하는 개요 문서로 교체:

```markdown
---
name: deep-work-workflow
version: "6.1.0"
description: |
  Evidence-driven development protocol with auto-flow orchestration.
  Use when: "deep work", "plan before code", "TDD", "evidence-driven",
  "분석 후 구현", "structured workflow", or complex multi-file tasks
  that benefit from structured planning before implementation.
---

# Deep Work Workflow v6.1.0

## Architecture

3-Layer Design: Commands (thin wrappers) → Skills (execution logic) → Hooks (enforcement).

## Primary Skills

| Skill | Phase | 역할 |
|-------|-------|------|
| deep-work-orchestrator | - | 초기화 + auto-flow dispatch |
| deep-brainstorm | 0 | 문제 정의, 접근법 탐색 |
| deep-research | 1 | 코드베이스 심층 분석 |
| deep-plan | 2 | 구현 계획 수립 |
| deep-implement | 3 | TDD 기반 슬라이스 구현 |
| deep-test | 4 | 종합 검증 |

## Primary Commands (entry points)

`/deep-work`, `/deep-research`, `/deep-plan`, `/deep-implement`, `/deep-test`, `/deep-brainstorm`

각 command는 해당 Skill을 호출하는 thin wrapper.

## Computational Guard

- **P0 (PreToolUse)**: Worktree 경로 외부 Write/Edit hard block
- **P1 (PostToolUse)**: Phase 전환 시 조건 context injection

## Utility Commands (standalone)

`/deep-status`, `/deep-finish`, `/deep-fork`, `/deep-resume`, `/deep-report`,
`/deep-receipt`, `/deep-debug`, `/deep-cleanup`, `/deep-history`
```

- [ ] **Step 2: 기존 references 디렉토리 삭제 (shared로 이동 완료)**

```bash
rm -rf skills/deep-work-workflow/references/
```

- [ ] **Step 3: Commit**

```bash
git add skills/deep-work-workflow/
git commit -m "refactor(skills): update deep-work-workflow SKILL.md to v6.1.0 architecture"
```

---

### Task 26: CLAUDE.md 업데이트

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: version + Structure 업데이트**

`CLAUDE.md`의 첫 줄 `# deep-work v6.0.2`를 `# deep-work v6.1.0`으로 변경.

Structure 섹션을 업데이트:

```markdown
## Structure

```
.claude-plugin/plugin.json        # 플러그인 매니페스트
commands/                          # 슬래시 커맨드 (thin wrappers + utilities)
hooks/hooks.json                   # 훅 설정 (P0 worktree guard + P1 phase transition)
hooks/scripts/                     # 훅 스크립트 및 테스트
skills/deep-work-orchestrator/     # Orchestrator Skill (초기화 + auto-flow)
skills/deep-brainstorm/            # Phase 0 Skill
skills/deep-research/              # Phase 1 Skill
skills/deep-plan/                  # Phase 2 Skill
skills/deep-implement/             # Phase 3 Skill
skills/deep-test/                  # Phase 4 Skill
skills/shared/references/          # 공통 레퍼런스 가이드 (14개)
skills/deep-work-workflow/         # 워크플로우 개요 Skill
templates/                         # CI 템플릿
```
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for v6.1.0 architecture"
```

---

### Task 27: 최종 Hook 테스트 회귀 확인

**Files:**
- (no new files)

- [ ] **Step 1: 전체 테스트 스위트 실행**

```bash
cd /Users/sungmin/Dev/deep-work && node --test hooks/scripts/*.test.js
```

Expected: 모든 테스트 pass.

- [ ] **Step 2: Plugin 로딩 확인**

Claude Code에서 `/reload-plugins`를 실행하여 플러그인이 정상 로드되는지 확인. 에러가 없어야 함.

---

### Task 28: package.json 버전 범프 (있을 경우)

**Files:**
- Modify: `package.json` (존재하는 경우)

- [ ] **Step 1: package.json version을 6.1.0으로 업데이트**

```bash
if [ -f package.json ]; then
  node -e "const p=require('./package.json');p.version='6.1.0';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
  git add package.json
  git commit -m "chore: bump package.json version to 6.1.0"
fi
```
