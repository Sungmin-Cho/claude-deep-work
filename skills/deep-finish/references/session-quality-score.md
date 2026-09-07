# Session observations and score

The runtime computes metric version 2 from authenticated observations: test pass rate 35%, machine trace completeness 35%, sensors 15% and mutation 15%. Each component is already on a 0–100 scale; divide the weighted sum by applicable weights once. Retry count is diagnostic only.

An applicable unobserved component makes `quality_score` null. Redistribute weights only when the compiled policy and evidence establish that sensor/mutation is not applicable. Absence is unknown, never an assumed 80 or a successful check. Machine trace reconciles plan IDs, accepted writes, producer receipts and committed evidence; it is not a semantic quality rating.

Goal acceptance lists required and independently accepted IDs separately. A high score cannot satisfy a missing goal. Preserve metric_version when reading history; do not pool legacy and current scores into a purported comparable average. Matched task/model/environment/metric evidence is required for intervention comparisons. Repeated correlated signals from one run are one observation, not many statistical trials.

Consume the metrics returned by the runtime's session receipt publication. Do not calculate a prose score or write finalized JSONL/receipt authority by hand. Missing measurements remain visible in the receipt and final report.
