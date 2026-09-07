---
name: deep-work
description: "Use when the user invokes /deep-work or requests a new deep-work session."
user-invocable: true
---

# Deep Work entry

Preserve `$ARGUMENTS` unchanged. Resolve the installed plugin root to a real absolute path and verify that `${CLAUDE_PLUGIN_ROOT}/skills/deep-work-orchestrator/SKILL.md` resolves inside it. Read that exact file and follow it inline. A native Skill dispatch may be used when available, but is never required to enter the workflow. Do not resolve plugin instructions from the target workspace.
