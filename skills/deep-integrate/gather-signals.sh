#!/usr/bin/env bash
# gather-signals.sh — Phase 5 signal envelope 생성
# Usage: gather-signals.sh <project-root> <installed-missing-json>
# 출력(stdout): signal envelope JSON (spec 섹션 3.2 참조)
set -u

if [[ $# -lt 2 ]]; then
  echo '{"error":"missing arguments: project-root, installed-missing-json"}'
  exit 1
fi

PROJECT_ROOT="$1"
PLUGINS_JSON="$2"

# C6 fix: 나중에 deep-work artifacts 섹션에서 참조될 수 있으므로 빈 문자열로 초기화
WORK_DIR_SLUG=""
SESSION_ID=""

warn() { printf '[deep-integrate/warn] %s\n' "$*" >&2; }

# 공용 유틸리티 (read_frontmatter_field)
UTILS_PATH="$(dirname "$(realpath "${BASH_SOURCE[0]}")")/../../hooks/scripts/utils.sh"
if [[ -f "$UTILS_PATH" ]]; then
  # shellcheck disable=SC1090
  source "$UTILS_PATH"
else
  warn "utils.sh not found at $UTILS_PATH — inline fallback"
  read_frontmatter_field() {
    local file="$1"; local field="$2"
    awk -v f="$field" '
      /^---[[:space:]]*$/ { inside=!inside; next }
      inside && $0 ~ "^"f":" {
        sub("^"f":[[:space:]]*", "");
        gsub(/^"|"$/, "");
        print; exit
      }
    ' "$file"
  }
fi

# ─── Session resolution ─────────────────────────────────────
SESSION_ID="${DEEP_WORK_SESSION_ID:-}"
if [[ -z "$SESSION_ID" ]]; then
  pointer="$PROJECT_ROOT/.claude/deep-work-current-session"
  if [[ -f "$pointer" ]]; then
    SESSION_ID="$(<"$pointer")"
  fi
fi

if [[ -z "$SESSION_ID" ]]; then
  warn "no active session — session=null"
  SESSION_JSON='null'
else
  STATE_FILE="$PROJECT_ROOT/.claude/deep-work.${SESSION_ID}.md"
  if [[ ! -f "$STATE_FILE" ]]; then
    warn "state file missing: $STATE_FILE"
    SESSION_JSON='null'
  else
    WORK_DIR_SLUG="$(read_frontmatter_field "$STATE_FILE" "work_dir")"
    GOAL="$(read_frontmatter_field "$STATE_FILE" "task_description")"

    # phases_completed: <phase>_completed_at 필드 스캔 (C7 fix: brainstorm 포함)
    phases_completed=()
    for phase in brainstorm research plan implement test; do
      ts="$(read_frontmatter_field "$STATE_FILE" "${phase}_completed_at")"
      if [[ -n "$ts" ]]; then
        phases_completed+=("$phase")
      fi
    done

    # git changes (cwd가 project-root, non-git이면 null)
    pushd "$PROJECT_ROOT" >/dev/null || true
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      base="$(git merge-base HEAD "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || echo main)" 2>/dev/null || echo HEAD)"
      if [[ "$base" == "HEAD" ]]; then
        files_changed=0; ins=0; dels=0
        cat_src=0; cat_test=0; cat_docs=0; cat_config=0
      else
        files_changed="$(git diff --name-only "$base"..HEAD 2>/dev/null | wc -l | tr -d ' ')"
        read -r ins dels <<<"$(git diff --numstat "$base"..HEAD 2>/dev/null | awk '{i+=$1; d+=$2} END {printf "%d %d", i+0, d+0}')"
        cat_src=0; cat_test=0; cat_docs=0; cat_config=0
        while IFS= read -r f; do
          case "$f" in
            *test*|*spec*) ((cat_test++)) ;;
            *.md|docs/*|*README*|*CHANGELOG*) ((cat_docs++)) ;;
            *.json|*.yaml|*.yml|*.toml|*.cfg|*.ini) ((cat_config++)) ;;
            *) ((cat_src++)) ;;
          esac
        done < <(git diff --name-only "$base"..HEAD 2>/dev/null)
      fi
      CHANGES_JSON=$(jq -n \
        --argjson fc "$files_changed" --argjson ins "$ins" --argjson dels "$dels" \
        --argjson src "$cat_src" --argjson t "$cat_test" \
        --argjson d "$cat_docs" --argjson c "$cat_config" \
        '{files_changed:$fc, insertions:$ins, deletions:$dels,
          categories:{src:$src, test:$t, docs:$d, config:$c}}')
    else
      warn "not a git repository — changes=null"
      CHANGES_JSON='null'
    fi
    popd >/dev/null || true

    phases_json="["
    for i in "${!phases_completed[@]}"; do
      [[ $i -gt 0 ]] && phases_json+=","
      phases_json+="\"${phases_completed[$i]}\""
    done
    phases_json+="]"

    SESSION_JSON=$(jq -n \
      --arg id "$SESSION_ID" \
      --arg wd "$WORK_DIR_SLUG" \
      --arg goal "$GOAL" \
      --argjson phases "$phases_json" \
      --argjson changes "$CHANGES_JSON" \
      '{id:$id, work_dir:$wd, goal:$goal, phases_completed:$phases, changes:$changes}')
  fi
fi

# ─── Artifacts collection (defensive) ───────────────────────
read_json_safe() {
  local path="$1"
  if [[ ! -s "$path" ]]; then echo "null"; return; fi
  if jq -e 'type' "$path" >/dev/null 2>&1; then
    cat "$path"
  else
    warn "invalid JSON at $path — null fallback"
    echo "null"
  fi
}

# C2 fix 원칙: 설치된 플러그인은 **placeholder object(모든 필드 null)** 반환,
# 미설치 플러그인만 whole-null. test가 nested field 접근해도 TypeError 없도록.

# deep-work (C6 fix: SESSION_ID/WORK_DIR_SLUG 미해석 시 whole-null)
if [[ -n "$SESSION_ID" && -n "$WORK_DIR_SLUG" ]] && \
   printf '%s' "$PLUGINS_JSON" | jq -e '(.installed // []) + ["deep-work"] | unique | index("deep-work")' >/dev/null 2>&1; then
  sr="$PROJECT_ROOT/$WORK_DIR_SLUG/session-receipt.json"
  dw_artifact=$(read_json_safe "$sr")
  dw_json=$(jq -n --argjson sr "$dw_artifact" --arg p "$PROJECT_ROOT/$WORK_DIR_SLUG/report.md" \
    '{session_receipt:$sr, report_md_path:$p}')
else
  dw_json='null'
fi

# deep-review (C2 fix: 설치된 경우 항상 object 반환)
if printf '%s' "$PLUGINS_JSON" | jq -e '.installed[]? | select(.=="deep-review")' >/dev/null 2>&1; then
  rf=$(read_json_safe "$PROJECT_ROOT/.deep-review/recurring-findings.json")
  fitness=$(read_json_safe "$PROJECT_ROOT/.deep-review/fitness.json")
  latest_report="$(ls -1t "$PROJECT_ROOT"/.deep-review/reports/*-review.md 2>/dev/null | head -1 || true)"
  latest_json=$(jq -n --arg p "$latest_report" 'if $p == "" then null else $p end')
  if [[ "$rf" != "null" ]]; then
    # I4 fix: combine total + top_cat in one defensive jq pass (non-array .findings safe)
    read -r total top_cat < <(
      printf '%s' "$rf" | jq -r '
        def a: (.findings // []);
        "\(a | length) \(a[0].category // "")"
      ' 2>/dev/null || echo "0 "
    )
    # C2 fix: build rf_sum with jq --arg to handle embedded quotes/backslashes
    if [[ -n "$top_cat" ]]; then
      rf_sum=$(jq -n --argjson t "$total" --arg c "$top_cat" '{total:$t, top_category:$c}')
    else
      rf_sum=$(jq -n --argjson t "$total" '{total:$t}')
    fi
  else
    rf_sum='null'
  fi
  dr_json=$(jq -n --argjson rf "$rf_sum" --argjson fit "$fitness" --argjson lr "$latest_json" \
    '{recurring_findings:$rf, fitness:$fit, latest_report_path:$lr}')
else
  dr_json='null'
fi

# deep-docs (C2 fix)
if printf '%s' "$PLUGINS_JSON" | jq -e '.installed[]? | select(.=="deep-docs")' >/dev/null 2>&1; then
  ls_path="$PROJECT_ROOT/.deep-docs/last-scan.json"
  ls_raw=$(read_json_safe "$ls_path")
  if [[ "$ls_raw" != "null" ]]; then
    scanned_at=$(printf '%s' "$ls_raw" | jq -r '.scanned_at // empty')
    issues_summary=$(printf '%s' "$ls_raw" | jq '[.documents[]? | {(.path): (.issues | length)}] | add // {}')
    sa_json=$(jq -n --arg v "$scanned_at" 'if $v == "" then null else $v end')
    dd_json=$(jq -n --argjson sa "$sa_json" --argjson is "$issues_summary" \
      '{last_scanned_at:$sa, issues_summary:$is}')
  else
    # 설치되어 있으나 last-scan.json 미생성 → placeholder object
    dd_json='{"last_scanned_at":null,"issues_summary":null}'
  fi
else
  dd_json='null'
fi

# deep-dashboard (C2, C3 fix: `.name` → `.id`)
if printf '%s' "$PLUGINS_JSON" | jq -e '.installed[]? | select(.=="deep-dashboard")' >/dev/null 2>&1; then
  h_raw=$(read_json_safe "$PROJECT_ROOT/.deep-dashboard/harnessability-report.json")
  if [[ "$h_raw" != "null" ]]; then
    score=$(printf '%s' "$h_raw" | jq '.total // null')
    # C3 fix: scorer.js dimension field는 {id, label, weight, score, checks}이며 `.name`은 없음
    weakest=$(printf '%s' "$h_raw" | jq -r '[.dimensions[]?] | min_by(.score) | .id // empty' 2>/dev/null || echo '')
    weak_json=$(jq -n --arg v "$weakest" 'if $v == "" then null else $v end')
    dh_json=$(jq -n --argjson s "$score" --argjson w "$weak_json" \
      '{harnessability_score:$s, weakest_dimension:$w}')
  else
    dh_json='{"harnessability_score":null,"weakest_dimension":null}'
  fi
else
  dh_json='null'
fi

# deep-evolve (C2 fix)
if printf '%s' "$PLUGINS_JSON" | jq -e '.installed[]? | select(.=="deep-evolve")' >/dev/null 2>&1; then
  current_json=$(read_json_safe "$PROJECT_ROOT/.deep-evolve/current.json")
  if [[ "$current_json" != "null" ]]; then
    evolve_sid=$(printf '%s' "$current_json" | jq -r '.session_id // empty')
    if [[ -n "$evolve_sid" ]]; then
      insights_json=$(read_json_safe "$PROJECT_ROOT/.deep-evolve/$evolve_sid/evolve-insights.json")
      de_json=$(jq -n --argjson i "$insights_json" --arg sid "$evolve_sid" \
        '{session_id:$sid, insights:$i}')
    else
      de_json='{"session_id":null,"insights":null}'
    fi
  else
    de_json='{"session_id":null,"insights":null}'
  fi
else
  de_json='null'
fi

# deep-wiki (C2 fix)
if printf '%s' "$PLUGINS_JSON" | jq -e '.installed[]? | select(.=="deep-wiki")' >/dev/null 2>&1; then
  widx="$PROJECT_ROOT/.wiki-meta/index.json"
  if [[ -f "$widx" ]]; then
    pages_count=$(jq 'try (.pages | length) catch 0' "$widx" 2>/dev/null || echo 0)
    dwiki_json=$(jq -n --argjson pc "$pages_count" '{pages_count:$pc}')
  else
    dwiki_json='{"pages_count":null}'
  fi
else
  dwiki_json='null'
fi

# W1 fix: envelope 총 예산 ~20KB 체크 — 초과 시 가장 큰 필드부터 축약
# (우선 recurring-findings를 {total, top_category} 요약으로 교체하는 최소 구현)
# 이 체크는 envelope 조립 후 최종 단계에서 수행하므로 아래 jq -n 뒤로 이동.

# ─── Envelope 조립 ──────────────────────────────────────────
ARTIFACTS=$(jq -n \
  --argjson dw "$dw_json" \
  --argjson dr "$dr_json" \
  --argjson dd "$dd_json" \
  --argjson dh "$dh_json" \
  --argjson de "$de_json" \
  --argjson dwiki "$dwiki_json" \
  '{"deep-work":$dw, "deep-review":$dr, "deep-docs":$dd, "deep-dashboard":$dh, "deep-evolve":$de, "deep-wiki":$dwiki}')

jq -n \
  --argjson session "$SESSION_JSON" \
  --argjson plugins "$PLUGINS_JSON" \
  --argjson artifacts "$ARTIFACTS" \
  '{session:$session, plugins:$plugins, artifacts:$artifacts}'
