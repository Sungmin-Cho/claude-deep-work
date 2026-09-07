---
name: deep-integrate
description: "Use when completing requested integrations after deep-work verification or exploring optional next actions."
user-invocable: true
---

# Complete authorized integration

Resolve the contained literal plugin root, and run `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" session context` (with an explicit --session when supplied). Use the returned state/work directory and phase-aware `session authority validate`. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md` for current runtime operations. Do not mutate authoritative state directly.

Require current Test evidence before integration/finalization. Respect --skip-integrate and an already requested Finish outcome: proceed to Finish without opening a recommendation questionnaire.

Perform the concrete integrations already authorized by the user. If they asked to explore additional plugins, inspect installed capabilities, propose only relevant next steps and let them choose additions. An optional recommendation does not become a new required goal or external permission.

Use runtime integration/publication operations for durable progress. Do not change current_phase to idle or call a shell helper to manufacture completion. Final idle/registry/pointer changes belong to the journalled Finish operation after stable M3 publication.

Preserve attempted integrations and recovery identities. An unavailable optional integration is reported separately; it cannot replace missing required goal evidence. Return to Finish and verify the actual requested outcome.

