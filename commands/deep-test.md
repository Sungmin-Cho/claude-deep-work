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

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `$STATE_FILE`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` and verify:
- `current_phase` is `test`
- plan.md's Slice Checklist has all items marked as `[x]`

If not, inform the user which prerequisite step is missing.

Extract `work_dir`, `test_retry_count`, and `max_test_retries` from the state file.
Set `WORK_DIR` to the value of `work_dir`.

**Record start time**: Update `test_started_at` in the state file with the current ISO timestamp.

### 1-1. Model Routing Check

Read `model_routing` from the state file. Default: `{research: "sonnet", plan: "main", implement: "sonnet", test: "haiku"}`.
Read `evaluator_model` from the state file (default: "sonnet"). This is used for test subagents in Sections 4-2, 4-3.

If `model_routing.test` is NOT "main":
  - Use the Agent tool to spawn a test agent:
    - `model`: value of `model_routing.test` (e.g., "haiku")
    - `prompt`: Include ALL test instructions (Sections 2, 3, 4), the WORK_DIR path, test_retry_count info, and `evaluator_model` value
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

### 1-3. deep-review 전체 리뷰 제안 (선택적)

deep-review 플러그인 설치 확인:
```bash
ls "$HOME/.claude/plugins/cache/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null || \
  ls "$HOME/.claude/plugins/"*/deep-review/.claude-plugin/plugin.json 2>/dev/null
```
설치되지 않은 경우 이 섹션을 건너뜀 (silent skip).

**설치된 경우:**
- 사용자에게 제안: "전체 변경사항에 대해 /deep-review를 실행할까요?"
- 수락 시: `/deep-review` 실행 (Sprint Contract가 있으면 자동으로 전체 contract 검증)
- 거부 시: 기존 Quality Gate만 실행
- deep-review 리포트가 생성되면 `$WORK_DIR/report.md`에 링크 참조 추가

### 1-4. Built-in Required Gate: Plan Alignment (Drift Detection)

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

5-1. **Calculate Fidelity Score**: After classifying all plan items, calculate a Fidelity Score (0-100):
   - Each plan item has a base value of `100 / total_plan_items` points
   - Fully implemented: full points
   - Partially implemented: half points
   - Not implemented: 0 points
   - Out of scope: -2 points per item (score cannot go below 0)
   - Write the numeric fidelity_score to `$WORK_DIR/fidelity-score.txt`
   - Write `fidelity_score: [N]` to the state file `$STATE_FILE`
   - Include the Fidelity Score in the drift-report.md display

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
감지된 검증 명령어:
  1. ✅ [command 1]
  2. ✅ [command 2]
  3. ✅ [command 3]

추가할 명령어가 있나요? (없으면 Enter)
```

If no commands are detected, ask the user to provide verification commands manually.

### 2-1. Quality Gates configuration

**Default behavior (no Quality Gates table in plan.md):**
All built-in gates run automatically:
- Drift Check: Required gate (already handled in Section 1-4)
- Spec Compliance Review: Required gate (Section 4-2)
- Code Quality Review: Advisory gate (Section 4-3)
- Verification Evidence: Required gate (Section 4-4)
- SOLID Review: Advisory gate (Section 4-5a, new in v5.2)
- Insight Analysis: Insight gate (Section 4-5b, new in v5.2)
- **Sensor Clean**: Required gate (Section 4-6, reads receipts — NO re-execution)
- **Coverage Report**: Advisory gate (Section 4-6, reads receipts — NO re-execution)
- **Mutation Score**: Advisory gate (Section 4-7, triggers `/deep-mutation-test` execution)
- Auto-detected test commands from Section 2 are used for test execution

**Override (Quality Gates table exists in plan.md):**
Read `$WORK_DIR/plan.md` and look for a `## Quality Gates` section containing a markdown table.

If found:
- Parse the table into a list of gates
- Each gate has: name, command, type (✅=required, ⚠️=advisory, ℹ️=insight), threshold
- **Use these gates instead of auto-detected commands** (Section 2 results are overridden)
- Execute gates in the order listed in the table
- For required (✅) gates: failure triggers implement rollback (same as current test failure)
- For advisory (⚠️) gates: failure records a warning only, does NOT trigger rollback
- For insight (ℹ️) gates: results recorded for informational purposes only — always treated as pass
- Built-in SOLID Review and Insight Analysis still run after user-defined gates

If not found:
- Use the auto-detected commands from Section 2 (default behavior)

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
Quality Gate 결과:
  ✅ [Gate 1]: PASS
  ✅ [Gate 2]: PASS
  ⚠️ [Gate 3]: 72% (≥80% 권고) — 경고만, 차단 없음
```

### 4-2. Built-in Required Gate: Spec Compliance Review (v4.0, updated v5.1)

After all test/lint gates pass, run spec compliance review using a subagent.

**Steps**:
1. Read plan.md's Slice Checklist to get all spec_checklist and contract items per slice
2. Read each receipt's `spec_compliance.checklist` and `contract_compliance.items` results
3. Read `evaluator_model` from state file (default: "sonnet"). Spawn a fresh Agent (spec-compliance-reviewer):
   - **Input**: plan.md + all receipt JSON files
   - **Prompt**: "For each slice, verify:
     1. Every spec_checklist item is implemented correctly
     2. Every contract item (if present) is satisfied — check receipt contract_compliance.items
     Compare the plan's requirements against the actual code changes (from receipt git_diff).
     Return JSON: { result: 'PASS'|'FAIL', per_slice: [{ slice_id, checklist_pass: bool, contract_pass: bool, missing_checklist: [...], missing_contract: [...] }] }"
   - **Model**: evaluator_model from state (default: "sonnet")
4. Parse reviewer result:
   - All slices pass (both checklist and contract) → **PASS**
   - Any slice fails → **FAIL** (Required Gate)
5. Update each receipt: `spec_compliance.reviewer_result`
6. Display:
   ```
   Spec Compliance Review:
      SLICE-001: ✅ checklist 3/3, contract 4/4
      SLICE-002: ❌ checklist 2/3 — missing: [requirement], contract 3/4 — missing: [item]
   ```

### 4-3. Built-in Advisory Gate: Code Quality Review (v4.0, updated v5.1)

Run code quality review using a subagent. This is advisory — does NOT block.

**Steps**:
1. Get the full git diff for this session
2. Read `evaluator_model` from state file (default: "sonnet"). Spawn a fresh Agent (code-quality-reviewer):
   - **Input**: git diff + plan.md
   - **Prompt**: "Review this code diff for quality issues. Check: error handling, naming, DRY violations, type safety, test coverage quality. Return JSON: { result: 'PASS'|'WARN', findings: [{ severity: 'critical'|'important'|'suggestion', file, issue, fix }] }"
   - **Model**: evaluator_model from state (default: "sonnet")
3. Parse reviewer result:
   - No critical findings → **PASS**
   - Any critical findings → **WARN** (Advisory, does not block)
4. Update receipts: `code_review.reviewer_result` and `code_review.findings`
5. Display:
   ```
   Code Quality Review:
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

### 4-5a. Built-in Advisory Gate: SOLID Review (v5.2)

After Code Quality Review (Section 4-3), run SOLID analysis on changed files. This is advisory — does NOT block.

**Steps**:
1. Get the list of modified files from `$WORK_DIR/file-changes.log` or `git diff --name-only`
2. Filter: source files only (exclude test files, configs, docs, generated files)
3. For each file, evaluate against 5 SOLID principles:
   - **SRP** (Single Responsibility): Does the file/class have one clear purpose?
   - **OCP** (Open/Closed): Can behavior be extended without modifying existing code?
   - **LSP** (Liskov Substitution): Are subtypes substitutable for their base types?
   - **ISP** (Interface Segregation): Are interfaces focused and minimal?
   - **DIP** (Dependency Inversion): Do modules depend on abstractions, not concretions?
4. Generate summary scorecard
5. Save to `$WORK_DIR/solid-review.md`
6. Display inline:
   ```
   SOLID Review (advisory):
     SRP: ✅ | OCP: ⚠️ | LSP: ✅ | ISP: ✅ | DIP: ✅
     ⚠️ [finding summary]
   ```

For detailed evaluation criteria, see the `/solid-review` command.

### 4-5b. Built-in Insight Analysis (v5.2)

After SOLID Review, run Insight analysis. Insight gates NEVER affect pass/fail determination.

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

5. **Important**: Even if Insight analysis fails completely, it does NOT affect the overall pass/fail determination. Silently skip and continue to Section 4-6.

### 4-6. Built-in Gate: Sensor Clean + Coverage Report (reads receipts, NO re-execution)

These gates read sensor data already collected during Phase 3 (implement). They do NOT re-run any sensors.

#### Sensor Clean Gate (✅ Required)

**Source**: Each slice's `sensor_results` field in `$WORK_DIR/receipts/SLICE-NNN.json`.

**Steps**:
1. For each slice receipt, read `sensor_results` (lint, typecheck fields).
2. Classify each sensor result:
   - `status: "pass"` → PASS
   - `status: "not_applicable"` → SKIP (excluded from judgment)
   - `status: "fail"` or `status: "timeout"` → FAIL
3. If any sensor has `status: "fail"` or `status: "timeout"` across any slice → **FAIL** (Required Gate).
4. If all sensor statuses are `pass` or `not_applicable` → **PASS**.

**Display**:
```
Sensor Clean Gate:
  SLICE-001: eslint ✅ pass, tsc ✅ pass
  SLICE-002: eslint ✅ pass, tsc ✅ pass
  Sensor Clean Rate: 2/2 슬라이스 통과 ✅
```

If any fail:
```
❌ Sensor Clean 실패:
  SLICE-002: tsc ❌ fail (correction_rounds: 3)
Implement 단계로 복귀하여 센서 오류를 해결하세요.
```

#### Coverage Report Gate (⚠️ Advisory)

**Source**: Each slice's `sensor_results.coverage` field in `$WORK_DIR/receipts/SLICE-NNN.json`.

**Steps**:
1. For each slice receipt, read `sensor_results.coverage` (line_pct, branch_pct).
2. If all slices have `coverage.status: "not_applicable"` → skip, display "커버리지 데이터 없음".
3. Otherwise, aggregate and display coverage percentages per slice.
4. This gate is advisory — it NEVER blocks progression regardless of coverage numbers.

**Display**:
```
⚠️ Coverage Report (advisory):
  SLICE-001: line 87.3%, branch 72.1%
  SLICE-002: line 91.2%, branch 80.5%
  전체 평균: line 89.3%, branch 76.3%
```

### 4-7. Built-in Advisory Gate: Mutation Score (/deep-mutation-test)

**Source**: Triggers new execution of `/deep-mutation-test`. This is the only gate that causes NEW execution (unlike Sensor Clean and Coverage which read from receipts).

**Steps**:
1. Check if a mutation testing tool is available (stryker, mutmut, pitest) by reading `sensor_results.ecosystem` from any slice receipt or detecting from project config.
2. If no mutation tool available → mark as `not_applicable`, skip gracefully.
3. If available → execute `/deep-mutation-test` (or equivalent mutation test command).
4. Parse results: total mutants, killed, survived, equivalent, mutation score (%).
5. Display survived mutants list.
6. This gate is advisory — it NEVER blocks progression.

**Display**:
```
⚠️ Mutation Score (advisory):
  도구: stryker | 총 변이체: 45 | 사살: 39 | 생존: 4 | 동등: 2
  Mutation Score: 90.7%
  생존 변이체:
    - src/auth/jwt.ts:42 (ConditionalExpression) [possibly_equivalent]
    - src/utils/parse.ts:15 (BinaryExpression)
```

**Mutation auto-fix**: If survived mutants are found, `/deep-mutation-test` handles the implement phase transition internally — returning to implement phase to add tests targeting surviving mutants, then looping back to test phase. This is managed by `/deep-mutation-test`'s own flow, not by this gate.

**Save to state**: Write `mutation_testing` object to the session state file with tool, status, score, and survived list for use by `/deep-finish` quality score calculation.

### 4-7a. Built-in Advisory Gate: Fitness Delta (⚠️ Advisory)

Phase 1에서 저장한 fitness baseline과 현재 fitness 검증 결과를 비교하는 게이트.

**Steps**:
1. Phase 1에서 저장한 `fitness_baseline`(세션 상태 파일)과 현재 fitness 검증 결과 비교
2. `node "$CLAUDE_PLUGIN_DIR/health/fitness/fitness-validator.js"` 재실행 (fitness.json이 있을 때만)
3. 새 위반 추가 없음 → ✅ PASS
4. 위반 감소 → ✅ PASS + 긍정 피드백
5. 위반 증가 → ⚠️ Advisory 경고 (차단 안 함, receipt에 기록)
6. fitness.json 없음 → not_applicable

**Display**:
```
Fitness Delta Gate (advisory):
  Baseline: 3건 위반 → 현재: 2건 위반 (−1) ✅
```

Or if violations increased:
```
⚠️ Fitness Delta (advisory):
  Baseline: 3건 위반 → 현재: 5건 위반 (+2) — 신규 위반 확인 필요
```

### 4-7b. Built-in Required Gate: Health Required (✅ Required)

Phase 1에서 발견된 required 이슈가 해결되었는지 확인하는 게이트.

**Steps**:
1. 세션 상태의 `unresolved_required_issues` 확인
2. 있으면: AskUserQuestion — "Phase 1에서 발견된 required 이슈가 미해결입니다: [목록]. 이 상태로 완료하시겠습니까?"
3. acknowledge 시: receipt에 `acknowledged_required_issues` 기록 + 진행
4. 거부 시: 이슈 해결 권장

**Display**:
```
Health Required Gate:
  미해결 required 이슈: 2건
  - dead-export: src/legacy/unused.ts (3개 미사용 export)
  - vulnerability: critical CVE-2026-1234
  사용자 확인 대기 중...
```

### 4-7c. Phase 4 Baseline 갱신

모든 Quality Gate 통과 후 (또는 acknowledge 후):
- `health-baseline.js` writeBaseline() 호출
- 현재 커버리지, dead_exports 수, fitness_violations 수를 baseline으로 기록
- 다음 세션의 Phase 1 비교 기준으로 사용

### 4-7d. Session Quality Score 변경 없음

Health Check은 세션 시작 시점의 코드베이스 상태 진단이므로 Score에 반영하지 않음.
기존 5가지 가중치(Test Pass Rate, Rework Cycles, Plan Fidelity, Sensor Clean Rate, Mutation Score) 유지.

### 4-8. Session Quality Score Weights

The Session Quality Score (calculated in `/deep-finish`) uses the following 5-component weighted formula:

| Component | Weight | not_applicable handling |
|-----------|--------|------------------------|
| Test Pass Rate | 25% | Always applies |
| Rework Cycles | 20% | Always applies |
| Plan Fidelity | 25% | Always applies |
| Sensor Clean Rate | 15% | Excluded from denominator if all sensors not_applicable |
| Mutation Score | 15% | Excluded from denominator if mutation not_applicable |

**not_applicable proportional redistribution**: When a component is excluded, the remaining weights are scaled proportionally so they sum to 100%.

Examples:
- If Sensor Clean is not_applicable (15% excluded): remaining 85% is redistributed → Test=29.4%, Rework=23.5%, Fidelity=29.4%, Mutation=17.6%
- If both Sensor + Mutation are not_applicable (30% excluded): remaining 70% redistributed → Test=35.7%, Rework=28.6%, Plan=35.7%

**Formula**:
```
applicable_weights = sum of weights for applicable components
score = Σ (component_score × component_weight) / applicable_weights × 100
```

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

   검증 결과:
     [result table]

   상세 결과: $WORK_DIR/test-results.md
   ```

3. **Send notification**:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$STATE_FILE" "test" "passed" "✅ 모든 테스트 통과 — 세션 완료" 2>/dev/null || true
   ```

4. **Automatically generate session report**: Read the `/deep-report` command file and generate `$WORK_DIR/report.md` following its structure. Include test results in the Verification Results section.

5. **deep-wiki 연동 (선택적)**

   deep-wiki 플러그인 설치 확인:
   ```bash
   ls "$HOME/.claude/plugins/cache/"*/deep-wiki/.claude-plugin/plugin.json 2>/dev/null || \
     ls "$HOME/.claude/plugins/"*/deep-wiki/.claude-plugin/plugin.json 2>/dev/null
   ```
   설치되지 않은 경우 이 섹션을 건너뜀 (silent skip).

   **설치된 경우:**
   - 사용자에게 제안: "이 세션의 리서치/설계 결과를 위키에 기록할까요? (/wiki-ingest)"
   - 수락 시: `/wiki-ingest $WORK_DIR/report.md` 실행
   - 거부 시: 건너뜀

6. **Git commit suggestion** (if `git_branch` is set in state file):
   ```
   변경사항을 커밋할까요?
      브랜치: [git_branch]
      변경 파일: [N]개

   제안 커밋 메시지:
     feat: [task_description 기반 자동 생성]
   ```
   If user agrees, create the commit. If not, skip.

#### Some tests fail (retry available) — Auto-Loop (v5.1)

If any verification fails and `test_retry_count` < `max_test_retries`:

1. Increment `test_retry_count` in state file
2. Analyze which gate failed and what needs fixing:
   - **Receipt missing**: Identify which slices lack receipts
   - **Drift detected**: Extract the diff list from drift-report.md
   - **Spec/contract not met**: Extract unmet items per slice
   - **Test failing**: Extract failure output and affected files

3. Update state file: Set `current_phase: implement`

4. Display:
   ```
   ❌ 검증 실패 (시도 [N]/[max]) — 자동 수정 시작:

   실패 항목:
     - [Gate]: [specific failure description]

   대상 slice: [SLICE-NNN, SLICE-MMM] (전체가 아닌 실패 slice만 재실행)
   ```

5. **Auto-fix**: Re-enter the implementation loop targeting only the failed slices:
   - For each failed slice:
     a. Set `active_slice` to the failed slice ID
     b. Set `tdd_state` to the appropriate state (RED if new test needed, GREEN_ELIGIBLE if test exists but implementation wrong)
     c. Execute the fix following the TDD cycle from deep-implement
     d. Collect updated receipt

6. After all failed slices are fixed:
   - Update state file: Set `current_phase: test`
   - Display: `자동 수정 완료 — 테스트 재실행 중...`
   - **Re-run all test gates** (loop back to Section 1-2)

7. **Send notification**:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$STATE_FILE" "test" "auto_retry" "🔄 테스트 자동 재시도 (시도 $test_retry_count/$max_test_retries)" 2>/dev/null || true
   ```

#### Some tests fail (retry exhausted) — Escalation (v5.1)

If `test_retry_count` >= `max_test_retries`:

1. Display:
   ```
   ⛔ 자동 수정 루프 종료 ([max]회 시도).

   누적 실패 이력:
     시도 1: [gate] — [failure summary]
     시도 2: [gate] — [failure summary]
     시도 3: [gate] — [failure summary]

   상세: $WORK_DIR/test-results.md

   수동으로 수정한 후 /deep-test를 실행하거나,
   /deep-report로 현재까지의 결과를 정리할 수 있습니다.
   ```

2. **Send notification**:
   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$STATE_FILE" "test" "failed_final" "⛔ 자동 수정 루프 종료 — 수동 개입 필요" 2>/dev/null || true
   ```

3. Keep `current_phase: implement` so the user can continue fixing manually.
