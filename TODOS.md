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
- **Status:** DONE — implemented in PR1 (hooks.json + phase-guard.sh + phase-guard-core.js)

## P2 — Important (v4.1 — IMPLEMENTED)

### Model routing auto-selection by slice complexity
- **What:** Auto-select model (haiku/sonnet/opus) based on slice estimated_size field
- **Why:** Optimize cost — small slices don't need expensive models
- **Status:** DONE — v4.1 (auto routing table in deep-implement.md Step 4)

### Git worktree isolation
- **What:** Worktree-based isolation for implementation sessions
- **Why:** Prevents accidental changes to main branch during deep-work sessions
- **Status:** DONE — v4.1 (deep-work.md Step 2-1, deep-finish.md, deep-cleanup.md)

### Finishing-a-development-branch workflow
- **What:** 4 completion options (merge, PR, keep, discard) at session end
- **Why:** Clean session termination with explicit user choice
- **Status:** DONE — v4.1 (/deep-finish command)

### CI/CD integration via receipt export
- **What:** GitHub Actions workflow that validates receipt completeness
- **Why:** Receipt export (PR4) creates the data; CI validates it
- **Status:** DONE — v4.1 (validate-receipt.sh + templates/deep-work-ci.yml)
