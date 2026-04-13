# Testing Phase — Detailed Guide

## Purpose

The Test phase runs comprehensive verification on implemented code. It forms an implement-test loop: if tests fail, the system returns to the implement phase for fixes, then re-tests. This cycle prevents shipping broken code.

## Testing Methodology

### Step 1: Auto-Detection

The test phase automatically detects verification commands from project configuration:

| Ecosystem | Config File | Commands |
|-----------|------------|----------|
| Node.js | `package.json` | `npm run test`, `npm run lint`, `npm run typecheck` |
| Python | `pyproject.toml` | `pytest`, `mypy`, `ruff check` |
| Rust | `Cargo.toml` | `cargo test`, `cargo clippy` |
| Go | `go.mod` | `go test ./...`, `go vet ./...` |
| Make | `Makefile` | `make test`, `make lint`, `make check` |

The user can add custom commands or remove detected ones before execution.

### Step 2: Sequential Execution

Commands run in order. Each result is recorded with:
- Command name and full command string
- Pass/fail status
- Error output (stderr/stdout) on failure
- Execution duration

### Step 3: Result Determination

**All pass** → Session completes, report is generated.

**Any fail** → System checks retry count:
- Under limit: Returns to implement phase with detailed failure info
- At limit: Stops the loop, asks for manual intervention

## The Implement-Test Loop

```
implement → test → (pass) → idle + report
                → (fail) → implement → test → ...
```

This loop runs up to `max_test_retries` times (default: 3). Each attempt is recorded in `test-results.md` with full details.

The key insight: during the test phase, code modifications are blocked by the Phase Guard. The tester cannot "fix" anything — it can only observe and report. Fixes happen in the implement phase where code editing is allowed.

## Output: test-results.md

Results accumulate across attempts:

```markdown
# Test Results

## Attempt 2 — 2026-03-13T15:30:00

### Results
| 검증 | 명령어 | 결과 | 소요 시간 |
|------|--------|------|----------|
| Type Check | npm run typecheck | ✅ PASS | 3.2s |
| Lint | npm run lint | ✅ PASS | 1.8s |
| Test | npm run test | ✅ PASS | 12.4s |

---

## Attempt 1 — 2026-03-13T15:00:00

### Results
| 검증 | 명령어 | 결과 | 소요 시간 |
|------|--------|------|----------|
| Type Check | npm run typecheck | ❌ FAIL | 3.1s |
| Lint | npm run lint | ✅ PASS | 1.7s |
| Test | npm run test | ❌ FAIL | 8.2s |

### Failures
#### Type Check
- **명령어**: npm run typecheck
- **에러 출력**: src/auth.ts:42 — Type 'string' is not assignable to type 'number'
- **관련 파일**: src/auth.ts:42
```

## Quality Criteria

A good test phase:
- Detects all available verification commands
- Runs them in a sensible order (type checks before tests)
- Provides clear, actionable failure messages
- Records each attempt for debugging
- Respects the retry limit to prevent infinite loops

## Quality Gates (v3.1.0)

plan.md에 `## Quality Gates` 마크다운 테이블을 정의하면, Test Phase에서 자동 실행된다.

### 게이트 유형
- **✅ 필수(required)**: 실패 시 implement 복귀
- **⚠️ 권고(advisory)**: 실패 시 경고만 기록
- **ℹ️ 인사이트(insight)**: 결과 기록만 (차단 없음, v3.3)

### 정의 형식
```markdown
| Gate | 명령어 | 필수 | 임계값 |
|------|--------|------|--------|
| Type Check | `npx tsc --noEmit` | ✅ | — |
| Coverage | `npm test -- --coverage` | ⚠️ | ≥80% |
| Complexity | `npx complexity-report src/` | ℹ️ | — |
```

### 결과 파일
`$WORK_DIR/quality-gates.md`에 상세 결과가 기록된다.
Quality Gates 미정의 시 기존 auto-detection 로직이 유지된다.
