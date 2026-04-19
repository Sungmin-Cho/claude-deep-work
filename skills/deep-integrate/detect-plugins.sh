#!/usr/bin/env bash
# detect-plugins.sh — deep-suite 플러그인 설치 감지
# Usage: detect-plugins.sh [--plugins-root <path>]
# 출력(stdout): {"installed":[...],"missing":[...]}
# 실패 시: 낙관적 fallback (모두 installed로 가정) + stderr 경고
set -u

warn() {
  printf '[deep-integrate/warn] %s\n' "$*" >&2
}

PLUGINS_ROOT="${HOME}/.claude/plugins/cache"
TARGETS=(deep-review deep-evolve deep-docs deep-wiki deep-dashboard)
PLUGINS_ROOT_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plugins-root)
      if [[ $# -lt 2 || -z "$2" ]]; then
        warn "--plugins-root requires a non-empty value — ignoring, using default"
        shift $(( $# >= 2 ? 2 : 1 ))
      else
        PLUGINS_ROOT="$2"
        PLUGINS_ROOT_OVERRIDE="$2"
        shift 2
      fi
      ;;
    *) shift ;;
  esac
done

# v6.3.0 review W-R3: cache root 부재 시에도 alternate install 경로를 probing.
# `~/.claude/plugins/marketplaces/*`, `~/.claude/plugins/` 자체가 valid install일 수 있음.
# override 경로가 명시적으로 지정된 경우는 사용자 의도를 존중하여 해당 경로만 본다.
SEARCH_ROOTS=()
if [[ -n "$PLUGINS_ROOT_OVERRIDE" ]]; then
  [[ -d "$PLUGINS_ROOT_OVERRIDE" ]] && SEARCH_ROOTS+=("$PLUGINS_ROOT_OVERRIDE")
else
  for cand in "${HOME}/.claude/plugins/cache" "${HOME}/.claude/plugins/marketplaces" "${HOME}/.claude/plugins"; do
    [[ -d "$cand" ]] && SEARCH_ROOTS+=("$cand")
  done
fi

# v6.3.0 review W2: fail-closed. 어떤 install root도 찾지 못하면 installed=[]로 보고.
if [[ ${#SEARCH_ROOTS[@]} -eq 0 ]]; then
  warn "no plugin install root found (probed cache/marketplaces/plugins) — reporting all targets as missing"
  printf '{"installed":[],"missing":['
  for i in "${!TARGETS[@]}"; do
    [[ $i -gt 0 ]] && printf ','
    printf '"%s"' "${TARGETS[$i]}"
  done
  printf '],"detection_status":"cache-missing"}\n'
  exit 0
fi

installed=()
missing=()
for plugin in "${TARGETS[@]}"; do
  found=0
  for root in "${SEARCH_ROOTS[@]}"; do
    if find "$root" -maxdepth 3 -type d -name "$plugin" 2>/dev/null | grep -q .; then
      found=1; break
    fi
  done
  if [[ $found -eq 1 ]]; then
    installed+=("$plugin")
  else
    missing+=("$plugin")
  fi
done

# JSON 출력
printf '{"installed":['
for i in "${!installed[@]}"; do
  [[ $i -gt 0 ]] && printf ','
  printf '"%s"' "${installed[$i]}"
done
printf '],"missing":['
for i in "${!missing[@]}"; do
  [[ $i -gt 0 ]] && printf ','
  printf '"%s"' "${missing[$i]}"
done
printf ']}\n'
