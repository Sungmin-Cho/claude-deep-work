# Plan Templates

Pre-defined plan structures for common task types. These serve as starting skeletons — adapt and expand as needed.

## Template Usage

When using a template:
1. Replace each task with a `SLICE-NNN:` entry in slice format (files, failing_test, verification_cmd, expected_output, steps, etc.)
2. Add concrete file paths, code sketches, and failing_test specifications per slice
3. Follow the Completeness Policy (Section 3.3-1 of deep-plan.md) — no placeholders
4. Templates are starting points, not ceilings — add or remove slices as needed
5. Every slice must provide an Exact file path list, `depends_on`, `failing_test`, `verification_cmd`, `expected_output`, a Code sketch or function signature, and numbered `steps`
6. Do not leave undefined references: every requirement ID, symbol, command, test name, and path must be defined in the plan or research evidence

## API Endpoint Addition

**Exemplar** (showing full slice format):

```markdown
## Slice Checklist

- [ ] SLICE-001: Route definition and request/response types
  - files: [src/routes/resource.ts, src/types/resource.ts]
  - depends_on: []
  - failing_test: tests/routes/resource.test.ts — "POST /resource returns 201 with valid input"
  - verification_cmd: npm test -- --grep "resource"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "export async function createResourceRoute(req: Request, res: Response): Promise<void>"
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
  - depends_on: [SLICE-001]
  - failing_test: tests/services/resource.test.ts — "creates resource with valid data"
  - verification_cmd: npm test -- --grep "resource"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "export async function createResource(input: CreateResourceInput): Promise<Resource>"
  - spec_checklist: [Service method exists, Repository query works, Error cases handled]
  - contract: [createResource(validData) → {id, ...data}, createResource(duplicateKey) → throws ConflictError]
  - acceptance_threshold: all
  - size: M
  - steps:
    1. Add failing service tests for createResource success and duplicate key.
    2. Implement ResourceRepository.create in src/repositories/resource.ts.
    3. Implement createResource in src/services/resource.ts using the repository.
    4. Run npm test -- --grep "resource" and confirm all tests passed, 0 failed.

- [ ] SLICE-003: Auth middleware and error integration
  - files: [src/routes/resource.ts]
  - depends_on: [SLICE-001]
  - failing_test: tests/routes/resource.test.ts — "rejects unauthenticated request with 401"
  - verification_cmd: npm test -- --grep "resource"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "router.post('/resource', requireAuth, createResourceRoute)"
  - spec_checklist: [Auth required on route, 401 for missing token, 403 for insufficient role]
  - contract: [POST /resource without token → 401 + {error: string}, POST /resource with insufficient role → 403 + {error: string}]
  - acceptance_threshold: all
  - size: S
  - steps:
    1. Add failing route tests for missing and insufficient credentials.
    2. Attach requireAuth middleware to POST /resource in src/routes/resource.ts.
    3. Map auth failures to 401 and 403 responses.
    4. Run npm test -- --grep "resource" and confirm all tests passed, 0 failed.
```

---

> **Non-output anti-pattern note**: Legacy `Task Checklist` examples are intentionally not used as final output. Final plans must emit `## Slice Checklist` and `SLICE-NNN` rows with the fields shown above.

## UI Component Addition

```markdown
## Slice Checklist
- [ ] SLICE-001: Component contract and render states
  - files: [src/components/Widget.tsx, src/components/Widget.module.css, tests/components/Widget.test.tsx]
  - depends_on: []
  - failing_test: tests/components/Widget.test.tsx — "Widget renders loading, empty, and populated states"
  - verification_cmd: npm test -- --grep "Widget"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "export function Widget(props: WidgetProps): JSX.Element"
  - spec_checklist: [Props typed, states rendered, event handlers wired, styles scoped]
  - contract: [Widget({items: []}) -> empty state, Widget({items}) -> list, onSelect(item.id) fires once]
  - acceptance_threshold: all
  - size: M
  - steps:
    1. Add failing component tests for loading, empty, populated, and click states.
    2. Define WidgetProps and the Widget component signature.
    3. Implement markup and scoped styles.
    4. Wire onSelect and rerun npm test -- --grep "Widget".
```

## Database Migration

```markdown
## Slice Checklist
- [ ] SLICE-001: Reversible schema migration
  - files: [migrations/202605190001_add_resource_status.sql, tests/migrations/resource-status.test.ts]
  - depends_on: []
  - failing_test: tests/migrations/resource-status.test.ts — "migration adds status with default and rollback removes it"
  - verification_cmd: npm test -- --grep "resource status migration"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "ALTER TABLE resources ADD COLUMN status text NOT NULL DEFAULT 'active';"
  - spec_checklist: [Up migration works, Down migration works, existing rows receive default, ORM model updated if needed]
  - contract: [migrate up -> resources.status exists, migrate down -> resources.status absent]
  - acceptance_threshold: all
  - size: M
  - steps:
    1. Add failing migration up/down test.
    2. Write the up and down SQL statements.
    3. Update the ORM model or repository field list if applicable.
    4. Run npm test -- --grep "resource status migration".
```

## Refactoring

```markdown
## Slice Checklist
- [ ] SLICE-001: Extract resource mapper without behavior change
  - files: [src/services/resource.ts, src/services/resource-mapper.ts, tests/services/resource.test.ts]
  - depends_on: []
  - failing_test: tests/services/resource.test.ts — "resource service keeps existing response shape after mapper extraction"
  - verification_cmd: npm test -- --grep "resource service"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "export function mapResourceRow(row: ResourceRow): Resource"
  - spec_checklist: [Mapper extracted, all imports updated, old inline mapping removed, regression test green]
  - contract: [mapResourceRow(existingRow) -> previous Resource shape]
  - acceptance_threshold: all
  - size: S
  - steps:
    1. Add or pin a failing regression test for the existing response shape.
    2. Create src/services/resource-mapper.ts with mapResourceRow.
    3. Replace inline mapping in src/services/resource.ts.
    4. Run npm test -- --grep "resource service".
```

## Bug Fix

```markdown
## Slice Checklist
- [ ] SLICE-001: Reproduce and fix null token crash
  - files: [src/auth/session.ts, tests/auth/session.test.ts]
  - depends_on: []
  - failing_test: tests/auth/session.test.ts — "parseSession returns null for missing token instead of throwing"
  - verification_cmd: npm test -- --grep "parseSession"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "export function parseSession(token: string | null | undefined): Session | null"
  - spec_checklist: [Null token handled, malformed token handled, valid token unchanged, regression test added]
  - contract: [parseSession(null) -> null, parseSession(validToken) -> Session]
  - acceptance_threshold: all
  - size: S
  - steps:
    1. Add failing regression test for null token.
    2. Guard parseSession input before token decoding.
    3. Confirm malformed and valid token tests still pass.
    4. Run npm test -- --grep "parseSession".
```

## New Feature (Full Stack)

```markdown
## Slice Checklist
- [ ] SLICE-001: Data model and persistence for saved resources
  - files: [migrations/202605190002_saved_resources.sql, src/models/saved-resource.ts, tests/models/saved-resource.test.ts]
  - depends_on: []
  - failing_test: tests/models/saved-resource.test.ts — "creates and retrieves a saved resource"
  - verification_cmd: npm test -- --grep "saved resource model"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "export interface SavedResource { id: string; ownerId: string; resourceId: string; createdAt: string }"
  - spec_checklist: [Migration created, model typed, repository can create and fetch]
  - contract: [saveResource(ownerId, resourceId) -> SavedResource]
  - acceptance_threshold: all
  - size: M
  - steps:
    1. Add failing model/repository tests.
    2. Create migration and model type.
    3. Implement create and fetch repository methods.
    4. Run npm test -- --grep "saved resource model".

- [ ] SLICE-002: API and UI integration for saved resources
  - files: [src/routes/saved-resources.ts, src/components/SaveResourceButton.tsx, tests/routes/saved-resources.test.ts, tests/components/SaveResourceButton.test.tsx]
  - depends_on: [SLICE-001]
  - failing_test: tests/routes/saved-resources.test.ts — "POST /saved-resources saves the selected resource"
  - verification_cmd: npm test -- --grep "saved resource"
  - expected_output: "all tests passed, 0 failed"
  - code_sketch: "export function SaveResourceButton({resourceId}: {resourceId: string}): JSX.Element"
  - spec_checklist: [API route validates input, UI calls route, success and error states rendered]
  - contract: [click SaveResourceButton -> POST /saved-resources -> persisted row]
  - acceptance_threshold: all
  - size: L
  - steps:
    1. Add failing API test for POST /saved-resources.
    2. Add failing component test for save click and success state.
    3. Implement route using the repository from SLICE-001.
    4. Implement SaveResourceButton API call and state handling.
    5. Run npm test -- --grep "saved resource".
```
