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

Read `.claude/deep-work.local.md` to get the task description, `team_mode`, `work_dir`, and `project_type`.

If the file doesn't exist or phase is not "research", inform the user they need to run `/deep-work <task>` first.

If `team_mode` is missing, treat it as `solo` (backward compatibility).
If `work_dir` is missing, treat it as `deep-work` (backward compatibility).
If `project_type` is missing, treat it as `existing` (backward compatibility).

Set `WORK_DIR` to the value of `work_dir` from the state file.

**Record start time**: Update `research_started_at` in the state file with the current ISO timestamp.

### 1-1. Check for partial re-run

Check if `$ARGUMENTS` contains a `--scope=` option.

Example: `/deep-research --scope=api,data`

If scope option is present:
1. Read the existing `$WORK_DIR/research.md`
2. Re-analyze only the specified areas
3. Overwrite the corresponding sections in research.md with the new analysis
4. Update the Executive Summary and Key Findings to reflect the re-analysis
5. Skip to [Step 4: Update state file](#4-update-state-file)

Valid scope values: `architecture`, `patterns`, `data`, `api`, `infrastructure`, `dependencies`

### 1-2. Check for previous Research cache

Search the `deep-work/` directory for the most recent `research.md` from a previous session (not the current session).

If a previous research.md exists:

```
📚 이전 리서치 발견:
   경로: deep-work/[이전 세션]/research.md
   작성일: [timestamp]

이전 리서치를 베이스라인으로 활용할까요?
1. ✅ 네 — 변경된 부분만 업데이트 (빠름)
2. ❌ 아니오 — 처음부터 분석 (정확함)
```

If the user selects option 1:
- Run `git diff --stat [previous session start time]..HEAD` to identify changed files (if git is available)
- Identify which analysis areas are affected by the changes
- Re-analyze only the changed areas
- Copy unchanged areas from the previous research.md
- Add note to Executive Summary: "[베이스라인: 이전 세션] + [변경 영역 재분석]"

If the user selects option 2 or git is not available:
- Proceed with full analysis as normal

### 1-3. Check for incremental mode

If `$ARGUMENTS` contains `--incremental`:

1. Read `last_research_commit` from the state file
2. If empty or missing, inform the user and fall back to full research:
   ```
   ℹ️ 이전 리서치 커밋 기록이 없습니다. 전체 리서치를 진행합니다.
   ```
   Proceed to Section 2.

3. Run `git diff --name-only $last_research_commit..HEAD` to get changed files
4. Map changed files to research areas using this heuristic:
   - `**/models/**`, `**/schema/**`, `**/entities/**`, `**/migrations/**` → data
   - `**/api/**`, `**/routes/**`, `**/controllers/**`, `**/handlers/**` → api
   - `**/middleware/**`, `**/core/**`, `**/config/**` → architecture
   - `**/test/**`, `**/spec/**`, `**/utils/**`, `**/helpers/**` → patterns
   - `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod` → dependencies
   - Other files → architecture (default)
5. Read the most recent previous `research.md` from a prior session
6. Copy unchanged sections verbatim from the previous research
7. Re-analyze only the affected areas
8. Update Executive Summary with note: `> 📚 증분 리서치: [영역 목록] 재분석, 기준 커밋: [last_research_commit]`
9. After completion, update `last_research_commit` in state file to current HEAD (`git rev-parse HEAD`)
10. Skip to [Step 4: Update state file](#4-update-state-file)

**Note**: `--scope` takes priority over `--incremental`. If both are provided, `--scope` wins.

### 2. Branch by mode and project type

- **`project_type: zero-base`** → Continue with [Zero-Base Research](#zero-base-research)
- **`team_mode: solo`** → Continue with [Solo Mode Research](#solo-mode-research)
- **`team_mode: team`** → Continue with [Team Mode Research](#team-mode-research)

---

## Zero-Base Research

For new projects without an existing codebase, investigate these 6 areas instead of analyzing existing code:

### 1. Technology Stack & Architecture Pattern Selection
- Compare languages/frameworks suitable for the requirements
- Select architecture pattern (MVC, Clean Architecture, Hexagonal, etc.)
- Analyze similar open-source projects for reference

### 2. Coding Conventions & Project Standards
- Naming rules, directory structure standards
- Linter/formatter setup (ESLint, Prettier, Ruff, etc.)
- Error handling patterns, logging strategy

### 3. Data Model & Storage Design
- Database selection (RDB, NoSQL, file-based)
- Core entity/schema draft
- Caching strategy (if needed)

### 4. API Design & External Service Selection
- API style (REST, GraphQL, gRPC)
- Authentication/authorization method
- External services to integrate

### 5. Project Scaffolding & Build/CI Design
- Directory structure design
- Build tool selection (Webpack, Vite, setuptools, etc.)
- CI/CD pipeline draft

### 6. Dependency Selection & Technical Risk Assessment
- Core dependency list with selection rationale
- License compatibility check
- Technical risks (learning curve, community activity, maintenance outlook)

### Write research.md (Zero-Base)

Write all findings to `$WORK_DIR/research.md` with the following structure:

```markdown
# Research: [Task Title] (Zero-Base)

## Executive Summary
<!-- 3-5줄로 핵심 결론 요약. 이 프로젝트를 구현하기 위해
     알아야 할 가장 중요한 사항을 먼저 기술한다. -->

## Key Findings
<!-- 불릿 리스트로 주요 발견사항 나열. 각 항목은 한 줄로. -->
- [발견 1]: [한 줄 요약]
- [발견 2]: [한 줄 요약]
- [발견 3]: [한 줄 요약]

## Risk & Blockers
<!-- 구현을 가로막을 수 있는 위험 요소. 없으면 "없음"으로 기재. -->

---

## 1. Technology Stack & Architecture
[Detailed analysis]

## 2. Coding Conventions & Standards
[Detailed analysis]

## 3. Data Model & Storage
[Detailed analysis]

## 4. API Design & External Services
[Detailed analysis]

## 5. Project Scaffolding & Build/CI
[Detailed analysis]

## 6. Dependencies & Technical Risks
[Detailed analysis]
```

Then continue to [Step 4: Update state file](#4-update-state-file).

---

## Solo Mode Research

### 1-1. Model Routing Check (Solo Mode)

Read `model_routing` from the state file. Default: `{research: "sonnet", plan: "main", implement: "sonnet", test: "haiku"}`.

If `model_routing.research` is NOT "main":
  - Use the Agent tool to spawn a research agent:
    - `model`: value of `model_routing.research` (e.g., "sonnet")
    - `prompt`: Include ALL the Solo Mode Research instructions below (Sections 2-SOLO and 3-SOLO), plus the task_description, WORK_DIR path, and project_type
    - `description`: "Deep research analysis"
  - Wait for the Agent to complete (it will write `$WORK_DIR/research.md`)
  - Skip to [Step 4: Update state file](#4-update-state-file)

If `model_routing.research` is "main":
  - Execute Solo Mode Research in the current session (existing behavior below)

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

Write all findings to `$WORK_DIR/research.md` in a structured format. The document MUST begin with summary sections, followed by detailed analysis (pyramid principle: conclusions first, then evidence, then details).

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

## 1. Architecture & Structure
[Detailed breakdown with file paths and code references]

## 2. Relevant Patterns
[Every pattern the implementation must follow]

## 3. Data Layer
[Data models, migrations, validation]

## 4. API & Integration
[API structure, auth, external services]

## 5. Shared Infrastructure
[Utilities, config, build setup]

## 6. Dependencies & Risk Assessment
[Potential issues, conflicts, and edge cases]

## Key Files
| File | Purpose | Relevance |
|------|---------|-----------|

## Dependencies Map
[What depends on what]

## Constraints
- [Technical limitation 1]
- [Convention requirement 2]
```

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
- Read `model_routing.research` from the state file (default: "sonnet")
- Pass the `model` parameter to each Agent spawn call (e.g., `model: "sonnet"`)
- Names: `arch-analyst`, `pattern-analyst`, `risk-analyst`
- Each agent joins team `deep-research`
- Use `TaskUpdate` to assign each task to the corresponding agent

### 2-TEAM-4. Monitor with progress notifications

- Use `TaskList` to check progress periodically
- **Display progress as each agent completes**:
  ```
  [1/3] arch-analyst 완료 ✅ (pattern-analyst, risk-analyst 대기 중...)
  [2/3] pattern-analyst 완료 ✅ (risk-analyst 대기 중...)
  [3/3] risk-analyst 완료 ✅
  ```
- Wait until all 3 tasks are completed

### 2-TEAM-5. Synthesize results

Read all 3 partial result files and synthesize into a single `$WORK_DIR/research.md`. The synthesized document MUST begin with summary sections:

```markdown
# Research: [Task Title]

## Executive Summary
<!-- 3-5줄. 세 분석가의 결과를 종합한 핵심 결론. -->

## Key Findings
- [발견 1]: [한 줄 요약]
- [발견 2]: [한 줄 요약]
- [발견 3]: [한 줄 요약]

## Risk & Blockers
<!-- 종합된 위험 요소. -->

---
```

Then include detailed sections:
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
- Set `research_completed_at` to the current ISO timestamp
- Update `last_research_commit` to the current git HEAD: run `git rev-parse HEAD 2>/dev/null` and store the result
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
  2. 특정 영역만 재분석하려면: /deep-research --scope=api,data
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

### 6. Send notification

Run the following command to notify phase completion. If it fails, ignore and continue:
```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$PROJECT_ROOT/.claude/deep-work.local.md" "research" "completed" "✅ Research 완료 — Plan 준비됨" 2>/dev/null || true
```

## Research Quality Checklist

Before marking research as complete, verify:
- [ ] Every relevant directory has been explored
- [ ] Key patterns are documented with specific file references
- [ ] Potential conflicts and risks are identified
- [ ] The document is detailed enough for someone unfamiliar with the codebase to understand the relevant parts
- [ ] Executive Summary and Key Findings are at the top of the document
