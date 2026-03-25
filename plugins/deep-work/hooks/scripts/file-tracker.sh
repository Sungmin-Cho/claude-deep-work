#!/usr/bin/env bash
# file-tracker.sh — PostToolUse hook: implement 단계 파일 변경 자동 추적 + receipt 수집
# v4.0: Bash 도구 지원, active slice에 변경 매핑, receipt JSON 업데이트
# Exit codes:
#   0 = always (PostToolUse hooks are informational only, never block)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

# ─── 프로젝트 루트 & 상태 파일 ──────────────────────────────

init_deep_work_state
STATE_FILE_NORM="$(normalize_path "$STATE_FILE")"

# 상태 파일이 없으면 즉시 종료
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── YAML frontmatter 파싱 ───────────────────────────────────

CURRENT_PHASE="$(read_frontmatter_field "$STATE_FILE" "current_phase")"
WORK_DIR="$(read_frontmatter_field "$STATE_FILE" "work_dir")"
ACTIVE_SLICE="$(read_frontmatter_field "$STATE_FILE" "active_slice")"

# implement 단계가 아니면 즉시 종료
if [[ "$CURRENT_PHASE" != "implement" ]]; then
  exit 0
fi

# work_dir이 비어있으면 종료
if [[ -z "$WORK_DIR" ]]; then
  exit 0
fi

# ─── 도구 입력 파싱 ──────────────────────────────────────────

TOOL_INPUT="$(cat)"
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"

FILE_PATH=""

if [[ "$TOOL_NAME" == "Bash" ]]; then
  # Bash 도구: command 필드에서 대상 파일 추출 시도 (best-effort)
  # file-changes.log에 명령 자체를 기록
  COMMAND=""
  if echo "$TOOL_INPUT" | grep -q '"command"'; then
    COMMAND="$(echo "$TOOL_INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  fi
  if [[ -n "$COMMAND" ]]; then
    FILE_PATH="[bash] $COMMAND"
  fi
else
  # Write/Edit/MultiEdit: file_path 추출
  if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
    FILE_PATH="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
  fi
fi

# file_path를 못 찾으면 종료
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# ─── 제외 대상 필터링 (Write/Edit만) ────────────────────────

if [[ "$TOOL_NAME" != "Bash" ]]; then
  PROJECT_ROOT_NORM="$(normalize_path "$PROJECT_ROOT")"
  FILE_PATH_NORM="$(normalize_path "$FILE_PATH")"

  RESOLVED_PATH_NORM="$FILE_PATH_NORM"
  if [[ "$FILE_PATH_NORM" =~ ^[A-Za-z]:/ ]] || [[ "$FILE_PATH_NORM" == /* ]]; then
    RESOLVED_PATH_NORM="$FILE_PATH_NORM"
  else
    RESOLVED_PATH_NORM="$(normalize_path "$PROJECT_ROOT_NORM/$FILE_PATH_NORM")"
  fi

  # deep-work/ 디렉토리 내 문서 파일 제외
  if [[ "$RESOLVED_PATH_NORM" == *"/deep-work/"* ]]; then
    exit 0
  fi
  # 상태 파일 자체 제외
  if [[ "$RESOLVED_PATH_NORM" == "$STATE_FILE_NORM" ]] || [[ "$RESOLVED_PATH_NORM" == *"/.claude/deep-work.local.md" ]]; then
    exit 0
  fi
fi

# ─── 파일 변경 로그에 기록 ───────────────────────────────────

LOG_DIR="$PROJECT_ROOT/$WORK_DIR"
LOG_FILE="$LOG_DIR/file-changes.log"

mkdir -p "$LOG_DIR" 2>/dev/null || true

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# v4.0: active slice 정보 포함
if [[ -n "$ACTIVE_SLICE" ]]; then
  echo "$TIMESTAMP [$ACTIVE_SLICE] $FILE_PATH" >> "$LOG_FILE" 2>/dev/null || true
else
  echo "$TIMESTAMP $FILE_PATH" >> "$LOG_FILE" 2>/dev/null || true
fi

# ─── v4.0: Receipt 디렉토리에 변경 기록 ─────────────────────

if [[ -n "$ACTIVE_SLICE" ]]; then
  RECEIPT_DIR="$LOG_DIR/receipts"
  RECEIPT_FILE="$RECEIPT_DIR/${ACTIVE_SLICE}.json"
  mkdir -p "$RECEIPT_DIR" 2>/dev/null || true

  # receipt 파일이 없으면 초기 생성
  if [[ ! -f "$RECEIPT_FILE" ]]; then
    cat > "$RECEIPT_FILE" 2>/dev/null <<RECEIPT || true
{
  "slice_id": "${ACTIVE_SLICE}",
  "status": "in_progress",
  "tdd_state": "PENDING",
  "tdd": {},
  "changes": {
    "files_modified": [],
    "lines_added": 0,
    "lines_removed": 0
  },
  "verification": {},
  "spec_compliance": {},
  "code_review": {},
  "debug": null,
  "timestamp": "${TIMESTAMP}"
}
RECEIPT
  fi

  # 파일 변경을 receipt의 changes.files_modified에 추가 (best-effort)
  # Node.js로 정확한 JSON 조작 — process.argv로 전달하여 injection 방지
  if command -v node &>/dev/null; then
    node -e "
      const fs = require('fs');
      const [,, receiptFile, filePath, ts] = process.argv;
      try {
        const r = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
        if (!r.changes) r.changes = { files_modified: [] };
        if (!r.changes.files_modified) r.changes.files_modified = [];
        if (!r.changes.files_modified.includes(filePath)) r.changes.files_modified.push(filePath);
        r.timestamp = ts;
        fs.writeFileSync(receiptFile, JSON.stringify(r, null, 2));
      } catch(e) {}
    " "$RECEIPT_FILE" "$FILE_PATH" "$TIMESTAMP" 2>/dev/null || true
  fi
fi

exit 0
