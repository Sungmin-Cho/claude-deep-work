# Phase-Guard Golden Fixtures (M5.5 #3)

Each scenario is a pair of files:

- `<name>.input.json`  — describes session state + tool invocation + env
- `<name>.expected.json` — pins exit code + decision + optional reason regex

Driver: `tests/phase-guard-golden.test.js` discovers pairs by basename,
materializes the state file inside a tmpdir, spawns `phase-guard.sh` via
the `runPhaseGuard` helper, and asserts each expected field.

## `.input.json` schema

```jsonc
{
  "description": "human-readable scenario",
  "state": {                          // optional — frontmatter for .claude/deep-work.<sid>.md
    "current_phase": "implement",     // idle | research | plan | test | implement | brainstorm
    "active_slice": "SLICE-001",
    "tdd_mode": "strict",
    "tdd_state": "GREEN",
    "strict_scope": "true",
    "slice_files": ["foo.py"]
  },
  "session_id": "s-golden-idle",      // optional, defaults to "golden-default"
  "tool_name": "Write",               // CLAUDE_TOOL_USE_TOOL_NAME
  "tool_input": { "file_path": "/tmp/a.py" },
  "env": { "CLAUDE_ALLOW_RM_RF": "1" } // optional — merged AFTER host-env scrub
}
```

## `.expected.json` schema

```jsonc
{
  "exit_code": 0,                     // 0 allow, 2 block, 3 internal error
  "decision": "allow",                // optional — "allow" | "block" | "warn"
  "reason_match": "Worktree Guard"    // optional — JS regex source string,
                                       // matched against parsed JSON `reason`
}
```

## When adding fixtures

- Use kebab-case basenames so test names sort sensibly: `01-idle-allow.input.json`.
- Keep `description` short — it's prefixed onto the `it()` name.
- Run `node --test tests/phase-guard-golden.test.js` after adding.
- If a pair is missing one half, the driver throws at load time (fail loud).
