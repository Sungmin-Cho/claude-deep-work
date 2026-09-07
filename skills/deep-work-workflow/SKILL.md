---
name: deep-work-workflow
description: "High-level overview of the deep-work workflow (Brainstorm → Research → Spec → Plan → Implement → Test → Integrate). Use for how deep-work works, 'which phase should I start from', and the phase-to-phase contracts; prefer the phase-specific skills to execute a phase. Triggers: 'deep-work overview', 'workflow 개요', 'how does deep-work work', 'phase 구조 설명'."
---

# Goal-completion workflow

Brainstorm clarifies the goal, Research checks relevant facts, Spec states observable acceptance, Plan seals slice boundaries and verification basis, Implement produces accepted changes and receipts, Test validates required evidence, and Finish completes the authorized repository outcome. Integrate covers requested integrations or optional exploration.

Fresh adaptive work preserves the current model inline and chooses strict TDD or outcome verification per slice. Explicit strict-required work keeps real RED/proof/GREEN. Outcome checks use final-source positive results and meaningful counterexamples without fake RED. The model continues reasoning and can adapt local details inside the approved contract; material changes trigger authenticated replan.

Runtime APIs own approvals, phase state, scoped writes, reviews and receipts. Existing authorization carries through internal phases; --interactive-gates requests conversations and --autonomous does not grant external permission. Early pre-plan sessions resume without imaginary future artifacts. Completed evidence is retained across recovery; missing M3 publication does not require reimplementation.

The internal V3 receipt store is runtime-receipts and public M3 views are in receipts. Finish records effects and publishes a stable session envelope before terminal state. Metrics remain observations and may be null; goal acceptance is a separate required check. Historical formats stay on their compatibility path. Parking is not completion.

For execution, resolve the literal plugin root and read the contained `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md`, then the relevant phase entry. Exact commands and required flags are available from `node "${CLAUDE_PLUGIN_ROOT}/scripts/deep-work-runtime.js" --help`. Do not depend on native Skill or Agent tool names when the host exposes another supported execution capability.
