# deep-work v5.6.0

Auto-flow orchestration plugin. `/deep-work "task"` 하나로 전체 워크플로우 자동 진행.

## Where to look

| What | Where |
|------|-------|
| Plugin manifest | `plugins/deep-work/.claude-plugin/plugin.json` |
| Commands (7 primary + 13 deprecated) | `plugins/deep-work/commands/` |
| Hook scripts (phase-guard, file-tracker, etc.) | `plugins/deep-work/hooks/scripts/` |
| Hook config | `plugins/deep-work/hooks/hooks.json` |
| SKILL.md (trigger, phase docs, references) | `plugins/deep-work/skills/deep-work-workflow/SKILL.md` |
| Reference guides (12 files) | `plugins/deep-work/skills/deep-work-workflow/references/` |
| Tests | `plugins/deep-work/hooks/scripts/*test.js` |
| Changelog | `plugins/deep-work/CHANGELOG.md` |
| Full docs (EN / KO) | `plugins/deep-work/README.md` / `README.ko.md` |

## Testing

```bash
cd plugins/deep-work/hooks/scripts
node --test phase-guard-core.test.js
node --test assumption-engine.test.js
node --test multi-session.test.js
```

## Conventions

- Hook exit codes: 0 (allow), 2 (block with JSON reason)
- Hook timeouts: PreToolUse 5s, PostToolUse 3s, Stop 5s
- Commands output in user's detected language
- State file: `.claude/deep-work.{SESSION_ID}.md` (YAML frontmatter, per-session)
- Session registry: `.claude/deep-work-sessions.json` (central index)
- Session pointer: `.claude/deep-work-current-session` (env var fallback)
- File paths: cross-platform normalized (POSIX)
