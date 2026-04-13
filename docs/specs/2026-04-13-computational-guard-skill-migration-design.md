# v6.1.0 Design Spec: Computational Guard + Command → Skill Migration

## Overview

2026-04-12 세션에서 발생한 Inferential Enforcement 실패 3건의 근본 원인을 해결한다.
두 가지 구조적 개선을 동시에 진행:

1. **Computational Guard (P0 + P1)**: Hook 기반 강제 — worktree 경로 hard block + phase 전환 조건 injection
2. **Command → Skill 전환**: 6개 core phase command를 독립 Skill로 분리, auto-flow orchestrator 재설계

### 해결 대상

| 문제 | 근본 원인 | 해결책 |
|------|----------|--------|
| Worktree 격리 미적용 | Write/Edit 경로를 검증하는 computational enforcement 부재 | P0: PreToolUse hook에서 경로 hard block |
| Team 모드 미적용 | Phase 전환 시 조건이 컨텍스트에서 밀려남 | P1: PostToolUse hook에서 조건 injection |
| Attention 희석 | 수백~수천 줄 지시문이 한번에 주입 | Skill 분리로 phase별 context 격리 |
| Inferential 체이닝 | "Read and follow" 패턴의 구조적 취약 | Skill tool 호출로 명시적 dispatch |
| 암묵적 조건 전달 | state 파일 간접 참조에 의존 | Skill args 명시적 전달 + state 자동 로드 + hook 강제 |

### Version

6.1.0

---

## Architecture

### Skill 런타임 동작 (Claude Code)

Claude Code의 `Skill` tool은 다음과 같이 동작한다:

- `Skill("deep-research", args="--session=abc")` 호출 시, 해당 skill의 SKILL.md 내용이 **현재 대화 context에 로드**됨
- `args`는 SKILL.md 내부에서 `$ARGUMENTS`로 접근 가능
- **별도 context window를 생성하지 않음** — 동일 context 내에서 실행

따라서 Skill 전환이 제공하는 이점은:
- **context 길이 축소**: 이전 phase의 수백 줄 지시문이 사라지고, 현재 phase SKILL.md만 활성
- **조건의 fresh 로드**: 호출 시점에 args로 조건이 명시적으로 전달
- **명시적 dispatch point**: "Read and follow"라는 텍스트 지시 대신 tool 호출이라는 구조적 경계

Skill 전환이 제공하지 **않는** 것:
- 완전한 context 격리 (별도 context window)
- args의 구조적/타입 검증 (LLM이 텍스트로 해석)

이 한계를 보완하기 위해 3중 방어(Skill args + state 자동 로드 + hook enforcement)를 적용한다.

### 3-Layer Design

```
Layer 1: Entry Points (Commands → Thin Wrappers)
  commands/deep-work.md      → Skill("deep-work-orchestrator")
  commands/deep-research.md  → Skill("deep-research")
  commands/deep-plan.md      → Skill("deep-plan")
  commands/deep-implement.md → Skill("deep-implement")
  commands/deep-test.md      → Skill("deep-test")
  commands/deep-brainstorm.md→ Skill("deep-brainstorm")
  commands/deep-finish.md    → (유지: utility command)
  commands/deep-status.md    → (유지: utility command)
  ... 나머지 utility commands → (유지: 구조 변경 없음)

Layer 2: Execution Logic (Skills)
  skills/
    deep-work-orchestrator/SKILL.md  ← 초기화 + auto-flow
    deep-brainstorm/SKILL.md         ← Phase 0
    deep-research/SKILL.md           ← Phase 1
    deep-plan/SKILL.md               ← Phase 2
    deep-implement/SKILL.md          ← Phase 3
    deep-test/SKILL.md               ← Phase 4
    shared/references/               ← 공통 reference 13개

Layer 3: Computational Enforcement (Hooks)
  hooks/scripts/
    phase-guard.sh        ← 기존 + P0: worktree 경로 hard block
    phase-transition.sh   ← P1 신규: phase 전환 조건 injection
    file-tracker.sh       ← 기존: 파일 변경 추적
    session-end.sh        ← 기존: 세션 종료 처리
```

### 3중 방어 (Defense-in-Depth)

조건 전달의 3중 보장:

1. **1차 — Skill args 명시적 전달**: Orchestrator가 `Skill("deep-research", args="--session=abc --worktree=/path --team")` 형태로 호출. args는 SKILL.md 내부에서 `$ARGUMENTS`로 접근.
2. **2차 — Skill 내 state 자동 로드**: 각 Skill 진입 시 첫 동작으로 state 파일 읽기. Standalone 호출 시 primary path, auto-flow 시 args의 fallback.
3. **3차 — Hook computational enforcement**: P0 worktree hard block + P1 phase 전환 injection. Skill 전환과 독립적으로 작동하는 코드 레벨 강제.

> **Note**: Skill 호출은 별도 context window를 생성하지 않으므로, 1차 방어가 "구조적 보장"이 아닌 "context 내 명시적 전달"임을 인지해야 한다. 핵심 조건(worktree path)은 3차 hook에서 computational하게 보장된다.

### Data Flow

```
사용자 → /deep-work "task"
  → commands/deep-work.md (thin wrapper)
    → Skill("deep-work-orchestrator", args="task description")
      → 초기화 (session, profile, worktree)
      → Skill("deep-research", args="--session=abc --worktree=/path --team=team")
        → [State 자동 로드] → [Phase 실행] → [산출물 생성]
      → [Auto Review] → [Main 에이전트 판단] → [1차 승인] → [수정] → [2차 승인]
      → Skill("deep-plan", args="--session=abc --worktree=/path --team=team")
        → ...
```

---

## P0: Worktree Path Guard

### Hook Type

PreToolUse — Write/Edit/MultiEdit/Bash 대상

### 삽입 위치

`phase-guard.sh` 내부, ownership check (line ~107) 직후, phase 분기 (line ~110) 이전.

이유:
- Worktree 경로 검증은 phase와 무관하게 모든 단계에서 적용
- Ownership check(multi-session 보호)보다 후순위
- Phase fast path보다 선순위 (implement phase에서도 보호)

### Logic

```bash
# ─── P0: WORKTREE PATH ENFORCEMENT ─────────────────────────
if [[ "$WORKTREE_ENABLED" == "true" && -n "$WORKTREE_PATH" && -n "$_OWN_FILE_NORM" ]]; then
  WORKTREE_PATH_NORM="$(normalize_path "$WORKTREE_PATH")"

  if [[ "$_OWN_FILE_NORM" != "$WORKTREE_PATH_NORM"/* && "$_OWN_FILE_NORM" != "$WORKTREE_PATH_NORM" ]]; then
    IS_META=false
    for pattern in ".claude/" ".deep-work/" ".deep-review/" ".deep-wiki/"; do
      if [[ "$_OWN_FILE_NORM" == *"$pattern"* ]]; then
        IS_META=true
        break
      fi
    done

    if [[ "$IS_META" == "false" ]]; then
      cat <<JSON
{"decision":"block","reason":"⛔ Worktree Guard: worktree 외부 파일 수정 차단\n\n대상: $_OWN_FILE\n허용 경로: $WORKTREE_PATH/\n\nworktree 내에서 작업해주세요."}
JSON
      exit 2
    fi
  fi
fi
```

### 변수 소싱

State 파일 파싱 블록에 추가:

```bash
WORKTREE_ENABLED="$(grep '^worktree_enabled:' "$STATE_FILE" | awk '{print $2}')"
WORKTREE_PATH="$(grep '^worktree_path:' "$STATE_FILE" | head -1 | sed 's/^worktree_path:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//')"
```

### Coverage

| Tool | 커버 방식 |
|------|----------|
| Write/Edit/MultiEdit | `file_path` JSON 필드 → `_OWN_FILE_NORM` |
| Bash | `detectBashFileWrite()` → `extractBashTargetFile()` → `_OWN_FILE_NORM` |

### 예외 경로

| 경로 패턴 | 허용 | 이유 |
|-----------|------|------|
| `{worktree_path}/**` | O | 정상 작업 경로 |
| `**/.claude/**` | O | 플러그인 설정, state 파일 |
| `**/.deep-work/**` | O | 세션 아티팩트 |
| `**/.deep-review/**` | O | 리뷰 아티팩트 |
| `**/.deep-wiki/**` | O | 위키 아티팩트 |
| 그 외 | X | worktree 격리 위반 |

### Edge Cases

- `worktree_enabled: false` → 전체 검증 skip
- `WORKTREE_PATH` 비어있음 → 검증 skip
- `_OWN_FILE_NORM` 비어있음 → 검증 skip (후속 fail-closed 로직이 처리)

---

## P1: Phase Transition Injector

### Hook Type

PostToolUse — Write/Edit/MultiEdit 대상 (state 파일 변경 감지)

### Hook 등록

`hooks/hooks.json` PostToolUse 배열에 추가:

```json
{
  "matcher": "Write|Edit|MultiEdit",
  "command": "bash hooks/scripts/phase-transition.sh \"$TOOL_INPUT\""
}
```

### 감지 메커니즘

Phase cache 파일로 이전 phase를 추적:

```
.claude/.phase-cache-{SESSION_ID}   ← 마지막으로 확인된 phase 값
```

**Stale cache 방지**:
- `session-end.sh`에서 세션 종료 시 cache 파일 삭제
- `deep-resume` 시 cache 파일을 현재 state의 `current_phase`로 재초기화
- Cache 파일이 존재하지 않으면 항상 injection 발동 (fail-open → 불필요한 injection은 무해)

### Script Flow

```bash
#!/usr/bin/env bash
# hooks/scripts/phase-transition.sh

TOOL_INPUT="$1"
source "$(cd "$(dirname "$0")" && pwd)/utils.sh"

# 1. State 파일 대상인지 확인
FILE_PATH="$(extract_file_path "$TOOL_INPUT")"
[[ "$FILE_PATH" != *".claude/deep-work."*".md" ]] && exit 0

# 2. Session ID 추출
SESSION_ID="$(echo "$FILE_PATH" | grep -o 'deep-work\.[^.]*' | sed 's/deep-work\.//')"
[[ -z "$SESSION_ID" ]] && exit 0

# 3. 현재 phase 읽기
STATE_FILE="$FILE_PATH"
[[ ! -f "$STATE_FILE" ]] && exit 0
NEW_PHASE="$(grep '^current_phase:' "$STATE_FILE" | awk '{print $2}')"

# 4. Cache 비교
CACHE_FILE=".claude/.phase-cache-${SESSION_ID}"
OLD_PHASE=""
[[ -f "$CACHE_FILE" ]] && OLD_PHASE="$(cat "$CACHE_FILE")"
[[ "$NEW_PHASE" == "$OLD_PHASE" ]] && exit 0

# 5. Cache 업데이트
echo "$NEW_PHASE" > "$CACHE_FILE"

# 6. State에서 조건 읽기
WORKTREE_ENABLED="$(grep '^worktree_enabled:' "$STATE_FILE" | awk '{print $2}')"
WORKTREE_PATH="$(grep '^worktree_path:' "$STATE_FILE" | head -1 | sed 's/^worktree_path:[[:space:]]*//' | sed 's/^"//' | sed 's/"$//')"
TEAM_MODE="$(grep '^team_mode:' "$STATE_FILE" | awk '{print $2}')"
CROSS_MODEL="$(grep '^cross_model:' "$STATE_FILE" | awk '{print $2}')"
TDD_MODE="$(grep '^tdd_mode:' "$STATE_FILE" | awk '{print $2}')"

# 7. Checklist injection (stdout → LLM context)
echo ""
echo "━━━ Phase Transition: ${OLD_PHASE:-init} → ${NEW_PHASE} ━━━"
echo ""

[[ "$WORKTREE_ENABLED" == "true" && -n "$WORKTREE_PATH" ]] && \
  echo "📂 worktree_path: $WORKTREE_PATH" && \
  echo "   → 모든 파일 작업은 이 경로 내에서 수행"

[[ "$TEAM_MODE" == "team" ]] && \
  echo "👥 team_mode: team" && \
  echo "   → TeamCreate 사용하여 병렬 에이전트 실행"

[[ -n "$CROSS_MODEL" && "$CROSS_MODEL" != "false" && "$CROSS_MODEL" != "none" ]] && \
  echo "🔄 cross_model: $CROSS_MODEL" && \
  echo "   → 교차 검증 실행 필요"

[[ "$NEW_PHASE" == "implement" ]] && \
  echo "🧪 tdd_mode: ${TDD_MODE:-strict}" && \
  echo "   → TDD 프로토콜 준수 (테스트 먼저)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

### PostToolUse stdout의 LLM context 주입

Claude Code의 hook 런타임에서:
- **PreToolUse**: stdout으로 `{"decision":"block","reason":"..."}` JSON을 반환하면 tool 실행을 차단 (documented protocol)
- **PostToolUse**: stdout 출력이 tool 실행 결과의 일부로 LLM에게 표시됨 (Claude Code documented behavior)

P1은 이 PostToolUse stdout → LLM context 경로를 활용한다. 기존 `file-tracker.sh`는 side-effect만 수행하고 stdout을 사용하지 않지만, 이는 설계 선택이지 기술적 제약이 아니다.

### P0 + P1 관계

```
P0 (hard block): worktree 경로 위반 → 차단. 절대 통과 불가.
P1 (injection):  team_mode, cross_model 등 → 최적 타이밍에 리마인드.
```

---

## Phase Skill Structure

### 공통 SKILL.md 템플릿

```markdown
---
name: deep-{phase}
version: 6.1.0
description: "Phase N — {한줄 설명}"
---

# Section 1: State 로드 (필수 — 건너뛰기 금지)

1. Session ID 결정
   - args에 --session=ID → 사용
   - 없으면 → .claude/deep-work-sessions.json에서 active session 탐색
2. State 파일 읽기: .claude/deep-work.{SESSION_ID}.md
3. 조건 변수 확인:
   - worktree_path — args 우선, 없으면 state에서
   - team_mode — args 우선, 없으면 state에서
   - cross_model — args 우선, 없으면 state에서

# Section 2: Phase 실행

{Phase별 핵심 로직 — 200줄 이내}
{상세 지침은 Read("shared/references/xxx-guide.md")로 위임}

# Section 3: 완료

1. Phase 산출물 검증
2. (Brainstorm/Implement/Test만) State 업데이트: current_phase → {next}
3. (Research/Plan은) Orchestrator가 리뷰+승인 후 current_phase 변경
```

### SKILL.md vs References 분리 원칙

| SKILL.md (100-200줄) | References |
|---|---|
| 흐름 제어 (step 순서, 분기) | 상세 실행 지침 |
| State 로드/업데이트 | Team 모드 에이전트 설정 |
| Solo/Team 분기 판단 | TDD 상태 머신 규칙 |
| 산출물 파일명/위치 정의 | 템플릿, 프롬프트, 체크리스트 |

### Phase별 예상 줄 수 (context 로드 기준)

아래 축소율은 **한 번에 LLM context에 로드되는 지시문 줄 수**의 감소를 나타낸다. 시스템 전체의 총 instruction 줄 수는 동일하거나 소폭 증가한다 (각 Skill의 state 로드 boilerplate 반복 + reference 파일 유지). 핵심 이점은 "전체 복잡도 감소"가 아니라 **attention 집중도 향상**이다.

| Phase | Command (현재, 한번에 로드) | Skill (제안, 한번에 로드) | Context 축소율 |
|-------|---------------------------|-------------------------|--------------|
| deep-brainstorm | 217줄 | ~100줄 | 54% |
| deep-research | 612줄 | ~150줄 | 76% |
| deep-plan | 736줄 | ~150줄 | 80% |
| deep-implement | 890줄 | ~200줄 | 78% |
| deep-test | 726줄 | ~120줄 | 83% |
| deep-work (orchestrator) | 1,193줄 | ~250줄 | 79% |

### References Directory

기존 `skills/deep-work-workflow/references/` → `skills/shared/references/`로 이동:

```
skills/shared/references/
  research-guide.md
  planning-guide.md
  plan-templates.md
  implementation-guide.md
  testing-guide.md
  model-routing-guide.md
  phase-review-gate.md
  review-gate.md
  review-approval-workflow.md   ← 신규: Research/Plan 리뷰 6단계 프로토콜
  solid-guide.md
  solid-prompt-guide.md
  notification-guide.md
  insight-guide.md
  zero-base-guide.md
```

---

## Orchestrator Skill

### 역할

초기화 + auto-flow dispatch. Phase별 실행은 위임.

### 구조

```markdown
---
name: deep-work-orchestrator
version: 6.1.0
description: "Evidence-Driven Development — 초기화 + Auto-flow Orchestration"
---

# Step 1: 세션 초기화
- 기존 active session 확인 → resume 제안 or 신규 생성
- 프로필 로드 (.claude/deep-work-profile.yaml)
- 세션 설정 결정 (team_mode, tdd_mode, cross_model, model_routing)
- Git 환경 감지 + Worktree 생성
- State 파일 + Registry 생성

# Step 2: 조건 변수 조립
ARGS="--session={SESSION_ID}"
if worktree_enabled: ARGS += " --worktree={worktree_path}"
if team_mode=team:   ARGS += " --team"
if cross_model:      ARGS += " --cross-model={value}"
if tdd_mode:         ARGS += " --tdd={value}"

# Step 3: Auto-flow Dispatch

## 3-1. Brainstorm (skip 가능)
Skill("deep-brainstorm", args=ARGS)

## 3-2. Research
Skill("deep-research", args=ARGS)
→ Review + Approval Workflow (아래 참조)

## 3-3. Plan
Skill("deep-plan", args=ARGS)
→ Review + Approval Workflow (아래 참조)

## 3-4. Implement
Skill("deep-implement", args=ARGS + " --tdd={tdd_mode}")

## 3-5. Test
Skill("deep-test", args=ARGS)
실패 → 3-4로 복귀 (retry loop)

## 3-6. Finish
완료 처리: merge/PR/keep/discard 선택
```

### Review + Approval Workflow (Research, Plan)

Research와 Plan 완료 후 실행되는 6단계 워크플로우.
상세 프로토콜은 `shared/references/review-approval-workflow.md`에 정의 (신규 reference).
Orchestrator SKILL.md에는 아래 요약만 포함하여 줄 수를 제어한다.

**Orchestrator 내 요약 (SKILL.md에 포함되는 부분):**

```
Phase Skill 완료 후:
1. 산출물 Read → Auto Review (subagent-opus + codex)
2. Main 에이전트가 findings 판단 → 동의/비동의 분류
3. 1차 승인: 수정 항목을 사용자에게 제시 (AskUserQuestion)
4. 승인된 항목 반영
5. 2차 승인: 최종 문서 확인 + 다음 phase 진행 (AskUserQuestion)
→ 상세: Read("shared/references/review-approval-workflow.md")
```

**Reference 파일에 포함되는 상세 프로토콜:**

```
# Review + Approval Workflow (shared/references/review-approval-workflow.md)

## Step 1: 산출물 로드
- Phase Skill 완료 후, Orchestrator가 산출물(research.md / plan.md)을 Read
- 산출물의 핵심 내용을 context에 확보

## Step 2: Auto Review
- Agent(subagent-opus): 구조적 리뷰 (산출물 경로 전달)
- Agent(codex): 교차 검증 (설치된 경우, 산출물 경로 전달)
- 두 리뷰어의 findings를 수집

## Step 3: Main 에이전트 판단
- 모든 findings를 읽고 자체 판단
- 각 finding에 대해 동의/비동의 + 근거 정리
- 동의 항목: 수정 대상으로 분류
- 비동의 항목: 비동의 근거와 함께 표시

## Step 4: 1차 승인 요청 (수정 항목)
AskUserQuestion:
  "리뷰 결과 중 반영이 필요하다고 판단한 항목:

   반영 제안:
   1. {finding} — (동의 근거)
   2. {finding} — (동의 근거)

   반영하지 않는 항목:
   - {finding} — (비동의 근거)

   → 전체 승인 / 선택 승인 / 거부"

## Step 5: 수정 적용
- 사용자가 승인한 항목만 산출물에 반영

## Step 6: 2차 승인 요청 (최종 확인 + 다음 phase)
AskUserQuestion:
  "수정 완료. 최종 문서를 확인해주세요.
   1) 승인 — 다음 phase로 진행
   2) 추가 수정 요청
   3) 이 phase 재실행"

승인 → current_phase 업데이트 → 다음 Skill 호출
```

> **Context 관리 주의**: Orchestrator가 Phase Skill 완료 후 산출물을 Read해야 한다. 이는 Skill 전환의 context 축소 이점을 일부 상쇄하지만, 리뷰를 위해 필수적인 비용이다. 산출물의 요약본(executive summary)만 Read하는 것도 고려할 수 있다.

### current_phase 변경 주체

| Phase | Auto Review | 사용자 승인 | current_phase 변경 주체 |
|-------|------------|------------|----------------------|
| Brainstorm | 선택적 | 불필요 | Phase Skill |
| **Research** | **필수** | **필수** | **Orchestrator** |
| **Plan** | **필수** | **필수** | **Orchestrator** |
| Implement | Phase Review | 불필요 | Phase Skill |
| Test | 자동 | 불필요 | Phase Skill |

---

## Command Thin Wrappers

### 변환 대상 (6개 core phase commands)

각 command는 Skill 호출 1줄로 축소:

```markdown
---
allowed-tools: {기존과 동일}
---

# /deep-{phase}

{한줄 설명}

Skill("deep-{phase}", args="$ARGUMENTS")
```

### Standalone 호출

| 호출 방식 | args | 조건 소싱 |
|-----------|------|----------|
| Auto-flow (Orchestrator 경유) | --session=ID --worktree=/path --team | args 우선 |
| Standalone (직접 호출) | 없음 또는 사용자 입력 | state 파일 자동 탐색 |

### 변환하지 않는 Commands

다음 utility commands는 Skill 전환 대상이 아니며 command 구조를 유지한다:

deep-status, deep-finish, deep-fork, deep-resume, deep-report,
deep-receipt, deep-insight, deep-assumptions, deep-debug,
deep-cleanup, deep-history, deep-slice, deep-phase-review,
deep-mutation-test, deep-sensor-scan, drift-check, solid-review

> **주의: References 경로 수정 필요**. 위 commands 중 `skills/deep-work-workflow/references/`를 참조하는 파일들은 `skills/shared/references/`로 경로를 업데이트해야 한다. 확인된 참조:
> - `deep-brainstorm.md`: `references/review-gate.md`
> - `deep-phase-review.md`: `references/phase-review-gate.md`
> - `solid-review.md`: `references/solid-guide.md`
> - `deep-plan.md` (thin wrapper 전환 대상이지만, 전환 전 과도기에 영향)
>
> Migration Phase B에서 references 이동 시 함께 처리한다.

---

## Migration Strategy

### 실행 순서

```
Phase A: Hooks (P0 + P1)
  → 구조 변경 없이 즉시 적용
  → 수정: hooks.json, phase-guard.sh
  → 신규: phase-transition.sh

Phase B: Skill 인프라 구축
  → 디렉토리 생성, SKILL.md 작성
  → references/ 이동 (deep-work-workflow/references/ → shared/references/)
  → utility commands의 references 경로 업데이트
  → review-approval-workflow.md 신규 생성
  → 신규: 6개 skill directory + shared/references/

Phase C: Command → Thin Wrapper
  → 순서: brainstorm → research → plan → test → implement
  → 각 전환 후 standalone 테스트

Phase D: Orchestrator 전환
  → deep-work.md → thin wrapper
  → deep-work-orchestrator SKILL.md 활성화

Phase E: 검증 + 정리
  → E2E 테스트 (auto-flow + standalone)
  → plugin.json 업데이트
  → CLAUDE.md, CHANGELOG 업데이트
  → 버전 범프: 6.1.0
```

### 롤백 안전성

| Phase | 롤백 방법 |
|-------|----------|
| A (Hooks) | hooks.json 항목 제거, 스크립트 삭제 |
| B (Skill 생성) | 디렉토리 삭제 (기존 command 미변경) |
| C (Wrapper 전환) | git에서 기존 command 복원 |
| D (Orchestrator) | git에서 기존 deep-work.md 복원 |

Phase A-B는 기존 구조와 공존 가능. C 진입 전까지 언제든 롤백 가능.
