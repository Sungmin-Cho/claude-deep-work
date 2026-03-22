#!/usr/bin/env bash
# file-tracker.sh — PostToolUse hook: implement 단계 파일 변경 자동 추적
# Write/Edit/MultiEdit 완료 후 실행되어 변경된 파일 경로를 기록한다.
# Exit codes:
#   0 = always (PostToolUse hooks are informational only, never block)

set -euo pipefail

# ─── 유틸리티 (phase-guard.sh 재사용) ──────────────────────

normalize_path() {
  local p="$1"
  p="${p//\\//}"
  while [[ "$p" == *"//"* ]]; do
    p="${p//\/\//\/}"
  done
  printf '%s' "$p"
}

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

# ─── 프로젝트 루트 & 상태 파일 ─────────────────────────────

PROJECT_ROOT="$(find_project_root 2>/dev/null || echo "$PWD")"
STATE_FILE="$PROJECT_ROOT/.claude/deep-work.local.md"
STATE_FILE_NORM="$(normalize_path "$STATE_FILE")"

# 상태 파일이 없으면 워크플로우 비활성 → 즉시 종료
if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── YAML frontmatter에서 current_phase, work_dir 추출 ────

CURRENT_PHASE=""
WORK_DIR=""
IN_FRONTMATTER=false
while IFS= read -r line; do
  if [[ "$line" == "---" ]]; then
    if $IN_FRONTMATTER; then
      break
    else
      IN_FRONTMATTER=true
      continue
    fi
  fi
  if $IN_FRONTMATTER; then
    if [[ "$line" =~ ^current_phase:[[:space:]]*(.+)$ ]]; then
      CURRENT_PHASE="${BASH_REMATCH[1]}"
      CURRENT_PHASE="${CURRENT_PHASE%\"}"
      CURRENT_PHASE="${CURRENT_PHASE#\"}"
      CURRENT_PHASE="${CURRENT_PHASE%\'}"
      CURRENT_PHASE="${CURRENT_PHASE#\'}"
    fi
    if [[ "$line" =~ ^work_dir:[[:space:]]*(.+)$ ]]; then
      WORK_DIR="${BASH_REMATCH[1]}"
      WORK_DIR="${WORK_DIR%\"}"
      WORK_DIR="${WORK_DIR#\"}"
      WORK_DIR="${WORK_DIR%\'}"
      WORK_DIR="${WORK_DIR#\'}"
    fi
  fi
done < "$STATE_FILE"

# implement 단계가 아니면 추적 불필요 → 즉시 종료
if [[ "$CURRENT_PHASE" != "implement" ]]; then
  exit 0
fi

# work_dir이 비어있으면 종료
if [[ -z "$WORK_DIR" ]]; then
  exit 0
fi

# ─── 도구 입력에서 file_path 추출 ──────────────────────────

TOOL_INPUT="$(cat)"

FILE_PATH=""
if echo "$TOOL_INPUT" | grep -q '"file_path"'; then
  FILE_PATH="$(echo "$TOOL_INPUT" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"
fi

# file_path를 못 찾으면 종료
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# ─── 경로 정규화 & 제외 대상 필터링 ────────────────────────

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

# ─── 파일 변경 로그에 기록 ─────────────────────────────────

LOG_DIR="$PROJECT_ROOT/$WORK_DIR"
LOG_FILE="$LOG_DIR/file-changes.log"

# 작업 디렉토리가 없으면 생성
mkdir -p "$LOG_DIR" 2>/dev/null || true

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "$TIMESTAMP $FILE_PATH" >> "$LOG_FILE" 2>/dev/null || true

exit 0
