# Plan Templates

Pre-defined plan structures for common task types. These serve as starting skeletons — adapt and expand as needed.

## Template Usage

When using a template:
1. Replace each task with a `SLICE-NNN:` entry in slice format (files, failing_test, verification_cmd, expected_output, steps, etc.)
2. Add concrete file paths, code sketches, and failing_test specifications per slice
3. Follow the Completeness Policy (Section 3.3-1 of deep-plan.md) — no placeholders
4. Templates are starting points, not ceilings — add or remove slices as needed

## API Endpoint Addition

**Exemplar** (showing full slice format):

```markdown
## Slice Checklist

- [ ] SLICE-001: Route definition and request/response types
  - files: [src/routes/resource.ts, src/types/resource.ts]
  - failing_test: tests/routes/resource.test.ts — "POST /resource returns 201 with valid input"
  - verification_cmd: npm test -- --grep "resource"
  - expected_output: "all tests passed, 0 failed"
  - spec_checklist: [Route registered, DTO types defined, validation schema created]
  - contract: [POST /resource with valid body → 201 + {id: string}, POST /resource with missing field → 400 + {error: string}]
  - acceptance_threshold: all
  - size: M
  - steps:
    1. Define request/response DTOs in types file
    2. Write failing integration test for the happy path
    3. Register route in router with handler stub
    4. Implement handler with validation
    5. Verify GREEN

- [ ] SLICE-002: Business logic and data access
  - files: [src/services/resource.ts, src/repositories/resource.ts]
  - failing_test: tests/services/resource.test.ts — "creates resource with valid data"
  - verification_cmd: npm test -- --grep "resource"
  - expected_output: "all tests passed, 0 failed"
  - spec_checklist: [Service method exists, Repository query works, Error cases handled]
  - contract: [createResource(validData) → {id, ...data}, createResource(duplicateKey) → throws ConflictError]
  - acceptance_threshold: all
  - size: M

- [ ] SLICE-003: Auth middleware and error integration
  - files: [src/routes/resource.ts]
  - failing_test: tests/routes/resource.test.ts — "rejects unauthenticated request with 401"
  - verification_cmd: npm test -- --grep "resource"
  - spec_checklist: [Auth required on route, 401 for missing token, 403 for insufficient role]
  - size: S
```

---

> **Legacy templates below**: The following templates use the old `Task Checklist` format. When using them, convert each `Task N:` into a `SLICE-NNN:` entry with `files`, `failing_test`, `verification_cmd`, `expected_output`, `spec_checklist`, `contract`, `size`, and `steps` (for M/L). See the API Endpoint exemplar above for the target format.

## UI Component Addition

```markdown
## Task Checklist
- [ ] Task 1: Component design — Define Props, State, and component structure
- [ ] Task 2: Component implementation — Build the component
- [ ] Task 3: Styling — Add styles (CSS modules, Tailwind, styled-components, etc.)
- [ ] Task 4: Event handlers — Wire up user interactions
- [ ] Task 5: Storybook/Visual tests — Add visual test cases
- [ ] Task 6: Unit tests — Test component logic and rendering
```

## Database Migration

```markdown
## Task Checklist
- [ ] Task 1: Schema change DDL — Write ALTER/CREATE statements
- [ ] Task 2: Migration script — Create migration file
- [ ] Task 3: Data transformation — Migrate existing data if needed
- [ ] Task 4: Rollback script — Write reverse migration
- [ ] Task 5: Code impact — Update ORM models/repositories
- [ ] Task 6: Query updates — Modify affected queries
- [ ] Task 7: Tests — Verify migration up and down
```

## Refactoring

```markdown
## Task Checklist
- [ ] Task 1: Current → Target mapping — Document exact structural changes
- [ ] Task 2: Step N (incremental) — Each step must leave the system in a working state
  - [ ] Task 2a: Move/rename [specific item]
  - [ ] Task 2b: Update all callers/importers
  - [ ] Task 2c: Verify tests pass
- [ ] Task 3: Update affected consumers — Fix all references
- [ ] Task 4: Regression tests — Ensure nothing broke
- [ ] Task 5: Clean up — Remove old code, update docs
```

## Bug Fix

```markdown
## Task Checklist
- [ ] Task 1: Reproduce — Write a failing test that demonstrates the bug
- [ ] Task 2: Root cause — Identify and document the exact cause
- [ ] Task 3: Fix — Apply the minimal change to resolve the issue
- [ ] Task 4: Verify — Confirm the failing test now passes
- [ ] Task 5: Side effects — Check for related areas that might be affected
- [ ] Task 6: Regression test — Add test to prevent recurrence
```

## New Feature (Full Stack)

```markdown
## Task Checklist
- [ ] Task 1: Data model — Define schema/types/interfaces
- [ ] Task 2: Database layer — Migration, ORM models, repositories
- [ ] Task 3: Business logic — Services, use cases, domain rules
- [ ] Task 4: API layer — Controllers, routes, DTOs, validation
- [ ] Task 5: Frontend — Components, pages, state management
- [ ] Task 6: Integration — Wire frontend to API
- [ ] Task 7: Tests — Unit + integration + e2e
- [ ] Task 8: Documentation — API docs, README updates
```
