# Plan Templates

Pre-defined plan structures for common task types. These serve as starting skeletons — adapt and expand as needed.

## API Endpoint Addition

```markdown
## Task Checklist
- [ ] Task 1: Route definition — Add route in router/controller
- [ ] Task 2: Controller/Handler — Implement request handling logic
- [ ] Task 3: Request/Response DTO — Define input/output types
- [ ] Task 4: Validation rules — Add input validation
- [ ] Task 5: Middleware setup — Configure auth, rate limiting, etc.
- [ ] Task 6: Unit tests — Test handler logic in isolation
- [ ] Task 7: Integration tests — Test full request/response cycle
```

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
