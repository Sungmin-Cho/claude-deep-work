#!/usr/bin/env bash
# phase5-finalize.sh — Phase 5 state file 쓰기를 제한된 helper로 캡슐화.
#
# v6.3.0 review RC3-1 대응: Phase 5는 idle 상태에서 state file 전체 쓰기가 필요한 것이 아니라
# 딱 하나, `phase5_completed_at` 필드만 기록하면 된다. phase-guard는 state file whitelist를
#제거했으므로 일반 Write/Edit으로는 쓸 수 없다. 이 helper 스크립트 호출만을 phase-guard가
# 허용함으로써, state file의 `work_dir` 등 다른 필드 변조를 원천 차단한다.
#
# Usage: phase5-finalize.sh <state-file> <phase5_completed_at-iso8601>
# 출력: stderr로 성공/실패 메시지, exit 0=success, exit 1=validation 실패, exit 2=write 실패.
#
# 제한:
# - state file 전체를 덮어쓰지 않는다. 기존 frontmatter를 읽어 `phase5_completed_at` 라인만
#   atomically 교체/추가한다.
# - 값은 ISO 8601 timestamp 형식(`YYYY-MM-DDThh:mm:ssZ` 또는 `...+00:00`)만 허용한다.
# - 실패 시 원본 파일은 건드리지 않는다 (tmp file 경유).

set -u

STATE_FILE="${1:-}"
ISO_TS="${2:-}"

err() { printf '[phase5-finalize] %s\n' "$*" >&2; }

if [[ -z "$STATE_FILE" ]]; then
  err "usage: phase5-finalize.sh <state-file> [<phase5_completed_at-iso8601>]"
  exit 1
fi

# v6.3.0 review RC7-X: ISO timestamp 인자가 비어있으면 내부에서 생성.
# SKILL.md Section 4 호출이 `$(date ...)` command substitution을 사용하면 Phase 5 guard가
# shell metacharacter로 block하므로, helper가 timestamp을 스스로 생성하도록 허용.
if [[ -z "$ISO_TS" ]]; then
  ISO_TS="$(date -u +%FT%TZ)"
fi

if [[ ! -f "$STATE_FILE" ]]; then
  err "state file not found: $STATE_FILE"
  exit 1
fi

# v6.3.0 review RC4-3: helper 자체가 임의 파일 쓰기 방지.
# 현재 세션의 state file 경로를 self-resolve하여 인자와 일치 여부 검증.
# 세션 해석 순서: DEEP_WORK_SESSION_ID env var → .claude/deep-work-current-session pointer.
# state file 경로 형식: <project-root>/.claude/deep-work.<session-id>.md
_expected_sid="${DEEP_WORK_SESSION_ID:-}"
if [[ -z "$_expected_sid" ]]; then
  # state file 경로에서 프로젝트 루트 추론 후 pointer 파일 read.
  _state_dir="$(cd "$(dirname "$STATE_FILE")" 2>/dev/null && pwd || true)"
  if [[ -n "$_state_dir" ]]; then
    _project_root="$(dirname "$_state_dir")"
    _ptr="$_project_root/.claude/deep-work-current-session"
    [[ -f "$_ptr" ]] && _expected_sid="$(tr -d '\n\r' < "$_ptr" 2>/dev/null || true)"
  fi
fi

# state file 경로가 `.claude/deep-work.<sid>.md` 패턴인지 확인.
_state_basename="$(basename "$STATE_FILE")"
if ! [[ "$_state_basename" =~ ^deep-work\.[A-Za-z0-9_-]+\.md$ ]]; then
  err "refusing: state file basename '$_state_basename' does not match 'deep-work.<sid>.md' pattern"
  exit 1
fi

# .claude 디렉토리에 위치하는지 확인.
_state_parent_dir="$(basename "$(dirname "$STATE_FILE")")"
if [[ "$_state_parent_dir" != ".claude" ]]; then
  err "refusing: state file not in .claude/ directory (got parent: $_state_parent_dir)"
  exit 1
fi

# expected session id가 있으면 정확한 매치 요구.
if [[ -n "$_expected_sid" ]]; then
  if [[ "$_state_basename" != "deep-work.$_expected_sid.md" ]]; then
    err "refusing: state file '$_state_basename' does not match current session '$_expected_sid'"
    exit 1
  fi
fi

# ISO 8601 형식 검증 (간단한 regex — 허용: YYYY-MM-DDThh:mm:ssZ, ...+/-hh:mm, ms 포함)
if ! [[ "$ISO_TS" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$ ]]; then
  err "invalid ISO 8601 timestamp: $ISO_TS"
  exit 1
fi

tmp="$(mktemp)" || { err "mktemp failed"; exit 2; }
trap 'rm -f "$tmp"' EXIT

# frontmatter에서 기존 phase5_completed_at 제거 후 새 값 추가.
# 구현: awk로 frontmatter 경계를 찾아 그 안에서만 치환.
awk -v ts="$ISO_TS" '
  BEGIN { in_fm=0; fm_end=0; added=0 }
  /^---[[:space:]]*$/ {
    if (in_fm == 0 && fm_end == 0) { in_fm=1; print; next }
    if (in_fm == 1) {
      # frontmatter 끝 직전에 phase5_completed_at 삽입 (없었다면)
      if (!added) { printf "phase5_completed_at: \"%s\"\n", ts; added=1 }
      in_fm=0; fm_end=1; print; next
    }
  }
  {
    if (in_fm && /^phase5_completed_at:/) {
      printf "phase5_completed_at: \"%s\"\n", ts
      added=1
      next
    }
    print
  }
' "$STATE_FILE" > "$tmp" || { err "awk processing failed"; exit 2; }

if ! [[ -s "$tmp" ]]; then
  err "produced empty output — refusing to overwrite state file"
  exit 2
fi

# v6.3.0 review W4-2 (was W4-4): frontmatter가 없는 파일에서 silent no-op 방지.
# awk가 `added=0`으로 종료 = frontmatter 구분자(`---`)를 못 찾음 → 실패로 처리.
if ! grep -qE '^phase5_completed_at:' "$tmp"; then
  err "refusing: phase5_completed_at was not written (no frontmatter detected?)"
  exit 2
fi

# atomic replace
mv "$tmp" "$STATE_FILE" || { err "mv failed"; exit 2; }
trap - EXIT

err "phase5_completed_at recorded: $ISO_TS"
exit 0
