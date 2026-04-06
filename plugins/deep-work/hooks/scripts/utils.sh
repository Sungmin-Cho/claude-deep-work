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
  else
    # mkdir-based spinlock fallback (NFS, macOS without flock)
    local i=0
    while ! mkdir "$lock_path" 2>/dev/null; do
      i=$((i + 1))
      if [[ $i -ge 3 ]]; then
        # Force-remove stale lock and proceed
        rmdir "$lock_path" 2>/dev/null || rm -rf "$lock_path" 2>/dev/null
        mkdir "$lock_path" 2>/dev/null || true
        break
      fi
      sleep 0.1
    done
    printf '%s' "$json" > "$tmp_file" && mv "$tmp_file" "$registry_file"
    rmdir "$lock_path" 2>/dev/null
  fi
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
