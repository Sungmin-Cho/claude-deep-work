#!/usr/bin/env bash
# phase-guard.sh — PreToolUse hook for deep-work v4.0 Evidence-Driven Protocol
#
# Bash fast path handles simple checks (~50ms).
# Complex logic (TDD state machine, Bash command analysis) delegates to Node.js (~200ms).
#
# Exit codes:
#   0 = allow the tool use
#   2 = block the tool use (with JSON reason on stdout)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/utils.sh"

init_deep_work_state

# ─── Session ID for multi-session ownership checks ──────────
CURRENT_SESSION_ID="${DEEP_WORK_SESSION_ID:-}"
if [[ -z "$CURRENT_SESSION_ID" ]]; then
  _PTR="$PROJECT_ROOT/.claude/deep-work-current-session"
  [[ -f "$_PTR" ]] && CURRENT_SESSION_ID="$(tr -d '\n\r' < "$_PTR")"
fi

# Helper: block with file ownership message and exit
block_ownership() {
  local fp="$1" result="$2"
  local parsed
  parsed="$(echo "$result" | node -e "
    process.stdin.setEncoding('utf8');let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{try{const o=JSON.parse(d);process.stdout.write((o.owner_session||'')+'|'+(o.task||''))}catch(e){process.stdout.write('|')}});
  " 2>/dev/null || echo "|")"
  local owner_sid="${parsed%%|*}"
  local owner_task="${parsed#*|}"
  local fp_esc owner_sid_esc owner_task_esc
  fp_esc="$(json_escape "$fp")"
  owner_sid_esc="$(json_escape "$owner_sid")"
  owner_task_esc="$(json_escape "$owner_task")"
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 이 파일은 다른 세션의 작업 영역입니다.\n\n세션: ${owner_sid_esc} (${owner_task_esc})\n파일: ${fp_esc}\n\n해당 세션에서 작업하거나, /deep-status --all로 세션 목록을 확인하세요."}
JSON
  exit 2
}

# ─── FAST PATH: No state file → allow everything ─────────────

if [[ ! -f "$STATE_FILE" ]]; then
  exit 0
fi

# ─── FAST PATH: Read phase from YAML frontmatter ─────────────

CURRENT_PHASE="$(read_frontmatter_field "$STATE_FILE" "current_phase")"
WORK_DIR="$(read_frontmatter_field "$STATE_FILE" "work_dir")"
TDD_MODE="$(read_frontmatter_field "$STATE_FILE" "tdd_mode")"
ACTIVE_SLICE="$(read_frontmatter_field "$STATE_FILE" "active_slice")"
TDD_STATE="$(read_frontmatter_field "$STATE_FILE" "tdd_state")"
TDD_OVERRIDE="$(read_frontmatter_field "$STATE_FILE" "tdd_override")"
SKIPPED_PHASES="$(read_frontmatter_field "$STATE_FILE" "skipped_phases")"
WORKTREE_ENABLED="$(read_frontmatter_field "$STATE_FILE" "worktree_enabled")"
WORKTREE_PATH="$(read_frontmatter_field "$STATE_FILE" "worktree_path")"
# Slice scope enforcement inputs (v6.2.4 — previously missing; scope check was no-op).
SLICE_FILES_JSON="$(read_frontmatter_list "$STATE_FILE" "slice_files")"
STRICT_SCOPE="$(read_frontmatter_field "$STATE_FILE" "strict_scope")"
EXEMPT_PATTERNS_JSON="$(read_frontmatter_list "$STATE_FILE" "exempt_patterns")"
# v6.3.0 review RC-1: Phase 5 Integrate markers (idle fast-path 안에서 read-only 모드 적용)
PHASE5_ENTERED_AT="$(read_frontmatter_field "$STATE_FILE" "phase5_entered_at")"
PHASE5_COMPLETED_AT="$(read_frontmatter_field "$STATE_FILE" "phase5_completed_at")"
# v6.3.0 review RC3-1: snapshot 기반 boundary. state file의 work_dir은 Phase 5 중 공격자에 의해
# 변조될 수 있으므로 Phase 5 진입 시점에 기록된 `phase5_work_dir_snapshot`을 enforcement 기준으로 사용.
# snapshot이 없으면 backward-compat로 `work_dir` 사용.
PHASE5_WORK_DIR_SNAPSHOT="$(read_frontmatter_field "$STATE_FILE" "phase5_work_dir_snapshot")"
WORK_DIR_REL="$(read_frontmatter_field "$STATE_FILE" "work_dir")"

# ─── Phase 5 detection (idle + entered + !completed) ────────
PHASE5_MODE=""
if [[ "$CURRENT_PHASE" == "idle" && -n "$PHASE5_ENTERED_AT" && -z "$PHASE5_COMPLETED_AT" ]]; then
  PHASE5_MODE="yes"
fi

# ─── FAST PATH: empty phase → allow ──────────────────────────
if [[ -z "$CURRENT_PHASE" ]]; then
  exit 0
fi

# ─── FAST PATH: idle (non-Phase-5) → allow ───────────────────
# Phase 5는 idle 상태를 유지하지만 read-only 제약이 있으므로 아래에서 별도 처리.
if [[ "$CURRENT_PHASE" == "idle" && -z "$PHASE5_MODE" ]]; then
  exit 0
fi

# ─── Phase 5 enforcement (v6.3.0 review RC-1/RC3-1/RC3-2/RC3-3) ─────
# Phase 5는 신호 수집·LLM 추론·루프 상태 업데이트만 수행한다. 쓰기 정책 (모드별):
# - Write/Edit/MultiEdit/NotebookEdit: work_dir 하위만 (exact 모드)
# - Bash write (redirect/mv DEST/cp/tee): work_dir 또는 TMPDIR 하위 (intermediate temp 허용)
# - Bash destructive (rm/chmod/chown/truncate) / mv SRC: work_dir 하위만 (TMPDIR 파괴 금지)
# State file은 어느 모드에서도 제외 — `phase5-finalize.sh` helper를 통해서만 기록 가능 (RC3-1).
# Boundary 기준: `phase5_work_dir_snapshot` (진입 시 기록된 불변 snapshot) — 런타임 state 변조 무력화.
# Destructive 명령은 변형(/bin/rm, \rm, command rm 등)을 정규화 후 검사 (RC3-2).
# Literal unresolved `$VAR` 또는 백틱 치환은 reject — SKILL은 expanded path를 사용 (RC3-3).
if [[ -n "$PHASE5_MODE" ]]; then
  _P5_INPUT="$(cat)"
  _P5_TOOL="${CLAUDE_TOOL_USE_TOOL_NAME:-${CLAUDE_TOOL_NAME:-}}"

  _PROJECT_ROOT_NORM="$(normalize_path "$PROJECT_ROOT")"
  # snapshot 우선 (RC3-1). snapshot 없으면 work_dir로 backward-compat.
  _P5_WORK_DIR_REL="$PHASE5_WORK_DIR_SNAPSHOT"
  [[ -z "$_P5_WORK_DIR_REL" ]] && _P5_WORK_DIR_REL="$WORK_DIR_REL"
  _WORK_DIR_ABS=""
  if [[ -n "$_P5_WORK_DIR_REL" ]]; then
    _WORK_DIR_ABS="$(normalize_path "$_PROJECT_ROOT_NORM/$_P5_WORK_DIR_REL")"
  fi

  # symlink resolution 포함 경로 정규화 (macOS /var ↔ /private/var 문제 회피).
  _p5_canonicalize() {
    local p="$1"
    [[ -z "$p" ]] && return
    node -e '
      const fs = require("fs"); const path = require("path");
      const p = process.argv[1];
      let out = p;
      try { out = fs.realpathSync.native(p); }
      catch(_) {
        try { out = path.join(fs.realpathSync.native(path.dirname(p)), path.basename(p)); }
        catch(_2) { out = p; }
      }
      process.stdout.write(out);
    ' "$p" 2>/dev/null || printf '%s' "$p"
  }

  _P5_WORK_DIR_CANON=""
  [[ -n "$_WORK_DIR_ABS" ]] && _P5_WORK_DIR_CANON="$(_p5_canonicalize "$_WORK_DIR_ABS")"
  # v6.3.0 review RC4-1 (fake helper attack): TMPDIR 쓰기 허용은 공격자가 가짜 helper를
  # /tmp에 작성 후 호출하는 bypass를 유발. 모든 legitimate mktemp/intermediate 쓰기는
  # helper (phase5-finalize.sh / phase5-record-error.sh) 내부에서 처리되므로 phase-guard가
  # generic TMPDIR 쓰기를 허용할 필요 없음. allowlist에서 제거.

  _p5_is_allowed_target() {
    local target="$1" mode="${2:-write}"
    [[ -z "$target" ]] && return 1
    # v6.3.0 review RC4-5: 정당한 quoted path(`"/tmp/mktemp.XXX"`, `'/path with space/foo'`)도
    # reject되어 legitimate 쓰기가 false-positive block되는 문제. 따옴표 unwrap 후 shell 변수/backtick만 검사.
    # shell expansion 공격은 변수($)와 command substitution(백틱)이 본체이므로 이 둘만 reject.
    # 1) 시작·끝의 matching 따옴표 pair를 unwrap:
    case "$target" in
      \"*\") target="${target#\"}"; target="${target%\"}" ;;
      \'*\') target="${target#\'}"; target="${target%\'}" ;;
    esac
    # 2) 남아있는 unresolved variable 또는 command substitution이면 reject:
    case "$target" in
      *'$'*|*'`'*) return 1 ;;
    esac
    local norm
    norm="$(normalize_path "$target")"
    if [[ "$norm" != /* && ! "$norm" =~ ^[A-Za-z]:/ ]]; then
      norm="$(normalize_path "$_PROJECT_ROOT_NORM/$norm")"
    fi
    local canon
    canon="$(_p5_canonicalize "$norm")"
    [[ -n "$_P5_WORK_DIR_CANON" && ( "$canon" == "$_P5_WORK_DIR_CANON" || "$canon" == "$_P5_WORK_DIR_CANON"/* ) ]] && return 0
    # mode 파라미터는 과거 정책의 잔재이나 현재 모든 모드에서 work_dir만 허용.
    # 명시적으로 `exact`/`write`/`destructive` 구분을 유지하여 향후 정책 재확장 시 훅이 명확.
    return 1
  }

  _p5_block() {
    local detail="$1"
    local reason_esc
    reason_esc="$(json_escape "⛔ Phase 5 (Integrate) 쓰기 제한: $detail. 허용: \$WORK_DIR 하위만. State file 수정은 phase5-finalize.sh helper, loop error 기록은 phase5-record-error.sh helper 경유.")"
    printf '{"decision":"block","reason":"%s"}\n' "$reason_esc"
    exit 2
  }

  # Destructive 명령의 변형(절대경로, \escape, command/exec/builtin wrapper)을 정규화.
  _p5_bash_normalize() {
    printf '%s' "$1" | node -e '
      let s = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", c => s += c);
      process.stdin.on("end", () => {
        let out = s;
        out = out.replace(/(^|[;&|\s(])(?:[A-Za-z0-9_./-]*\/)?(rm|rmdir|chmod|chown|truncate|mv|cp)\b/g, "$1$2");
        out = out.replace(/(^|[;&|\s(])\\(rm|rmdir|chmod|chown|truncate|mv|cp|ln|install)\b/g, "$1$2");
        out = out.replace(/(^|[;&|\s(])(?:command|exec|builtin)\s+(rm|rmdir|chmod|chown|truncate|mv|cp|ln|install)\b/g, "$1$2");
        // v6.3.0 review C9-1/C10-1: git global flags 정규화. `=` 형태와 공백 분리 형태 둘 다 커버.
        // `git -C /path commit`, `git --git-dir /p commit`, `git --work-tree /p add`, `git -c k=v push` 등 → `git commit/add/push`로 정규화.
        // v6.3.0 review W10-1: fixed-point iteration으로 무한 중첩 global flag 완전 흡수.
        while (true) {
          const prev = out;
          out = out.replace(/(^|[;&|\s(])git\s+(--git-dir=\S+|--git-dir\s+\S+|--work-tree=\S+|--work-tree\s+\S+|--namespace=\S+|--namespace\s+\S+|--exec-path=\S+|--exec-path\s+\S+|-C\s+\S+|-c\s+\S+|-p|-P|--no-pager|--bare|--no-replace-objects|--html-path|--man-path|--info-path|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs)(\s+)/g, "$1git$3");
          if (out === prev) break;
        }
        process.stdout.write(out);
      });
    ' 2>/dev/null || printf '%s' "$1"
  }

  # 주어진 token(rm/mv 등) 뒤에 오는 첫 non-flag 인자 추출. 따옴표 strip.
  _p5_extract_positional() {
    local cmd="$1" token="$2"
    printf '%s\n' "$cmd" | awk -v tok="$token" '
      {
        n = split($0, arr, /[ \t]+/)
        found = 0
        for (i = 1; i <= n; i++) {
          w = arr[i]
          gsub(/^["'"'"']|["'"'"']$/, "", w)
          if (!found) {
            if (w == tok) { found = 1; continue }
          } else {
            if (w ~ /^-/) continue
            print w
            exit
          }
        }
      }
    '
  }

  case "$_P5_TOOL" in
    Write|Edit|MultiEdit|NotebookEdit)
      _P5_TARGET="$(extract_file_path_from_json "$_P5_INPUT")"
      if _p5_is_allowed_target "$_P5_TARGET" "exact"; then
        exit 0
      fi
      _p5_block "${_P5_TOOL} 대상(${_P5_TARGET:-unknown})이 허용 영역 밖 (state file 포함)"
      ;;
    Bash)
      _P5_CMD="$(echo "$_P5_INPUT" | node -e "
        process.stdin.setEncoding('utf8');let d='';
        process.stdin.on('data',c=>d+=c);
        process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).command||'')}catch(e){}});
      " 2>/dev/null || echo "")"
      if [[ -z "$_P5_CMD" ]]; then
        exit 0
      fi

      # Phase 5 helper exception (v6.3.0 review RC4-1/RC4-3/RC5-1/RC6-1):
      # 허용 helper는 **canonical realpath**가 repo-owned 위치와 일치하는 경우만.
      # - 5차까지의 suffix-match(`[^[:space:]]*/skills/deep-integrate/...`)는 `$WORK_DIR/skills/deep-integrate/`에
      #   fake helper 작성 후 호출 시 bypass 허용했음 (RC6-1).
      # - 이제 script 경로를 추출하여 realpath한 뒤 plugin cache 또는 PROJECT_ROOT 하위의 정확한
      #   helper 파일과 동일한지 확인.
      case "$_P5_CMD" in
        *\;*|*'&&'*|*'||'*|*\|*|*'&'*|*'$'*|*'`'*|*'('*|*')'*|*'<'*|*'>'*|*$'\n'*|*$'\r'*) : ;;
        *)
          # helper 호출 형태 검출: `bash <path>.sh <args...>`
          if [[ "$_P5_CMD" =~ ^[[:space:]]*bash[[:space:]]+([^[:space:]]+)([[:space:]]+[^[:space:]]+)*[[:space:]]*$ ]]; then
            _P5_HELPER_RAW="${BASH_REMATCH[1]}"
            # script path가 phase5-finalize.sh 또는 phase5-record-error.sh로 끝나는 경우만 검증.
            case "$_P5_HELPER_RAW" in
              *phase5-finalize.sh|*phase5-record-error.sh)
                # 상대경로면 PROJECT_ROOT 기준 절대화 (realpath가 정확히 매치되도록).
                _P5_HELPER_ABS="$_P5_HELPER_RAW"
                case "$_P5_HELPER_ABS" in
                  /*) : ;;
                  *) _P5_HELPER_ABS="$_PROJECT_ROOT_NORM/$_P5_HELPER_ABS" ;;
                esac
                _P5_HELPER_CANON="$(_p5_canonicalize "$_P5_HELPER_ABS")"
                _P5_HELPER_BASENAME="$(basename "$_P5_HELPER_CANON")"
                # 허용되는 repo-owned helper 위치:
                # 1. $PROJECT_ROOT/skills/deep-integrate/<helper>.sh
                # 2. plugin cache 경로 (~/.claude/plugins/cache/.../skills/deep-integrate/<helper>.sh)
                _P5_EXPECTED_LOCAL_CANON="$(_p5_canonicalize "$_PROJECT_ROOT_NORM/skills/deep-integrate/$_P5_HELPER_BASENAME")"
                _P5_HELPER_OK=0
                if [[ "$_P5_HELPER_CANON" == "$_P5_EXPECTED_LOCAL_CANON" ]]; then
                  _P5_HELPER_OK=1
                else
                  # v6.3.0 review C7-1/C8-2: plugin cache 경로는 $HOME prefix anchored + 알려진 plugin ID로 제한.
                  # bash glob `*`의 `/` 포함 매치 및 임의 plugin에 대한 trust 위임을 원천 차단.
                  # 허용 plugin ID: `claude-deep-suite` (marketplace ID) 하위의 `deep-work` plugin만.
                  _P5_PLUGINS_CACHE_CANON="$(_p5_canonicalize "${HOME:-}/.claude/plugins/cache")"
                  if [[ -n "$_P5_PLUGINS_CACHE_CANON" && "$_P5_HELPER_CANON" == "$_P5_PLUGINS_CACHE_CANON"/claude-deep-suite/deep-work/*/skills/deep-integrate/"$_P5_HELPER_BASENAME" ]]; then
                    _P5_HELPER_OK=1
                  fi
                fi
                if [[ $_P5_HELPER_OK -eq 1 ]]; then
                  exit 0
                fi
                # suffix 매치하지만 canonical 경로 불일치 → fake helper일 가능성. 아래 interpreter 검사로 fallthrough.
                ;;
            esac
          fi
          ;;
      esac

      # v6.3.0 review C9-2: helper exception 이후 일반 Bash는 compound 연산자 금지.
      # `cp secret /etc/pwn && echo ok > $WORK_DIR/x` 처럼 첫 subcommand가 work_dir 밖 쓰기이고
      # 뒷 subcommand만 extractBashTargetFile에서 추출되어 통과하던 우회로 차단.
      # SKILL의 legitimate bash 호출은 단일 명령(+ redirect)만 사용하므로 영향 없음.
      case "$_P5_CMD" in
        *\;*|*'&&'*|*'||'*|*\|*|*'&'*)
          _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
          _p5_block "Phase 5 Bash에서 compound 연산자(';'·'&&'·'||'·'|'·'&') 금지 — 각 subcommand가 boundary 검증을 개별적으로 통과해야 안전. 명령=${_P5_CMD_SNIP}"
          ;;
      esac

      _P5_NORM="$(_p5_bash_normalize "$_P5_CMD")"

      # v6.3.0 review C10-2: Phase 5 Bash를 allowlist-only로 전환 (default-deny).
      # 이전 block-list 접근은 매 iteration 새 bypass 벡터 발견 → 수렴 불가. allowlist-only는
      # positive proof of safety 모델 — 허용된 command 이외는 자동 block.
      # 첫 command token(env prefix 스킵 후)이 허용 목록에 있는지 확인.
      # 허용되더라도 기존 layer(destructive target, write target, script canonical 등)로 추가 검증.
      _P5_FIRST_CMD="$(printf '%s' "$_P5_NORM" | awk '
        {
          n = split($0, arr, /[ \t]+/)
          for (i = 1; i <= n; i++) {
            w = arr[i]
            # env 변수 대입 skip (KEY=val bash cmd 형태)
            if (w ~ /^[A-Za-z_][A-Za-z0-9_]*=/) continue
            gsub(/^["'"'"']|["'"'"']$/, "", w)
            print w
            exit
          }
        }
      ')"

      # Phase 5 read-mostly allowlist.
      # - Pure read: cat/head/tail/wc/ls/pwd/file/stat/realpath/readlink/dirname/basename/grep/sort/uniq/diff/cut/paste/column/tr/tee/echo/printf/date/env/true/false/test/which/type/command/xxd/md5/sha256sum/sha1sum/md5sum
      # - Interpreters (additional canonical script check below): bash/sh/python/python2/python3/perl/ruby/node/awk/sed/php/osascript/tsx/deno/bun
      # - git (additional subcommand check): git
      # - find (additional flag check below): find
      # - filesystem ops with target check: mv/cp/mkdir/rm (work_dir 한정, 기존 layer)
      # - JSON/YAML read: jq/yq
      case "$_P5_FIRST_CMD" in
        # read-only filesystem/text commands — 무조건 허용 (추가 검증 불필요)
        cat|head|tail|wc|ls|pwd|file|stat|realpath|readlink|dirname|basename|grep|sort|uniq|diff|cut|paste|column|tr|tee|echo|printf|date|env|true|false|test|'['|which|type|command|xxd|md5|sha256sum|sha1sum|md5sum|jq|yq|du|:|hash|tput|tty|whoami|hostname|uname|id) ;;
        # find — flag 검사(아래)
        find) ;;
        # git — subcommand 검사(기존 block list + 아래 read-only allowlist)
        git) ;;
        # interpreters — 아래 canonical script 검사
        bash|sh|python|python2|python3|perl|ruby|node|awk|sed|php|osascript|tsx|deno|bun) ;;
        # filesystem ops — 기존 destructive/write target layer에서 검증
        rm|rmdir|chmod|chown|truncate|mv|cp|mkdir|touch|ln|install) ;;
        # read-only redirects without explicit command (e.g. `> /file`) — write target layer가 잡음
        '') ;;
        *)
          _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
          _p5_block "Phase 5 allowlist 외 명령(${_P5_FIRST_CMD}) — read-mostly boundary. 허용 목록: cat/head/tail/wc/ls/grep/find/git/jq/bash(helper)/interpreters(canonical). 명령=${_P5_CMD_SNIP}"
          ;;
      esac

      # find -delete/-exec 차단 (allowlist에 find 포함 but 위험한 flag 금지)
      if [[ "$_P5_FIRST_CMD" == "find" ]]; then
        if printf '%s' "$_P5_NORM" | grep -Eq '[[:space:]](-delete|-exec|-execdir|-ok|-okdir|-fprint|-fprintf|-fls)([[:space:]]|$)'; then
          _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
          _p5_block "find -delete/-exec/-ok 등 mutating flag 차단. 명령=${_P5_CMD_SNIP}"
        fi
      fi

      # jq -i / sed -i / awk -i inplace / perl -i 차단 (allowlist에 이들 포함 but in-place 쓰기 금지)
      # (기존 인터프리터 -c/-e 차단과 별개 — -i flag는 file mutation)
      if printf '%s' "$_P5_NORM" | grep -Eq '(^|[[:space:]])(jq|sed|perl|ruby)[[:space:]]+(-[^[:space:]]*i|--in-place)([[:space:]]|$)'; then
        _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
        _p5_block "인터프리터 in-place 쓰기 플래그(-i) 차단. 명령=${_P5_CMD_SNIP}"
      fi

      # git allowlist: read-only 서브커맨드. 기존 mutating block list는 아래에서 중복 검사 (defense-in-depth).
      if [[ "$_P5_FIRST_CMD" == "git" ]]; then
        _P5_GIT_SUB="$(printf '%s' "$_P5_NORM" | awk '
          {
            n = split($0, arr, /[ \t]+/)
            seen_git = 0
            for (i = 1; i <= n; i++) {
              w = arr[i]
              gsub(/^["'"'"']|["'"'"']$/, "", w)
              if (!seen_git) {
                if (w == "git") seen_git = 1
                continue
              }
              if (w ~ /^-/) continue
              print w
              exit
            }
          }
        ')"
        case "$_P5_GIT_SUB" in
          # read-only git subcommands (allowlist)
          status|diff|log|show|blame|grep|rev-parse|rev-list|merge-base|symbolic-ref|ls-files|ls-tree|branch|tag|config|describe|cat-file|fsck|shortlog|reflog|name-rev|for-each-ref|count-objects|verify-pack|check-ignore|check-attr|check-mailmap|check-ref-format|var|help|version|'') ;;
          *)
            _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
            _p5_block "git 서브커맨드 '${_P5_GIT_SUB}'는 Phase 5 read-only allowlist 밖. 명령=${_P5_CMD_SNIP}"
            ;;
        esac
      fi

      # 인터프리터 기반 파일 쓰기 — 정적 분석이 어려우므로 Phase 5에서 차단.
      # v6.3.0 review RC4-2 (was RC4-4): sh/bash -c 도 포함 (이전 regex가 누락).
      if printf '%s' "$_P5_NORM" | grep -Eq '\b(sh|bash|python[23]?|perl|ruby|node|awk|sed|php|osascript)[[:space:]]+-[A-Za-z]*[eEci]'; then
        _p5_block "인터프리터 기반 쓰기 시도 차단 (sh/bash/python/perl/ruby/node/awk/sed -e/-c)"
      fi

      # v6.3.0 review RC4-1/RC5-1/RC6-1/RC6-2 (fake helper + interpreter attack):
      # 모든 interpreter(bash/sh/python/perl/ruby/node) + script-file 호출을 canonical 경로 검증으로 제한.
      # helper exception이 이미 허용한 경우는 위에서 exit 0으로 종료됐으므로 여기까지 도달하지 못함.
      # 그 외 interpreter-with-script 호출은 `canonical realpath가 repo의 skills/deep-integrate/*.sh`
      # 와 일치하지 않으면 block. RC6-2 근거: `python /work_dir/pwn.py`처럼 write detect와 interpreter
      # -c flag 체크 모두 우회하던 경로를 막음.
      if printf '%s' "$_P5_CMD" | grep -Eq '(^|[;&|[:space:]])(bash|sh|python[23]?|perl|ruby|node|awk|tsx|deno|bun|php|osascript)[[:space:]]+[^[:space:]-][^[:space:]]*(\.sh|\.py|\.pl|\.rb|\.js|\.mjs|\.cjs|\.ts|\.tsx|\.awk|\.php|\.scpt|\.applescript)([[:space:]]|$)'; then
        # shell metacharacter 금지 (RC5-1)
        case "$_P5_CMD" in
          *'$('*|*'`'*|*'<('*|*'>('*|*$'\n'*|*$'\r'*)
            _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
            _p5_block "interpreter <script> 호출 argument에 command/process substitution·newline 금지. 명령=${_P5_CMD_SNIP}"
            ;;
        esac
        # script path 추출 후 canonical realpath 검증.
        _P5_IS_ALLOWED_SCRIPT=0
        _P5_SCRIPT_PATH="$(printf '%s' "$_P5_CMD" | awk '
          {
            n = split($0, arr, /[ \t]+/)
            for (i = 1; i <= n; i++) {
              w = arr[i]
              gsub(/^["'"'"']|["'"'"']$/, "", w)
              if (w ~ /^(bash|sh|python[23]?|perl|ruby|node|awk|tsx|deno|bun|php|osascript)$/) {
                # 다음 non-flag 토큰이 script path.
                for (j = i + 1; j <= n; j++) {
                  v = arr[j]
                  gsub(/^["'"'"']|["'"'"']$/, "", v)
                  if (v ~ /^-/) continue
                  print v
                  exit
                }
                exit
              }
            }
          }
        ')"
        if [[ -n "$_P5_SCRIPT_PATH" ]]; then
          # 상대경로면 PROJECT_ROOT 기준 절대화.
          _P5_SCRIPT_ABS="$_P5_SCRIPT_PATH"
          case "$_P5_SCRIPT_ABS" in
            /*) : ;;
            *) _P5_SCRIPT_ABS="$_PROJECT_ROOT_NORM/$_P5_SCRIPT_ABS" ;;
          esac
          _P5_SCRIPT_CANON="$(_p5_canonicalize "$_P5_SCRIPT_ABS")"
          _P5_SCRIPT_BASE="$(basename "$_P5_SCRIPT_CANON")"
          _P5_EXPECTED_DIR_CANON="$(_p5_canonicalize "$_PROJECT_ROOT_NORM/skills/deep-integrate")"
          _P5_SCRIPT_DIR_CANON="$(_p5_canonicalize "$(dirname "$_P5_SCRIPT_CANON")")"
          if [[ "$_P5_SCRIPT_DIR_CANON" == "$_P5_EXPECTED_DIR_CANON" ]]; then
            _P5_IS_ALLOWED_SCRIPT=1
          else
            # v6.3.0 review C7-1/C8-2: plugin cache 경로를 claude-deep-suite/deep-work만 허용.
            _P5_PLUGINS_CACHE_CANON="$(_p5_canonicalize "${HOME:-}/.claude/plugins/cache")"
            if [[ -n "$_P5_PLUGINS_CACHE_CANON" && "$_P5_SCRIPT_CANON" == "$_P5_PLUGINS_CACHE_CANON"/claude-deep-suite/deep-work/*/skills/deep-integrate/"$_P5_SCRIPT_BASE" ]]; then
              _P5_IS_ALLOWED_SCRIPT=1
            fi
          fi
        fi
        if [[ $_P5_IS_ALLOWED_SCRIPT -ne 1 ]]; then
          _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
          _p5_block "interpreter + script 실행은 repo의 skills/deep-integrate/*.sh 로만 제한. script=${_P5_SCRIPT_PATH:-unknown}, 명령=${_P5_CMD_SNIP}"
        fi
      fi

      # 파괴적 명령(rm/rmdir/chmod/chown/truncate) — 대상이 work_dir 밖이면 block (TMPDIR도 불가).
      for _dtok in rm rmdir chmod chown truncate; do
        if printf '%s' "$_P5_NORM" | grep -Eq "(^|[;&|[:space:]])${_dtok}([[:space:]]|\$)"; then
          _dtarget="$(_p5_extract_positional "$_P5_NORM" "$_dtok")"
          if _p5_is_allowed_target "$_dtarget" "destructive"; then
            continue
          fi
          _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
          _p5_block "파괴적 '${_dtok}' 대상(${_dtarget:-unknown})이 work_dir 밖. 명령=${_P5_CMD_SNIP}"
        fi
      done

      # v6.3.0 review C8-1: Phase 5 전용 mutating 명령 블록.
      # phase-guard-core.js의 SAFE_COMMAND_PATTERNS는 implement phase 기준이라 `git add/commit/stash`·`mkdir`·
      # `touch`·`ln`·`install`을 write로 감지하지 않음. Phase 5 read-mostly 계약을 위해 아래 명령들을
      # 추가 차단 (mkdir은 work_dir 하위 대상만 허용).
      if printf '%s' "$_P5_NORM" | grep -Eq '(^|[;&|[:space:]])git[[:space:]]+(add|commit|stash|checkout|merge|reset|rebase|cherry-pick|revert|apply|mv|rm|tag|push|fetch|pull|clean|am|format-patch|worktree|branch|submodule|notes|update-ref|update-index|write-tree|hash-object|bisect|replace|gc|prune|repack|reflog|remote|restore|switch|filter-branch|filter-repo)([[:space:]]|$)'; then
        _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
        _p5_block "git mutating 명령은 Phase 5에서 차단 (read-mostly). 명령=${_P5_CMD_SNIP}"
      fi
      if printf '%s' "$_P5_NORM" | grep -Eq '(^|[;&|[:space:]])(touch|ln|install|ditto|patch|unzip|gunzip)([[:space:]]|$)'; then
        _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
        _p5_block "파일시스템 mutating 명령(touch/ln/install 등) Phase 5에서 차단. 명령=${_P5_CMD_SNIP}"
      fi
      # tar/cpio 추출(`tar -xf`, `tar xf`)도 차단.
      if printf '%s' "$_P5_NORM" | grep -Eq '(^|[;&|[:space:]])(tar|cpio)([[:space:]]+.*[[:space:]]+)?[-]?[a-z]*x'; then
        _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
        _p5_block "tar/cpio 추출은 Phase 5에서 차단. 명령=${_P5_CMD_SNIP}"
      fi
      # mkdir: work_dir 하위 대상만 허용.
      if printf '%s' "$_P5_NORM" | grep -Eq '(^|[;&|[:space:]])mkdir([[:space:]]|$)'; then
        _mkdir_target="$(_p5_extract_positional "$_P5_NORM" "mkdir")"
        if ! _p5_is_allowed_target "$_mkdir_target" "destructive"; then
          _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
          _p5_block "mkdir 대상(${_mkdir_target:-unknown})이 work_dir 밖. 명령=${_P5_CMD_SNIP}"
        fi
      fi

      # 일반 쓰기 감지 (redirect/tee/sed -i/cp/mv/node writeFile 등).
      # v6.3.0 review RC5-2: 정규화된 명령(_P5_NORM)으로 detect/extract 호출해야 `/bin/cp`·`\cp`·`command mv`
      # 변형이 write pattern으로 인식됨. 이전 원본 `_P5_CMD` 사용은 정규화 후 destructive 토큰만 잡히고
      # 일반 write는 변형에서 통과하는 비대칭 우회를 유발.
      _P5_WRITE_PAT="$(printf '%s' "$_P5_NORM" | node -e "
        const {detectBashFileWrite}=require(process.argv[1]);
        let d='';process.stdin.on('data',c=>d+=c);
        process.stdin.on('end',()=>{
          const r=detectBashFileWrite(d);
          if(r.isFileWrite) process.stdout.write(r.pattern||'write');
        });
      " "$SCRIPT_DIR/phase-guard-core.js" 2>/dev/null || echo "")"

      if [[ -z "$_P5_WRITE_PAT" ]]; then
        exit 0  # read-only 명령 → 통과
      fi

      _P5_TARGET="$(printf '%s' "$_P5_NORM" | node -e "
        const {extractBashTargetFile}=require(process.argv[1]);
        let d='';process.stdin.on('data',c=>d+=c);
        process.stdin.on('end',()=>{const f=extractBashTargetFile(d); if(f) process.stdout.write(f);});
      " "$SCRIPT_DIR/phase-guard-core.js" 2>/dev/null || echo "")"

      if ! _p5_is_allowed_target "$_P5_TARGET" "write"; then
        _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
        _p5_block "쓰기 대상(${_P5_TARGET:-unknown})이 허용 영역 밖. 패턴=${_P5_WRITE_PAT}. 명령=${_P5_CMD_SNIP}"
      fi

      # mv/cp 추가 검증: SRC도 허용 영역이어야 (외부→내부 유출/삭제 방지, RC3-2 C-NEW-2).
      if printf '%s' "$_P5_NORM" | grep -Eq '(^|[;&|[:space:]])(mv|cp)([[:space:]]|$)'; then
        _P5_SRC="$(_p5_extract_positional "$_P5_NORM" "mv")"
        [[ -z "$_P5_SRC" ]] && _P5_SRC="$(_p5_extract_positional "$_P5_NORM" "cp")"
        if [[ -n "$_P5_SRC" ]] && ! _p5_is_allowed_target "$_P5_SRC" "write"; then
          _P5_CMD_SNIP="$(printf '%s' "$_P5_CMD" | head -c 180 | tr '\n' ' ')"
          _p5_block "mv/cp 원본(${_P5_SRC})이 허용 영역 밖 — 원본 유출/삭제 방지. 명령=${_P5_CMD_SNIP}"
        fi
      fi

      exit 0
      ;;
    *)
      exit 0
      ;;
  esac
fi

# ─── Read tool input from stdin ───────────────────────────────

TOOL_INPUT="$(cat)"

# Detect tool name from environment (set by hooks system)
TOOL_NAME="${CLAUDE_TOOL_USE_TOOL_NAME:-${CLAUDE_TOOL_NAME:-}}"

# ─── File path extraction (all phases, for worktree guard + ownership) ──
# NOTE: 파일 경로 추출은 CURRENT_SESSION_ID와 무관하게 실행해야 한다 (F-02).
# Session ID가 없어도 P0 worktree guard는 작동해야 하므로, 경로 추출을
# session ID 조건 밖으로 분리하고, ownership check만 session ID 안에 유지한다.
_OWN_FILE=""
if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "MultiEdit" ]]; then
  # Use JSON parser instead of regex — handles escaped quotes in file paths
  _OWN_FILE="$(extract_file_path_from_json "$TOOL_INPUT")"
elif [[ "$TOOL_NAME" == "Bash" ]]; then
  _BASH_CMD="$(echo "$TOOL_INPUT" | node -e "
    process.stdin.setEncoding('utf8');let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).command||'')}catch(e){}});
  " 2>/dev/null || echo "")"
  if [[ -n "$_BASH_CMD" ]]; then
    _OWN_FILE="$(printf '%s' "$_BASH_CMD" | node -e "
      const {detectBashFileWrite,extractBashTargetFile}=require(process.argv[1]);
      let d='';process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{
        const r=detectBashFileWrite(d);
        if(r.isFileWrite){const f=extractBashTargetFile(d);if(f)process.stdout.write(f);}
      });
    " "$SCRIPT_DIR/phase-guard-core.js" 2>/dev/null || echo "")"
  fi
fi

_OWN_FILE_NORM=""
if [[ -n "$_OWN_FILE" ]]; then
  _OWN_FILE_NORM="$(normalize_path "$_OWN_FILE")"
  if [[ "$_OWN_FILE_NORM" =~ ^[A-Za-z]:/ ]] || [[ "$_OWN_FILE_NORM" == /* ]]; then
    : # already absolute
  else
    _OWN_FILE_NORM="$(normalize_path "$(normalize_path "$PROJECT_ROOT")/$_OWN_FILE_NORM")"
  fi
fi

# Ownership check: implement phase + session ID required
if [[ -n "$CURRENT_SESSION_ID" && -n "$_OWN_FILE_NORM" ]]; then
  if [[ "$CURRENT_PHASE" == "implement" ]]; then
    OWNERSHIP_RESULT=""
    if ! OWNERSHIP_RESULT="$(check_file_ownership "$CURRENT_SESSION_ID" "$_OWN_FILE_NORM" 2>/dev/null)"; then
      block_ownership "$_OWN_FILE" "$OWNERSHIP_RESULT"
    fi
  fi
fi

# ─── P0: WORKTREE PATH ENFORCEMENT ─────────────────────────
# Blocks Write/Edit/Bash to files outside the active worktree path.
# Meta directories (.claude/, .deep-work/, .deep-review/, .deep-wiki/) are exempt.

if [[ "$WORKTREE_ENABLED" == "true" && -n "$WORKTREE_PATH" && -n "$_OWN_FILE_NORM" ]]; then
  WORKTREE_PATH_NORM="$(normalize_path "$WORKTREE_PATH")"

  if [[ "$_OWN_FILE_NORM" != "$WORKTREE_PATH_NORM"/* && "$_OWN_FILE_NORM" != "$WORKTREE_PATH_NORM" ]]; then
    # Meta directory exceptions — anchored to PROJECT_ROOT (C-3: prevents bypass via external .claude/ paths)
    _IS_META=false
    _PROJECT_ROOT_NORM="$(normalize_path "$PROJECT_ROOT")"
    for _meta_pat in ".claude/" ".deep-work/" ".deep-review/" ".deep-wiki/"; do
      if [[ "$_OWN_FILE_NORM" == "$_PROJECT_ROOT_NORM/$_meta_pat"* ]]; then
        _IS_META=true
        break
      fi
    done

    if [[ "$_IS_META" == "false" ]]; then
      _OWN_FILE_ESC="$(json_escape "$_OWN_FILE")"
      _WORKTREE_PATH_ESC="$(json_escape "$WORKTREE_PATH")"
      cat <<JSON
{"decision":"block","reason":"⛔ Worktree Guard: worktree 외부 파일 수정 차단\n\n대상: ${_OWN_FILE_ESC}\n허용 경로: ${_WORKTREE_PATH_ESC}/\n\nworktree 내에서 작업해주세요."}
JSON
      exit 2
    fi
  fi
fi

# ─── FAST PATH: implement phase, Write/Edit, relaxed mode ────

if [[ "$CURRENT_PHASE" == "implement" && "$TDD_MODE" == "relaxed" && "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# ─── FAST PATH: implement phase, spike mode → allow ──────────

if [[ "$CURRENT_PHASE" == "implement" && "$TDD_MODE" == "spike" ]]; then
  exit 0
fi

# ─── FAST PATH: implement phase, TDD override active → allow ─

if [[ "$CURRENT_PHASE" == "implement" && -n "$TDD_OVERRIDE" && "$TDD_OVERRIDE" == "$ACTIVE_SLICE" && "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# ─── FAST PATH: non-implement phase, Write/Edit → block ──────
# (research, plan, test, brainstorm) — same logic as v3.3.3

if [[ "$CURRENT_PHASE" != "implement" && "$TOOL_NAME" != "Bash" ]]; then
  # If current phase was skipped (v5.1 skip-to-implement), allow
  if [[ -n "$SKIPPED_PHASES" && ",${SKIPPED_PHASES}," == *",${CURRENT_PHASE},"* ]]; then
    exit 0
  fi

  # F-17: Use _OWN_FILE/_OWN_FILE_NORM from unified extraction above (no duplicate grep)
  # If no file_path: block for Write/Edit/MultiEdit (fail-closed), allow others
  if [[ -z "$_OWN_FILE" ]]; then
    if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "MultiEdit" ]]; then
      cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 현재 ${CURRENT_PHASE} 단계입니다. 파일 경로를 확인할 수 없어 차단되었습니다.\n\n다시 시도해주세요."}
JSON
      exit 2
    fi
    exit 0
  fi

  # Allow .deep-work/ directory and state file
  if [[ "$_OWN_FILE_NORM" == *"/.deep-work/"* ]]; then
    exit 0
  fi
  if [[ "$_OWN_FILE_NORM" == *"/.claude/deep-work."*".md" ]]; then
    exit 0
  fi

  # File ownership check (multi-session protection)
  if [[ -n "$CURRENT_SESSION_ID" ]]; then
    OWNERSHIP_RESULT=""
    if ! OWNERSHIP_RESULT="$(check_file_ownership "$CURRENT_SESSION_ID" "$_OWN_FILE_NORM" 2>/dev/null)"; then
      block_ownership "$_OWN_FILE" "$OWNERSHIP_RESULT"
    fi
  fi

  # Block with phase-specific message
  PHASE_LABEL=""
  NEXT_STEP=""
  case "$CURRENT_PHASE" in
    research)
      PHASE_LABEL="리서치(Research)"
      NEXT_STEP="리서치가 완료되면 /deep-plan을 실행하세요."
      ;;
    plan)
      PHASE_LABEL="기획(Plan)"
      NEXT_STEP="계획을 승인하면 자동으로 구현이 시작됩니다."
      ;;
    test)
      PHASE_LABEL="테스트(Test)"
      NEXT_STEP="테스트가 통과하면 세션이 자동 완료됩니다."
      ;;
    brainstorm)
      PHASE_LABEL="브레인스톰(Brainstorm)"
      NEXT_STEP="brainstorm.md를 승인하면 다음 단계로 진행됩니다."
      ;;
    *)
      PHASE_LABEL="$CURRENT_PHASE"
      NEXT_STEP="/deep-status로 현재 상태를 확인하세요."
      ;;
  esac

  _OWN_FILE_ESC="$(json_escape "$_OWN_FILE")"
  _PHASE_LABEL_ESC="$(json_escape "$PHASE_LABEL")"
  _NEXT_STEP_ESC="$(json_escape "$NEXT_STEP")"
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 현재 ${_PHASE_LABEL_ESC} 단계입니다. 코드 파일 수정이 차단되었습니다.\n\n수정 시도된 파일: ${_OWN_FILE_ESC}\n\n${_NEXT_STEP_ESC}"}
JSON
  exit 2
fi

# ─── COMPLEX PATH: delegate to Node.js ───────────────────────
# Reached when:
# - Bash tool in any non-idle phase (file write detection)
# - implement phase with strict/coaching TDD mode (TDD state machine)

# Build JSON input for Node.js using stdin pipe (safe: avoids set -e failure on argv approach).
# Pass slice_files/strict_scope/exempt_patterns too — previously omitted, leaving
# checkSliceScope a no-op (slice scope contract was silently unenforced).
NODE_INPUT=$(printf '%s' "$TOOL_INPUT" | node -e "
  process.stdin.setEncoding('utf8');
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    const a = process.argv;
    const buildState = () => {
      const tdd_override = a[6] === a[3] && a[6] !== '';
      let slice_files = []; try { slice_files = JSON.parse(a[7] || '[]'); } catch(_) {}
      let exempt_patterns = []; try { exempt_patterns = JSON.parse(a[9] || '[]'); } catch(_) {}
      return {
        current_phase: a[1],
        tdd_mode: a[2] || 'strict',
        active_slice: a[3] || '',
        tdd_state: a[4] || 'PENDING',
        tdd_override,
        slice_files,
        strict_scope: a[8] === 'true',
        exempt_patterns,
      };
    };
    try {
      const input = JSON.parse(d);
      console.log(JSON.stringify({ action: 'pre', toolName: a[5], toolInput: input, state: buildState() }));
    } catch(e) {
      console.log(JSON.stringify({ action: 'pre', toolName: a[5] || 'unknown', toolInput: {}, state: buildState() }));
    }
  });
" "$CURRENT_PHASE" "${TDD_MODE:-strict}" "$ACTIVE_SLICE" "${TDD_STATE:-PENDING}" "$TOOL_NAME" "${TDD_OVERRIDE:-}" "${SLICE_FILES_JSON:-[]}" "${STRICT_SCOPE:-false}" "${EXEMPT_PATTERNS_JSON:-[]}" 2>/dev/null || true)

# Call Node.js with error-code discipline (v6.2.4):
#   exit 0   → success; inspect decision on stdout (allow / warn / block)
#   exit 3   → internal Node error; stdout has a 내부 검증 오류 block message
#   other    → subprocess crash / OOM / timeout; emit generic block
NODE_ERR_LOG="$PROJECT_ROOT/.claude/deep-work-guard-errors.log"
set +e
NODE_RESULT=$(echo "$NODE_INPUT" | node "$SCRIPT_DIR/phase-guard-core.js" 2>>"$NODE_ERR_LOG")
NODE_RC=$?
set -e

if [[ $NODE_RC -eq 3 ]]; then
  # Internal error — Node already emitted the block JSON with the debug hint.
  printf '%s' "$NODE_RESULT"
  exit 2
fi

if [[ $NODE_RC -ne 0 ]]; then
  # Subprocess crash / unexpected exit — generic block.
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: hook 검증 중 오류가 발생했습니다.\n\n다시 시도해주세요. 문제가 지속되면 /deep-status로 상태를 확인하세요."}
JSON
  exit 2
fi

# Parse decision from Node.js output.
DECISION=$(echo "$NODE_RESULT" | grep -o '"decision"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"decision"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

if [[ -z "$DECISION" ]]; then
  # Fail-closed: malformed stdout or missing decision field.
  cat <<JSON
{"decision":"block","reason":"⛔ Deep Work Guard: 가드가 결정을 생성하지 못했습니다. 다시 시도해주세요."}
JSON
  exit 2
fi

if [[ "$DECISION" == "block" ]]; then
  # Extract reason (already JSON-escaped by Node).
  REASON=$(echo "$NODE_RESULT" | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const s=JSON.stringify(JSON.parse(d).reason||'');process.stdout.write(s.slice(1,-1))}catch(e){process.stdout.write('TDD enforcement가 이 수정을 차단했습니다.')}})" 2>/dev/null || echo "TDD enforcement가 이 수정을 차단했습니다.")
  cat <<JSON
{"decision":"block","reason":"${REASON}"}
JSON
  exit 2
fi

# allow or warn → exit 0
exit 0
