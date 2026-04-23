#!/usr/bin/env bash
# verify-delegated-receipt.sh — Post-hoc receipt validation for delegated
# Implement phase (distinct from validate-receipt.sh which handles CI/CD
# session-receipt chain validation).
#
# Usage: verify-delegated-receipt.sh [--skip-items=N,M,...] [--only-completed]
#                                     <state_file> <receipts_dir> <plan_md_path>
# Exit 0 = all valid, 1 = validation failure.
set -eo pipefail

SKIP_ITEMS=""
ONLY_COMPLETED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-items=*) SKIP_ITEMS="${1#--skip-items=}"; shift ;;
    --only-completed) ONLY_COMPLETED=1; shift ;;
    --) shift; break ;;
    -*) echo "Unknown flag: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done

STATE_FILE="${1:?state_file required}"
RECEIPTS_DIR="${2:?receipts_dir required}"
PLAN_MD_PATH="${3:?plan_md_path required}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if ! command -v node >/dev/null 2>&1; then
  echo "[verify-delegated-receipt] ERROR: node not in PATH"
  exit 1
fi

node "$SCRIPT_DIR/verify-delegated-receipt-runner.js" \
     "$SCRIPT_DIR" "$STATE_FILE" "$RECEIPTS_DIR" "$PLAN_MD_PATH" \
     "$SKIP_ITEMS" "$ONLY_COMPLETED"
