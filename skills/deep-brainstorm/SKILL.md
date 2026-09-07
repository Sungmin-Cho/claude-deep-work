---
name: deep-brainstorm
description: "Use when clarifying the goal, boundaries and approach for a deep-work task."
user-invocable: true
---

# Establish the intended outcome

Resolve the contained literal plugin root, and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context` (with an explicit --session when supplied). Use the returned state/work directory and phase-aware `session authority validate`. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md` for current runtime operations. Do not mutate authoritative state directly.

Use the user's request and available repository context to identify the goal, acceptance conditions and boundaries. Ask a concise question only for a material gap; do not ask the user to repeat information already supplied. For a straightforward correction, choose the evident approach and continue. Compare alternatives when the decision matters.

Record a compact brainstorm.md when it helps retain the decision. Keep source edits for the approved implementation phase. Required policy review uses one evidence-bound pipeline; do not create duplicate structural/phase reviews merely to fill ceremony.

Advance through `phase continue` once the goal is clear and internal continuation is authorized. Never write phase/completion/review markers yourself. Report the concrete approach and next action without a mandatory permission question.
