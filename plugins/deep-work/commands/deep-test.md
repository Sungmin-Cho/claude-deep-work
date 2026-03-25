---
allowed-tools: Bash, Read, Write, Glob, Grep, Agent
description: "Phase 4: Run comprehensive tests and verify implementation"
---

# Deep Test — Phase 4: Comprehensive Verification

You are in the **Test** phase of a Deep Work session. This phase runs comprehensive verification on the implemented code and manages the implement-test retry loop.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Critical Constraints

🚫 **DO NOT modify any code files in this phase.**
🚫 **Code modifications are blocked by Phase Guard.**
✅ **Only run tests, analyze results, and update documentation.**
✅ **If tests fail, the system will transition back to implement phase for fixes.**

## Instructions

### 1. Verify prerequisites

Read `.claude/deep-work.local.md` and verify:
- `current_phase` is `test`
- plan.md's Slice Checklist has all items marked as `[x]`

If not, inform the user which prerequisite step is missing.

Extract `work_dir`, `test_retry_count`, and `max_test_retries` from the state file.
Set `WORK_DIR` to the value of `work_dir`.

**Record start time**: Update `test_started_at` in the state file with the current ISO timestamp.

### 1-1. Model Routing Check

Read `model_routing` from the state file. Default: `{research: "sonnet", plan: "main", implement: "sonnet", test: "haiku"}`.

If `model_routing.test` is NOT "main":
  - Use the Agent tool to spawn a test agent:
    - `model`: value of `model_routing.test` (e.g., "haiku")
    - `prompt`: Include ALL test instructions (Sections 2, 3, 4), the WORK_DIR path, and test_retry_count info
    - `description`: "Deep test verification"
  - Wait for Agent to complete (it will write test results)
  - Read Agent's output to determine pass/fail
  - Skip to [Section 5: Determine outcome](#5-determine-outcome)

If `model_routing.test` is "main":
  - Proceed with existing behavior below

### 1-2. Built-in Required Gate: Receipt Completeness (v4.0)

Check that all slices have receipt files before proceeding.

**Steps**:
1. Parse plan.md's Slice Checklist to get all SLICE-NNN IDs
2. For each slice, check if `$WORK_DIR/receipts/SLICE-NNN.json` exists
3. For each existing receipt, validate it has `status: "complete"` or `status: "partial"`
4. If any slice has no receipt file → **FAIL**:
   ```
   ❌ Receipt Completeness 실패:
      SLICE-001: ✅ complete
      SLICE-002: ❌ receipt 없음
      SLICE-003: ⚠️ partial (incomplete TDD cycle)

   Implement 단계로 복귀하여 누락된 receipt를 생성하세요.
   ```
5. If all receipts exist → **PASS**, proceed to Plan Alignment

### 1-3. Built-in Required Gate: Plan Alignment (Drift Detection)

If `$WORK_DIR/plan.md` exists, perform Plan Alignment check **before** any other verification. This gate runs automatically — it does not need to be listed in the Quality Gates table.

**Steps**:
1. Parse plan.md to extract:
   - **File list**: Files listed in "Files to Modify" / "수정 대상 파일" / "File Changes" sections
   - **Implementation items**: Checklist items (`- [ ]`, `- [x]`) and numbered steps
   - **Design decisions**: Explicit architectural instructions in "Design Decisions" / "설계 지침" sections

2. Get comparison baseline:
   - Read `plan_approved_at` from state file → find nearest commit via `git log --before="[timestamp]" -1 --format=%H`
   - If no timestamp, use plan.md mtime as baseline
   - If neither available, use `HEAD~10` with a warning

3. Run `git diff --name-only [baseline]..HEAD` to get changed files

4. Compare and classify each plan item:
   - **Implemented**: Plan item reflected in actual code → PASS
   - **Not implemented**: Plan item missing from code → FAIL
   - **Out of scope**: Code change not in plan (exclude test files, configs) → WARNING
   - **Design drift**: Implementation contradicts plan's design decisions → FAIL

5. Generate `$WORK_DIR/drift-report.md` with the full comparison report

6. **Determine result**:
   - If not-implemented = 0 AND design-drift = 0 → **PASS** (continue to other gates)
   - If not-implemented > 0 OR design-drift > 0 → **FAIL** (Required Gate failure)
     - Display: "Plan Alignment 실패 — 미구현 [N]건, 설계 이탈 [N]건"
     - Skip all remaining gates (both Required and Advisory)
     - Treat as test failure → follow existing retry logic (Section 5 "Some tests fail")

For detailed comparison logic, see the `/drift-check` command.

### 2. Auto-detect verification commands

Read project root configuration files to identify available verification commands:

| Config File | Detection Targets |
|-------------|------------------|
| `package.json` | `scripts.test`, `scripts.lint`, `scripts.typecheck`, `scripts.check` |
| `pyproject.toml` | `[tool.pytest]`, `[tool.mypy]`, `[tool.ruff]` |
| `Makefile` | `test`, `lint`, `check` targets |
| `Cargo.toml` | `cargo test`, `cargo clippy` |
| `go.mod` | `go test ./...`, `go vet ./...` |

Present detected commands to the user for confirmation:

```
🧪 감지된 검증 명령어:
  1. ✅ [command 1]
  2. ✅ [command 2]
  3. ✅ [command 3]

추가할 명령어가 있나요? (없으면 Enter)
```

If no commands are detected, ask the user to provide verification commands manually.

### 2-1. Parse Quality Gates from plan.md

Read `$WORK_DIR/plan.md` and look for a `## Quality Gates` section containing a markdown table:

```markdown
## Quality Gates

| Gate | 명령어 | 필수 | 임계값 |
|------|--------|------|--------|
| Type Check | `npx tsc --noEmit` | ✅ | — |
| Lint | `npm run lint` | ✅ | — |
| Unit Test | `npm test` | ✅ | — |
| Coverage | `npm test -- --coverage` | ⚠️ | ≥80% |
| Bundle Size | `npm run build && stat -f%z dist/main.js` | ⚠️ | ≤512000 |
```

If a Quality Gates section exists:
- Parse the table into a list of gates
- Each gate has: name, command, type (✅=required, ⚠️=advisory, ℹ️=insight), threshold
- **Use these gates instead of auto-detected commands** (Section 2 results are overridden)
- Execute gates in the order listed in the table
- For required (✅) gates: failure triggers implement rollback (same as current test failure)
- For advisory (⚠️) gates: failure records a warning only, does NOT trigger rollback
- For insight (ℹ️) gates: results recorded for informational purposes only — always treated as pass

If no Quality Gates section exists:
- Use the auto-detected commands from Section 2 (existing behavior, backward compatible)

### 3. Run verification

Execute detected commands sequentially. Record each result:

| 검증 | 명령어 | 결과 | 메시지 |
|------|--------|------|--------|
| Type Check | `[command]` | ✅ PASS / ❌ FAIL | [error content] |
| Lint | `[command]` | ✅ PASS / ❌ FAIL | [error content] |
| Test | `[command]` | ✅ PASS / ❌ FAIL | [failed tests] |

### 4. Record results

Write results to `$WORK_DIR/test-results.md`. Append to existing content if the file already has previous attempts:

```markdown
# Test Results

## Attempt [N] — [timestamp]

### Results
| 검증 | 명령어 | 결과 | 소요 시간 |
|------|--------|------|----------|
| [name] | [command] | ✅ PASS / ❌ FAIL | [duration] |

### Failures (if any)
#### [Verification Name]
- **명령어**: [command]
- **에러 출력**: [stderr/stdout summary]
- **관련 파일**: [file:line]

---
```

### 4-1. Record Quality Gate results

If Quality Gates were defined in plan.md, write `$WORK_DIR/quality-gates.md`:

```markdown
# Quality Gate Results

## Attempt [N] — [timestamp]

### Required Gates
| Gate | 명령어 | 결과 | 소요 시간 | 세부 사항 |
|------|--------|------|----------|----------|
| [name] | `[command]` | ✅ PASS / ❌ FAIL | [duration] | [details] |

### Advisory Gates
| Gate | 명령어 | 결과 | 소요 시간 | 측정값 | 임계값 | 세부 사항 |
|------|--------|------|----------|--------|--------|----------|
| [name] | `[command]` | ✅ PASS / ⚠️ WARN | [duration] | [actual] | [threshold] | [details] |

### Insight Gates
| Gate | 명령어 | 결과 | 측정값 | 세부 사항 |
|------|--------|------|--------|----------|
| Code Insight | [auto] | ℹ️ INFO | — | [summary] |
| [user gate] | `[command]` | ℹ️ INFO / ℹ️ SKIP | [value] | [details] |

### 판정: ✅ PASS / ⚠️ PASS with warnings / ❌ FAIL
- Required: N/N 통과
- Advisory: N/N 통과
- Insight: N개 분석 완료
```

Update `quality_gates_passed` in the state file:
- `true` if all required gates passed
- `false` if any required gate failed

Display inline:
```
📊 Quality Gate 결과:
  ✅ [Gate 1]: PASS
  ✅ [Gate 2]: PASS
  ⚠️ [Gate 3]: 72% (≥80% 권고) — 경고만, 차단 없음
```

### 4-2. Built-in Required Gate: Spec Compliance Review (v4.0)

After all test/lint gates pass, run spec compliance review using a subagent.

**Steps**:
1. Read plan.md's Slice Checklist to get all spec_checklist items per slice
2. Read each receipt's `spec_compliance.checklist` results
3. Spawn a fresh Agent (spec-compliance-reviewer):
   - **Input**: plan.md + all receipt JSON files
   - **Prompt**: "For each slice, verify that every spec_checklist item is implemented correctly. Compare the plan's requirements against the actual code changes (from receipt git_diff). Return JSON: { result: 'PASS'|'FAIL', per_slice: [{ slice_id, checklist_pass: bool, missing: [...] }] }"
   - **Model**: Use model_routing.test or "haiku"
4. Parse reviewer result:
   - All slices pass → **PASS**
   - Any slice fails → **FAIL** (Required Gate)
5. Update each receipt: `spec_compliance.reviewer_result`
6. Display:
   ```
   📋 Spec Compliance Review:
      SLICE-001: ✅ 3/3 requirements met
      SLICE-002: ❌ 2/3 — missing: [requirement]
   ```

### 4-3. Built-in Advisory Gate: Code Quality Review (v4.0)

Run code quality review using a subagent. This is advisory — does NOT block.

**Steps**:
1. Get the full git diff for this session
2. Spawn a fresh Agent (code-quality-reviewer):
   - **Input**: git diff + plan.md
   - **Prompt**: "Review this code diff for quality issues. Check: error handling, naming, DRY violations, type safety, test coverage quality. Return JSON: { result: 'PASS'|'WARN', findings: [{ severity: 'critical'|'important'|'suggestion', file, issue, fix }] }"
   - **Model**: Use model_routing.test or "haiku"
3. Parse reviewer result:
   - No critical findings → **PASS**
   - Any critical findings → **WARN** (Advisory, does not block)
4. Update receipts: `code_review.reviewer_result` and `code_review.findings`
5. Display:
   ```
   🔍 Code Quality Review:
      Critical: 0 | Important: 2 | Suggestions: 5
      ⚠️ [important finding 1]
      ⚠️ [important finding 2]
   ```

### 4-4. Built-in Required Gate: Verification Evidence (v4.0)

Verify that actual test execution evidence exists — not just claims of passing.

**Steps**:
1. For each receipt, check that `tdd.passing_test_output` is non-empty
2. Check that `verification.full_test_suite` shows a PASS result
3. If any receipt lacks actual test output → **FAIL**:
   ```
   ❌ Verification Evidence 부족:
      SLICE-002: passing_test_output가 비어있음
      실제 테스트 실행 증거가 필요합니다.
   ```
4. All evidence present → **PASS**

### 4-5. Built-in Insight Analysis & Insight Gate Results

After all Required and Advisory gates complete (regardless of their results), run the built-in Insight analysis. Insight gates NEVER affect pass/fail determination.

**Steps**:

1. **Run built-in Insight analysis**: Read the `/deep-insight` command file and execute its analysis logic (Sections 3A-3D) against the files modified during implementation. Save results to `$WORK_DIR/insight-report.md`.

2. **Run user-defined Insight gates**: If plan.md has ℹ️ gates defined in the Quality Gates table, execute each command and record the output. Failed commands are recorded as ℹ️ SKIP (not as failures).

3. **Append Insight results to quality-gates.md**: Add the `### Insight Gates` section to the file.

4. **Display inline summary**:
   ```
   ℹ️ Insight 분석:
     ℹ️ Code Insight: N파일, N줄, 복잡도 지표 N건
     ℹ️ [User Gate]: [output summary]
   ```

5. **Important**: Even if Insight analysis fails completely, it does NOT affect the overall pass/fail determination. Silently skip and continue to Section 5.

### 5. Determine outcome

#### All tests pass

If every verification command passes:

Also check `quality_gates_passed` if Quality Gates were defined:
- If `quality_gates_passed` is false (required gate failed), treat as test failure even if auto-detected tests passed

1. Update state file:
   - Set `current_phase: idle`
   - Set `test_passed: true`
   - Set `test_completed_at` to the current ISO timestamp
   - Add progress log entry

2. Display:
   ```
   ✅ 모든 검증 통과! 세션이 완료되었습니다.

   🧪 검증 결과:
     [result table]

   📄 상세 결과: $WORK_DIR/test-results.md
   ```

3. **Send notification**:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$PROJECT_ROOT/.claude/deep-work.local.md" "test" "passed" "✅ 모든 테스트 통과 — 세션 완료" 2>/dev/null || true
   ```

4. **Automatically generate session report**: Read the `/deep-report` command file and generate `$WORK_DIR/report.md` following its structure. Include test results in the Verification Results section.

5. **Git commit suggestion** (if `git_branch` is set in state file):
   ```
   📝 변경사항을 커밋할까요?
      브랜치: [git_branch]
      변경 파일: [N]개

   제안 커밋 메시지:
     feat: [task_description 기반 자동 생성]
   ```
   If user agrees, create the commit. If not, skip.

#### Some tests fail (retry available)

If any verification fails and `test_retry_count` < `max_test_retries`:

1. Increment `test_retry_count` in state file
2. Update state file: Set `current_phase: implement`
3. Display:
   ```
   ❌ 검증 실패 (시도 [N]/[max]):

   실패 항목:
     - [Type Check] src/auth.ts:42 — Type 'string' is not assignable to 'number'
     - [Test] auth.test.ts — "should validate token" FAILED

   Implement 단계로 복귀합니다. 위 이슈를 수정한 후 /deep-test 명령을 실행하세요.
   ```

4. **Send notification**:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$PROJECT_ROOT/.claude/deep-work.local.md" "test" "failed" "❌ 테스트 실패 — Implement 복귀 (시도 $test_retry_count/$max_test_retries)" 2>/dev/null || true
   ```

5. The user can now modify code (Phase Guard allows edits in implement phase) and then run `/deep-test` when ready.

#### Some tests fail (retry exhausted)

If `test_retry_count` >= `max_test_retries`:

1. Display:
   ```
   ⛔ 테스트 재시도 횟수 초과 ([max]회).
   자동 수정 루프를 중단합니다.

   누적 실패 내용은 $WORK_DIR/test-results.md를 참조하세요.
   수동으로 수정한 후 /deep-test를 실행하거나,
   /deep-report로 현재까지의 결과를 정리할 수 있습니다.
   ```

2. **Send notification**:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$PROJECT_ROOT/.claude/deep-work.local.md" "test" "failed_final" "⛔ 테스트 재시도 횟수 초과" 2>/dev/null || true
   ```

3. Keep `current_phase: implement` so the user can continue fixing manually.
