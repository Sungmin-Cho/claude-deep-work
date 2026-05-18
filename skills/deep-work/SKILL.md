---
name: deep-work
description: "Use when the user invokes /deep-work \"task\", uses cross-platform Skill({ skill: \"deep-work:deep-work\", args: \"task\" }) or $deep-work:deep-work \"task\", asks to start a new deep-work session, or requests the primary Evidence-Driven Development auto-flow entry point. This is a compatibility alias for deep-work-orchestrator and preserves the historical /deep-work entry name."
user-invocable: true
---

# Deep Work Entry Alias

This skill preserves the historical `/deep-work <task>` entrypoint name for
Codex and other skill-based callers.

Forward the invocation to `deep-work-orchestrator` with the same `$ARGUMENTS`
and follow that skill's instructions exactly:

```text
Skill("deep-work-orchestrator", args="$ARGUMENTS")
```
