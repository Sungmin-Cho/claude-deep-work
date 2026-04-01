---
allowed-tools: Read, Grep, Glob, Agent, Write, Bash, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage
description: "Phase 1: Deep research - exhaustively analyze the codebase"
---

# Phase 1: Deep Research

You are in the **Research** phase of a Deep Work session.

## Language

Detect the user's language from their messages or the Claude Code `language` setting. **Output ALL user-facing messages in the detected language.** The display templates below use Korean as the reference format — translate naturally to the user's language while preserving emoji, formatting, and structure.

## Critical Constraints

🚫 **DO NOT write any code.**
🚫 **DO NOT create any implementation files.**
🚫 **DO NOT modify any existing source code.**
✅ **ONLY research, analyze, and document findings in the session's work directory.**

## Instructions

### 1. Read the state file

Resolve the current session's state file:
1. If `DEEP_WORK_SESSION_ID` env var is set → `.claude/deep-work.${DEEP_WORK_SESSION_ID}.md`
2. If `.claude/deep-work-current-session` pointer file exists → read session ID → `.claude/deep-work.${SESSION_ID}.md`
3. Legacy fallback → `$STATE_FILE`

Set `$STATE_FILE` to the resolved path.

Read `$STATE_FILE` to get the task description, `team_mode`, `work_dir`, and `project_type`.

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

### 1-4. Document Refinement Protocol

**This protocol applies whenever research.md is updated** — whether via partial re-run (`--scope=`), incremental mode (`--incremental`), research cache reuse, or user feedback during the research phase.

After incorporating new or updated content into `$WORK_DIR/research.md`, perform these 3 steps:

1. **Apply** — Incorporate the new analysis content into the appropriate sections.
2. **Deduplicate** — Scan the entire document for duplicate or near-duplicate information across sections. If the same finding, pattern, or dependency appears in multiple places, keep it only in the most appropriate section and remove it from others.
3. **Prune** — Remove content that has been invalidated by the new analysis (e.g., old findings about files that no longer exist, patterns that have been refactored). Delete any sections that are now empty. Tighten verbose descriptions.

After refinement, append a log entry at the end of the document:

```
<!-- Refinement Log -->
<!-- v[N]: [summary of what changed] — deduped: [N] items, pruned: [M] sections -->
```

Where `[N]` is the revision number (increment from previous log entries, starting at 2).

### 1-5. Session Relevance Detection

When the user provides additional direction or feedback during the research phase, evaluate whether it falls within the current session scope before incorporating it.

Read `task_description` from `$STATE_FILE`. If the user's input introduces a clearly unrelated topic (not a refinement of the current research task), use AskUserQuestion:

```
💡 이 요청은 현재 세션("[task_description]")의 범위 밖으로 보입니다.

1. 현재 세션에 포함 — 리서치 범위 확장
2. 새 세션으로 분리 — 현재 세션 완료 후 진행
3. 백로그에 저장 — deep-work/backlog.md에 기록
```

- Option 1: expand research scope.
- Option 2: continue current research unchanged.
- Option 3: append to `deep-work/backlog.md` with timestamp.

If the input is related to the current task, proceed without interruption.

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

### Team Mode Pre-check

Before proceeding with team mode, validate that Agent Teams is still available:

```bash
echo "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-not_set}"
```

If the result is `not_set` or empty:
```
⚠️ Agent Teams 환경변수가 비활성화되었습니다. Solo 모드로 전환합니다.
```
- Update `team_mode: solo` in `$STATE_FILE`
- Fall back to the Solo research flow above (Step 1 through Step 4)
- Do NOT proceed to Team Mode Research below

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
  [1/3] arch-analyst 완료 ✅ (pattern-analyst, risk-analyst 진행 중...)
  [2/3] pattern-analyst 완료 ✅ (risk-analyst 진행 중...)
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

When research is complete, update `$STATE_FILE`:
- Set `research_complete: true`
- Set `current_phase: plan`
- Set `research_completed_at` to the current ISO timestamp
- Update `last_research_commit` to the current git HEAD: run `git rev-parse HEAD 2>/dev/null` and store the result
- Add a progress log entry for research completion

### 4.5. Structural Review

Read `references/review-gate.md` from the skill directory (located at `skills/deep-work-workflow/references/review-gate.md`).

Follow the **Structural Review Protocol** with these settings:
- **Phase**: research
- **Document**: `$WORK_DIR/research.md`
- **Dimensions**: completeness, accuracy, relevance, depth, actionability
- **Output**: `$WORK_DIR/research-review.json` + `$WORK_DIR/research-review.md`
- **Model**: "haiku"
- **Max iterations**: 2

If `--skip-review` flag was set during session init (check state file `review_state: skipped`), skip this step entirely and proceed.

Update state file when starting review:
- `review_state: in_progress`

After review completes, update state file:
- `review_state: completed`
- `review_results.research`: `{score: N, iterations: N, timestamp: "ISO"}`

Display:
```
Structural Review 결과: [score]/10 ([iterations]회 반복)
```

## 5. Guide the user

**IMPORTANT**: Do NOT auto-proceed to plan phase. Present the research results and wait for user feedback.

Display:

```
✅ Research 단계가 완료되었습니다!

연구 결과: $WORK_DIR/research.md

분석 요약:
  - [분석한 주요 내용 요약 3-5줄]

현재 상태: Plan 단계로 전환됨
   - 여전히 코드 파일 수정이 차단됩니다
```

Then use AskUserQuestion:
```
리서치 결과를 검토해주세요:

1. Plan 단계로 진행 — 리서치 결과에 만족합니다
2. 피드백 제공 — 리서치 내용을 수정/보완하고 싶습니다
3. 특정 영역 재분석 — 추가 조사가 필요합니다
```

- If option 1: proceed (auto-flow or manual /deep-plan).
- If option 2: apply feedback to research.md, re-display updated summary, ask again.
- If option 3: inform user to run `/deep-research --scope=<area>`.

If Team mode was used, also display:
```
팀 리서치 결과:
  - arch-analyst: $WORK_DIR/research-architecture.md
  - pattern-analyst: $WORK_DIR/research-patterns.md
  - risk-analyst: $WORK_DIR/research-dependencies.md
  - 통합 결과: $WORK_DIR/research.md
```

### 6. Send notification

Run the following command to notify phase completion. If it fails, ignore and continue:
```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/notify.sh "$STATE_FILE" "research" "completed" "✅ Research 완료 — Plan 준비됨" 2>/dev/null || true
```

## Research Quality Checklist

Before marking research as complete, verify:
- [ ] Every relevant directory has been explored
- [ ] Key patterns are documented with specific file references
- [ ] Potential conflicts and risks are identified
- [ ] The document is detailed enough for someone unfamiliar with the codebase to understand the relevant parts
- [ ] Executive Summary and Key Findings are at the top of the document
