# Planning by goal and evidence

Choose the simplest approach that satisfies the requested outcome and known constraints. Read relevant repository evidence; document trade-offs only when they affect the decision. Use a compact plan for small work and deeper decomposition where independent outcomes, risk or dependencies justify it.

A slice is an observable result with exact file boundaries, dependency IDs, requirement/invariant/failure IDs and a reviewed verification basis. There is no fixed number of steps, mandatory size label or code-sketch quota. Keep the model free to choose private implementation details inside the contract.

Fresh plans use schema 3 and one Execution Plan JSON block. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/templates/plan-template-existing.md` or `${CLAUDE_PLUGIN_ROOT}/skills/shared/templates/plan-template-zerobase.md`. Strict slices retain genuine RED/proof/GREEN; adaptive documentation/config or appropriate functional work can choose outcome verification. Explicit strict-required IDs cannot be weakened. Outcome controls must test meaningful counterexamples using the same final oracle and dependency bytes.

Draft Spec and Plan together at the Spec phase when both are ready, so one qualifying review can cover both. Omit mechanical contract binding, capability facts, closed environment defaults and replan epoch; the compiler derives them from validated Spec/current context and rejects conflicting explicit values. Keep derived hashes out of authored plan source. Approval produces plan.json and its immutable/verification identities. Do not change approved plan bytes for progress; completion comes from runtime receipts. Existing schema1/V2 plans are read through their compatibility path, never relabelled.

Incorporate user feedback and concrete repository discoveries. Local adaptations inside the contract continue with evidence. Changes to public behavior, authorized scope, oracle, execution basis or persistent contracts use journalled replan under existing authorization. Ask only for a genuinely new decision/permission. Never treat approval of a plan as a reason to ask again merely to move to implementation.

Use one required review pipeline with exact artifact/request/contract/policy bindings. Reuse unchanged qualifying evidence; refresh only affected identities. Read `${CLAUDE_PLUGIN_ROOT}/skills/shared/references/runtime-execution-spine.md` for runtime publication and continuation.
