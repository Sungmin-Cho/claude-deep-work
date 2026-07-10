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

# ─── Project-root path hardening ─────────────────────────────
# Windows/Git Bash defense: a $PWD (or env-derived path) carrying a stray
# CR (from a CRLF-tainted source), backslash separators, or trailing
# whitespace would otherwise flow into PROJECT_ROOT and, downstream, make
# `mkdir -p "$PROJECT_ROOT/.claude"` materialize a "ghost" directory tree
# (e.g. `pop-studio-suite <CR>/d/NHN/.../.claude/`). Normalize once, at the
# single point where PROJECT_ROOT is derived, so every consumer agrees on
# the same clean value.
sanitize_project_path() {
  local p="${1:-}"
  p="${p//$'\r'/}"                    # strip CR (Windows CRLF artifact)
  p="${p//\\//}"                      # backslashes → forward slashes
  p="${p%"${p##*[![:space:]]}"}"      # trim trailing whitespace
  printf '%s' "$p"
}

# ─── Project root detection ──────────────────────────────────
# Walks up from $PWD looking for a .claude directory.
# Returns the first directory containing .claude, or the (sanitized) $PWD
# if not found. Output is always exactly one sanitized line.

find_project_root() {
  local dir
  dir="$(sanitize_project_path "$PWD")"
  local start="$dir"
  local prev=""
  # `prev` guard terminates the walk on Windows drive roots (e.g. `D:/`),
  # which never reach `/` and would otherwise spin (dirname "." == ".").
  while [[ -n "$dir" && "$dir" != "/" && "$dir" != "$prev" ]]; do
    if [[ -d "$dir/.claude" ]]; then
      printf '%s\n' "$dir"
      return 0
    fi
    prev="$dir"
    dir="$(dirname "$dir")"
  done
  printf '%s\n' "$start"
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

# resolve_hook_tool_context — hook의 tool_name/tool_input 해석 (env 우선 →
# stdin wrapper fallback). 하네스는 tool_name을 env(flat 계약)로 주거나, env
# 미설정 시 stdin payload 최상위 키({"tool_name":..., "tool_input":{...}})로
# 감싸 전달할 수 있다 (docs/handoff/2026-07-10-phase-guard-toolname-stdin-fallback.md).
#
# env 우선 — CLAUDE_TOOL_USE_TOOL_NAME/CLAUDE_TOOL_NAME이 설정된 하네스에서는
# payload를 절대 교체하지 않는다: unwrap하면 가드가 평가하는 입력과 툴이 실제
# 실행하는 입력(top-level)이 어긋나는 우회 표면이 된다 (v6.9.3 리뷰 R1-1).
# env 미설정일 때만 wrapper 키를 읽고 중첩 tool_input을 unwrap한다.
#
# node 1회 spawn으로 tool_name과 unwrap된 tool_input을 US(0x1f) 구분자로 동시
# 추출한다 — JSON.stringify는 제어 문자를 \u001f로 이스케이프하므로 payload
# 내용과 구분자가 충돌하지 않는다. malformed JSON이면 HOOK_TOOL_NAME은 빈
# 문자열로 남고 입력은 원본 유지 (fail-open — stdin 계약을 1차로 승격할 때
# allowlist + fail-closed로 전환 예정, deep-review D-1).
#
# 결과는 전역 HOOK_TOOL_NAME / HOOK_TOOL_INPUT에 설정된다.
# Usage: resolve_hook_tool_context "$RAW_INPUT"
#        TOOL_NAME="$HOOK_TOOL_NAME"; TOOL_INPUT="$HOOK_TOOL_INPUT"

resolve_hook_tool_context() {
  local raw="${1-}"
  HOOK_TOOL_NAME="${CLAUDE_TOOL_USE_TOOL_NAME:-${CLAUDE_TOOL_NAME:-}}"
  HOOK_TOOL_INPUT="$raw"
  [[ -n "$HOOK_TOOL_NAME" ]] && return 0
  local out
  out="$(printf '%s' "$raw" | node -e '
    process.stdin.setEncoding("utf8"); let d = "";
    process.stdin.on("data", c => d += c);
    process.stdin.on("end", () => {
      try {
        const o = JSON.parse(d);
        const name = typeof o.tool_name === "string" ? o.tool_name : "";
        const inner = (o && o.tool_input && typeof o.tool_input === "object")
          ? JSON.stringify(o.tool_input) : "";
        process.stdout.write(name + "\u001f" + inner);
      } catch (_) { /* malformed — no output, caller keeps raw (fail-open) */ }
    });
  ' 2>/dev/null || printf '')"
  # 구분자가 없으면 파싱 실패 — env-빈 이름 + 원본 입력 유지.
  [[ "$out" != *$'\x1f'* ]] && return 0
  HOOK_TOOL_NAME="${out%%$'\x1f'*}"
  local inner="${out#*$'\x1f'}"
  [[ -n "$inner" ]] && HOOK_TOOL_INPUT="$inner"
  return 0
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

# _try_write_registry — call write_registry and log failure with context.
# v6.2.4 post-review: previously, all callers wrapped the call with
# `|| true`, so lock-contention failures silently skipped registry
# mutations (session registration, ownership updates, phase transitions
# could all vanish without trace). Now we log to the guard error log so
# at least the operator can investigate.
# Non-fatal: returns 1 on failure, but the caller is expected to keep
# going — PostToolUse hooks must never block.
# NOTE: RMW callers no longer use this — pairing it with an unlocked
# read_registry is exactly the lost-update bug the _registry_rmw helper (below)
# fixes. Kept only as a lock+log wrapper around a standalone write_registry.
_try_write_registry() {
  local json="$1" context="${2:-unknown}"
  if ! write_registry "$json"; then
    local err_log="${PROJECT_ROOT:-$PWD}/.claude/deep-work-guard-errors.log"
    mkdir -p "$(dirname "$err_log")" 2>/dev/null
    printf '%s write_registry failed (context: %s)\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)" \
      "$context" >> "$err_log" 2>/dev/null || true
    return 1
  fi
  return 0
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
  # find_project_root already emits a single sanitized line (even on its
  # not-found path). `|| true` absorbs its exit-1 so `set -e` callers don't
  # abort here; it replaces the old `|| echo "$PWD"`, which double-emitted on
  # not-found and produced a multi-line PROJECT_ROOT. `${…:-$PWD}` covers the
  # (rare) empty-output case.
  PROJECT_ROOT="$(find_project_root 2>/dev/null || true)"
  PROJECT_ROOT="$(sanitize_project_path "${PROJECT_ROOT:-$PWD}")"

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
#
# Concurrency model (RMW hardening): every registry mutation is a
# read-modify-write cycle. Previously each RMW caller did an UNLOCKED
# read_registry → node transform → LOCKED write_registry, so the lock never
# spanned the read: two concurrent sessions could read the same snapshot and
# the second write clobbered the first (lost update). The fix serializes the
# whole cycle under ONE lock hold:
#
#   _with_registry_lock <fn> …   — run <fn> while holding the registry lock
#   _read_registry_unlocked      — read only (NO lock, NO default-write)
#   _write_registry_unlocked     — atomic-rename write (NO lock)
#   _registry_rmw <ctx> <node> … — read→transform→write, all under one lock
#
# Re-entrancy: RMW callers MUST use the *_unlocked helpers, never the public
# read_registry/write_registry — those re-acquire the lock and would
# self-deadlock (the mkdir spinlock is not re-entrant; flock -w 2 would block
# then time out, silently dropping the mutation). The public wrappers are kept
# for existing external callers, unchanged.

_registry_default_json() {
  printf '%s' '{"version":1,"shared_files":["package.json","package-lock.json","tsconfig.json",".eslintrc.*","*.config.js","*.config.ts"],"sessions":{}}'
}

# Lock-free registry read. Returns the on-disk JSON, or the default when the
# file is absent — WITHOUT writing it (the default-write is a mutation and
# belongs under the lock; see read_registry). Callers needing mutual exclusion
# must already hold the lock (see _registry_rmw).
_read_registry_unlocked() {
  local registry_file="$PROJECT_ROOT/.claude/deep-work-sessions.json"
  if [[ -f "$registry_file" ]]; then
    cat "$registry_file"
  else
    _registry_default_json
  fi
}

# Lock-free registry write via atomic temp+rename. Caller MUST hold the lock.
_write_registry_unlocked() {
  local json="$1"
  local registry_file="$PROJECT_ROOT/.claude/deep-work-sessions.json"
  local tmp_file="${registry_file}.tmp.$$"
  mkdir -p "$(dirname "$registry_file")" 2>/dev/null
  printf '%s' "$json" > "$tmp_file" && mv "$tmp_file" "$registry_file"
}

# _with_registry_lock <fn> [args...]
# Runs `fn args...` while holding the registry lock, then releases it, and
# returns fn's exit status (or 1 if the lock can't be acquired). Uses flock
# when available, else the mkdir spinlock (NFS / macOS without flock).
# NOTE: on the flock path `fn` runs in a SUBSHELL, so it must persist results
# to the registry file on disk — not to shell variables.
_with_registry_lock() {
  local lock_path="$PROJECT_ROOT/.claude/deep-work-sessions.lock"
  mkdir -p "$(dirname "$lock_path")" 2>/dev/null

  if command -v flock >/dev/null 2>&1; then
    local rc=0
    (
      flock -w 2 9 || exit 1
      "$@"
    ) 9>"$lock_path" || rc=$?
    return $rc
  fi

  # mkdir-based spinlock fallback. Fail-closed: do NOT force-remove the lock
  # directory on timeout — that corrupted the registry under contention in
  # v6.2.3.
  if ! _acquire_lock "$lock_path" 20 0.05; then
    return 1
  fi
  local rc=0
  "$@" || rc=$?
  _release_lock "$lock_path"
  return $rc
}

# _registry_rmw <context> <node_transform> [node_args...]
# Atomically read-modify-write the registry under a single lock hold. The node
# transform receives the current registry JSON as argv[1] and node_args as
# argv[2..], and must print the updated registry JSON to stdout. Non-fatal:
# logs to the guard error log and returns 1 on failure (callers keep going —
# PostToolUse hooks must never block). Replaces the old read_registry +
# _try_write_registry pairing, which left the read outside the lock.
_registry_rmw() {
  local context="$1" transform="$2"
  shift 2
  if _with_registry_lock _registry_rmw_apply "$transform" "$@"; then
    return 0
  fi
  local err_log="${PROJECT_ROOT:-$PWD}/.claude/deep-work-guard-errors.log"
  mkdir -p "$(dirname "$err_log")" 2>/dev/null
  printf '%s registry RMW failed (context: %s)\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)" \
    "$context" >> "$err_log" 2>/dev/null || true
  return 1
}

# Runs UNDER the registry lock (invoked by _with_registry_lock). Reads
# lock-free, transforms via node, writes lock-free. Never call directly.
_registry_rmw_apply() {
  local transform="$1"
  shift
  local current updated
  current="$(_read_registry_unlocked)"
  updated="$(node -e "$transform" "$current" "$@")" || return 1
  _write_registry_unlocked "$updated"
}

read_registry() {
  local registry_file="$PROJECT_ROOT/.claude/deep-work-sessions.json"
  if [[ -f "$registry_file" ]]; then
    cat "$registry_file"
    return 0
  fi
  # Missing file: create the default under the lock (the default-write is a
  # mutation — doing it lock-free raced concurrent writers and could clobber a
  # registry another session had just created).
  _with_registry_lock _registry_create_default_if_absent
  if [[ -f "$registry_file" ]]; then
    cat "$registry_file"
  else
    _registry_default_json  # lock unavailable — still hand back valid JSON
  fi
}

_registry_create_default_if_absent() {
  local registry_file="$PROJECT_ROOT/.claude/deep-work-sessions.json"
  [[ -f "$registry_file" ]] && return 0  # double-check under the lock
  _write_registry_unlocked "$(_registry_default_json)"
}

write_registry() {
  local json="$1"
  _with_registry_lock _write_registry_unlocked "$json"
}

# ─── Session registration ──────────────────────────────────

register_session() {
  local session_id="$1"
  local pid="$2"
  local task_desc="$3"
  local work_dir="$4"

  _registry_rmw "register_session(${session_id})" '
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
  ' "$session_id" "$pid" "$task_desc" "$work_dir"
}

unregister_session() {
  local session_id="$1"

  _registry_rmw "unregister_session(${session_id})" '
    const data = JSON.parse(process.argv[1]);
    delete data.sessions[process.argv[2]];
    console.log(JSON.stringify(data));
  ' "$session_id"
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

  _registry_rmw "register_file_ownership(${session_id})" '
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
  ' "$session_id" "$file_path"
}

# ─── Activity & phase sync ─────────────────────────────────

update_last_activity() {
  local session_id="$1"

  _registry_rmw "update_last_activity(${session_id})" '
    const data = JSON.parse(process.argv[1]);
    const sid = process.argv[2];
    if (data.sessions[sid]) {
      data.sessions[sid].last_activity = new Date().toISOString();
    }
    console.log(JSON.stringify(data));
  ' "$session_id"
}

update_registry_phase() {
  local session_id="$1"
  local phase="$2"

  _registry_rmw "update_registry_phase(${session_id})" '
    const data = JSON.parse(process.argv[1]);
    const sid = process.argv[2];
    const phase = process.argv[3];
    if (data.sessions[sid]) {
      data.sessions[sid].current_phase = phase;
      data.sessions[sid].last_activity = new Date().toISOString();
    }
    console.log(JSON.stringify(data));
  ' "$session_id" "$phase"
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

  # 원자적 등록: registry RMW 를 단일 lock 안에서 수행 (read~write lost-update
  # 방지). session ID 기반 suffix이므로 번호 할당 race condition 없음.
  _registry_rmw "register_fork_session(${session_id})" '
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
  ' "$session_id" "$parent_id" "$fork_generation" "$task_desc" "$work_dir" "$restart_phase"

  # 부모 상태 파일 업데이트 (registry lock 밖 — 다른 파일이라 contention 없음)
  local parent_state="$PROJECT_ROOT/.claude/deep-work.${parent_id}.md"
  if [[ -f "$parent_state" ]]; then
    update_parent_fork_children "$parent_state" "$session_id" "$restart_phase"
  fi
}
