---
allowed-tools: Read, Grep, Glob, Agent, Write, Bash, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Phase 1: Deep research - exhaustively analyze the codebase"
---

# Phase 1: Deep Research

You are in the **Research** phase of a Deep Work session.

## Critical Constraints

🚫 **DO NOT write any code.**
🚫 **DO NOT create any implementation files.**
🚫 **DO NOT modify any existing source code.**
✅ **ONLY research, analyze, and document findings in the session's work directory.**

## Instructions

### 1. Read the state file

Read `.claude/deep-work.local.md` to get the task description, `team_mode`, and `work_dir`.

If the file doesn't exist or phase is not "research", inform the user they need to run `/deep-work <task>` first.

If `team_mode` is missing, treat it as `solo` (backward compatibility).
If `work_dir` is missing, treat it as `deep-work` (backward compatibility).

Set `WORK_DIR` to the value of `work_dir` from the state file.

### 2. Branch by mode

- **`team_mode: solo`** → Continue with [Solo Mode Research](#solo-mode-research)
- **`team_mode: team`** → Continue with [Team Mode Research](#team-mode-research)

---

## Solo Mode Research

### 2-SOLO. Conduct exhaustive research

Analyze the codebase **deeply** and **exhaustively**, covering **every detail** relevant to the task. You must investigate:

#### Architecture & Structure
- Project directory structure and organization
- Existing architectural patterns (MVC, layered, hexagonal, etc.)
- Module boundaries and responsibilities
- Entry points and bootstrapping flow

#### Code Patterns & Conventions
- Naming conventions (files, classes, functions, variables)
- Error handling patterns (try/catch, Result types, error boundaries)
- Logging and observability patterns
- Testing patterns and coverage approach
- Import/export conventions

#### Data Layer
- ORM/database schema and models
- Migration patterns
- Data validation and transformation
- Caching strategies

#### API & Integration
- API structure (REST, GraphQL, RPC)
- Authentication and authorization patterns
- External service integrations
- Middleware and interceptor chains

#### Shared Infrastructure
- Shared utilities, helpers, and abstractions
- Configuration management
- Environment handling
- Build and deployment setup

#### Dependencies & Risks
- Key dependency versions and constraints
- Potential conflict areas with the proposed task
- Breaking change risks
- Areas that need special attention

### 3-SOLO. Write research.md

Write all findings to `$WORK_DIR/research.md` in a structured format. Be thorough — this document is the foundation for the planning phase. Include:

- **Executive Summary**: One-paragraph overview of the codebase as it relates to the task
- **Architecture Analysis**: Detailed breakdown with file paths and code references
- **Relevant Patterns**: Every pattern the implementation must follow
- **Risk Assessment**: Potential issues, conflicts, and edge cases
- **Key Files**: List of files that will likely need modification
- **Dependencies Map**: What depends on what
- **Constraints**: Technical limitations or requirements discovered

Then continue to [Step 4: Update state file](#4-update-state-file).

---

## Team Mode Research

### 2-TEAM-1. Create team

Create a research team:
- Use `TeamCreate` with team_name `deep-research`
- Description: "Deep research team for parallel codebase analysis"

### 2-TEAM-2. Create tasks (TaskCreate × 3)

Create three analysis tasks:

| Task | Agent | Analysis Area | Output File |
|:-----|:------|:-------------|:-----------|
| A | arch-analyst | Architecture, structure, data layer, API | `$WORK_DIR/research-architecture.md` |
| B | pattern-analyst | Patterns, conventions, shared infrastructure, testing | `$WORK_DIR/research-patterns.md` |
| C | risk-analyst | Dependencies, risks, external integrations, security | `$WORK_DIR/research-dependencies.md` |

Each task description MUST include:
- The task_description from the state file (what we're analyzing for)
- Detailed list of analysis areas for this agent
- Output file path and structured format requirements (same sections as solo research.md but limited to their area)
- Constraint: "코드 수정 금지 — 분석 및 문서화만 수행"

### 2-TEAM-3. Spawn agents and assign

Spawn 3 `general-purpose` agents using the Agent tool:
- Names: `arch-analyst`, `pattern-analyst`, `risk-analyst`
- Each agent joins team `deep-research`
- Use `TaskUpdate` to assign each task to the corresponding agent

### 2-TEAM-4. Monitor

- Use `TaskList` to check progress periodically
- Wait until all 3 tasks are completed

### 2-TEAM-5. Synthesize results

Read all 3 partial result files and synthesize into a single `$WORK_DIR/research.md`:

- **Executive Summary**: Synthesized overview combining all three perspectives
- **Architecture Analysis**: From arch-analyst results
- **Relevant Patterns**: From pattern-analyst results
- **Risk Assessment**: From risk-analyst results
- **Key Files**: Merged from all 3 results, deduplicated
- **Dependencies Map**: Primarily from risk-analyst, supplemented by arch-analyst
- **Constraints**: Combined from all results

### 2-TEAM-6. Clean up team

- Send `shutdown_request` to all team members via `SendMessage`
- Wait for confirmations, then `TeamDelete`

### 2-TEAM-7. Continue to state update

Continue to [Step 4: Update state file](#4-update-state-file) below, with additional team info display.

---

## 4. Update state file

When research is complete, update `.claude/deep-work.local.md`:
- Set `research_complete: true`
- Set `current_phase: plan`
- Add a progress log entry for research completion

## 5. Guide the user

Display:

```
✅ Research 단계가 완료되었습니다!

📄 연구 결과: $WORK_DIR/research.md

📊 분석 요약:
  - [분석한 주요 내용 요약 3-5줄]

⚡ 현재 상태: Plan 단계로 전환됨
   - 여전히 코드 파일 수정이 차단됩니다

👉 다음 단계:
  1. $WORK_DIR/research.md 를 검토하세요
  2. 피드백이 있으면 알려주세요
  3. 준비되면 /deep-plan 을 실행하세요
```

If Team mode was used, also display:
```
🤝 팀 리서치 결과:
  - arch-analyst: $WORK_DIR/research-architecture.md
  - pattern-analyst: $WORK_DIR/research-patterns.md
  - risk-analyst: $WORK_DIR/research-dependencies.md
  - 통합 결과: $WORK_DIR/research.md
```

## Research Quality Checklist

Before marking research as complete, verify:
- [ ] Every relevant directory has been explored
- [ ] Key patterns are documented with specific file references
- [ ] Potential conflicts and risks are identified
- [ ] The document is detailed enough for someone unfamiliar with the codebase to understand the relevant parts
