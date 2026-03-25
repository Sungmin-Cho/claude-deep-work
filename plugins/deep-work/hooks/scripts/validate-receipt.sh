#!/usr/bin/env bash
# validate-receipt.sh — CI/CD receipt chain validation
# Usage: validate-receipt.sh <work_dir>
# Exit codes: 0 = valid, 1 = invalid
#
# Note: $WORK_DIR is always the directory containing session-receipt.json,
# regardless of worktree mode. The caller passes the correct path.

set -euo pipefail

WORK_DIR="${1:-.}"
RECEIPTS_DIR="$WORK_DIR/receipts"
SESSION_RECEIPT="$WORK_DIR/session-receipt.json"

ERRORS=()
WARNINGS=()
CHECKS_PASSED=0
CHECKS_TOTAL=0

check() {
  local name="$1"
  local result="$2"
  CHECKS_TOTAL=$((CHECKS_TOTAL + 1))
  if [[ "$result" == "pass" ]]; then
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
  else
    ERRORS+=("$name: $result")
  fi
}

warn() {
  WARNINGS+=("$1")
}

# ─── Use node for JSON parsing (portable, no jq dependency) ──

json_field() {
  local file="$1"
  local field="$2"
  node -e "
    const fs = require('fs');
    try {
      const d = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      const keys = process.argv[2].split('.');
      let v = d;
      for (const k of keys) { v = v?.[k]; }
      console.log(v ?? '');
    } catch(e) { console.log(''); }
  " "$file" "$field" 2>/dev/null
}

json_validate() {
  local file="$1"
  node -e "
    const fs = require('fs');
    try {
      JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
      console.log('valid');
    } catch(e) {
      console.log('invalid: ' + e.message);
    }
  " "$file" 2>/dev/null
}

# ─── 1. Check session receipt ─────────────────────────────────

if [[ -f "$SESSION_RECEIPT" ]]; then
  VALID=$(json_validate "$SESSION_RECEIPT")
  check "session-receipt.json format" "$( [[ "$VALID" == "valid" ]] && echo "pass" || echo "$VALID" )"
else
  warn "session-receipt.json not found (optional — slice receipts are canonical)"
fi

# ─── 2. Check slice receipts ─────────────────────────────────

if [[ ! -d "$RECEIPTS_DIR" ]]; then
  check "receipts directory exists" "FAIL — $RECEIPTS_DIR not found"
  # Output summary and exit
  node -e "console.log(JSON.stringify({passed:$CHECKS_PASSED,total:$CHECKS_TOTAL,errors:$(node -e "console.log(JSON.stringify([$(printf '"%s",' "${ERRORS[@]}" | sed 's/,$//')]))")}))" 2>/dev/null || echo '{"passed":0,"total":1,"errors":["receipts directory missing"]}'
  exit 1
fi

RECEIPT_FILES=()
for f in "$RECEIPTS_DIR"/SLICE-*.json; do
  [[ -f "$f" ]] && RECEIPT_FILES+=("$f")
done

if [[ ${#RECEIPT_FILES[@]} -eq 0 ]]; then
  check "at least one slice receipt" "FAIL — no SLICE-*.json files found"
else
  check "at least one slice receipt" "pass"
fi

# ─── 3. Validate each slice receipt ──────────────────────────

VALID_TDD_STATES="PENDING RED RED_VERIFIED GREEN_ELIGIBLE GREEN REFACTOR SPIKE"

for receipt_file in "${RECEIPT_FILES[@]}"; do
  fname=$(basename "$receipt_file")

  # JSON valid?
  VALID=$(json_validate "$receipt_file")
  check "$fname JSON format" "$( [[ "$VALID" == "valid" ]] && echo "pass" || echo "$VALID" )"
  [[ "$VALID" != "valid" ]] && continue

  # Required fields
  SLICE_ID=$(json_field "$receipt_file" "slice_id")
  check "$fname has slice_id" "$( [[ -n "$SLICE_ID" ]] && echo "pass" || echo "FAIL — missing slice_id" )"

  TDD_STATE=$(json_field "$receipt_file" "tdd_state")
  if [[ -n "$TDD_STATE" ]]; then
    if echo "$VALID_TDD_STATES" | grep -qw "$TDD_STATE"; then
      check "$fname tdd_state valid" "pass"
    else
      check "$fname tdd_state valid" "FAIL — invalid state: $TDD_STATE"
    fi
  else
    check "$fname has tdd_state" "FAIL — missing tdd_state"
  fi

  # Schema version (v4.1+)
  SCHEMA_VER=$(json_field "$receipt_file" "schema_version")
  if [[ -z "$SCHEMA_VER" ]]; then
    warn "$fname: no schema_version (pre-v4.1 receipt)"
  fi

  # Test count sanity
  TESTS_PASSED=$(json_field "$receipt_file" "verification.full_test_suite")
  if [[ -n "$TESTS_PASSED" ]]; then
    check "$fname has test results" "pass"
  fi
done

# ─── 4. Cross-validation with session receipt ─────────────────

if [[ -f "$SESSION_RECEIPT" ]]; then
  SESSION_TOTAL=$(json_field "$SESSION_RECEIPT" "slices.total")
  ACTUAL_COUNT=${#RECEIPT_FILES[@]}
  if [[ -n "$SESSION_TOTAL" && "$SESSION_TOTAL" -gt 0 ]]; then
    if [[ "$ACTUAL_COUNT" -eq "$SESSION_TOTAL" ]]; then
      check "slice count matches session receipt" "pass"
    else
      check "slice count matches session receipt" "FAIL — session says $SESSION_TOTAL, found $ACTUAL_COUNT"
    fi
  fi
fi

# ─── 5. Output summary ────────────────────────────────────────

RESULT="pass"
[[ ${#ERRORS[@]} -gt 0 ]] && RESULT="fail"

node -e "
  const result = {
    result: '$RESULT',
    passed: $CHECKS_PASSED,
    total: $CHECKS_TOTAL,
    errors: $(printf '%s\n' "${ERRORS[@]}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(d.trim().split('\n').filter(Boolean))))" 2>/dev/null || echo '[]'),
    warnings: $(printf '%s\n' "${WARNINGS[@]}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(d.trim().split('\n').filter(Boolean))))" 2>/dev/null || echo '[]')
  };
  console.log(JSON.stringify(result, null, 2));
" 2>/dev/null || echo "{\"result\":\"$RESULT\",\"passed\":$CHECKS_PASSED,\"total\":$CHECKS_TOTAL}"

[[ "$RESULT" == "pass" ]] && exit 0 || exit 1
