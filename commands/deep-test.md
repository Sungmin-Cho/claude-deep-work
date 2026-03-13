---
allowed-tools: Bash, Read, Write, Glob, Grep, Edit
description: "Phase 4: Run comprehensive tests and verify implementation"
---

# Deep Test — Phase 4: Comprehensive Verification

You are in the **Test** phase of a Deep Work session. This phase runs comprehensive verification on the implemented code and manages the implement-test retry loop.

## Critical Constraints

🚫 **DO NOT modify any code files in this phase.**
🚫 **Code modifications are blocked by Phase Guard.**
✅ **Only run tests, analyze results, and update documentation.**
✅ **If tests fail, the system will transition back to implement phase for fixes.**

## Instructions

### 1. Verify prerequisites

Read `.claude/deep-work.local.md` and verify:
- `current_phase` is `test`
- plan.md's Task Checklist has all items marked as `[x]`

If not, inform the user which prerequisite step is missing.

Extract `work_dir`, `test_retry_count`, and `max_test_retries` from the state file.
Set `WORK_DIR` to the value of `work_dir`.

**Record start time**: Update `test_started_at` in the state file with the current ISO timestamp.

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

### 5. Determine outcome

#### All tests pass

If every verification command passes:

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

3. **Automatically generate session report**: Read the `/deep-report` command file and generate `$WORK_DIR/report.md` following its structure. Include test results in the Verification Results section.

4. **Git commit suggestion** (if `git_branch` is set in state file):
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

   implement 단계로 복귀합니다. 위 이슈를 수정한 후 /deep-test를 실행하세요.
   ```

4. The user can now modify code (Phase Guard allows edits in implement phase) and then run `/deep-test` when ready.

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

2. Keep `current_phase: implement` so the user can continue fixing manually.
