# TODOS

## P1 — Critical (v4.0 PR1)

### Bash hook enforcement
- **What:** Add Bash tool to PreToolUse hook matcher to detect file-writing commands
- **Why:** Current hook only blocks Write/Edit/MultiEdit. AI can bypass TDD enforcement
  via `echo 'code' > file.ts`, `sed -i`, `tee`, `cp`, `mv` in Bash. Discovered by
  Codex during CEO review (2026-03-25).
- **How:** Add `Bash` to hooks.json PreToolUse matcher. In phase-guard.sh, when tool is
  Bash, parse the `command` field (not `file_path`) and detect file-writing patterns.
  Block with guidance message if in non-implement phase or TDD state requires test first.
- **Status:** IN PROGRESS — included in PR1

## P2 — Important (v4.0 follow-up)

### Model routing auto-selection by slice complexity
- **What:** Auto-select model (haiku/sonnet/opus) based on slice estimated_size field
- **Why:** Optimize cost — small slices don't need expensive models
- **Deferred to:** v4.1

### Git worktree isolation
- **What:** Integrate superpowers-style worktree isolation for implementation sessions
- **Why:** Prevents accidental changes to main branch during deep-work sessions
- **Deferred to:** v4.1

### Finishing-a-development-branch workflow
- **What:** 4 completion options (merge, PR, keep, discard) at session end
- **Why:** Clean session termination with explicit user choice
- **Deferred to:** v4.1

### CI/CD integration via receipt export
- **What:** GitHub Actions workflow that validates receipt completeness
- **Why:** Receipt export (PR4) creates the data; CI validates it
- **Deferred to:** v4.1
