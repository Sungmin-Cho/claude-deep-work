# Session discovery and session-ID assignment

> Reference for `skills/deep-work-orchestrator/SKILL.md`. Update check, legacy single-session migration, stale-session detection, active-session listing, session-ID generation. Read at §1-1/§1-2 of session init.

---

## 1-1. Update Check

SessionStart hook의 update-check.sh 출력 처리:
- `JUST_UPGRADED` → 업그레이드 완료 메시지, 계속 진행
- `UPGRADE_AVAILABLE` → AskUserQuestion으로 업그레이드 제안 (업그레이드 / 건너뜀)

## 1-2. 기존 세션 확인 (Multi-Session)

### Legacy 마이그레이션
`.claude/deep-work.local.md` 존재 + active → `migrate_legacy_state` 실행

### Stale 세션 감지
`detect_stale_sessions` → 각 stale 세션에 대해 AskUserQuestion:
1. 이어서 진행 → state 읽기 + worktree 확인 + artifact 복원 → **Step 3으로 jump**
2. 종료 처리 → idle 설정, registry 해제
3. 무시 → 계속

### Active 세션 목록
Registry에서 활성 세션 표시. 5개 이상이면 경고.

### 세션 ID 생성
```
SESSION_ID=$(generate_session_id)
write_session_pointer "$SESSION_ID"
```

## 1-3. 프로필 로드 + 플래그 파싱

