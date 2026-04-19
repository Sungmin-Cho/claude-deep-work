#!/usr/bin/env bash
# phase5-record-error.sh — Phase 5 defensive error marker (v6.3.0 review RC4-2).
#
# /deep-finish --skip-integrate 경로에서 `integrate-loop.json`의 terminated_by가 null이면
# atomically "error"로 교체한다. 파일 부재 시 최소 구조로 새로 작성한다.
# Phase 5 guard가 `phase-guard.sh`의 helper exception으로 이 스크립트 호출을 단일 명령으로
# 허용하므로, deep-finish가 single Bash tool call로 호출한다. 내부의 mktemp + mv 같은 중첩
# write 패턴은 이 helper 안에 캡슐화되어 guard의 literal-variable reject 검사를 우회 가능.
#
# Usage: phase5-record-error.sh <work-dir-absolute>
# 요구사항:
# - work-dir는 절대 경로이며 실제로 존재하는 디렉토리여야 함.
# - helper는 $work_dir/integrate-loop.json 만 수정한다 (다른 파일 쓰기 금지).
# - 세션 ID는 DEEP_WORK_SESSION_ID 환경변수에서 resolve (없으면 .claude pointer fallback).

set -u

err() { printf '[phase5-record-error] %s\n' "$*" >&2; }

# v6.3.0 review W5-2: jq 의존성 preflight. 없는 환경에서 silent fail 대신 명시적 에러.
if ! command -v jq >/dev/null 2>&1; then
  err "refusing: jq not found on PATH — Phase 5 helpers require jq"
  exit 1
fi

WORK_DIR="${1:-}"
if [[ -z "$WORK_DIR" ]]; then
  err "usage: phase5-record-error.sh <work-dir-absolute>"
  exit 1
fi

if [[ ! -d "$WORK_DIR" ]]; then
  err "work_dir does not exist: $WORK_DIR"
  exit 1
fi

# 절대 경로 요구 (상대경로 전달 차단).
case "$WORK_DIR" in
  /*) : ;;
  *) err "work_dir must be absolute path (got: $WORK_DIR)"; exit 1 ;;
esac

# v6.3.0 review RC5-3: helper가 phase-guard의 마지막 방어선이므로 인자가 실제 세션 work_dir
# snapshot과 일치하는지 검증. state file의 phase5_work_dir_snapshot을 읽어 비교한다.
# 이 검증으로 `bash phase5-record-error.sh /tmp/evil` 같은 임의 디렉토리 호출을 차단.
# v6.3.0 review C10-3: project root 도출을 `dirname(dirname(WORK_DIR))` 2-level 가정에서
# `.claude` 디렉토리 walk-up으로 변경 — nested fork 세션(`.deep-work/sessions/<...>/sub`)에서도 정확.
SESSION_ID="${DEEP_WORK_SESSION_ID:-}"
_pr=""
_cur="$WORK_DIR"
while [[ -n "$_cur" && "$_cur" != "/" ]]; do
  if [[ -d "$_cur/.claude" ]]; then
    _pr="$_cur"
    break
  fi
  _parent="$(dirname "$_cur")"
  [[ "$_parent" == "$_cur" ]] && break
  _cur="$_parent"
done
# fallback: 2-level up (v6.2.x compat)
[[ -z "$_pr" ]] && _pr="$(dirname "$(dirname "$WORK_DIR")")"
if [[ -z "$SESSION_ID" ]]; then
  _ptr="$_pr/.claude/deep-work-current-session"
  [[ -f "$_ptr" ]] && SESSION_ID="$(tr -d '\n\r' < "$_ptr" 2>/dev/null || true)"
fi

if [[ -z "$SESSION_ID" ]]; then
  err "refusing: cannot resolve current session ID (no DEEP_WORK_SESSION_ID env, no pointer)"
  exit 1
fi

_state_file="$_pr/.claude/deep-work.${SESSION_ID}.md"
if [[ ! -f "$_state_file" ]]; then
  err "refusing: state file not found for session '$SESSION_ID' (expected $_state_file)"
  exit 1
fi

# state file에서 snapshot 읽기. frontmatter awk 파서.
_snapshot_rel="$(awk '
  /^---[[:space:]]*$/ { in_fm=!in_fm; next }
  in_fm && /^phase5_work_dir_snapshot:/ {
    sub(/^phase5_work_dir_snapshot:[[:space:]]*/, "")
    gsub(/^"|"$|^'"'"'|'"'"'$/, "")
    print; exit
  }
' "$_state_file" 2>/dev/null || true)"

# v6.3.0 review RC7-Y: validator에서 결정된 work_dir relative를 fallback file 작성 시 재사용하도록 변수 통일.
_resolved_wd_rel=""
if [[ -n "$_snapshot_rel" ]]; then
  _expected_abs="$_pr/$_snapshot_rel"
  # 경로 정규화 및 canonical 비교 (symlink 포함).
  _got_canon="$(cd "$WORK_DIR" 2>/dev/null && pwd -P || echo "$WORK_DIR")"
  _exp_canon="$(cd "$_expected_abs" 2>/dev/null && pwd -P || echo "$_expected_abs")"
  if [[ "$_got_canon" != "$_exp_canon" ]]; then
    err "refusing: work_dir argument ($WORK_DIR) does not match session snapshot ($_expected_abs)"
    exit 1
  fi
  _resolved_wd_rel="$_snapshot_rel"
else
  # backward-compat: snapshot 필드 없는 v6.2.x 세션은 state file의 work_dir로 fallback 검증.
  _wd_rel="$(awk '
    /^---[[:space:]]*$/ { in_fm=!in_fm; next }
    in_fm && /^work_dir:/ {
      sub(/^work_dir:[[:space:]]*/, "")
      gsub(/^"|"$|^'"'"'|'"'"'$/, "")
      print; exit
    }
  ' "$_state_file" 2>/dev/null || true)"
  if [[ -z "$_wd_rel" ]]; then
    err "refusing: state has neither phase5_work_dir_snapshot nor work_dir"
    exit 1
  fi
  _expected_abs="$_pr/$_wd_rel"
  _got_canon="$(cd "$WORK_DIR" 2>/dev/null && pwd -P || echo "$WORK_DIR")"
  _exp_canon="$(cd "$_expected_abs" 2>/dev/null && pwd -P || echo "$_expected_abs")"
  if [[ "$_got_canon" != "$_exp_canon" ]]; then
    err "refusing: work_dir ($WORK_DIR) does not match state work_dir ($_expected_abs) — no snapshot available"
    exit 1
  fi
  _resolved_wd_rel="$_wd_rel"
fi

LOOP_FILE="$WORK_DIR/integrate-loop.json"

if [[ -f "$LOOP_FILE" ]]; then
  # 기존 loop 파일: terminated_by가 null이면 "error"로 교체.
  tb="$(jq -r '.terminated_by // "null"' "$LOOP_FILE" 2>/dev/null || echo "null")"
  if [[ "$tb" == "null" ]]; then
    tmp="$(mktemp "${TMPDIR:-/tmp}/phase5-record-error.XXXXXX")" || { err "mktemp failed"; exit 2; }
    if jq '.terminated_by = "error"' "$LOOP_FILE" > "$tmp" 2>/dev/null; then
      mv "$tmp" "$LOOP_FILE" || { err "mv failed"; rm -f "$tmp"; exit 2; }
      err "recorded terminated_by=error in $LOOP_FILE"
    else
      rm -f "$tmp"
      err "jq modification failed — loop file preserved"
      exit 2
    fi
  else
    err "terminated_by already set ($tb) — no change"
  fi
else
  # 파일 부재: skill이 Section 2(loop init) 전에 실패한 경우. 최소 구조로 작성.
  tmp="$(mktemp "${TMPDIR:-/tmp}/phase5-record-error.XXXXXX")" || { err "mktemp failed"; exit 2; }
  iso="$(date -u +%FT%TZ)"
  # v6.3.0 review RC7-Y: loop-state.json schema는 work_dir을 required로 정의 → 누락 방지.
  # validator에서 이미 검증된 `_resolved_wd_rel` 사용.
  if jq -n --arg id "${SESSION_ID}" --arg ts "$iso" --arg wd "$_resolved_wd_rel" \
    '{session_id:$id, work_dir:$wd, entered_at:$ts, loop_round:0, max_rounds:5,
      executed:[], last_recommendations:null, terminated_by:"error"}' > "$tmp" 2>/dev/null; then
    mv "$tmp" "$LOOP_FILE" || { err "mv failed"; rm -f "$tmp"; exit 2; }
    err "created new $LOOP_FILE with terminated_by=error"
  else
    rm -f "$tmp"
    err "jq construction failed"
    exit 2
  fi
fi

exit 0
