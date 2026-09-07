---
name: deep-work-orchestrator
description: "Use when starting or continuing a deep-work task with durable goal, verification and completion evidence."
user-invocable: true
---

# Complete the user's goal

Parse `$ARGUMENTS` using the contained `${CLAUDE_PLUGIN_ROOT}/scripts/parse-deep-work-flags.js`. Preserve explicit method, model, effort and repository choices. Fresh profiles default to solo-adaptive/current model; existing profiles retain their choices. `--no-ask` affects setup only. `--autonomous` requests internal continuation; `--interactive-gates` requests phase conversations. Neither grants external authority.

For an existing session, use `session context --session ID` and `session authority validate --state PATH`; resume from the returned current phase. For a new task, write setup inputs (task text and validated flag/profile/default JSON), call `session initialize`, then `session repository prepare` with its session ID and returned repository mode. Persist the returned `defaults` as the prepare route’s --defaults-json input so explicit flags and profile choices survive; do not reuse the earlier defaults file. Use the returned state capability path/work directory. Do not manually write state, reserve a guessed session ID or convert `main` to another model.

Resolve `${CLAUDE_PLUGIN_ROOT}` to a literal real absolute path and check each referenced file stays inside it. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md` before invoking runtime commands. `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help` provides exact inputs and enums.

Work through Brainstorm → Research → Spec → Plan → Implement → Test → Integrate/Finish. Scale the reasoning and artifacts to the task: Low risk can combine discussion and author a compact Spec without a separate approval conversation. Every fresh execution plan still binds a real Spec. Read the applicable phase entry at `${CLAUDE_PLUGIN_ROOT}/skills/deep-<phase>/SKILL.md` explicitly after substituting one of the listed phase names; native Skill calls are optional, never required host capabilities.

After each phase's evidence is valid, call `phase continue --state PATH`; it derives the internal next transition under lock. Continue authorized work immediately. When interactive gates are requested, honor that preference. Otherwise ask only for missing intent or genuinely new authority, explaining the concrete dependency.

Use `session environment explain/prepare` for a necessary supported dependency preparation already authorized by the task. Execution follows an explicit prepared digest; continue/compile/resume never run it implicitly.

Keep reasoning during implementation. Adapt local details within the sealed contract. Material goal/scope/oracle/basis changes use authenticated replan; reuse existing authorization and refresh only affected evidence. Preserve healthy completed work.

Report concise progress and the next meaningful result. Finish only when the actual user outcome, required verification/reviews and durable final receipt are complete. Preserve failed/unavailable evidence; never use a display marker or a fabricated receipt as completion.
