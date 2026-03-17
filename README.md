# sseocho-plugins

Claude Code 플러그인 마켓플레이스.

## 플러그인 목록

| 플러그인 | 버전 | 설명 |
|----------|------|------|
| [deep-work](./plugins/deep-work/) | 3.1.0 | 4-phase workflow (Research → Plan → Implement → Test) with model routing, notifications, quality gates |

## 설치

```bash
claude plugin add sseocho --from github.com/Sungmin-Cho/sseocho-plugins
```

## v3.1.0 마이그레이션 안내

v3.1.0에서 저장소 구조가 변경되었습니다. 기존 사용자는 재설치가 필요합니다:

```bash
# 1. 기존 플러그인 제거
claude plugin remove deep-work

# 2. 재설치
claude plugin add sseocho --from github.com/Sungmin-Cho/sseocho-plugins
```

## 라이선스

MIT
