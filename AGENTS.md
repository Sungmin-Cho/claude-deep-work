# deep-work - Codex Project Guide

Evidence-Driven Development Protocol for structured agent work. The plugin
remains Claude Code compatible while also exposing native Codex plugin metadata.

Current version: 6.7.1.

## Runtime Surfaces

- Codex manifest: `.codex-plugin/plugin.json`
- Claude Code manifest: `.claude-plugin/plugin.json`
- User-invocable skills: `skills/*/SKILL.md`
- Hooks: `hooks/hooks.json` and `hooks/scripts/`
- Agents: `agents/`
- Release history: `CHANGELOG.md` and `CHANGELOG.ko.md`

Do not edit local install caches under `~/.claude/plugins/` or
`~/.codex/plugins/cache/` directly. Update this repo, then update the suite
marketplace pin after the plugin release lands on `main`.

## Verification

```bash
node -e "JSON.parse(require('fs').readFileSync('.codex-plugin/plugin.json','utf8'))"
npm test
```

After a release, update `/Users/sungmin/Dev/claude-plugins/deep-suite/`:

- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`
- generated README / guide marker regions when version text changes
