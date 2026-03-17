# sseocho-plugins

Claude Code Plugin Marketplace | Claude Code 플러그인 마켓플레이스

## Plugins | 플러그인

| Plugin | Version | Description |
|--------|---------|-------------|
| [deep-work](./plugins/deep-work/) | 3.1.0 | 4-phase workflow with model routing, notifications, quality gates |

**Documentation | 문서**:
- [English](./plugins/deep-work/README.en.md)
- [한국어](./plugins/deep-work/README.md)

## Installation | 설치

```bash
claude plugin add sseocho --from github.com/Sungmin-Cho/sseocho-plugins
```

## v3.1.0 Migration | 마이그레이션

Repository structure changed in v3.1.0. Existing users must reinstall:

v3.1.0에서 저장소 구조가 변경되었습니다. 기존 사용자는 재설치가 필요합니다:

```bash
# Remove existing | 기존 플러그인 제거
claude plugin remove deep-work

# Reinstall | 재설치
claude plugin add sseocho --from github.com/Sungmin-Cho/sseocho-plugins
```

## License | 라이선스

MIT
