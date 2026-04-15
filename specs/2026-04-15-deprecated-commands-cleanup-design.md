# Deprecated Commands Cleanup — Design Spec

- **Date**: 2026-04-15
- **Target version**: deep-work v6.3.0
- **Branch**: `chore/cleanup-deprecated-commands`
- **Status**: Draft (awaiting user review)
- **Location note**: `docs/`가 `.gitignore`에 있어 구현 중에는 `specs/`에 보관. 구현 완료 후 `docs/`로 이동 및 git 정리 예정(원격 push 제외).

## 1. Problem

`commands/` 디렉터리에는 22개의 슬래시 커맨드가 있고, 그중 11개 파일이 상단에 `> **Deprecated in v5.2**` 문구를, SKILL.md는 별도로 13개를 "deprecated"로 분류하고 있다. 그러나 실제 코드베이스를 탐색한 결과 이 분류는 여러 면에서 부정확하다.

1. **내부 참조가 존재**: `/deep-status`가 `--receipts / --history / --report / --assumptions` 플래그 구현을 위해 `/deep-receipt`, `/deep-history`, `/deep-report`, `/deep-assumptions` 커맨드 파일을 `Read`한다. `/deep-work-orchestrator`는 Step 3-6에서 `Read "/deep-finish"`로, Phase 0에서 `Skill("deep-brainstorm")`으로 호출한다. 즉 "사용자가 직접 치지 않지만 시스템이 여전히 의존"하는 6개 파일이 deprecated로 잘못 표기되어 있다.
2. **Standalone 사용이 README에 권장**: `/drift-check`, `/solid-review`, `/deep-insight`는 README와 `skills/deep-work-workflow/SKILL.md`에서 "Standalone mode available"로 권장되는데도 파일에는 deprecated 표시가 있다.
3. **Escape hatch 힌트와 충돌**: `hooks/scripts/phase-guard-core.js`는 TDD 블록 메시지에서 `/deep-slice spike`, `/deep-slice reset`을 대안으로 안내한다. deep-slice를 삭제하면 이 안내가 끊어진다.
4. **진짜로 대체된 것은 소수**: `deep-cleanup`과 `deep-resume`은 orchestrator Step 1-2(Stale 세션 감지 · Multi-Session 초기화)로 기능이 흡수되었고, 파일을 `Read`하는 참조가 없다.

결과적으로 "Deprecated" 라벨이 네 가지 실질적으로 다른 상태를 뒤섞고 있다 — 내부 구현체, 자동 실행되는 Quality Gate utility, escape hatch utility, 실제로 대체되어 불필요한 커맨드.

## 2. Goal / Non-goal

**Goal**
- 커맨드 노출 수를 실제 사용자가 타이핑할 법한 수준으로 줄이되, 현재 동작 중인 auto-flow와 hook escape hatch를 깨뜨리지 않는다.
- `commands/*.md`, `skills/deep-work-workflow/SKILL.md`, `README*`, `CHANGELOG*`, hook 안내 문구 간 분류를 일관되게 맞춘다.
- "Deprecated" 라벨 오남용을 제거하고, 각 커맨드의 실제 역할(Primary / Special / Quality Gate / Internal / Escape hatch)을 정확히 표현한다.

**Non-goal**
- deep-slice 기능을 `/deep-implement`로 이전하는 리팩토링 — 별도 프로젝트로 분리.
- `/deep-status`가 내부 구현을 위해 커맨드 파일을 `Read`하는 아키텍처 자체의 재설계 — 현재 구조를 유지한 채 표기만 정정한다.
- Primary/특수 커맨드(`deep-work`, `deep-research`, `deep-plan`, `deep-implement`, `deep-test`, `deep-status`, `deep-debug`, `deep-fork`, `deep-mutation-test`, `deep-phase-review`, `deep-sensor-scan`)의 동작 변경.

## 3. Final classification (목표 상태)

총 22개 → 20개로 축소.

### A. Primary workflow (7) — 변경 없음
`deep-work`, `deep-research`, `deep-plan`, `deep-implement`, `deep-test`, `deep-status`, `deep-debug`

### B. Special utility (4) — 변경 없음
`deep-fork`, `deep-mutation-test`, `deep-phase-review`, `deep-sensor-scan`

### C. Quality Gate standalone (3) — deprecated 표기 제거, 새 분류 헤더
`drift-check`, `solid-review`, `deep-insight`

상단 블록을 다음으로 교체:
```
> **Quality Gate (v6.3)** — `/deep-test`가 자동 실행합니다. 특정 대상/범위에 대한 독립 호출이 필요할 때만 직접 사용하세요.
```

### D. Internal implementation (6) — deprecated 표기를 Internal 표기로 교체
`deep-brainstorm`, `deep-finish`, `deep-report`, `deep-receipt`, `deep-history`, `deep-assumptions`

상단 블록을 다음으로 교체:
```
> **Internal command (v6.3)** — orchestrator 또는 `/deep-status`가 이 파일의 로직을 참조합니다. 자동 실행되며, 디버깅 또는 명시적 수동 호출 시에만 직접 사용하세요.
```

각 파일별로 "이 커맨드가 어디에서 참조되는지"를 한 줄 추가:
- `deep-brainstorm`: `orchestrator Phase 0 진입점 (Skill 호출)`
- `deep-finish`: `orchestrator Step 3-6에서 Read`
- `deep-report`: `/deep-status --report에서 Read`
- `deep-receipt`: `/deep-status --receipts에서 Read`
- `deep-history`: `/deep-status --history에서 Read`
- `deep-assumptions`: `/deep-status --assumptions에서 Read`

### E. Escape hatch utility (1) — deprecated 표기를 Escape hatch 표기로 교체
`deep-slice`

상단 블록을 다음으로 교체:
```
> **Escape hatch utility (v6.3)** — TDD 블록 시 phase-guard가 안내하는 수동 slice 개입 경로. `/deep-implement` auto-flow가 정상 동작할 때는 대부분 자동 관리됩니다.
```

**Frontmatter 처리 규칙**: 모든 헤더 교체는 파일 상단의 YAML frontmatter(`---` 블록의 `description:`, `allowed-tools:` 등) 아래에 삽입된 `> **Deprecated in v5.2** …` 블록만 대상으로 한다. frontmatter 자체는 수정하지 않는다. 이를 통해 Claude Code 커맨드 등록 메타데이터가 변하지 않도록 보장한다.

### F. Deleted (2)
- `commands/deep-cleanup.md` — orchestrator Step 1-2 "Stale 세션 감지"로 흡수됨, 외부 `Read` 참조 없음.
- `commands/deep-resume.md` — orchestrator Step 1-2 "기존 세션 확인 (Multi-Session)"으로 흡수됨, 외부 `Read` 참조 없음.

## 4. Ripple changes (문서/훅/메타)

### 4.1. `skills/deep-work-workflow/SKILL.md`
"Deprecated commands (13)" 섹션(L83–L87 근방)과 하단의 `*deprecated, auto-runs in /deep-test*` 문구(L238–L256 근방)와 `Session Resume — *deprecated, auto-detected in /deep-work*` 섹션(L318–L322)을 아래 구조로 전면 재작성한다.

```
**Primary commands (7):** deep-work, deep-research, deep-plan, deep-implement, deep-test, deep-status, deep-debug
**Special utility (4):** deep-fork, deep-mutation-test, deep-phase-review, deep-sensor-scan
**Quality Gate standalone (3):** drift-check, solid-review, deep-insight — `/deep-test`가 자동 실행, standalone으로도 호출 가능
**Internal (6):** deep-brainstorm, deep-finish, deep-report, deep-receipt, deep-history, deep-assumptions — orchestrator/deep-status 내부 참조
**Escape hatch (1):** deep-slice — phase-guard가 TDD 블록 시 안내
```

이에 맞춰 섹션 제목들(`Plan Alignment Check`, `SOLID Design Review`, `Code Insight Analysis`, `Session Report`, `Session Resume`)의 "deprecated" 문구를 정확한 분류 어휘로 교체한다.

### 4.2. `README.md` / `README.ko.md`
L54 주석 ("Check unified status (replaces …)")와 L86–L98의 "Replaced by" 표를 다음으로 재구성:

- 삭제된 2개(`deep-cleanup`, `deep-resume`) 행 제거.
- 나머지는 카테고리별 섹션으로 분리:
  - "Internal — auto-runs, don't invoke manually": deep-brainstorm, deep-finish, deep-report, deep-receipt, deep-history, deep-assumptions
  - "Quality Gate — auto-runs in /deep-test, standalone available": drift-check, solid-review, deep-insight
  - "Escape hatch — invoked via phase-guard hint": deep-slice

### 4.3. Hook 스크립트 안내 문자열
- `hooks/scripts/assumption-engine.js` L1247: `Run /deep-assumptions for details` → `Run /deep-status --assumptions for details`.
- `hooks/scripts/session-end.sh` L64: `/deep-report`로 리포트를 생성하세요 → `/deep-status --report`로 리포트를 확인하세요.
- `hooks/scripts/phase-guard-core.js` L110–L123: `/deep-slice spike`, `/deep-slice reset` 안내는 **유지** (escape hatch 설계). 테스트(`phase-guard-core.test.js` L44, L61) 유지.

### 4.4. Skill 내부 안내 문자열
- `skills/deep-test/SKILL.md` L150: `/deep-report로 결과 정리` → `/deep-status --report로 결과 정리`.
- `skills/deep-test/SKILL.md` L122, L125: `/deep-finish` 안내는 **유지** (내부 구현체 호출 경로).
- `skills/deep-work-orchestrator/SKILL.md` L217의 `Read '/deep-finish'` 참조 **유지**.

### 4.5. CHANGELOG
`CHANGELOG.md`, `CHANGELOG.ko.md`에 v6.3.0 섹션 신설. 요지:
- Removed: `/deep-cleanup`, `/deep-resume` (기능은 orchestrator로 이미 통합됨)
- Reclassified: 10개 커맨드 라벨을 Deprecated에서 Quality Gate / Internal / Escape hatch로 교체
- 동작 변경 없음 — 문서/표기 정리

기존 CHANGELOG의 v5.2 deprecated 항목은 역사로 남긴다(수정하지 않음).

### 4.6. Plugin manifest
`.claude-plugin/plugin.json`: `"version": "6.2.0"` → `"6.3.0"`.

### 4.7. CLAUDE.md
L1의 `deep-work v6.2.0` → `v6.3.0`.

## 5. Implementation order

1. 브랜치 생성 (`chore/cleanup-deprecated-commands`) — 완료됨.
2. 설계 문서 작성 및 사용자 리뷰 — 본 단계.
3. `skills/deep-work-workflow/SKILL.md` 분류 섹션 재작성.
4. Quality Gate 3개 커맨드 파일 헤더 교체 (`drift-check`, `solid-review`, `deep-insight`).
5. Internal 6개 커맨드 파일 헤더 교체 (`deep-brainstorm`, `deep-finish`, `deep-report`, `deep-receipt`, `deep-history`, `deep-assumptions`).
6. Escape hatch 1개 커맨드 파일 헤더 교체 (`deep-slice`).
7. Hook 스크립트 안내 문자열 수정 (`assumption-engine.js`, `session-end.sh`).
8. Skill 안내 문자열 수정 (`deep-test/SKILL.md`).
9. README 2종 "Replaced by" 표 재구성.
10. `deep-cleanup.md`, `deep-resume.md` 파일 삭제.
11. CHANGELOG 2종에 v6.3.0 항목 추가.
12. `plugin.json`, `CLAUDE.md` 버전 bump.
13. 훅 테스트(`phase-guard-core.test.js`) 실행하여 escape hatch 문자열 assertion이 여전히 통과하는지 확인.
14. `git grep`으로 `/deep-cleanup`, `/deep-resume`, "Deprecated in v5.2" 잔존 참조 재확인.
15. 커밋 분리 기준:
    - `docs: reclassify deprecated commands into quality-gate/internal/escape-hatch`
    - `chore: delete deep-cleanup and deep-resume commands absorbed by orchestrator`
    - `fix: align hook and skill guidance with /deep-status flag routing`
    - `chore: bump to v6.3.0`

## 6. Risk and mitigation

- **리스크**: `/deep-status --receipts`가 `deep-receipt.md`를 `Read`하는 구조는 설계상 기이함. 이번 작업으로 노출은 줄이지만 구조는 그대로 남는다.
  - **완화**: Internal 표기로 명시화하여 혼동 방지. 차기 버전에서 해당 로직을 `skills/shared/references/`로 이동하는 후속 과제로 분리 (별도 스펙 필요).
- **리스크**: 사용자가 `/deep-cleanup` 또는 `/deep-resume`을 muscle memory로 치면 "command not found".
  - **완화**: CHANGELOG에 명시적으로 제거 항목 기록. README에서 `/deep-work` init이 자동 처리한다는 점을 강조.
- **리스크**: Quality Gate 3개를 유지하면서 "Deprecated" 표기를 제거하면, 신규 사용자가 이를 primary로 오해할 가능성.
  - **완화**: 헤더 블록의 첫 줄을 `Quality Gate (v6.3) — /deep-test가 자동 실행합니다`로 시작하여 일차 용도를 명시.
- **리스크**: phase-guard-core.js의 escape hatch 문구가 deep-slice 파일과 분리되어 유지되는 현재 구조는 여전히 coupling.
  - **완화**: 본 정리는 문서/분류 레이어에만 손댄다. 커플링 자체는 문서화(`deep-slice.md`의 새 헤더)로 투명화.

## 7. Out-of-scope (follow-up candidates)

- `/deep-status`가 `deep-receipt.md` 등을 `Read`하는 구조를 참조 가이드(`skills/shared/references/`) 기반으로 전환.
- `deep-slice` 기능을 `/deep-implement` 플래그로 이관 (`--spike=SLICE-NNN`, `--reset=SLICE-NNN`) 후 완전 삭제.
- `CHANGELOG.md`의 v5.2 deprecated 기록을 "historical note"로 재분류하는 작업.
