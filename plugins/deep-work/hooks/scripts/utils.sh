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
      if [[ "$line" =~ ^${field}:[[:space:]]*(.+)$ ]]; then
        value="${BASH_REMATCH[1]}"
        value="${value%\"}" ; value="${value#\"}"
        value="${value%\'}" ; value="${value#\'}"
        break
      fi
    fi
  done < "$file"

  printf '%s' "$value"
}

# ─── Common state initialization ─────────────────────────────
# Sets PROJECT_ROOT, STATE_FILE, and optionally reads common fields.
# Usage: init_deep_work_state
# After calling: PROJECT_ROOT, STATE_FILE are set.

init_deep_work_state() {
  PROJECT_ROOT="$(find_project_root 2>/dev/null || echo "$PWD")"
  STATE_FILE="$PROJECT_ROOT/.claude/deep-work.local.md"
}
