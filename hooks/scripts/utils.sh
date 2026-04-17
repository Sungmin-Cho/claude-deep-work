#!/usr/bin/env bash
# utils.sh — Shared utilities for deep-work hook scripts
# Source this file: source "$(dirname "${BASH_SOURCE[0]}")/utils.sh"

# ─── Path normalization ──────────────────────────────────────
# Converts backslashes to forward slashes and collapses double slashes.

normalize_path() {
  local p="$1"
  p="${p//\\//}"
  while [[ "$p" == *"//"* ]]; do
    p="${p//\/\//\/}"
  done
  # Resolve .. segments (only when present, keeps fast path)
  if [[ "$p" == *"/.."* ]]; then
    p=$(node -e "console.log(require('path').resolve(process.argv[1]))" "$p" 2>/dev/null || echo "$p")
  fi
  printf '%s' "$p"
}

# ─── Project root detection ──────────────────────────────────
# Walks up from $PWD looking for a .claude directory.
# Returns the first directory containing .claude, or $PWD if not found.

find_project_root() {
  local dir="$PWD"
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.claude" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  echo "$PWD"
  return 1
}

# ─── YAML frontmatter field extraction ───────────────────────
# Reads a YAML frontmatter field from a file.
# Usage: read_frontmatter_field <file> <field_name>
# Returns the unquoted value, or empty string if not found.

read_frontmatter_field() {
  local file="$1"
  local field="$2"
  local value=""
  local in_fm=false

  while IFS= read -r line; do
    if [[ "$line" == "---" ]]; then
      if $in_fm; then break; else in_fm=true; continue; fi
    fi
    if $in_fm; then
      local prefix="${field}: "
      local prefix_nospace="${field}:"
      if [[ "$line" == "${prefix}"* ]]; then
        value="${line#"${prefix}"}"
        value="${value%\"}" ; value="${value#\"}"
        value="${value%\'}" ; value="${value#\'}"
        break
      elif [[ "$line" == "${prefix_nospace}"* ]]; then
        value="${line#"${prefix_nospace}"}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%\"}" ; value="${value#\"}"
        value="${value%\'}" ; value="${value#\'}"
        break
      fi
    fi
  done < "$file"

  printf '%s' "$value"
}

# ─── YAML list field extraction ───────────────────────────────
# Reads a YAML list under a frontmatter key; emits JSON array string.
# Handles both inline array (key: [a, b, c]) and block list forms
# (key:\n  - a\n  - b). Returns "[]" on missing field or parse errors.
# Usage: read_frontmatter_list <file> <field_name>

read_frontmatter_list() {
  local file="$1" field="$2"
  [[ -f "$file" ]] || { printf '[]'; return 0; }
  node -e '
    (() => {
      const fs = require("fs"), f = process.argv[1], key = process.argv[2];
      try {
        const t = fs.readFileSync(f, "utf8");
        const fm = t.match(/^---\n([\s\S]*?)\n---/);
        if (!fm) { process.stdout.write("[]"); return; }
        const body = fm[1];
        // Escape regex special chars in key
        const keyEsc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // inline array form: key: [a, b, "c"]
        const inline = body.match(new RegExp("^" + keyEsc + ":\\s*\\[([^\\]]*)\\]", "m"));
        if (inline) {
          const items = inline[1]
            .split(",")
            .map(s => s.trim().replace(/^["\x27]|["\x27]$/g, ""))
            .filter(Boolean);
          process.stdout.write(JSON.stringify(items));
          return;
        }
        // block list form: key:\n  - a\n  - b
        const block = body.match(new RegExp("^" + keyEsc + ":\\s*\\n((?:\\s+- .*\\n?)+)", "m"));
        if (block) {
          const items = block[1]
            .split("\n")
            .map(l => l.match(/^\s+-\s+(.+)$/))
            .filter(Boolean)
            .map(m => m[1].replace(/^["\x27]|["\x27]$/g, ""));
          process.stdout.write(JSON.stringify(items));
          return;
        }
        process.stdout.write("[]");
      } catch(_) { process.stdout.write("[]"); }
    })();
  ' "$file" "$field" 2>/dev/null || printf '[]'
}

# ─── JSON helpers ────────────────────────────────────────────
# extract_file_path_from_json — safely extract .file_path from a JSON blob.
# Returns empty string on parse failure or missing/non-string field.
# Unlike regex parsing, handles escaped quotes (\"), backslashes, and Unicode
# escapes correctly.
# Usage: path=$(extract_file_path_from_json "$TOOL_INPUT")

extract_file_path_from_json() {
  local input="$1"
  printf '%s' "$input" | node -e '
    let d = ""; process.stdin.setEncoding("utf8");
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      try {
        const o = JSON.parse(d);
        if (typeof o.file_path === "string") process.stdout.write(o.file_path);
      } catch(_) { /* malformed — emit empty */ }
    });
  ' 2>/dev/null || printf ''
}

# json_escape — escape a string for safe inclusion in a JSON string literal.
# Arg is REQUIRED. No stdin fallback (prevents hook hangs when arg happens
# to be empty). Empty arg returns empty string.
# Usage: reason_esc=$(json_escape "$reason")

json_escape() {
  local input="${1-}"
  [[ -z "$input" ]] && return 0
  printf '%s' "$input" | node -e '
    let d = ""; process.stdin.setEncoding("utf8");
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      const s = JSON.stringify(d);
      // strip surrounding quotes for inline interpolation
      process.stdout.write(s.slice(1, -1));
    });
  ' 2>/dev/null
}

# ─── Lock primitives ─────────────────────────────────────────
# mkdir-based advisory spinlock. Fail-closed on timeout (no force-removal —
# that was the v6.2.3 bug that corrupted the registry under contention).
# _acquire_lock <lock_path> [retries=20] [sleep_s=0.05]
# Returns 0 on acquire, 1 on timeout. On timeout, appends to the guard error log.

_acquire_lock() {
  local lock="$1" retries="${2:-20}" sleep_s="${3:-0.05}"
  local i
  for ((i = 0; i < retries; i++)); do
    if mkdir "$lock" 2>/dev/null; then
      return 0
    fi
    sleep "$sleep_s" 2>/dev/null || true
  done
  local err_log="${PROJECT_ROOT:-$PWD}/.claude/deep-work-guard-errors.log"
  mkdir -p "$(dirname "$err_log")" 2>/dev/null
  printf '%s lock timeout: %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)" \
    "$lock" >> "$err_log" 2>/dev/null || true
  return 1
}

_release_lock() {
  rmdir "$1" 2>/dev/null || true
}

# ─── Session ID generation ──────────────────────────────────
# Generates a unique session identifier: s-{8 hex digits}

generate_session_id() {
  local hex
  if [[ -r /dev/urandom ]]; then
    hex=$(od -An -tx1 -N4 /dev/urandom 2>/dev/null | tr -d ' \n\t')
  fi
  if [[ -z "$hex" || ${#hex} -ne 8 ]]; then
    printf -v hex '%04x%04x' "$RANDOM" "$RANDOM"
  fi
  printf 's-%s\n' "$hex"
}

# ─── Common state initialization ─────────────────────────────
# Sets PROJECT_ROOT, STATE_FILE based on session identity.
# Priority: DEEP_WORK_SESSION_ID env var → pointer file → legacy path.
# After calling: PROJECT_ROOT, STATE_FILE are set.

init_deep_work_state() {
  PROJECT_ROOT="$(find_project_root 2>/dev/null || echo "$PWD")"

  local session_id=""

  # Priority 1: environment variable
  if [[ -n "${DEEP_WORK_SESSION_ID:-}" ]]; then
    session_id="$DEEP_WORK_SESSION_ID"
  fi

  # Priority 2: pointer file
  if [[ -z "$session_id" ]]; then
    local pointer_file="$PROJECT_ROOT/.claude/deep-work-current-session"
    if [[ -f "$pointer_file" ]]; then
      session_id="$(tr -d '\n\r' < "$pointer_file")"
    fi
  fi

  # Set STATE_FILE
  if [[ -n "$session_id" ]]; then
    STATE_FILE="$PROJECT_ROOT/.claude/deep-work.${session_id}.md"
  else
    # Priority 3: legacy fallback
    STATE_FILE="$PROJECT_ROOT/.claude/deep-work.local.md"
  fi
}

# ─── Session pointer file ──────────────────────────────────
# Manages .claude/deep-work-current-session for env var fallback.

write_session_pointer() {
  local session_id="$1"
  mkdir -p "$PROJECT_ROOT/.claude" 2>/dev/null
  printf '%s' "$session_id" > "$PROJECT_ROOT/.claude/deep-work-current-session"
}

read_session_pointer() {
  local pointer_file="$PROJECT_ROOT/.claude/deep-work-current-session"
  if [[ -f "$pointer_file" ]]; then
    tr -d '\n\r' < "$pointer_file"
  fi
}

# ─── Registry read/write ───────────────────────────────────
# Central registry: .claude/deep-work-sessions.json

read_registry() {
  local registry_file="$PROJECT_ROOT/.claude/deep-work-sessions.json"
  if [[ -f "$registry_file" ]]; then
    cat "$registry_file"
  else
    local default_json='{"version":1,"shared_files":["package.json","package-lock.json","tsconfig.json",".eslintrc.*","*.config.js","*.config.ts"],"sessions":{}}'
    mkdir -p "$(dirname "$registry_file")" 2>/dev/null
    printf '%s' "$default_json" > "$registry_file"
    printf '%s' "$default_json"
  fi
}

write_registry() {
  local json="$1"
  local registry_file="$PROJECT_ROOT/.claude/deep-work-sessions.json"
  local lock_path="$PROJECT_ROOT/.claude/deep-work-sessions.lock"
  local tmp_file="${registry_file}.tmp.$$"

  mkdir -p "$(dirname "$registry_file")" 2>/dev/null

  if command -v flock >/dev/null 2>&1; then
    (
      flock -w 2 9 || exit 1
      printf '%s' "$json" > "$tmp_file" && mv "$tmp_file" "$registry_file"
    ) 9>"$lock_path"
    return $?
  fi

  # mkdir-based spinlock fallback (NFS, macOS without flock). Fail-closed:
  # do NOT force-remove the lock directory on timeout — that corrupted the
  # registry under contention in v6.2.3.
  if ! _acquire_lock "$lock_path" 20 0.05; then
    rm -f "$tmp_file" 2>/dev/null
    return 1
  fi
  printf '%s' "$json" > "$tmp_file" && mv "$tmp_file" "$registry_file"
  local rc=$?
  _release_lock "$lock_path"
  return $rc
}

# ─── Session registration ──────────────────────────────────

register_session() {
  local session_id="$1"
  local pid="$2"
  local task_desc="$3"
  local work_dir="$4"

  local current
  current="$(read_registry)"

  local updated
  updated=$(node -e '
    const data = JSON.parse(process.argv[1]);
    const sid = process.argv[2];
    const now = new Date().toISOString();
    data.sessions[sid] = {
      pid: parseInt(process.argv[3], 10),
      current_phase: "plan",
      task_description: process.argv[4],
      work_dir: process.argv[5],
      started_at: now,
      last_activity: now,
      file_ownership: [],
      worktree_path: null,
      git_branch: null
    };
    console.log(JSON.stringify(data));
  ' "$current" "$session_id" "$pid" "$task_desc" "$work_dir")

  write_registry "$updated"
}

unregister_session() {
  local session_id="$1"

  local current
  current="$(read_registry)"

  local updated
  updated=$(node -e '
    const data = JSON.parse(process.argv[1]);
    delete data.sessions[process.argv[2]];
    console.log(JSON.stringify(data));
  ' "$current" "$session_id")

  write_registry "$updated"
}

# ─── File ownership ────────────────────────────────────────

check_file_ownership() {
  local session_id="$1"
  local file_path="$2"

  local registry
  registry="$(read_registry)"

  node -e '
    const data = JSON.parse(process.argv[1]);
    const mySession = process.argv[2];
    const filePath = process.argv[3];

    function matchGlob(pattern, fp) {
      if (pattern.endsWith("/**")) {
        const dir = pattern.slice(0, -3);
        return fp.startsWith(dir + "/") || fp === dir;
      }
      if (pattern.includes("*")) {
        const re = new RegExp(
          "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
        );
        return re.test(fp);
      }
      // Normalize trailing slashes for directory comparison
      return pattern.replace(/\/+$/, "") === fp.replace(/\/+$/, "");
    }

    // Shared files are always allowed
    for (const pat of (data.shared_files || [])) {
      if (matchGlob(pat, filePath)) process.exit(0);
    }

    // Check other sessions ownership
    for (const [sid, sess] of Object.entries(data.sessions || {})) {
      if (sid === mySession) continue;
      for (const pat of (sess.file_ownership || [])) {
        if (matchGlob(pat, filePath)) {
          console.log(JSON.stringify({
            blocked: true,
            owner_session: sid,
            task: sess.task_description || ""
          }));
          process.exit(1);
        }
      }
    }
    process.exit(0);
  ' "$registry" "$session_id" "$file_path"
}

register_file_ownership() {
  local session_id="$1"
  local file_path="$2"

  local current
  current="$(read_registry)"

  local updated
  updated=$(node -e '
    const path = require("path");
    const data = JSON.parse(process.argv[1]);
    const sid = process.argv[2];
    const fp = process.argv[3];

    const sess = data.sessions[sid];
    if (!sess) { console.log(JSON.stringify(data)); process.exit(0); }

    const ownership = sess.file_ownership || [];

    // Skip if already covered by existing pattern
    for (const pat of ownership) {
      if (pat.endsWith("/**")) {
        const dir = pat.slice(0, -3);
        if (fp.startsWith(dir + "/") || fp === dir) {
          console.log(JSON.stringify(data));
          process.exit(0);
        }
      } else if (pat === fp) {
        console.log(JSON.stringify(data));
        process.exit(0);
      }
    }

    ownership.push(fp);

    // Glob promotion: 3+ files in same directory → dir/**
    const dir = path.dirname(fp);
    const filesInDir = ownership.filter(
      (f) => !f.endsWith("/**") && path.dirname(f) === dir
    );
    if (filesInDir.length >= 3) {
      sess.file_ownership = ownership.filter((f) => {
        if (f.endsWith("/**")) return true;
        return path.dirname(f) !== dir;
      });
      sess.file_ownership.push(dir + "/**");
    } else {
      sess.file_ownership = ownership;
    }

    console.log(JSON.stringify(data));
  ' "$current" "$session_id" "$file_path")

  write_registry "$updated"
}

# ─── Activity & phase sync ─────────────────────────────────

update_last_activity() {
  local session_id="$1"

  local current
  current="$(read_registry)"

  local updated
  updated=$(node -e '
    const data = JSON.parse(process.argv[1]);
    const sid = process.argv[2];
    if (data.sessions[sid]) {
      data.sessions[sid].last_activity = new Date().toISOString();
    }
    console.log(JSON.stringify(data));
  ' "$current" "$session_id")

  write_registry "$updated"
}

update_registry_phase() {
  local session_id="$1"
  local phase="$2"

  local current
  current="$(read_registry)"

  local updated
  updated=$(node -e '
    const data = JSON.parse(process.argv[1]);
    const sid = process.argv[2];
    const phase = process.argv[3];
    if (data.sessions[sid]) {
      data.sessions[sid].current_phase = phase;
      data.sessions[sid].last_activity = new Date().toISOString();
    }
    console.log(JSON.stringify(data));
  ' "$current" "$session_id" "$phase")

  write_registry "$updated"
}

# ─── Stale session detection ───────────────────────────────
# Outputs JSON array of stale session IDs.

detect_stale_sessions() {
  local registry
  registry="$(read_registry)"

  node -e '
    const data = JSON.parse(process.argv[1]);
    const stale = [];
    const now = Date.now();
    const STALE_MINUTES = 60;

    for (const [sid, sess] of Object.entries(data.sessions || {})) {
      const pid = sess.pid;
      let isStale = false;

      if (pid) {
        try {
          process.kill(pid, 0);
          continue; // process alive — not stale
        } catch (e) {
          if (e.code === "EPERM") continue; // exists but no permission
          isStale = true; // ESRCH or other — process gone
        }
      } else {
        // No PID — use time-based fallback
        if (sess.last_activity) {
          const elapsed = (now - new Date(sess.last_activity).getTime()) / 60000;
          if (elapsed > STALE_MINUTES) isStale = true;
        } else {
          isStale = true;
        }
      }

      if (isStale) stale.push(sid);
    }

    console.log(JSON.stringify(stale));
  ' "$registry"
}

# ─── Legacy migration ──────────────────────────────────────
# Migrates deep-work.local.md to session-specific file.
# Outputs new session ID if migrated, empty otherwise.

migrate_legacy_state() {
  local legacy_file="$PROJECT_ROOT/.claude/deep-work.local.md"

  if [[ ! -f "$legacy_file" ]]; then
    return 0
  fi

  local phase
  phase="$(read_frontmatter_field "$legacy_file" "current_phase")"

  if [[ "$phase" == "idle" || -z "$phase" ]]; then
    return 0
  fi

  local new_id
  new_id="$(generate_session_id)"

  mv "$legacy_file" "$PROJECT_ROOT/.claude/deep-work.${new_id}.md"

  local task_desc
  task_desc="$(read_frontmatter_field "$PROJECT_ROOT/.claude/deep-work.${new_id}.md" "task_description")"
  register_session "$new_id" "$$" "${task_desc:-migrated}" ""

  printf '%s' "$new_id"
}

# ─── Fork utilities ───────────────────────────────────────────
# Session fork support (v5.6)

validate_fork_target() {
  local state_file="$1"

  if [[ ! -f "$state_file" ]]; then
    echo "State file not found: 상태 파일이 존재하지 않습니다." >&2
    return 1
  fi

  local phase
  phase="$(read_frontmatter_field "$state_file" "current_phase")"

  if [[ -z "$phase" || "$phase" == "idle" ]]; then
    echo "Cannot fork idle session: idle 세션은 fork할 수 없습니다." >&2
    return 1
  fi

  printf 'valid'
}

get_fork_generation() {
  local session_id="$1"

  local registry
  registry="$(read_registry)"

  node -e '
    const data = JSON.parse(process.argv[1]);
    const sid = process.argv[2];
    const sess = data.sessions[sid];
    if (!sess) { console.log("0"); process.exit(0); }
    const gen = sess.fork_generation || 0;
    console.log(String(gen));
  ' "$registry" "$session_id"
}

update_parent_fork_children() {
  local parent_state_file="$1"
  local child_id="$2"
  local restart_phase="$3"

  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%S%z)"

  node -e '
    const fs = require("fs");
    const stateFile = process.argv[1];
    const childId = process.argv[2];
    const restartPhase = process.argv[3];
    const now = process.argv[4];

    let content = fs.readFileSync(stateFile, "utf8");

    // Check if fork_children already exists in frontmatter
    const fmEnd = content.indexOf("\n---", 4);
    if (fmEnd === -1) process.exit(0);

    const fmSection = content.substring(0, fmEnd);
    const afterFm = content.substring(fmEnd);

    if (fmSection.includes("fork_children:")) {
      // Append to existing fork_children
      const entry = `\n  - session_id: ${childId}\n    forked_at: ${now}\n    restart_phase: ${restartPhase}`;
      // Find last entry under fork_children and append after it
      const lines = content.split("\n");
      let insertIdx = -1;
      let inForkChildren = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^fork_children:/)) { inForkChildren = true; continue; }
        if (inForkChildren) {
          if (lines[i].match(/^  - /) || lines[i].match(/^    /)) {
            insertIdx = i;
          } else {
            break;
          }
        }
      }
      if (insertIdx >= 0) {
        lines.splice(insertIdx + 1, 0, `  - session_id: ${childId}`, `    forked_at: ${now}`, `    restart_phase: ${restartPhase}`);
      }
      fs.writeFileSync(stateFile, lines.join("\n"));
    } else {
      // Add fork_children before closing ---
      const insertion = `fork_children:\n  - session_id: ${childId}\n    forked_at: ${now}\n    restart_phase: ${restartPhase}\n`;
      content = fmSection + "\n" + insertion + afterFm;
      fs.writeFileSync(stateFile, content);
    }
  ' "$parent_state_file" "$child_id" "$restart_phase" "$now"
}

register_fork_session() {
  local session_id="$1"
  local parent_id="$2"
  local fork_generation="$3"
  local task_desc="$4"
  local work_dir="$5"
  local restart_phase="${6:-plan}"

  # 원자적 등록: 레지스트리 lock 내에서 fork 등록 + 부모 업데이트를 모두 수행
  # session ID 기반 suffix이므로 번호 할당 race condition 없음
  local current
  current="$(read_registry)"

  local updated
  updated=$(node -e '
    const data = JSON.parse(process.argv[1]);
    const sid = process.argv[2];
    const parentId = process.argv[3];
    const gen = parseInt(process.argv[4], 10);
    const now = new Date().toISOString();
    data.sessions[sid] = {
      pid: null,
      current_phase: process.argv[7] || "plan",
      task_description: process.argv[5],
      work_dir: process.argv[6],
      started_at: now,
      last_activity: now,
      file_ownership: [],
      fork_parent: parentId,
      fork_generation: gen,
      worktree_path: null,
      git_branch: null
    };
    console.log(JSON.stringify(data));
  ' "$current" "$session_id" "$parent_id" "$fork_generation" "$task_desc" "$work_dir" "$restart_phase")

  write_registry "$updated"

  # 부모 상태 파일 업데이트도 같은 호출 내에서 수행
  local parent_state="$PROJECT_ROOT/.claude/deep-work.${parent_id}.md"
  if [[ -f "$parent_state" ]]; then
    update_parent_fork_children "$parent_state" "$session_id" "$restart_phase"
  fi
}
