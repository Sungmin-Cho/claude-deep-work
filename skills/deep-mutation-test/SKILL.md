---
name: deep-mutation-test
description: "Use when the user wants mutation testing on changed files to verify AI-generated test quality, with optional auto-fix loop for surviving mutants. Triggers on `/deep-mutation-test`, \"mutation test\", \"test quality\", \"mutation score\", \"뮤테이션 테스트\", \"테스트 품질 검증\". Primary callsite is Phase 4 (Test) but supports standalone manual use. Computes `killed / (killed + survived)` score (excludes NoCoverage), auto-fix loop (max 3 rounds) transitions back to Implement phase to add tests for survived mutants then re-runs."
user-invocable: true
---

## Invocation

이 스킬은 두 가지 경로로 호출됩니다 — 어느 쪽이든 본 SKILL 본문의 절차를 그대로 실행합니다:

1. **Claude Code 슬래시** — 사용자가 `/deep-mutation-test [args...]` 입력 (skill 의 `user-invocable: true` 가 슬래시 진입을 허용).
2. **타 에이전트 / Codex / Copilot CLI / Gemini CLI / SDK** — `Skill({ skill: "deep-work:deep-mutation-test", args: "..." })` 형태로 명시 invoke (cross-platform 표준 경로).

두 경로 모두 args 는 동일한 토큰 문자열로 전달되며, 본문 (`$ARGUMENTS` 자리) 의 파서가 동일하게 처리합니다.

## Inputs (skill args)

| 인자 | 의미 |
|---|---|
| (없음) | git diff 기반 changed files (세션 baseline 또는 HEAD~5..HEAD fallback) |
| `--full` | 전체 프로젝트 (expensive) |
| `--files <path>` | 특정 파일/디렉터리 명시 |

빈 args / 매칭되지 않는 토큰 → 본문의 default 분기로 진입.

## Prerequisites

이 entry skill 은 `deep-work-orchestrator` (Phase dispatch) 및 `deep-work-workflow` (reference skill — Phase 규약/Exit Gate/M3 envelope) 와 함께 동작합니다. 활성 deep-work 세션이 있을 때는 세션 state file (`.claude/deep-work.<SESSION_ID>.md`) 의 변수 (`work_dir`, `current_phase`, `active_slice` 등) 를 읽어 동작하며, 세션 외부에서도 standalone 실행이 가능한 경우 본문의 분기를 따릅니다.

**Cross-platform self-containment**: Claude Code 에서는 sibling skill 이 description 매칭으로 자동 로드됩니다. Codex / Copilot CLI / Gemini CLI / Agent SDK 에서 `Skill()` 로 호출 시 sibling auto-load 보장이 약할 수 있으므로, 본문은 self-contained 으로 보존되어 있습니다 — state file 해석, `$ARGUMENTS` 파싱, AskUserQuestion 분기, 출력 포맷이 인라인.


# /deep-mutation-test

Mutation testing for AI-generated test quality verification. Primarily used in Phase 4 (Test) but can be run manually.

## Usage

```
/deep-mutation-test                    # Test changed files (git diff based)
/deep-mutation-test --full             # Test entire project (expensive)
/deep-mutation-test --files src/auth   # Test specific files/directories
```

## How It Works

### Step 1: Determine Scope

**Primary source**: `git diff --name-only <baseline>..HEAD` where baseline is the session's starting commit.
**Fallback**: If no session, use `git diff --name-only HEAD~5..HEAD` (last 5 commits).
**Override**: `--files` flag specifies exact scope.

Filter files by detected ecosystem's file_extensions.

### Step 2: Check Mutation Tool

Read sensor detection cache. If mutation tool is not_installed:
- Display warning: "Mutation testing tool not installed for [ecosystem]. Install [tool] to enable."
- Exit gracefully (not an error).

### Step 3: Execute Mutation Testing

Run mutation tool with budget constraints from registry.json:
- `timeout`: max seconds per round (default 300)
- `max_mutants`: cap mutant count (default 200)

```bash
node "$PLUGIN_DIR/sensors/run-sensors.js" "<mutation_cmd>" "<parser>" "mutation" "advisory" <timeout>
```

### Step 4: Analyze Results

Parse mutation report:
- Mutation Score = killed / (killed + survived) × 100
- Exclude NoCoverage from denominator
- Tag possibly_equivalent mutants (NoCoverage + logging-related StringLiteral)

### Step 5: Auto-Fix Loop (if survived mutants found)

**IMPORTANT**: Follow existing deep-test pattern — Test phase does NOT allow code modifications.

For each round (max 3):

1. **Transition to Implement phase**: Set `current_phase: implement` in session state
2. **Present survived mutant feedback** in agent-readable format:
   ```
   [MUTATION_SURVIVED] N mutants survived (Score: X%)
   Transitioning to Implement phase for test improvement.

   MUTANT 1: file:line
     Mutation: MutatorName — changed `original` to `replacement`
     Impact: What this means for behavior
     ACTION: Specific test to add
   ```
3. **Agent writes tests** following TDD (RED → GREEN)
4. **Transition back**: Set `current_phase: test`
5. **Re-run mutation testing**
6. **Compare**: If score improved, continue. If no improvement after round, stop.

After 3 rounds or all killable mutants eliminated:
- Record final results in session receipt
- Display summary: score, rounds, fixed/remaining mutants

### Step 6: Record Results

Add to session receipt:
```json
{
  "mutation_testing": {
    "tool": "<tool>",
    "status": "completed",
    "total_mutants": 45,
    "killed": 39,
    "survived": 4,
    "equivalent": 2,
    "score": 90.7,
    "auto_fix_rounds": 2,
    "auto_fixed_mutants": 3,
    "remaining_survived": []
  }
}
```

## Not Applicable Handling

If mutation tool is not installed, record in receipt:
```json
{ "mutation_testing": { "status": "not_applicable", "reason": "tool not installed" } }
```
Quality Score treats this as excluded from denominator (no penalty).
