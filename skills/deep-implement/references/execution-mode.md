# Execution mode

Resolve mode with `${CLAUDE_PLUGIN_ROOT}/runtime/model-capabilities.js` through the public runtime. Explicit current arguments override stored choices; stored explicit choices override defaults. Fresh adaptive work uses the current model inline. Preserve `main`, concrete model pins and requested effort across migration/resume.

Inspect actual native tool capabilities. If explicit delegation is supported, use the worker contract at `${CLAUDE_PLUGIN_ROOT}/agents/implement-slice-worker.md`; if unavailable, explain the missing capability and perform the same protocol inline when consistent with the user's request. An explicitly pinned unavailable model remains unavailable; do not silently substitute another model.

Execution mode is a scheduling choice, not a verification exemption. Every slice uses its sealed strict or outcome basis and the same runtime producer/receipt chain. Keep one active slice/write window per session. Parallel patch preparation and separate sessions are valid; simultaneous shared-state scoped writes are not.

Persist execution selection only through `session execution set`. Do not mutate YAML or create a delegation snapshot manually. Obtain snapshot/recovery identities from the corresponding runtime operation.
