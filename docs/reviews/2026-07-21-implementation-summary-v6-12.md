# v6.12 구현 요약 (implementation summary)

- **일자:** 2026-07-21
- **브랜치:** `worktree-v6-12-adaptive-routing` (base `aed7bb9` = v6.11.0)
- **정본 설계:** `docs/design/v6-12-adaptive-routing-unified-review.md` (design 3라운드 APPROVE)
- **정본 계획:** `docs/plans/2026-07-21-v6-12-adaptive-routing-plan.md` (plan 4라운드 APPROVE)
- **구현자:** Codex gpt-5.6-sol / effort medium (동일 스레드 resume, 배치 A-E) — worktree gitdir 샌드박스 제약으로 커밋은 orchestrator가 태스크별 수행
- **테스트:** `npm test` **1383 pass / 0 fail / 16 skip** (기준 v6.11: 1318) — 신규 테스트 +65
- **기존 테스트 무수정 예외:** E2(validate-receipt 테스트 강화)·E3(버전 assert) 2건만 사용. **E1(26종 risk matrix 기대값 갱신)은 미사용** — trigger 재설계가 기존 기대값 전건 보존.

## 태스크별 커밋

| 태스크 | 내용 | 커밋 |
|---|---|---|
| T0 | 결정론 routing-state carrier fixture 3종(engine-auto/pinned/legacy-nested) + 검증 테스트 | `18c6e22` |
| T2 | risk-runtime hard trigger 3부+iv 구조화 매칭(corpusWithPaths 폐기), `\|auth` 세그먼트 경계 — 인계 (a)+M4 | `7296c54` |
| T3 | validate-receipt.sh summary JSON argv off-by-one 수정 + 직접 assert — 인계 (c) | `d491804` |
| T4 | adaptive tier floor(상향 전용)+floorBaseline 단조성+meta.policy/efforts+sliceModelTierWithRisk+CLI 플래그+migration clobber 가드(R2-B1②) | `9b89ff8` |
| T5 | `--policy/--risk/--review` 플래그 파싱 (M8 1단계) | `f8a2284` |
| T1 | risk-profile-cli `--risk-only`/`--reuse-input`/`--state-file`+extractRoutingState — 인계 (b) | `b4e5fa7` |
| T6 | review-finding-runtime(severity 정규화·dedupe·verdict·persistence+legacy fallback) | `b5e37df` |
| T7 | review-policy-runtime(compileReviewPlan/evaluateReviewExecution/finishGateAllowed/detectReviewChannels) | `b17c8c1` |
| T8 | methodology_policy_json/review_execution_json round-trip + receipt optional 블록 | `1a458e8` |
| T9+T10 | 스킬 배선: init 3단계+스칼라 carrier 리더 8곳 전수 전환+direct-access 제거 / unified review 배선+shim 4건+이중 리뷰 제거+finishGateAllowed 게이트 (contract test 2건) | `34bbf8b` |
| T11 | codex-cli effort 적용(B.3 매핑 정본, 클램프·폴백 기록) | `26f5b5a` |
| T12 | v6.12.0 bump(3 manifests)+CHANGELOG en/ko+E3 | `99e5eb7` |

## 설계 §12 Exit criteria 대응

- Low/lean 문서 리뷰 structural 단독 — `compileReviewPlan` B.1 매트릭스 fixture ✅
- High/strict required dual 실패 fail-closed — `evaluateReviewExecution` oracle fixture ✅
- rounds_max 2 — 런타임 상수+fixture ✅
- reviewer failure/fallback/degraded state+receipt 기록 — `review_execution_json`+receipt optional 블록 round-trip ✅
- High/Critical tier floor + risk 부재 시 v6.10 동일 — 단조성 property+고정 clock 동일 회귀 ✅
- effort 기록+능력 게이트 폴백 — dispatcher fixture ✅
- codex 가용 시 high/critical `effort_applied:true` — T11 fixture ✅
- `evaluateReviewExecution` pause 판정 단위 테스트 — T7 ✅
- Critical human-gate+external_change_lock deep-finish 차단 — `finishGateAllowed`+T10 배선 ✅
- 인계 3건 회귀 고정 — T2/T1/T3 ✅
- `npm test` 전체 green(예외 2건 외 무수정) ✅

## 특기 사항

- 구현 중 설계·계획 모순 보고 0건 (codex 5개 배치 전부 무중단 완료)
- deep-work의 새 `evaluateReviewExecution`/`finishGateAllowed`는 finding 판정과 분리된 실행 판정 oracle로, "High fail-closed"가 단위 테스트로 강제됨
- 스칼라 carrier 전환은 리더 8곳 전수 + migration clobber 가드 + contract negative assert로 봉인
