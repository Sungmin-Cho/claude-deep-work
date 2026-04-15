# Deprecated Commands Cleanup — Design Spec (v2)

- **Date**: 2026-04-15
- **Target version**: deep-work v6.2.1 (patch bump — pure documentation/UX polish, no command removed)
- **Branch**: `chore/cleanup-deprecated-commands`
- **Status**: Draft v2 (post-review revision, awaiting user review)
- **Location note**: `docs/`가 `.gitignore`에 있어 구현 중에는 `specs/`에 보관. 구현 완료 후 `docs/`로 이동 및 git 정리 예정(원격 push 제외).
- **Review history**:
  - v1 (commit `1908aba`) — 3-way review (Opus + Codex review + Codex adversarial) → REQUEST_CHANGES.
  - v2 (현재) — review 수용하여 삭제 범위 제거, 파급 범위 보강, 버전 bump 정책 조정.

## 1. Problem

`commands/` 디렉터리에는 22개의 슬래시 커맨드가 있고, 그중 **11개 파일**이 상단에 `> **Deprecated in v5.2**` 블록을, `skills/deep-work-workflow/SKILL.md` L86의 인라인 리스트는 **13개**를 "deprecated"로 분류하고 있다. 숫자 차이는 `deep-brainstorm.md`와 `deep-phase-review.md`가 블록 없이 리스트에만 포함되기 때문이다.

실제 코드베이스 탐색 결과 이 분류는 네 가지 실질적으로 다른 상태를 뒤섞고 있다.

1. **내부 참조가 존재하는 커맨드** (orchestrator·`/deep-status`가 이 파일을 `Read` 또는 `Skill` 호출):
   - `/deep-status`의 `--receipts / --history / --report / --assumptions` 플래그가 각각 `commands/deep-receipt.md` (§6, L283), `deep-history.md` (§7, L300), `deep-report.md` (§8, L334), `deep-assumptions.md` (§9, L342)를 `Read`.
   - `skills/deep-work-orchestrator/SKILL.md` Step 3-6 (L217)이 `Read "/deep-finish"`.
   - orchestrator §3-1 (L163)이 `Skill("deep-brainstorm", ...)`로 Phase 0 진입점 호출.
2. **Standalone 사용이 README에 권장되는 Quality Gate**: `drift-check`, `solid-review`, `deep-insight` — `/deep-test`가 자동 실행하지만 README/SKILL.md에서 `Standalone mode available`로 표기.
3. **Escape hatch로 참조되는 커맨드**: `hooks/scripts/phase-guard-core.js` L110–L123이 TDD 블록 시 `/deep-slice spike`, `/deep-slice reset`을 안내. `phase-guard-core.test.js` L44·L61이 이 문자열을 assert.
4. **실제로 auto-flow가 대체했다고 표기된 커맨드**: `deep-cleanup`, `deep-resume`. 3-way 리뷰(v1) 결과 **이 주장은 사실이 아님**:
   - orchestrator Step 1-2는 stale 세션 감지 + 새 세션 ID 발급만 담당. `/deep-resume`의 **active 세션 선택·worktree 컨텍스트 복원·state 마이그레이션·phase cache 정리·phase별 resume dispatch** (`commands/deep-resume.md` L19–L266)는 미이식.
   - orchestrator는 `git worktree list` 스캔·stale/active 분류·dirty 트리 삭제 확인·fork worktree/registry 정리(`commands/deep-cleanup.md` L19–L156)를 수행하지 않음.
   - 따라서 이 두 커맨드는 **standalone utility**로 재분류하고 기능 이관 후 삭제는 별도 스프린트로 분리한다.

결과적으로 "Deprecated" 라벨은 네 가지 서로 다른 역할을 혼동시키고 있고, 본 스펙은 라벨을 올바른 역할로 교정하는 데 범위를 한정한다.

## 2. Goal / Non-goal

**Goal**
- 커맨드별 실제 역할(Primary / Special / Quality Gate / Internal / Escape hatch / Utility)을 정확한 라벨로 표기하여 `commands/*.md`, `skills/deep-work-workflow/SKILL.md`, `README*`, hook/skill의 사용자 대상 안내 문자열 간 정합성을 맞춘다.
- hook/skill의 사용자 대상 안내 문자열을 `/deep-status` 플래그 기반으로 일관화 (기존 커맨드는 계속 작동하므로 functional breaking change 아님).
- "Deprecated" 라벨 오남용을 제거한다.

**Non-goal**
- 어떤 커맨드 파일도 **삭제하지 않는다**. `/deep-cleanup`, `/deep-resume`의 기능 이관은 §7 follow-up.
- `deep-slice` 기능의 `/deep-implement` 이전 리팩토링도 §7 follow-up.
- `/deep-status`가 `commands/*.md`를 `Read`하는 아키텍처 재설계도 §7 follow-up.
- Primary/특수 커맨드의 동작 변경 금지.

## 3. Final classification (목표 상태)

총 22개 → 22개 유지. 라벨만 변경.

### A. Primary workflow (7) — 변경 없음
`deep-work`, `deep-research`, `deep-plan`, `deep-implement`, `deep-test`, `deep-status`, `deep-debug`

### B. Special utility (4) — 변경 없음
`deep-fork`, `deep-mutation-test`, `deep-phase-review`, `deep-sensor-scan`

> 주의: `deep-phase-review`는 현재 README "Deprecated Commands" 표에 포함되어 있으나 파일에는 `Deprecated in v5.2` 블록이 없다. README 표에서 이 행을 Special utility 섹션으로 이동한다(§4.2 C3).

### C. Quality Gate standalone (3) — deprecated 표기 제거, 새 분류 헤더
`drift-check`, `solid-review`, `deep-insight`

기존 `> **Deprecated in v5.2** …` 블록을 다음으로 **교체**:
```
> **Quality Gate (v6.2.1)** — `/deep-test`가 자동 실행합니다. 특정 대상/범위에 대한 독립 호출이 필요할 때만 직접 사용하세요.
> Standalone: `/drift-check [plan-file]` · `/solid-review [target]` · `/deep-insight [target]`
```
(각 파일의 standalone 예시는 해당 커맨드에 맞는 한 줄만 남긴다.)

### D-1. Internal implementation — 블록 교체 (5개)
`deep-finish`, `deep-report`, `deep-receipt`, `deep-history`, `deep-assumptions`

기존 `> **Deprecated in v5.2** …` 블록을 다음으로 **교체**:
```
> **Internal (v6.2.1)** — orchestrator 또는 `/deep-status`가 이 파일의 로직을 참조합니다. 자동 호출이 주 경로이며, 수동 호출도 지원됩니다(특히 디버깅·명시적 완료 시).
```
+ 각 파일별 참조 경로 한 줄:
- `deep-finish`: `참조처: skills/deep-work-orchestrator/SKILL.md Step 3-6 (Read). test pass 후 수동 호출 공식 경로.`
- `deep-report`: `참조처: /deep-status --report 구현체 (deep-status.md §8 Read).`
- `deep-receipt`: `참조처: /deep-status --receipts 구현체 (deep-status.md §6 Read).`
- `deep-history`: `참조처: /deep-status --history 구현체 (deep-status.md §7 Read).`
- `deep-assumptions`: `참조처: /deep-status --assumptions 구현체 (deep-status.md §9 Read).`

> 주의 (v1 review 반영): `/deep-finish`는 `skills/deep-test/SKILL.md` L122·L125가 test 통과 후 수동 호출을 안내하므로 "don't invoke manually"로 표현해서는 안 된다. "자동 호출이 주 경로·수동 호출도 공식"으로 톤 조정.

### D-2. Internal implementation — 블록 신규 삽입 (1개)
`deep-brainstorm`

이 파일에는 현재 `Deprecated in v5.2` 블록이 **없다**(L1–L9, 9줄 짜리 Skill wrapper). frontmatter 바로 아래, `# /deep-brainstorm` 이전에 **삽입**:
```
> **Internal (v6.2.1)** — orchestrator §3-1이 `Skill("deep-brainstorm", ...)`로 호출하는 Phase 0 진입점. `/deep-work` auto-flow가 기본 경로이며, 특정 phase만 재실행할 때 수동 호출도 가능합니다.
```

### E. Escape hatch utility (1) — deprecated 표기를 Escape hatch 표기로 교체
`deep-slice`

기존 블록을 다음으로 **교체**:
```
> **Escape hatch utility (v6.2.1)** — TDD 블록 시 `phase-guard`가 안내하는 수동 slice 개입 경로 (`spike`, `reset`, `model`). `/deep-implement` auto-flow가 정상 동작할 때는 대부분 자동 관리됩니다.
```

### F. Utility — standalone, 기능 이관 보류 (2개) ★ v1에서 "Deleted"였으나 v2에서 유지
`deep-cleanup`, `deep-resume`

**v1 review 결과 반영**: orchestrator가 이 커맨드들의 기능을 완전히 흡수하지 않았으므로 **삭제하지 않는다**. 라벨만 교체:
```
> **Utility (v6.2.1)** — 별도 관리 경로. `/deep-work` init에서 stale 세션 일부가 감지되지만, 다음 기능은 여전히 이 커맨드가 유일한 경로입니다:
> - `/deep-resume`: active 세션 선택·worktree 컨텍스트 복원·phase별 resume dispatch
> - `/deep-cleanup`: `git worktree list` 스캔·fork worktree·registry 정리
> 향후 기능 이관 후 삭제 예정(§7 follow-up).
```

### Frontmatter 처리 규칙 (전 카테고리 공통)
모든 헤더 교체는 파일 상단 YAML frontmatter(`---` 블록의 `description:`, `allowed-tools:` 등) 아래의 **quote block**(`> ...`)만 대상으로 한다. frontmatter 자체는 수정하지 않아 Claude Code 커맨드 등록 메타데이터를 보존한다. `deep-brainstorm`처럼 quote block이 없는 파일은 신규 삽입한다.

## 4. Ripple changes (문서/훅/메타)

### 4.1. `skills/deep-work-workflow/SKILL.md`

**L83–L87 분류 섹션**: "Primary commands (7)" / "Deprecated commands (13)"를 다음 5-카테고리 구조로 전면 교체:
```
**Primary workflow (7):** deep-work, deep-research, deep-plan, deep-implement, deep-test, deep-status, deep-debug
**Special utility (4):** deep-fork, deep-mutation-test, deep-phase-review, deep-sensor-scan
**Quality Gate (3):** drift-check, solid-review, deep-insight — `/deep-test`가 자동 실행, standalone 호출 가능
**Internal (6):** deep-brainstorm, deep-finish, deep-report, deep-receipt, deep-history, deep-assumptions — orchestrator/`/deep-status` 내부 참조. 수동 호출도 공식 경로
**Escape hatch (1):** deep-slice — phase-guard가 TDD 블록 시 안내
**Utility (2):** deep-cleanup, deep-resume — standalone, 기능 이관 후 삭제 예정
```
(총 23개 = 22 커맨드 + `/deep-brainstorm` 중복 제거 후 22. 카테고리 합산은 7+4+3+6+1+2 = 23이므로 실제로는 한 커맨드가 중복 카운트되지 않도록 재확인: Primary 7, Special 4, Quality 3, Internal 6, Escape 1, Utility 2 = 23. 전체 커맨드는 22개이므로 재확인 필요.)

**재확인**: commands/ 디렉터리 22개 실측 목록 = deep-assumptions, deep-brainstorm, deep-cleanup, deep-debug, deep-finish, deep-fork, deep-history, deep-implement, deep-insight, deep-mutation-test, deep-phase-review, deep-plan, deep-receipt, deep-report, deep-research, deep-resume, deep-sensor-scan, deep-slice, deep-status, deep-test, deep-work, drift-check, solid-review → 정확히 **23개**. 즉 현재 CLAUDE.md가 말하는 "22개"가 부정확. 본 스펙은 실측 기준 **23개**로 정정하여 분류한다. CLAUDE.md 업데이트 항목(§4.7)에 숫자 정정 반영.

**L238–L256 `Plan Alignment Check / SOLID Design Review / Code Insight Analysis / Session Report` 소제목**: `*deprecated, auto-runs in /deep-test*` 표시를 각 카테고리 어휘로 교체:
- Plan Alignment Check → `*Quality Gate — auto-runs in /deep-test; standalone: /drift-check [plan-file]*`
- SOLID Design Review → `*Quality Gate — auto-runs in /deep-test; standalone: /solid-review [target]*`
- Code Insight Analysis → `*Quality Gate — auto-runs in /deep-test; standalone: /deep-insight [target]*`
- Session Report → `*Internal — auto-runs; manual: /deep-status --report*`

**L318–L322 Session Resume 섹션**: "Session Resume — *deprecated, auto-detected in /deep-work*" 제목을 `### Session Resume (/deep-resume)`로 재작성. 본문 L321 "`/deep-resume`는 여전히 수동으로 호출 가능합니다." → "`/deep-work` 진입 시 stale 세션은 자동 감지되지만, active 세션 선택·worktree 복원·phase별 resume dispatch는 `/deep-resume`을 통해서만 가능합니다."

### 4.2. `README.md` / `README.ko.md`

다음 **세 블록** 모두 갱신:

**(a) L54 주석 "Check unified status (replaces /deep-report, /deep-receipt, /deep-history, /deep-assumptions)"**
→ `Unified status (/deep-status) — flags route to the same implementations as their standalone counterparts`

**(b) L86–L98 "Deprecated Commands" 표**
전면 재구성. 단일 표를 5개 하위 섹션으로 분리:
- **Special utility** — `/deep-phase-review` (표에서 신규 이동)
- **Quality Gate (standalone available)** — drift-check, solid-review, deep-insight
- **Internal — auto-runs, manual supported** — deep-brainstorm, deep-finish, deep-report, deep-receipt, deep-history, deep-assumptions
- **Escape hatch (phase-guard hint)** — deep-slice
- **Utility (standalone)** — deep-cleanup, deep-resume

각 행에 "auto-runs where?" 한 줄 유지.

**(c) README.md L335–L336 / README.ko.md L460–L461 본문 "Worktree Isolation" 섹션** (v1 review 반영)
```
- `/deep-cleanup` removes stale worktrees (7+ days old, no active session)
- `/deep-resume` automatically detects and restores worktree context
```
이 두 줄은 **유지한다**(§3F 결정에 따라). 단 문구 보강:
- `/deep-cleanup`: "removes stale worktrees (7+ days old, no active session) — **standalone utility**"
- `/deep-resume`: "restores worktree context and dispatches into the correct phase — **standalone utility**; `/deep-work` init also auto-detects stale sessions"
(ko 동일 번역)

### 4.3. Hook 스크립트 안내 문자열
- `hooks/scripts/assumption-engine.js` L1247: `Run /deep-assumptions for details` → `Run /deep-status --assumptions for details`.
- `hooks/scripts/session-end.sh` L64: `/deep-report`로 리포트를 생성하세요 → `/deep-status --report`로 리포트를 확인하세요.
- `hooks/scripts/phase-guard-core.js` L110–L123: `/deep-slice spike`, `/deep-slice reset` 안내는 **유지** (escape hatch 설계). 테스트(`phase-guard-core.test.js` L44·L61) 유지.

### 4.4. Skill 내부 안내 문자열
- `skills/deep-test/SKILL.md` L150: `/deep-report로 결과 정리` → `/deep-status --report로 결과 정리`.
- `skills/deep-test/SKILL.md` L122·L125: `/deep-finish` 안내 **유지** (`/deep-finish`는 Internal이지만 수동 호출 공식 경로 — §3D-1 참조).
- `skills/deep-work-orchestrator/SKILL.md` L217 `Read '/deep-finish'` **유지**.

### 4.5. CHANGELOG
`CHANGELOG.md`, `CHANGELOG.ko.md`에 v6.2.1 섹션 신설. 요지:
- Reclassified: 10개 커맨드 라벨을 "Deprecated"에서 Quality Gate / Internal / Escape hatch / Utility로 교체.
- Fixed: Hook·skill 안내 문구를 `/deep-status` 플래그 기반으로 정렬(기존 커맨드는 계속 동작; UX 일관성 개선).
- Fixed: `deep-phase-review`를 README "Deprecated" 표에서 Special utility 섹션으로 이동.
- No commands removed. `/deep-cleanup`·`/deep-resume` 삭제는 기능 이관 후 별도 릴리즈에서 처리(§7 follow-up).
- 기존 CHANGELOG의 v5.2 deprecated 항목은 역사로 남긴다(수정하지 않음).

### 4.6. 버전 bump
- `.claude-plugin/plugin.json`: `"version": "6.2.0"` → `"6.2.1"`.
- `package.json`: `"version": "6.2.0"` → `"6.2.1"` (v1 review C2 반영 — 두 매니페스트 drift 방지).

**정책**: 커맨드 삭제가 없고 동작 변경도 없으므로 patch bump가 SemVer상 적절. v1 스펙의 minor bump(v6.3.0)는 삭제를 전제로 한 것으로 v2에서 patch로 하향.

### 4.7. `CLAUDE.md`
L1 `deep-work v6.2.0` → `v6.2.1`. 본 문서에 `commands/`의 실측 파일 수(23개)를 반영한 분류 한 줄 요약 추가 고려(선택).

## 5. Implementation order

1. 브랜치 생성 (`chore/cleanup-deprecated-commands`) — 완료.
2. 설계 문서 v2 작성 및 사용자 리뷰 — 본 단계.
3. `skills/deep-work-workflow/SKILL.md` L83–L87 분류 섹션 재작성.
4. Quality Gate 3개 커맨드 파일 블록 교체 (`drift-check`, `solid-review`, `deep-insight`).
5. Internal 5개 커맨드 파일 블록 교체 (`deep-finish`, `deep-report`, `deep-receipt`, `deep-history`, `deep-assumptions`).
6. Internal 1개 커맨드에 블록 신규 삽입 (`deep-brainstorm`).
7. Escape hatch 1개 블록 교체 (`deep-slice`).
8. Utility 2개 블록 교체 (`deep-cleanup`, `deep-resume`).
9. Hook 스크립트 안내 문자열 수정 (`assumption-engine.js`, `session-end.sh`).
10. Skill 안내 문자열 수정 (`deep-test/SKILL.md` L150).
11. `skills/deep-work-workflow/SKILL.md` L238–L256, L318–L322 문구 재작성.
12. README 2종 L54·L86–L98 표 재구성, L335–L336 / L460–L461 본문 보강.
13. CHANGELOG 2종에 v6.2.1 항목 추가.
14. `plugin.json`, `package.json`, `CLAUDE.md` 버전 bump (및 필요 시 커맨드 수 정정).
15. **검증 체크리스트**:
    - `node --test hooks/scripts/phase-guard-core.test.js` — escape hatch assertion 유지.
    - `git grep -n "Deprecated in v5.2"` → 결과 0건.
    - `git grep -n "Deprecated commands (13)"` → 결과 0건.
    - `git grep -n "/deep-cleanup\|/deep-resume"` → 본 스펙이 정의한 위치에만 남아있는지 확인.
    - **Smoke test** (수동 — v1 review M2 반영): 실제 세션에서 `/deep-status --receipts`·`--report`·`--history`·`--assumptions`가 각각 정상 렌더되는지 확인. 내부 `Read` 대상 파일(§3D-1의 5개)의 display logic 섹션을 건드리지 않았는지 재확인.
16. 커밋 분리:
    - `docs(commands): reclassify labels into quality-gate/internal/escape-hatch/utility`
    - `docs(readme,skill): align /deep-status routing and command classification`
    - `refactor(hooks,skill): route user-facing guidance to /deep-status flags`
    - `chore: bump to v6.2.1`

## 6. Risk and mitigation

- **리스크**: `/deep-status`의 `--receipts/--history/--report/--assumptions` 구현이 `commands/*.md`를 `Read`하는 기이한 아키텍처는 유지. 본 스펙은 라벨만 정돈한다.
  - **완화**: Internal 표기로 명시화. §7에 참조 가이드(`skills/shared/references/`) 기반 전환 follow-up 기록.
- **리스크**: Internal 커맨드의 display logic 섹션을 실수로 편집하면 `/deep-status` 플래그가 깨진다.
  - **완화**: §5 Step 15 smoke test 체크리스트로 수동 검증. 헤더 quote block만 교체하는 규칙(§3 Frontmatter 처리 규칙)을 커밋 직전 diff 리뷰로 확인.
- **리스크**: Escape hatch 힌트(`/deep-slice spike/reset`)가 `phase-guard-core.js`에 하드코딩되어 있어 커맨드 파일과 drift 가능.
  - **완화**: 본 스펙은 문구 유지. §7 `deep-slice` 기능 이관 시 `phase-guard-core.js` L110–L123 및 `phase-guard-core.test.js` L44·L61 동시 갱신을 조건으로 명시.
- **리스크**: `/deep-cleanup`·`/deep-resume` 삭제 기대 사용자는 계속 파일이 남아있는 것을 보고 혼동할 수 있다.
  - **완화**: 새 "Utility" 라벨과 CHANGELOG v6.2.1 항목에 "기능 이관 후 삭제 예정"을 명시. §7에 명확한 follow-up.

## 7. Out-of-scope (follow-up candidates)

- `/deep-status`의 `commands/*.md` `Read` 의존을 `skills/shared/references/` 기반 가이드로 전환.
- `deep-slice` 기능을 `/deep-implement` 플래그(`--spike=SLICE-NNN`, `--reset=SLICE-NNN`)로 이관. 이관 완료 시 `hooks/scripts/phase-guard-core.js` L110–L123, `hooks/scripts/phase-guard-core.test.js` L44·L61, `commands/deep-slice.md`를 한 릴리즈에 동시 갱신.
- `/deep-cleanup` 기능(`git worktree list` 스캔, dirty/fork 트리 정리)을 orchestrator 또는 `/deep-status --cleanup` 플래그로 이관 후 `commands/deep-cleanup.md` 삭제.
- `/deep-resume` 기능(active 세션 선택, worktree 복원, phase별 resume dispatch)을 `/deep-work --resume=<session-id>` 옵션으로 이관 후 `commands/deep-resume.md` 삭제.
- `CHANGELOG.md`의 v5.2 deprecated 기록을 "historical note" 섹션으로 재분류.

## 8. Review response summary (v1 → v2)

| Reviewer 지적 | 수용 여부 | v2 반영 위치 |
|---|---|---|
| 🔴 Codex review P2 + adversarial HIGH: `/deep-resume` 삭제 premature | 수용 | §3F Utility 유지, §7 follow-up |
| 🔴 Codex review P2 + adversarial MEDIUM: `/deep-cleanup` 삭제 premature | 수용 | §3F Utility 유지, §7 follow-up |
| 🟡 Codex review P3: `/deep-finish` "don't invoke manually" 부적절 | 수용 | §3D-1 톤 조정, §4.4 명시 |
| 🟢 Opus C1: deep-brainstorm은 교체가 아니라 삽입 | 수용 | §3D-1/D-2 분리 |
| 🟢 Opus C2: package.json bump 누락 | 수용 | §4.6 |
| 🟢 Opus C3: /deep-phase-review README 재배치 | 수용 | §4.2(b) Special utility 섹션 |
| 🟢 Opus C4: README 본문 L335–L336 / L460–L461 갱신 | 수용 | §4.2(c) |
| 🟢 Opus C5: SKILL.md L86 인라인 리스트·L321 처리 규칙 | 수용 | §4.1 전 구간 |
| 🟡 Opus M1: version bump 근거 명시 | 수용(정책 변경) | §4.6 patch bump로 하향 |
| 🟡 Opus M2: smoke test 체크리스트 | 수용 | §5 Step 15 |
| 🟡 Opus M4: 외부 소비자 리스크 | 부분 수용 | 삭제 제거로 리스크 소멸; §6에 혼동 리스크로 압축 |
| 🟡 Opus M5: phase-guard 동시 갱신 조건 | 수용 | §7 follow-up |
| 🟢 Opus m3: 커밋 prefix `fix:` → `refactor:` | 수용 | §5 Step 16 |
| 🟢 Opus m4: standalone 예시 한 줄 | 수용 | §3C 블록에 예시 |
| 🟢 Opus m1: 숫자 차이 원인 설명 | 수용 | §1 첫 문단 |
| 🟢 Opus m5: 리뷰 gate 선언 | 별도 조치 불요 | "Draft (awaiting user review)" |
| 🟢 Opus m2: .gitignore 논리 | 유지 | 사용자 확정 ("원격 push 제외 원칙") |
