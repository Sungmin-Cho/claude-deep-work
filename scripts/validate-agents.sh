#!/usr/bin/env bash
# validate-agents.sh — Static sanity check for agents/*.md frontmatter.
# Exit 0 if all agents pass; exit 1 if any agent fails (reports all failures).
set -eo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS_DIR="$PLUGIN_ROOT/agents"

if [ ! -d "$AGENTS_DIR" ]; then
  echo "[validate-agents] no agents/ directory — nothing to validate"
  exit 0
fi

errors=0

for agent in "$AGENTS_DIR"/*.md; do
  [ -f "$agent" ] || continue
  name=$(basename "$agent" .md)

  # 1. Frontmatter block exists (first line ---)
  if [ "$(head -n 1 "$agent")" != "---" ]; then
    echo "[FAIL] $name: first line must be '---'"
    errors=$((errors + 1)); continue
  fi

  fm=$(awk '/^---$/{n++; next} n==1{print}' "$agent")

  # 2. Required field: name
  if ! echo "$fm" | grep -qE '^name:[[:space:]]+[a-z][a-z0-9-]*$'; then
    echo "[FAIL] $name: missing or invalid 'name' field"
    errors=$((errors + 1)); continue
  fi

  # 3. description multiline
  if ! echo "$fm" | grep -qE '^description:[[:space:]]*\|'; then
    echo "[FAIL] $name: missing 'description:' multiline block"
    errors=$((errors + 1)); continue
  fi

  # 4. At least one <example>
  if ! grep -qE '<example>' "$agent"; then
    echo "[FAIL] $name: description must contain <example>"
    errors=$((errors + 1)); continue
  fi

  # 5. model: inherit (spec §5.8)
  if ! echo "$fm" | grep -qE '^model:[[:space:]]+inherit$'; then
    echo "[FAIL] $name: model must be 'inherit'"
    errors=$((errors + 1)); continue
  fi

  # 6. tools allowlist explicit
  if ! echo "$fm" | grep -qE '^tools:$'; then
    echo "[FAIL] $name: tools allowlist must be explicit"
    errors=$((errors + 1)); continue
  fi

  # 7. Agent-specific tool constraints (F3)
  case "$name" in
    research-codebase-worker)
      if echo "$fm" | grep -qE '^[[:space:]]*-[[:space:]]+(Bash|Edit|WebSearch|WebFetch)\b'; then
        echo "[FAIL] $name: must not allow Bash/Edit/WebSearch/WebFetch"
        errors=$((errors + 1)); continue
      fi
      ;;
    research-zerobase-worker)
      if echo "$fm" | grep -qE '^[[:space:]]*-[[:space:]]+(Bash|Edit)\b'; then
        echo "[FAIL] $name: must not allow Bash/Edit"
        errors=$((errors + 1)); continue
      fi
      if ! echo "$fm" | grep -qE '^[[:space:]]*-[[:space:]]+(WebSearch|WebFetch)\b'; then
        echo "[FAIL] $name: must allow WebSearch or WebFetch"
        errors=$((errors + 1)); continue
      fi
      ;;
    implement-slice-worker)
      if echo "$fm" | grep -qE '^[[:space:]]*-[[:space:]]+(WebSearch|WebFetch)\b'; then
        echo "[FAIL] $name: must not allow WebSearch/WebFetch"
        errors=$((errors + 1)); continue
      fi
      ;;
  esac

  echo "[OK]   $name"
done

if [ $errors -gt 0 ]; then
  echo "[validate-agents] $errors failure(s)"
  exit 1
fi
echo "[validate-agents] all agents valid"
