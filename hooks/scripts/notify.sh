#!/usr/bin/env bash
# notify.sh — 멀티채널 알림 디스패처
# 사용법: bash notify.sh <state_file> <phase> <status> <message>
# 예시:   bash notify.sh .claude/deep-work.s-a3f7b2c1.md research completed "✅ Research 완료"

# notify.sh is best-effort — a single missing webhook field or unmatched
# grep in a pipeline must not abort the script. We keep -u (unset var check)
# and drop -e/pipefail because many grep pipelines below expect no-match
# gracefully. Each external action already has `|| true` guards.
set -u

STATE_FILE="${1:-.claude/deep-work.local.md}"  # caller passes session-specific path; legacy default kept for backward compat
PHASE="${2:-unknown}"
STATUS="${3:-completed}"
MESSAGE="${4:-Deep Work: ${PHASE} ${STATUS}}"
# Proper JSON escaping via Node.js (fallback to manual escape)
MESSAGE_ESCAPED=$(node -e "console.log(JSON.stringify(process.argv[1]).slice(1,-1))" "$MESSAGE" 2>/dev/null) \
  || { MESSAGE_ESCAPED="${MESSAGE//\\/\\\\}"; MESSAGE_ESCAPED="${MESSAGE_ESCAPED//\"/\\\"}"; }
TITLE="Deep Work"

# ─── Platform-specific escape helpers ────────────────────

# AppleScript string-literal escape: backslash + double-quote.
# Also strip control chars (osascript rejects them).
_osascript_escape() {
  local s="${1:-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s" | tr -d '\000-\011\013\014\016-\037'
}

# XML entity escape for Windows PowerShell toast XML.
_xml_escape() {
  local s="${1:-}"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  s="${s//\"/&quot;}"
  s="${s//\'/&apos;}"
  printf '%s' "$s"
}

# ─── 설정 읽기 ───────────────────────────────────────────

# notifications.enabled 확인 (기본: true). YAML-aware: parse the
# `notifications:` block specifically so that unrelated `enabled: false`
# under e.g. `team_mode:` does not suppress notifications.
NOTIFICATIONS_ENABLED=$(node -e '
  (() => {
    const fs = require("fs");
    const f = process.argv[1];
    try {
      const t = fs.readFileSync(f, "utf8");
      const m = t.match(/^notifications:\s*\n((?:\s{2,}.*\n?)+)/m);
      if (!m) { process.stdout.write("true"); return; }
      const e = m[1].match(/^\s{2}enabled:\s*(true|false)/m);
      process.stdout.write(e ? e[1] : "true");
    } catch(_) { process.stdout.write("true"); }
  })();
' "$STATE_FILE" 2>/dev/null || printf 'true')

if [[ "$NOTIFICATIONS_ENABLED" == "false" ]]; then
  exit 0
fi

# ─── 1. 로컬 알림 (항상 실행) ─────────────────────────────

send_local() {
  case "$(uname -s)" in
    Darwin)
      local _msg _title
      _msg="$(_osascript_escape "$MESSAGE")"
      _title="$(_osascript_escape "$TITLE")"
      osascript -e "display notification \"${_msg}\" with title \"${_title}\"" 2>/dev/null || true
      ;;
    Linux)
      # notify-send takes the message as argv, so no shell escape needed.
      command -v notify-send &>/dev/null && notify-send "${TITLE}" "${MESSAGE}" 2>/dev/null || true
      ;;
    MINGW*|MSYS*|CYGWIN*)
      local _msg_xml _title_xml
      _msg_xml="$(_xml_escape "$MESSAGE")"
      _title_xml="$(_xml_escape "$TITLE")"
      powershell.exe -NoProfile -Command "
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null
        \$t = '<toast><visual><binding template=\"ToastGeneric\"><text>${_title_xml}</text><text>${_msg_xml}</text></binding></visual></toast>'
        \$xml = New-Object Windows.Data.Xml.Dom.XmlDocument; \$xml.LoadXml(\$t)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Deep Work').Show([Windows.UI.Notifications.ToastNotification]::new(\$xml))
      " 2>/dev/null || true
      ;;
  esac
}

# ─── 2. Slack Webhook ────────────────────────────────────

send_slack() {
  local webhook_url="$1"
  local emoji="📋"
  [[ "$STATUS" == "completed" ]] && emoji="✅"
  [[ "$STATUS" == "failed" ]] && emoji="❌"

  curl -sS -X POST "$webhook_url" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"${emoji} *[Deep Work]* ${MESSAGE_ESCAPED}\",\"unfurl_links\":false}" \
    --max-time 5 2>/dev/null || true
}

# ─── 3. Discord Webhook ─────────────────────────────────

send_discord() {
  local webhook_url="$1"
  curl -sS -X POST "$webhook_url" \
    -H 'Content-Type: application/json' \
    -d "{\"content\":\"**[Deep Work]** ${MESSAGE_ESCAPED}\"}" \
    --max-time 5 2>/dev/null || true
}

# ─── 4. Telegram Bot API ────────────────────────────────

send_telegram() {
  local bot_token="$1"
  local chat_id="$2"
  curl -sS -X POST "https://api.telegram.org/bot${bot_token}/sendMessage" \
    -d "chat_id=${chat_id}" \
    -d "text=🔔 [Deep Work] ${MESSAGE}" \
    -d "parse_mode=Markdown" \
    --max-time 5 2>/dev/null || true
}

# ─── 5. 커스텀 Webhook ──────────────────────────────────

send_webhook() {
  local url="$1"
  local method="${2:-POST}"
  local headers="$3"
  local body_template="$4"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # body_template 변수 치환
  local body="$body_template"
  body="${body//\{\{phase\}\}/$PHASE}"
  body="${body//\{\{status\}\}/$STATUS}"
  body="${body//\{\{message\}\}/$MESSAGE_ESCAPED}"
  body="${body//\{\{timestamp\}\}/$timestamp}"
  body="${body//\{\{task\}\}/$TASK_DESC}"

  # body_template이 비어있으면 기본 JSON 생성
  if [[ -z "$body" ]]; then
    body="{\"phase\":\"${PHASE}\",\"status\":\"${STATUS}\",\"message\":\"${MESSAGE_ESCAPED}\",\"timestamp\":\"${timestamp}\"}"
  fi

  # curl 명령어 조립
  local curl_cmd=(curl -sS -X "$method" "$url" -H 'Content-Type: application/json' --max-time 5)

  # 커스텀 헤더 추가
  if [[ -n "$headers" ]]; then
    while IFS= read -r hdr; do
      [[ -n "$hdr" ]] && curl_cmd+=(-H "$hdr")
    done <<< "$headers"
  fi

  curl_cmd+=(-d "$body")
  "${curl_cmd[@]}" 2>/dev/null || true
}

# ─── 디스패치 ────────────────────────────────────────────

# task_description 읽기 (커스텀 웹훅의 {{task}} 변수용).
# grep 미매칭 시 `set -e`가 트리거되지 않도록 파이프라인 전체에 `|| true` 래핑.
TASK_DESC=$({ grep "^task_description:" "$STATE_FILE" 2>/dev/null || true; } | sed 's/task_description:[[:space:]]*"\(.*\)"/\1/' | head -1)

# 로컬은 항상 실행
send_local

# 외부 채널: state 파일에서 설정 추출하여 전송
SLACK_URL=$(grep -A1 "type: slack" "$STATE_FILE" 2>/dev/null | grep "webhook_url:" | sed 's/.*webhook_url:[[:space:]]*"\(.*\)"/\1/' | head -1)
DISCORD_URL=$(grep -A1 "type: discord" "$STATE_FILE" 2>/dev/null | grep "webhook_url:" | sed 's/.*webhook_url:[[:space:]]*"\(.*\)"/\1/' | head -1)
TELEGRAM_TOKEN=$(grep -A2 "type: telegram" "$STATE_FILE" 2>/dev/null | grep "bot_token:" | sed 's/.*bot_token:[[:space:]]*"\(.*\)"/\1/' | head -1)
TELEGRAM_CHAT=$(grep -A3 "type: telegram" "$STATE_FILE" 2>/dev/null | grep "chat_id:" | sed 's/.*chat_id:[[:space:]]*"\(.*\)"/\1/' | head -1)

[[ -n "$SLACK_URL" ]] && send_slack "$SLACK_URL"
[[ -n "$DISCORD_URL" ]] && send_discord "$DISCORD_URL"
[[ -n "$TELEGRAM_TOKEN" && -n "$TELEGRAM_CHAT" ]] && send_telegram "$TELEGRAM_TOKEN" "$TELEGRAM_CHAT"

# 커스텀 웹훅
WEBHOOK_URL=$(grep -A1 "type: webhook" "$STATE_FILE" 2>/dev/null | grep "url:" | sed 's/.*url:[[:space:]]*"\(.*\)"/\1/' | head -1)
WEBHOOK_METHOD=$(grep -A3 "type: webhook" "$STATE_FILE" 2>/dev/null | grep "method:" | sed 's/.*method:[[:space:]]*"\(.*\)"/\1/' | head -1)
WEBHOOK_BODY=$(grep -A10 "type: webhook" "$STATE_FILE" 2>/dev/null | grep "body_template:" | sed "s/.*body_template:[[:space:]]*'\(.*\)'/\1/" | head -1)

[[ -n "$WEBHOOK_URL" ]] && send_webhook "$WEBHOOK_URL" "${WEBHOOK_METHOD:-POST}" "" "$WEBHOOK_BODY"

# 항상 성공 (알림 실패가 Phase를 차단하면 안 됨)
exit 0
