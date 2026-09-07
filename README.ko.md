[English](./README.md) | **한국어**

# deep-work

[![version](https://img.shields.io/github/package-json/v/Sungmin-Cho/deep-work?label=version)](https://github.com/Sungmin-Cho/deep-work)
[![license](https://img.shields.io/github/license/Sungmin-Cho/deep-work)](./LICENSE)
[![part of deep-suite](https://img.shields.io/badge/part%20of-deep--suite-5b8def)](https://github.com/Sungmin-Cho/deep-suite)

Claude Code와 Codex에서 목표·승인된 변경·검증·완료 근거를 중단 이후에도 유지하는 개발 워크플로우입니다. 기본적으로 현재 모델이 인라인으로 작업하며, 명시한 모델·추론 강도·방법론을 보존합니다.

새 adaptive 계획은 slice별로 strict TDD 또는 결과 검증을 선택합니다. 문서·설정 등 적합한 작업은 실제 양성 검사와 의미 있는 반례로 검증하고, strict 필수 작업은 실제 RED/proof/GREEN을 유지합니다. AI는 구현 중에도 판단하며 승인된 계약 안에서 세부 방법을 조정하고, 계약 변경은 근거를 남기는 replan으로 처리합니다.

## 설치

`claude-deep-suite` 마켓플레이스 (권장):

```bash
/plugin marketplace add Sungmin-Cho/deep-suite
/plugin install deep-work@claude-deep-suite
```

이 저장소에서 단독 설치:

```bash
/plugin marketplace add Sungmin-Cho/deep-work
/plugin install deep-work@Sungmin-Cho-deep-work
```

deep-work는 Claude Code와 Codex 플러그인 런타임 모두에서 동작합니다 — 각자 native manifest를 읽고, skill 호출자는 동일한 skill-native invocation 모델을 사용합니다.

> **Windows**: hook 스크립트는 PATH에 `bash`가 필요합니다 (Git for Windows 또는 WSL).

## 사용법

스킬 한 번으로 시작합니다. 이미 승인된 내부 작업은 단계마다 재확인하지 않고 진행합니다. 단계별 대화를 원하면 `--interactive-gates`를 사용합니다. `--autonomous`는 내부 진행 선호이며 외부 작업 권한을 부여하지 않습니다.

```bash
# 전체 auto-flow 실행: Brainstorm → Research → Spec → Plan → Implement → Test → Integrate → Report
$deep-work:deep-work "JWT 기반 사용자 인증 구현"

# 통합 상태 조회 — 플래그는 standalone skill과 동일한 구현으로 라우팅됨
$deep-work:deep-status              # 현재 진행 상태
$deep-work:deep-status --report     # 세션 리포트
$deep-work:deep-status --receipts   # receipt 대시보드
$deep-work:deep-status --history    # 크로스 세션 트렌드
$deep-work:deep-status --assumptions # 가설 건강도
$deep-work:deep-status --all        # 전체 통합 뷰
$deep-work:deep-status --compare    # 두 세션 비교
```

Claude Code에서는 동일한 표면을 슬래시 커맨드로도 사용할 수 있으며, Codex 등 다른 호스트에서는 `$deep-work:<verb>` skill 형태를 사용합니다.

## Skills

deep-work는 27개 command-equivalent skill을 노출합니다. 가장 많이 쓰는 것:

| Skill | 설명 |
|---|---|
| `$deep-work:deep-work <task>` | Auto-flow 오케스트레이션 — 전체 파이프라인 실행; 승인된 내부 작업을 단계 간 연속 진행 |
| `$deep-work:deep-research` | Phase 1 (Research) — 코드베이스 심층 분석 |
| `$deep-work:deep-spec` | Phase 2 (Spec) — 실행 가능한 requirement, failure mode, evidence gate |
| `$deep-work:deep-plan` | Phase 3 (Plan) — slice 기반 구현 계획 |
| `$deep-work:deep-implement` | Phase 4 (Implement) — strict 또는 결과 검증 slice 실행 |
| `$deep-work:deep-test` | Phase 5 (Test) — receipt + spec + quality gate; drift-check·SOLID·insight 자동 실행 |
| `$deep-work:deep-integrate` | Phase 6 (Integrate) — 크로스 플러그인 다음 단계 추천 루프 |
| `$deep-work:deep-status` | 통합 뷰 (`--report` / `--receipts` / `--history` / `--assumptions` / `--all` / `--compare`) |
| `$deep-work:deep-finish` | 세션 종료 — worktree merge / PR / keep / discard |
| `$deep-work:deep-debug` | 체계적 디버깅: investigate → analyze → hypothesize → fix |

그 외 skill은 quality gate(`drift-check`, `solid-review`, `deep-insight`), 세션 유틸리티(`deep-fork`, `deep-resume`, `deep-cleanup`, `deep-slice`), 툴체인 헬퍼(`deep-mutation-test`, `deep-sensor-scan`, `deep-phase-review`), read-only status 서브 skill(`deep-report`, `deep-receipt`, `deep-history`, `deep-assumptions`)을 다룹니다. 모두 수동 호출 가능하며, 다수는 auto-flow 내에서 자동 실행됩니다.

## 워크플로우

| Phase | 역할 |
|---|---|
| **0 — Brainstorm** | 선택적 디자인 탐색, "왜 만드는가" (`--skip-brainstorm`으로 생략) |
| **1 — Research** | 아키텍처·패턴·데이터·API·인프라·리스크 전반의 코드베이스 분석; `research.md` 산출 |
| **2 — Spec** | 실행 가능한 requirement, invariant, failure mode, compatibility, evidence gate; `spec.md` 산출 |
| **3 — Plan** | slice별 검증 방식과 관측 가능한 수용 조건을 갖춘 계획; `plan.md` 산출 |
| **4 — Implement** | strict 또는 결과 검증 slice 실행: failing test → production code → receipt |
| **5 — Test** | receipt 완전성·spec compliance·code quality·검증 증거, 최대 3회 implement→test 재시도 |
| **6 — Integrate** | deep-suite 플러그인 아티팩트를 읽어 최대 3개 다음 단계 제안하는 skippable 루프 (`--skip-integrate`로 생략) |

런타임이 단계 전환·승인·범위가 정해진 쓰기·receipt를 소유합니다. Low 작업은 별도의 승인 대화 없이 간결한 Spec을 사용할 수 있습니다. Spec과 Plan을 함께 작성해 동일한 소스 묶음을 한 번 독립 검토하고, 기계적 바인딩은 컴파일러가 계산하며, 같은 적격 승인 근거를 두 단계에서 소비합니다. 필수 검사·리뷰는 실제 근거를 요구하며, 한 세션에는 활성 slice와 쓰기 창이 하나만 존재합니다.

## 산출물

각 세션의 산출물은 `.deep-work/<session-id>/`에 저장됩니다:

| 파일 | 생성 시점 | 설명 |
|---|---|---|
| `research.md` | Phase 1 | 코드베이스 분석 (Executive Summary 먼저) |
| `spec.md` | Phase 2 | 실행 가능한 requirement, failure mode, evidence-gate contract |
| `plan.md` | Phase 3 | 구현 계획 (per-slice contract + acceptance 필드) |
| `plan.v{N}.md` / `plan-diff.md` | Plan 재작성 | 이전 plan 백업 / 구조적 변경 비교 |
| `brainstorm.md` | Phase 0 | 문제 정의, 접근법 비교, 성공 기준 |
| `receipts/SLICE-NNN.json` | Phase 3 | Per-slice 증거: TDD 출력, git diff, spec check, 리뷰, 모델 |
| `file-changes.log` | Phase 3 | slice 매핑을 갖춘 자동 파일 변경 추적 |
| `test-results.md` | Phase 4 | 검증 결과 (시도별 누적) |
| `quality-gates.md` / `drift-report.md` / `solid-review.md` / `insight-report.md` | Phase 4 | Quality gate, plan 정합성, SOLID, 메트릭 리포트 |
| `report.md` | 세션 완료 | Phase 소요 시간 포함 전체 세션 리포트 |
| `session-receipt.json` | 세션 종료 | 크로스 slice 세션 요약 (M3 envelope) |
| `debug-log/RC-NNN.md` | Phase 3 (디버깅) | Root cause 분석 노트 |
| `harness-history/harness-sessions.jsonl` | 세션 종료 | Per-session assumption-engine 데이터 |

세션 상태는 `.claude/deep-work.<session-id>.md`에 YAML frontmatter로 저장됩니다 (current phase, work dir, TDD state, model routing, worktree 정보, quality gate, health report 등).

## Hooks

훅은 세션 라이프사이클과 computational enforcement를 관리합니다.

| 훅 | 트리거 | 용도 |
|---|---|---|
| SessionStart (`update-check.sh`) | 시작/재개 | Git 기반 버전 업데이트 확인 |
| PreToolUse (`phase-guard.sh`) | Write/Edit/MultiEdit/Bash | Phase 기반 편집 차단 + P0 Worktree Path Guard + non-implement dangerous-command denylist |
| PostToolUse (`file-tracker.sh`) | Write/Edit/MultiEdit/Bash | 관측용 변경 추적; governed receipt는 런타임이 소유 |
| PostToolUse (`sensor-trigger.js`) | Write/Edit/MultiEdit/Bash | computational 센서 파이프라인 트리거 (lint, typecheck, review-check) |
| PostToolUse (`phase-transition.sh`) | Write/Edit/MultiEdit | P1 Phase Transition Injector — phase 전환 시 worktree/team/cross-model context 주입 |
| Stop (`session-end.sh`) | CLI 세션 종료 | 활성 세션 알림, worktree 정보, phase cache 정리 |

denylist는 recursive rm, npm publish, 일부 파괴적 kubectl/SQL, curl/wget의 sh/bash 파이프를 다룹니다. 적용 제외와 family별 override는 [AGENTS.md](AGENTS.md)에 명시되어 있습니다. 일반적인 셸 샌드박스는 아닙니다.

## 검증과 호환성

- Strict TAP 정책은 정확한 Node 패치22.23.2,24.20.0,26.0.0,26.8.1을 지원합니다. 과거 정책 식별자는 그대로 유지하며, 미지원 런타임을 성공으로 표시하지 않습니다.
- 결과 검증은 제한된 등록형 Node/Python 명령과 비밀값이 없는 닫힌 환경을 사용합니다. 신뢰하는 검증 코드를 실행하는 경계이며 악성 코드 샌드박스는 아닙니다. 임의 runner/lifecycle recipe는 미지원 상태로 남깁니다.
- 새 raw receipt는 `runtime-receipts/`, 공개 M3는 `receipts/`에 저장합니다. payload registry1.1과 envelope format1.0을 사용하며 과거1.0/V2 호환 경로를 보존합니다. release 집계는 별도 completion basis로 모든 자식 근거를 인증합니다.
- Finish는 외부 동작을 기록하고 PR/merge/discard를 반복하지 않은 채 검증·공개 실패를 복구합니다. Park/restore/downgrade-check는 호환되지 않는 기록을 보존하며 parked 작업을 완료로 부르지 않습니다.
- metric version2는 테스트와 기계적 추적 각35%, 센서와 mutation 각15%를 반영합니다. 필요한 관측이 없으면 null이며 목표 수용 여부는 별도로 판단합니다. 비교 주장은 같은 과제·모델·환경·metric 근거를 요구합니다.

## 평가와 연동

[harness 평가 bank](evals/harness/README.md)는 결정적 런타임 사례와 고정된12회 live smoke 절차를 정의합니다. 신뢰성 테스트와 작은 smoke 시험만으로 일반적인 효과나 모델 순위를 입증하지 않습니다.

관련 있고 승인된 경우 deep-review·deep-wiki·deep-memory를 사용할 수 있습니다. 선택적 제안이 이미 요청한 Finish를 중단하거나 외부 동작·메모리 쓰기 권한을 부여하지 않습니다. 가져온 데이터에도 M3 identity guard와 provenance를 적용합니다.

## 링크

- [CHANGELOG](CHANGELOG.ko.md) — 릴리스 히스토리
- [deep-suite](https://github.com/Sungmin-Cho/deep-suite) — 마켓플레이스와 sibling 플러그인
- [CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md)

## 라이선스

MIT
