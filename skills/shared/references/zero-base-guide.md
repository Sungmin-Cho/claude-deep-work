# Zero-Base Research — Detailed Guide

## Purpose

The Zero-Base mode is for creating new projects from scratch. Instead of analyzing an existing codebase, research focuses on technology selection, architecture design, and project scaffolding.

## Research Methodology

### Area 1: Technology Stack & Architecture Pattern Selection

**Goal**: Choose the right tools for the job.

1. **Requirements analysis**: Extract functional and non-functional requirements from the task description
2. **Language/framework comparison**: Compare 2-3 options with pros/cons
3. **Architecture pattern**: Select based on project complexity and team size
   - Simple CRUD → MVC
   - Complex domain logic → Clean Architecture / Hexagonal
   - Microservices → Event-driven / CQRS
   - CLI tool → Single module with command pattern
4. **Reference projects**: Find 1-2 similar open-source projects to learn from

### Area 2: Coding Conventions & Project Standards

**Goal**: Define rules before writing any code.

1. **Naming conventions**: files (kebab-case, PascalCase), classes, functions, variables
2. **Directory structure**: Define the standard layout
3. **Linter/formatter**: Choose and configure (ESLint + Prettier, Ruff, rustfmt, etc.)
4. **Error handling**: Define the pattern (custom error classes, Result types, etc.)
5. **Logging**: Choose a logging library and define log levels
6. **Git conventions**: Commit message format, branch naming

### Area 3: Data Model & Storage Design

**Goal**: Design the data layer before implementation.

1. **Database selection**: RDB (PostgreSQL, MySQL) vs NoSQL (MongoDB, Redis) vs File-based (SQLite, JSON)
2. **Core entities**: List the main data models with fields and relationships
3. **Schema draft**: Create initial table/collection definitions
4. **Caching strategy**: Identify what needs caching and how (in-memory, Redis, CDN)
5. **Data validation**: Where and how to validate data (schema validation, runtime checks)

### Area 4: API Design & External Service Selection

**Goal**: Define interfaces before building them.

1. **API style**: REST (most common), GraphQL (complex queries), gRPC (internal services)
2. **Endpoint design**: List main endpoints with HTTP methods, paths, request/response shapes
3. **Authentication**: JWT, OAuth2, API keys, session-based
4. **Authorization**: RBAC, ABAC, simple permission checks
5. **External services**: List all third-party APIs/services needed with purpose and pricing

### Area 5: Project Scaffolding & Build/CI Design

**Goal**: Set up the development environment.

1. **Directory structure**: Full tree with descriptions for each directory
2. **Build tool**: Webpack, Vite, esbuild, setuptools, Cargo, etc.
3. **Dev environment**: Docker, devcontainer, local setup instructions
4. **CI/CD pipeline**: GitHub Actions, GitLab CI, Jenkins — define stages
5. **Environment management**: .env files, config management, secrets handling

### Area 6: Dependency Selection & Technical Risk Assessment

**Goal**: Choose dependencies wisely and identify risks.

1. **Core dependencies**: List each with version, purpose, and selection rationale
2. **License compatibility**: Check all licenses are compatible with project license
3. **Maintenance health**: Check last update date, issue activity, download stats
4. **Technical risks**:
   - Learning curve for the team
   - Community size and support availability
   - Long-term maintenance outlook
   - Security track record
5. **Alternatives**: For each critical dependency, note a fallback option

## Output Format

The research.md for zero-base projects follows the same summary-first structure (Executive Summary, Key Findings, Risk & Blockers at top), with the 6 areas as detailed sections below.

## Quality Criteria

A good zero-base research document:
- Makes clear, justified technology choices (not "it depends")
- Includes concrete schema/API drafts, not just descriptions
- Identifies realistic risks, not hypothetical ones
- Provides enough detail to scaffold the project immediately in the planning phase
- References real-world examples or documentation links
