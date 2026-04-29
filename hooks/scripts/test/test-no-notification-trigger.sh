#!/bin/bash
set -euo pipefail
# Regression guard: verify notify.sh has been removed and no production hooks invoke it.
# Task 6 (v6.4.2) — Phase A notification system removal.
# Note: phase SKILL.md references are excluded (Task 7 scope).
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

result=$(grep -r "notify\.sh" \
  "$REPO_ROOT/hooks/scripts" \
  "$REPO_ROOT/commands" \
  "$REPO_ROOT/scripts" \
  --include="*.sh" --include="*.js" \
  --exclude-dir="test" 2>/dev/null || true | wc -l | tr -d ' ')

[[ "$result" == "0" ]] || { echo "FAIL — notify.sh 잔여 참조: $result"; exit 1; }
echo "PASS — notify.sh references in production scripts/hooks: 0"
