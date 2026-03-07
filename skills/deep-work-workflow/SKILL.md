---
name: deep-work-workflow
description: |
  This skill should be used when the user wants to follow a structured, phase-based
  development workflow that separates research, planning, and implementation into
  distinct phases. It applies when users say things like "deep work", "3단계 워크플로우",
  "기획과 코딩 분리", "plan before code", "리서치 플랜 구현", "structured workflow",
  "analyze the codebase first then plan", "research then plan then implement",
  "분석 후 구현", "계획 세우고 구현", or want to enforce strict separation between
  planning and coding to avoid premature implementation. Also use this skill when
  the user describes a complex, multi-file task that would benefit from structured
  planning — for example "복잡한 기능 구현", "여러 파일을 수정해야 하는 작업",
  "큰 작업을 체계적으로 진행하고 싶어", "코드 분석 먼저 하고 싶어", "구현 전에
  계획부터 세워줘", "this is a big change, let's plan first", "analyze the codebase
  before we start", "I want to understand the code before making changes", or any
  request involving architectural changes, cross-module refactoring, or unfamiliar
  codebase exploration where jumping straight to implementation would risk mistakes.
  This skill covers the full Research -> Plan -> Implement lifecycle including
  phase enforcement, state management, and iterative plan review. Even if the user
  does not explicitly mention "deep work" or "workflow", consider triggering this
  skill for complex feature requests touching multiple files or modules where a
  structured approach would prevent common AI coding pitfalls like architecture
  ignorance, duplicate implementation, or premature coding.
compatibility: |
  Team mode requires Agent Teams feature (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1).
  Solo mode works with standard Claude Code installation.
  Requires PreToolUse hook support for phase enforcement.
---

# Deep Work Workflow: Research → Plan → Implement

## Why This Workflow Exists

When AI coding tools work on complex tasks without structure, common failure modes emerge:

1. **Architecture Ignorance**: AI generates code that doesn't follow existing patterns
2. **Duplicate Implementation**: AI creates new utilities when equivalent ones already exist
3. **Premature Coding**: AI starts writing code before understanding the full picture
4. **Scope Creep**: AI adds "improvements" not requested, introducing bugs
5. **Inconsistency**: AI uses different conventions than the rest of the codebase

The Deep Work workflow prevents these by **strictly separating analysis, planning, and coding** into three distinct phases with enforced gates between them.

## The Three Phases

### Phase 1: Research (`/deep-research`)

**Goal**: Build a complete mental model of the relevant codebase before making any decisions.

**What happens**:
- Exhaustive analysis of architecture, patterns, and conventions
- Identification of all relevant files, dependencies, and risk areas
- Documentation of everything in `$WORK_DIR/research.md`

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "You cannot plan what you don't understand, and you cannot understand what you haven't read."

**Team mode**: 3 specialist agents (arch-analyst, pattern-analyst, risk-analyst) analyze the codebase in parallel, then results are synthesized into a single research document.

For detailed guidance, see [Research Guide](references/research-guide.md).

### Phase 2: Plan (`/deep-plan`)

**Goal**: Create a detailed, reviewable, approvable implementation plan.

**What happens**:
- Transform research findings into a concrete action plan
- Define exact files to modify, code snippets, execution order
- Document trade-offs, risks, and rollback strategies
- Create a checklist-style task list in `$WORK_DIR/plan.md`

**What's blocked**: All code file modifications (enforced by hook)

**Key principle**: "The plan is the contract between human and AI. No implementation without approval."

**Feedback loop**: The user reviews the plan, adds notes, and the plan is refined until explicitly approved.

**Self-review**: Before presenting the plan to the user, review the plan against the research findings for internal consistency — verify all referenced files exist, all patterns are respected, and no contradictions exist between tasks. Document any inconsistencies found and resolved.

**Auto-implementation**: When the user approves the plan ("승인"), implementation starts automatically — no need to run `/deep-implement` manually.

**Note**: Plan phase does not use Team mode — planning requires a single coherent document produced by one agent.

For detailed guidance, see [Planning Guide](references/planning-guide.md).

### Phase 3: Implement (`/deep-implement`)

**Goal**: Mechanically execute the approved plan, task by task.

**What happens**:
- Follow the plan checklist exactly
- Implement one task at a time, marking each complete
- Run verification (type checks, lints, tests) as applicable
- Document any issues encountered — never improvise
- **Automatically generate a session report** upon completion

**What's allowed**: All tools — code modification is now permitted

**Key principle**: "The best implementation is a boring implementation. No creativity, no surprises, just faithful execution."

**Team mode**: Tasks are clustered by file ownership and distributed to parallel agents. After implementation, agents cross-review each other's work before final verification.

For detailed guidance, see [Implementation Guide](references/implementation-guide.md).

### Session Report (`/deep-report`)

**Goal**: Generate or view a comprehensive report of the entire session.

**What happens**:
- Summarizes research findings, planning decisions, and implementation results
- Documents files changed, verification results, and issues encountered
- Saved as `$WORK_DIR/report.md`

**When it runs**:
- Automatically after implementation completes
- Manually via `/deep-report` at any time (can regenerate with current state)

## Phase Enforcement

A PreToolUse hook (`phase-guard.sh`) enforces phase boundaries:

- During **Research** and **Plan** phases: Write/Edit tools are blocked for all files except `$WORK_DIR/` documents and the state file
- During **Implement** phase: All tools are available
- When no session is active: No restrictions

This is not a suggestion — it's a hard gate. The AI literally cannot modify code files until the plan is approved.

## Quick Start

```
/deep-work "Add user authentication with JWT tokens"   # Initialize session (Solo/Team select, task folder created)
/deep-research                                          # Phase 1: Analyze codebase
# Review $WORK_DIR/research.md
/deep-plan                                              # Phase 2: Create plan
# Review $WORK_DIR/plan.md, add notes, iterate
# Type "승인" when satisfied → Implementation starts automatically
# → Phase 3 runs automatically, report generated
/deep-report                                            # View or regenerate session report
/deep-status                                            # Check status and session history
```

When initializing with `/deep-work`, you'll be asked to choose between **Solo** and **Team** mode. Team mode requires Agent Teams to be enabled in your environment.

## Session History

Each session creates a unique task folder under `deep-work/`:
```
deep-work/
├── 20260307-143022-jwt-기반-인증/
│   ├── research.md
│   ├── plan.md
│   └── report.md
├── 20260306-091500-api-리팩토링/
│   ├── research.md
│   ├── plan.md
│   └── report.md
```

Previous sessions are preserved when starting new ones. Use `/deep-status` to view session history.

## State Management

Session state is stored in `.claude/deep-work.local.md` with YAML frontmatter tracking:
- Current phase
- Task description
- **Work directory** (`work_dir` — path to the task-specific folder)
- Research completion status
- Plan approval status
- Iteration count
- **Team mode** (`solo` or `team`)
- Timestamps

Use `/deep-status` at any time to see the current state, work mode, session history, and next recommended action.

## When to Use Deep Work

**Use it when**:
- The task touches multiple files or modules
- You're working in an unfamiliar codebase
- The change has architectural implications
- Previous AI attempts have gone wrong
- You want to review the approach before any code is written

**Consider Team mode when**:
- The codebase is large and research would benefit from parallel analysis
- The implementation plan has many independent tasks across different files
- Complex refactoring that touches many modules simultaneously
- You want built-in cross-review of implementation quality

**Skip it when**:
- Simple one-file bug fixes
- Trivial text or config changes
- You already know exactly what to do

## Complexity Assessment

Not every task needs the full three-phase workflow. Assess task complexity before starting:

**Full 3-phase workflow (Research -> Plan -> Implement):**
- Touches 5+ files across multiple modules
- Involves architectural changes or new patterns
- Working in an unfamiliar codebase
- Previous attempts have gone wrong
- High-risk changes (auth, data, payments)

**Lightweight mode (skip to /deep-plan directly):**
- Touches 2-4 files in a well-understood area
- Follows established patterns with minor extensions
- Medium complexity where a plan helps but exhaustive research is overkill
- Start with `/deep-work` then `/deep-plan` directly, skipping `/deep-research`

**No workflow needed:**
- Single-file bug fixes or config changes
- Trivial text edits
- Tasks where the solution is already known

## Complementary Usage with Built-in Plan Mode

Deep Work and Claude's built-in plan mode serve different purposes and can work together:

- **Built-in plan mode**: Lightweight, good for quick task decomposition and initial design review
- **Deep Work**: Heavyweight, enforces strict phase gates with documentation artifacts and session persistence

**Combined usage pattern**: Use built-in plan mode for initial task decomposition, then Deep Work for complex subtasks that need thorough research and planning before implementation.
