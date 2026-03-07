# Research Phase — Detailed Guide

## Purpose

The Research phase builds a comprehensive understanding of the codebase before any decisions are made. The output (`$WORK_DIR/research.md`) serves as the foundation for the planning phase.

## Research Methodology

### Step 1: Top-Down Exploration

Start with the big picture:

1. **Project structure**: List top-level directories and understand the organization
2. **Entry points**: Find main/index files, app bootstrapping, route definitions
3. **Configuration**: Read package.json/pyproject.toml/Cargo.toml for dependencies and scripts
4. **Build system**: Understand how the project is built and deployed

### Step 2: Architecture Mapping

Identify the architectural layers:

1. **Presentation layer**: UI components, templates, API controllers
2. **Business logic**: Services, use cases, domain models
3. **Data access**: Repositories, ORM models, database queries
4. **Infrastructure**: External service integrations, messaging, caching

Document how data flows between layers.

### Step 3: Pattern Extraction

For each pattern found, document it with concrete examples:

- **Naming conventions**: How are files, classes, functions, and variables named?
- **Error handling**: Are there custom error classes? How are errors propagated?
- **Validation**: Where and how is input validated?
- **Authentication/Authorization**: How is access controlled?
- **State management**: How is application state managed?
- **Testing**: What testing framework? What's the test structure?

### Step 4: Dependency Analysis

Map out what depends on what:

- **Internal dependencies**: Which modules import from which?
- **External dependencies**: Which third-party libraries are used and why?
- **Circular dependencies**: Are there any? How are they handled?
- **Shared code**: What utilities/helpers are used across modules?

### Step 5: Risk Assessment

Identify potential issues for the planned task:

- **Conflict areas**: What existing code might be affected?
- **Breaking changes**: What could break if we make changes?
- **Performance implications**: Will the change affect performance?
- **Security considerations**: Are there security implications?

## Output Format: research.md

```markdown
# Research: [Task Title]

## Executive Summary
One paragraph summarizing the codebase landscape as it relates to the task.

## Project Structure
[Directory tree with descriptions]

## Architecture
[Layer diagram and data flow]

## Relevant Patterns
### Pattern: [Name]
- Location: [file paths]
- Description: [how it works]
- Example: [code reference]
- Relevance to task: [why it matters]

## Key Files
| File | Purpose | Relevance |
|------|---------|-----------|
| path/to/file | What it does | Why it matters |

## Dependencies
[Dependency graph or list]

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [risk] | High/Med/Low | High/Med/Low | [strategy] |

## Constraints
- [Technical limitation 1]
- [Convention requirement 2]
- [Performance requirement 3]
```

## Quality Criteria

A good research document:
- Contains specific file paths, not vague descriptions
- Shows concrete code examples, not abstract patterns
- Identifies non-obvious constraints
- Is detailed enough for the planning phase to be purely synthetic (no new research needed)
