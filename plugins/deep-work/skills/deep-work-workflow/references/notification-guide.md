# Notification Guide

## 개요

Phase 완료 시 OS 네이티브 알림 + 외부 서비스로 알림 전송.

## 채널 설정

### 로컬 알림 (기본)
- macOS: osascript
- Linux: notify-send
- Windows: PowerShell toast

### Slack
Incoming Webhook URL 필요. Slack 앱 설정에서 생성.
```yaml
- type: slack
  webhook_url: "https://hooks.slack.com/services/T00/B00/xxxx"
```

### Discord
Webhook URL 필요. 서버 설정 → 연동 → 웹훅에서 생성.
```yaml
- type: discord
  webhook_url: "https://discord.com/api/webhooks/ID/TOKEN"
```

### Telegram
Bot Token과 Chat ID 필요.
```yaml
- type: telegram
  bot_token: "123456:ABC-DEF"
  chat_id: "-1001234567890"
```

### 커스텀 Webhook
범용 HTTP 엔드포인트.
```yaml
- type: webhook
  name: "CI Pipeline"
  url: "https://my-server.com/api/notify"
  method: "POST"
  headers:
    Authorization: "Bearer my-token"
  body_template: '{"event":"{{phase}}","status":"{{status}}"}'
```

변수: `{{phase}}`, `{{status}}`, `{{message}}`, `{{timestamp}}`, `{{task}}`

## 트러블슈팅

알림이 오지 않을 때:
```bash
curl -X POST "https://hooks.slack.com/services/..." -H 'Content-Type: application/json' -d '{"text":"test"}'
```

## 보안
- `.claude/deep-work.local.md`는 `.gitignore`에 포함
- Webhook URL과 토큰은 커밋되지 않음
