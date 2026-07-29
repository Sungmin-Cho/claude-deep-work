# Native Goal Plan — deep-work v6.14 → v7.0

## Goal

`docs/research/2026-07-20-claude-deep-work-risk-adaptive-evidence-gated-improvement-proposal-ko.md`의 v6.13 이후 잔여 로드맵을 구현한다. 기존 deep-loop orchestration은 사용하지 않는다. Codex native goal이 아래 체크포인트와 증명 게이트를 직접 관리한다.

Baseline:

- project: `/Users/sungmin/Dev/claude-plugins/deep-work`
- main: `892a61bb9143a19d4cf0907b2846e21b94ce9b33`
- version: `6.13.0`
- verified proof command: `npm test`

## Global invariants

- `main`에 직접 구현 커밋이나 merge를 하지 않는다.
- push, PR 생성, publish, remote merge, marketplace pin 변경은 사람의 새 승인 전까지 하지 않는다.
- `~/.claude/plugins/`와 `~/.codex/plugins/cache/`를 수정하지 않는다.
- `.deep-work/`, `.deep-loop/`, 기존 worktree와 사용자 소유 산출물을 삭제하거나 초기화하지 않는다.
- 테스트 삭제, 검증 약화, fail-closed 경로의 fail-open 전환으로 green을 만들지 않는다.
- public/runtime contract 변경은 backward compatibility 또는 명시적 migration과 함께 제공한다.
- production dispatcher/state/storage/reader 경로를 증명하고 helper-only green을 완료 증거로 인정하지 않는다.
- 기존 dirty/untracked 상태를 보존하고 작업 파일만 명시적으로 stage한다.

## Checkpoint 0 — Preserve and establish authority

- 세 worktree와 branch/head/dirty 상태를 기록한다.
- v6.14 기존 spec과 review artifact를 현재 source of truth로 사용한다.
- v6.14의 open executability findings `EXE-B-001`, `EXE-M-004`를 재현 가능한 source evidence로 고정한다.
- 각 phase 시작 전 대상 worktree와 범위를 다시 확인한다.

Exit:

- worktree 손실 없음
- 기존 artifact 변경 전 baseline 확인
- 작업 대상과 금지 대상 명시

## Checkpoint 1 — v6.14 correct-RED, stop-and-replan, canonical visibility

Target:

- branch: `worktree-v6-14-tdd-replan`
- worktree: `.claude/worktrees/v6-14-tdd-replan`

Sequence:

1. `EXE-B-001`을 해소한다.
   - bootstrap authorization이 first RED slice/spec digest를 사전 결속한다.
   - crash-open `RED_VERIFIED`가 production admission을 통과하지 못하도록 completed bridge/adoption/proof authority를 인증한다.
2. `EXE-M-004`를 해소한다.
   - closed release environment와 digest preimage를 정의한다.
   - deterministic release checker별 fact/blocking schema와 authenticated input locator/preimage를 정의한다.
3. structural/semantic/executability 재검토에서 동일 artifact digest 기준 전부 `APPROVE`를 확보한다.
4. 승인된 spec으로 slice plan을 만들고 의미 있는 RED → GREEN → REFACTOR를 수행한다.
5. public dispatcher 경로를 통해 다음을 구현·증명한다.
   - versioned deterministic correct-RED classifier와 immutable RedProof
   - inline/delegated completion의 동일 proof authority
   - authenticated idempotent stop-and-replan과 stale-authority invalidation
   - scoped-write accept-or-replan recovery
   - evidence/residual-risk/replan/findings의 단일 governed projection
6. v6.14.0 version surfaces, 양 언어 CHANGELOG, 필요한 사용자 문서를 동기화한다.

Exit:

- open spec/review findings 0
- v6.14 focused production-route tests green
- `npm test` green
- `.codex-plugin/plugin.json` JSON parse green
- package/plugin manifests all `6.14.0`
- branch-local atomic commits와 PR-ready report

## Checkpoint 2 — v7 adaptive core

Target:

- branch: `worktree-v7-adaptive-core`
- worktree: `.claude/worktrees/v7-adaptive-core`

Sequence:

1. v6.14의 검증된 contract를 기준으로 v7 design/spec/plan을 작성하고 독립 review를 수렴한다.
2. Spec을 정식 phase로 승격하되 legacy `subphase: spec` 세션을 읽을 수 있게 한다.
3. profile v4 parser, validator, migration, v3 fallback을 구현한다.
4. methodology policy를 권위 라우터로 만들고 기존 model router를 compatibility facade로 축소한다.
5. state/receipt/resume/finish가 policy/spec/plan/evidence hash drift를 fail-closed로 처리한다.
6. fixture/property/integration tests로 risk monotonicity, hard trigger, override floor, cross-runtime model-name isolation을 증명한다.

Exit:

- explicit Spec phase와 profile v4 production route green
- legacy profile/session/receipt compatibility green
- methodology authority 단일화 및 model-router facade tests green
- focused tests와 `npm test` green
- branch-local atomic commits와 integration-ready report

## Checkpoint 3 — v7 integration, context, review envelope, cleanup, reporting

Target:

- branch: `worktree-v7-adaptive-integration`
- worktree: `.claude/worktrees/v7-adaptive-integration`

Sequence:

1. 검증된 v6.14와 v7 core commit을 이 integration branch에 로컬 통합한다. `main`은 변경하지 않는다.
2. Codex compaction-first와 명시적 task/fork 이유를 포함하는 context-policy runtime을 정식화한다.
3. cross-plugin review request/receipt envelope와 backward-compatible adapters를 구현한다.
4. 중복 review reference의 실행 권위를 제거하고 compatibility shim과 사용자 설명만 유지한다.
5. status/report/dashboard projection에 residual risk, evidence completeness, canonical findings, replan state를 같은 governed bytes에서 표시한다.
6. proposal의 Definition of Done 전 항목을 executable test 또는 explicit compatibility evidence에 매핑한다.
7. v7.0.0 version surfaces, 양 언어 CHANGELOG, README/guide marker 범위를 저장소 문서 규칙에 맞게 동기화한다.

Exit:

- v7 focused production-route and migration tests green
- cross-runtime and restart/resume integration tests green
- duplicate authority scan에서 실행 계약 중복 0
- report/dashboard와 enforcement projection digest 일치
- `npm test` green
- package/plugin manifests all `7.0.0`
- branch-local atomic commits와 PR-ready report

## Checkpoint 4 — Final independent verification

- 각 worktree에서 변경 파일, commit, dirty 상태를 보고한다.
- 각 release branch에서 focused commands와 `npm test`를 새로 실행한다.
- `.codex-plugin/plugin.json`과 `.claude-plugin/plugin.json`을 parse하고 버전 일치를 확인한다.
- proposal §24 Definition of Done 체크리스트를 evidence path/test/commit에 매핑한다.
- unresolved finding, skipped required gate, missing receipt/evidence, unexplained dirty file이 있으면 goal을 완료하지 않는다.
- 외부 release action은 실행하지 않고 정확한 push/PR/marketplace 후속 제안만 남긴다.

## Native goal completion contract

Success requires all of the following:

1. Checkpoints 0–4 complete.
2. v6.14 and v7 integration branches each have review-converged, production-route implementation evidence.
3. Verified `npm test` passes at the final head of every release-bearing branch.
4. Required manifests/docs/versions are internally consistent.
5. Proposal §24 Definition of Done is fully mapped with no unexplained unmet item.
6. No prohibited external action occurred.

Stop without success only when:

- 80 native-goal turns are exhausted; or
- progress requires new external authority, unavailable credentials/runtime, or an irreducible human product decision.

At every checkpoint, record the target worktree, changed files, exact verification commands/results, review verdicts, remaining risks, and next action.
