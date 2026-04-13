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

The document MUST begin with summary sections (pyramid principle: conclusions first, then evidence, then details):

```markdown
# Research: [Task Title]

## Executive Summary
<!-- 3-5줄로 핵심 결론 요약. 이 프로젝트에서 [task]를 구현하기 위해
     알아야 할 가장 중요한 사항을 먼저 기술한다. -->

## Key Findings
<!-- 불릿 리스트로 주요 발견사항 나열. 각 항목은 한 줄로. -->
- [발견 1]: [한 줄 요약]
- [발견 2]: [한 줄 요약]
- [발견 3]: [한 줄 요약]

## Risk & Blockers
<!-- 구현을 가로막을 수 있는 위험 요소. 없으면 "없음"으로 기재. -->

---

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

For zero-base projects, see [Zero-Base Guide](zero-base-guide.md).

## Quality Criteria

A good research document:
- Contains specific file paths, not vague descriptions
- Shows concrete code examples, not abstract patterns
- Captures function signatures and type definitions for all interfaces the plan will touch (tagged as [RA-NNN])
- Tags key findings with [RF-NNN] identifiers for plan cross-reference
- Identifies non-obvious constraints with specific evidence (file path + line number)
- Includes at least one code snippet per detailed analysis section (Sections 1-6)
- Is detailed enough for the planning phase to be purely synthetic (no new research needed)
- Documents existing test patterns (test framework, assertion style, file naming convention) so plan can specify tests in the project's idiom

## Incremental Research (v3.1.0)

`/deep-research --incremental` 플래그로 변경 영역만 재분석할 수 있다.

1. state 파일의 `last_research_commit`을 기준으로 `git diff` 실행
2. 변경 파일을 분석 영역에 매핑 (models→data, api→api 등)
3. 변경 안 된 영역은 이전 research.md에서 복사
4. Executive Summary에 증분 리서치 사실 표기

`--scope`와 동시 사용 시 `--scope`가 우선한다.
