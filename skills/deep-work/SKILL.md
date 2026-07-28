---
name: deep-work
description: "Primary Evidence-Driven Development entry point. Triggers on /deep-work \"task\", Skill({ skill: \"deep-work:deep-work\", args: \"task\" }), $deep-work:deep-work \"task\", or a request to start a new deep-work session. Compatibility alias for deep-work-orchestrator."
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
