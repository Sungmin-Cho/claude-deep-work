#!/usr/bin/env bash
# detect-plugins.sh — deep-suite 플러그인 설치 감지
# Usage: detect-plugins.sh [--plugins-root <path>]
# 출력(stdout): {"installed":[...],"missing":[...]}
# 실패 시: 낙관적 fallback (모두 installed로 가정) + stderr 경고
set -u

PLUGINS_ROOT="${HOME}/.claude/plugins/cache"
TARGETS=(deep-review deep-evolve deep-docs deep-wiki deep-dashboard)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plugins-root) PLUGINS_ROOT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

warn() {
  printf '[deep-integrate/warn] %s\n' "$*" >&2
}

# 낙관적 fallback: plugins root 접근 불가 시 모든 플러그인을 installed로 간주
if [[ ! -d "$PLUGINS_ROOT" ]]; then
  warn "plugins root not found: $PLUGINS_ROOT — assuming all installed"
  printf '{"installed":['
  for i in "${!TARGETS[@]}"; do
    [[ $i -gt 0 ]] && printf ','
    printf '"%s"' "${TARGETS[$i]}"
  done
  printf '],"missing":[]}\n'
  exit 0
fi

installed=()
missing=()
for plugin in "${TARGETS[@]}"; do
  # marketplace 이름에 무관하게 cache root 하위 어디든 존재하면 installed
  if find "$PLUGINS_ROOT" -maxdepth 3 -type d -name "$plugin" 2>/dev/null | grep -q .; then
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
