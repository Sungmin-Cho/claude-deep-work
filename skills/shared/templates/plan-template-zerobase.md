# Implementation Plan

Author a single source plan for the current goal. This is an outcome-based README example, not an authority receipt: replace its goal, files and checks with the actual task. Choose enough slices to express outcomes/dependencies; no size, sketch or step quotas apply.

Author the task-specific outcomes, file scopes, requirements, basis and meaningful checks. Omit mechanical contract_binding, capability_facts, outcome_environment and replan_epoch: the compiler derives their defaults from the current session and validated Spec, including compatibility requirements. Explicit supplied values must match that context. Do not calculate approval hashes or capability digests by hand. Preview the authored Spec+Plan bundle before review; only runtime approval publishes executable authority.

For a strict slice, use execution_basis=strict-tdd-v2, genuine failing_test/production scopes and an actual VerificationSpecV2 plus its canonical SHA256. Remove outcome commands/controls from that slice. Explicit strict_required_slice_ids must select strict. For an outcome slice, retain positive/counterexample controls for every required ID. Source-writing work remains slice_kind=functional even when change_kind=non-functional.

## Goal and boundaries

Describe the observable outcome and meaningful exclusions. Keep local implementation choices adaptable inside these boundaries.

## Execution Plan

```json
{
  "schema_version": 3,
  "execution_policy": {
    "requested_method": "adaptive",
    "strict_required_slice_ids": []
  },
  "slices": [
    {
      "id": "SLICE-001",
      "slice_kind": "functional",
      "change_kind": "non-functional",
      "execution_basis": "outcome-v1",
      "checked": false,
      "scope_schema_version": 1,
      "files": [
        "README.md"
      ],
      "write_scope": {
        "failing_test": [],
        "production": [
          "README.md"
        ],
        "refactor": []
      },
      "verification_commands": [],
      "oracle_controls": [
        {
          "id": "ORACLE-001",
          "requirement_ids": [
            "REQ-001"
          ],
          "invariant_ids": [],
          "failure_mode_ids": [],
          "source_kind": "pre-existing-immutable",
          "source_refs": [],
          "check": {
            "kind": "file-contains",
            "path": "README.md",
            "value": "New heading"
          },
          "counterexample": {
            "kind": "replace-target",
            "path": "README.md",
            "content": "Old heading"
          },
          "command_id": null
        }
      ],
      "contract": {
        "id": "SLICE-001",
        "outcome": "README states the new heading",
        "files": [
          "README.md"
        ],
        "depends_on": [],
        "integration_touchpoints": [
          "documentation"
        ],
        "requirements": [
          "REQ-001"
        ],
        "invariants": [],
        "failure_modes": [],
        "risk": {
          "class": "low",
          "score": 1,
          "triggers": []
        },
        "negative_tests": [],
        "evidence_required": [
          "GATE-outcome-verification"
        ],
        "rollback": {
          "method": "restore previous content",
          "verification": [
            "GATE-plan-alignment"
          ]
        },
        "review_policy": "single",
        "scope_expansion_trigger": [
          "public contract change"
        ]
      }
    }
  ]
}
```

## Verification and recovery

Explain why the controls catch a meaningful wrong result. Mutable program oracles require independent per-ID review of the final oracle and intended control failure; built-ins use deterministic trusted control validation. Record a practical scoped recovery. Finish uses runtime producers and M3 publication, never hand-authored completion JSON.
