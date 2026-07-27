---
name: deep-fork
description: "Create an isolated deep-work branch for a parallel slice, alternative experiment, independent review, recovery, or security isolation. Same-goal context continuation is not a fork reason."
user-invocable: true
---

# Deep Fork

`deep-fork` creates one managed child worktree and session through the public
deep-work dispatcher. The dispatcher is the sole execution authority for Git,
state, registry, snapshot, and parent-link mutations.

Do not reproduce the lifecycle with direct `git worktree`, state-file writes,
registry edits, shell helpers, or copied legacy instructions.

## Arguments

```text
/deep-fork [session-id] [--from-phase=<phase>] [--reason=<reason>]
```

Allowed phases:

- `brainstorm`
- `research`
- `spec`
- `plan`
- `implement`
- `test`

Allowed reasons:

- `parallel-slice`
- `alternative-experiment`
- `independent-review`
- `recovery`
- `security-isolation`

`context-pressure`, token limits, or a desire for a fresh context are not valid
reasons. Continue the same goal instead.

## Procedure

1. Resolve the parent session by explicit ID, active-session environment, then
   the selected session pointer.
2. If `--reason` is absent, ask which allowed isolation reason applies. Do not
   infer a reason from context pressure.
3. If `--from-phase` is absent, ask for a phase no later than the parent phase.
4. Inspect the parent repository. If dirty, ask for one of:
   - `commit`
   - `stash-apply`
   - `abort`
5. Invoke the production route:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" \
  session fork \
  --parent "<PARENT_SESSION_ID>" \
  --from-phase "<PHASE>" \
  --reason "<REASON>" \
  --dirty-resolution "<DIRTY_RESOLUTION>"
```

6. Treat the returned JSON as authoritative. Report the generated child
   session ID, worktree, branch, generation, snapshot digest, and reason.

The route records the reason in the child state, fork snapshot, registry row,
parent link, and operation journal. A missing or unknown reason fails before
Git mutation.

## Compatibility

Existing child sessions without `fork_reason` remain readable. They are legacy
artifacts and do not authorize another fork. A new fork always uses the
dispatcher contract above.

Non-Git sessions cannot create a managed child worktree. Continue in the same
session or use an explicitly supported external isolation workflow; do not
emulate the old artifacts-only fork by writing session state directly.

## Failure handling

- Collision or stale parent: stop and report the exact dispatcher error.
- Dirty-resolution failure: preserve the parent and report recovery guidance.
- Partial lifecycle interruption: rerun the exact same dispatcher request so
  its journal can adopt the existing side effects.
- Never delete a worktree, branch, state file, or registry row manually as
  automatic recovery.
