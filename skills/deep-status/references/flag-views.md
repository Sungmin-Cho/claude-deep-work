# `--all`, `--badge` and `--risk` views

> Reference for `skills/deep-status/SKILL.md`. The all-sessions dashboard, the shields.io quality badge, and the governed risk/policy view.

---

### 10. --all: All Sessions Dashboard + Everything

If `$ARGUMENTS` contains `--all`:

#### 10a. Multi-session dashboard

Read the registry (`.claude/deep-work-sessions.json`). If the registry exists and has sessions:

Display a table of all registered sessions:

```
📋 전체 세션 대시보드
━━━━━━━━━━━━━━━━━━━━━━━━━━

| 세션 ID | 작업 | Phase | 최근 활동 | 상태 | 소유 파일 |
|---------|------|-------|----------|------|----------|
| s-a3f7b2c1 | JWT 인증 구현 | implement | 5분 전 | ✅ 활성 | src/auth/**, src/middleware/jwt.ts |
| s-b8e2d4f0 | API 리팩토링 | plan | 2시간 전 | ⚠️ stale? | src/api/** |
| s-c1d3e5f7 | 테스트 추가 | idle | 1일 전 | 💤 완료 | — |

현재 세션: [current SESSION_ID or "없음"]
총 활성: [N]개 / 총 등록: [M]개
```

For each session:
- **상태**: Check PID liveness (`kill -0 PID 2>/dev/null`)
  - PID alive → `✅ 활성`
  - PID dead → `⚠️ stale?`
  - Phase is `idle` → `💤 완료`
- **최근 활동**: Relative time from `last_activity` field
- **소유 파일**: Abbreviated `file_ownership` list (max 3 items, then `+N more`)

If registry doesn't exist or has no sessions:
```
ℹ️ 등록된 세션이 없습니다.
```

#### 10b. Standard views

Then execute Steps 4 (default view for current session), 5 (session history), 6 (receipts dashboard), 7 (history trends), 8 (report), 9 (assumptions), 11 (tree), 12 (badge) in sequence.

---

### 12. --badge: Quality Badge

If `$ARGUMENTS` contains `--badge`:

1. Read `harness-sessions.jsonl` from `.deep-work/harness-history/` (shared path)
2. Calculate average quality score, session count, and average fidelity from finalized sessions
3. Generate shields.io badge markdown:

```
📛 Badges (copy to README.md):

![Deep Work Quality](https://img.shields.io/badge/deep--work-quality%20[score]%2F100-[color])
![Sessions](https://img.shields.io/badge/sessions-[count]-blue)
![Plan Fidelity](https://img.shields.io/badge/plan%20fidelity-[pct]%25-[color])
```

Color thresholds:
- 80+: brightgreen
- 60-79: green
- 40-59: yellow
- <40: red

If no finalized sessions exist:
```
ℹ️ Badge 생성을 위해 최소 1개의 완료된 세션이 필요합니다.
   /deep-work로 세션을 시작하고 완료하면 badge가 생성됩니다.
```

### 13. `--risk` — Governed Risk & Policy

For a v7 strict-spec session, do not parse independent state scalars. Invoke the
production dispatcher and render the returned canonical progress projection:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" receipt dashboard --state "$STATE_FILE"
```

The projection is the sole status/dashboard authority for plan identity,
methodology policy, evidence, residual risk, invalidations, findings, receipts,
replan state, and admission blockers. Report the command error and stop if governed
loading fails; never reconstruct or weaken a fail-closed result.

For a legacy session without strict-spec binding, use the compatibility display
below.

#### Legacy shadow display

If `$ARGUMENTS` contains `--risk`:

state에서 `risk_profile_json` / `policy_shadow_json` / `slice_risk_shadow_json` 스칼라를 읽어 `JSON.parse` 후 표시한다. 파싱 실패 시 경고 1줄 후 해당 블록 생략 (fail-open).

**3필드 모두 부재 시**: "이 세션은 risk shadow 데이터가 없습니다 (shadow 도입 이전 세션)" 출력 후 종료.

Policy 추천·Routing diff는 `policy_shadow_json`에 `authoritative`가 있으면 그것을, 없으면 `provisional`을 표시한다 (`based_on`으로 출처 표기).

표시 형식:

```text
🔍 Shadow Risk (관찰 전용 — 라우팅·게이트 무영향)
  Provisional:  <class> <score>/14 (confidence <val>) — <dimensions 중 0이 아닌 항목 요약>
  Authoritative: <class> <score>/14 (confidence <val>) | hard triggers: <각 항목의 `.id` 목록 또는 없음>
  History: <from> → <to> (<stage>, <reason>) — 항목별 1줄
  Policy 추천: <profile> | 리뷰: <review_policy.recommended> | 검증: <verification_policy.recommended>
  Routing diff (<based_on> 기준): phase별 1줄 — 일치 시 "= <tier>", 불일치 시 "<actual_tier> → 추천 <recommended_tier>", 제외 시 "(제외: <excluded_reason>)"
  Slice risk: SLICE-NNN <class> <score>/14 — 항목별 1줄 (없으면 생략)
  Errors: <stage>: <message> — 항목별 1줄 (없으면 생략)
```
