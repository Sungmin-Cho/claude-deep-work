@AGENTS.md

# Claude-only notes

`agents/*.md` are Claude Code subagents, dispatched as
`Agent(subagent_type="deep-work:<worker>")` by `skills/deep-implement` (team mode)
and `skills/deep-research`. `.codex-plugin/plugin.json` declares no agents
surface, so on Codex the same work runs inline in the calling skill. Everything
else in `AGENTS.md` applies to both hosts.
