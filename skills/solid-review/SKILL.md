---
name: solid-review
description: "Use when the user wants SOLID design-principles code review — evaluating SRP / OCP / LSP / ISP / DIP compliance on a target file/directory/glob. Triggers on `/solid-review`, \"SOLID review\", \"design review\", \"design principles\", \"SOLID 검증\", \"디자인 리뷰\", \"원칙 검증\", or auto-invocation by `/deep-test` as the Advisory Quality Gate (does not block). Review-only — does NOT modify code. Saves results to `$WORK_DIR/solid-review.md` when in workflow mode."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/solid-review [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:solid-review", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) | Auto-detect scope: 활성 세션의 changed files, 없으면 현재 디렉터리 |
| `<target>` | File path / directory / glob pattern |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


> **Quality Gate (v6.2.4)** — `/deep-test`가 Advisory Gate로 자동 실행합니다. 특정 파일/디렉터리에 대한 독립 SOLID 검증이 필요할 때 직접 사용하세요.
> Standalone: `/solid-review [target]`

# SOLID Design Review

You are performing a **SOLID Design Review** — analyzing code against the 5 SOLID design principles to evaluate design quality and suggest improvements.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Critical Constraints

- **DO NOT modify any code files.** This is a review-only operation.
- **Read, analyze, and report findings.**
- **Save review results to file when in workflow mode.**

## Instructions

### 1. Determine operating mode

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `.claude/deep-work.local.md`

Set `$STATE_FILE` to the resolved path.

Check if `$STATE_FILE` exists and has an active session (`current_phase` is not `idle` and not empty).

**Workflow Mode** (active deep-work session):
- Read `work_dir` from the state file
- Set `WORK_DIR` to the value of `work_dir`
- Read `$WORK_DIR/plan.md` to extract the list of files to review (from "Files to Modify" section)
- Read `$WORK_DIR/research.md` for architectural context (Executive Summary section only)
- Review scope: files listed in plan.md that were actually modified during implementation

**Standalone Mode** (no active session):
- If `$ARGUMENTS` is provided: use as target (file path, directory, or glob pattern)
- If `$ARGUMENTS` is empty: detect scope automatically:
  1. Check `git diff --name-only HEAD~1` for recently changed files
  2. If not a git repo or no changes, use current directory
- Review scope: all code files in detected scope (exclude node_modules, .git, __pycache__, build, dist, etc.)

### 2. Collect review targets

Gather the list of files to review. For each file:
- Read the file contents
- Skip files that are clearly not code (README.md, .json config, .env, etc.)
- Skip files smaller than 5 lines (trivial)
- Skip auto-generated files (migrations, lock files, bundled output)

If the total number of files exceeds 20, prioritize:
1. Files with the most lines of code
2. Files with class/interface definitions
3. Files explicitly listed in plan.md (workflow mode)

Display progress:
```
SOLID 리뷰 대상: [N]개 파일
  - src/auth/service.ts (245 lines)
  - src/models/user.ts (180 lines)
  - ...
```

### 3. Analyze each principle

For each file (or logical group of related files), evaluate against all 5 SOLID principles.

Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/solid-guide.md` for the detailed checklist.

**Analysis approach**:
- Do NOT mechanically check every rule against every file
- Focus on **violations that actually matter** in the given context
- Consider the project's scale and maturity (KISS balance)
- A small utility script doesn't need DIP — flag it only in core domain logic

For each principle, assign one of:
- **준수**: No violations found, or principle is not applicable
- **개선 권장**: Minor violations that would improve maintainability
- **위반**: Clear violations that will cause maintenance problems

### 4. Generate scorecard

#### Per-file scorecard (for each reviewed file):

```markdown
### [filename] ([N] lines)

| 원칙 | 상태 | 요약 |
|------|------|------|
| SRP  | [status] | [1-line summary] |
| OCP  | [status] | [1-line summary] |
| LSP  | [status] | [N/A or finding] |
| ISP  | [status] | [1-line summary] |
| DIP  | [status] | [1-line summary] |
```

#### Overall scorecard:

```markdown
## 종합 SOLID 스코어카드

| 원칙 | 전체 상태 | 위반 파일 수 | 핵심 발견 |
|------|----------|-------------|----------|
| SRP  | [status] | N/M         | [most common issue] |
| OCP  | [status] | N/M         | — |
| LSP  | [status] | N/M         | — |
| ISP  | [status] | N/M         | [most common issue] |
| DIP  | [status] | N/M         | [most common issue] |

**총점**: N/5 원칙 준수
**판정**: 개선 권장 (Advisory — 워크플로우 차단 없음)
```

### 5. Generate refactoring suggestions

For each violation or improvement finding, provide a concrete refactoring suggestion. Limit to **top 5 suggestions** sorted by impact:

```markdown
## 리팩토링 제안

### 1. [SRP] PlayerController.cs — 책임 분리
**현재**: 이동, 입력, UI 업데이트가 한 클래스에 혼재
**제안**: PlayerMover, PlayerInput, PlayerUI로 분리
**우선순위**: 높음

### 2. [DIP] AuthService.ts — 추상화 도입
**현재**: `new DatabaseClient()` 직접 생성
**제안**: `IDatabaseClient` 인터페이스 추출, 생성자 주입
**우선순위**: 중간
```

### 6. AI 프롬프트 개선 제안 (워크플로우 모드, 선택적)

If running in **workflow mode** and clear SOLID violations were found, read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/solid-prompt-guide.md` and suggest how plan.md could be improved:

```markdown
## AI 프롬프트 개선 제안

다음 plan 작성 시 아래 조건을 추가하면 SOLID 위반을 사전에 방지할 수 있습니다:
- "각 클래스는 단일 책임만 담당하도록 분리할 것 (SRP)"
- "새 기능 추가 시 기존 코드 수정 없이 확장 가능한 구조로 설계할 것 (OCP)"
- "구체 클래스 대신 인터페이스에 의존하도록 구현할 것 (DIP)"
```

### 7. Save results

**Workflow Mode**:
- Write results to `$WORK_DIR/solid-review.md`
- Display summary in terminal

**Standalone Mode**:
- Display full results in terminal
- Ask user: "리뷰 결과를 파일로 저장할까요? (기본: 아니오)"
- If yes, save to `./solid-review.md`

### 8. Workflow integration (workflow mode only)

If called as a Quality Gate during Test phase:
- Record results in `quality-gates.md` as Advisory entry
- Violations do NOT block the workflow — record warning only

If called outside the Test phase:
- Still run the review
- Note: "deep-work 워크플로우 활성 상태 — 결과가 $WORK_DIR/solid-review.md에 저장됩니다"
