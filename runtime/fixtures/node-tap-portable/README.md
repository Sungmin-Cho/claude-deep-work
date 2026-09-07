# Exact-patch Node TAP conformance

These outputs were captured from Node 22.23.2, 24.20.0, 26.0.0 and 26.8.1 with
`--test-reporter=tap` and test isolation disabled. Only the temporary test file's
absolute path was replaced by `__TEST_FILE__`; timings, layouts and reporter
stacks remain observed output. The policy fixture binds the normalized bytes by
SHA-256. No Homebrew or machine-local executable paths are needed to run them.

The portable parser accepts a bounded complete document (1 MiB, 10,000 nodes,
32 nested suite levels), scalar assertion/contract values from the existing
`tap-value-v1` domain, passing siblings, and exactly one named selected failure.
It reconciles every local plan, ordinal and global count. Suite failures must
aggregate actual child failures. Unknown YAML keys/forms, non-scalar expected or
actual values, arbitrary diagnostics, nested `test` containers, skip, todo,
cancellation, and extra failure leaves are unsupported and rejected. The
`deep-assert` fixture documents the structured-value boundary; it is not a claim
of arbitrary deep-equality diagnostic support.

GREEN must contain a single matching selected leaf name and otherwise all-pass
valid TAP. Node's passing diagnostics do not emit the test source location;
GREEN identifies that name within the spec-bound file and accepted source
manifest. RED additionally verifies the emitted source line and expected signal.

Live conformance tests use the current executable and hard-fail unsupported
patches. Cross-reader tests accept explicit `DEEP_WORK_TEST_NODE_READERS` JSON
(`[{"path":"/absolute/node","version":"22.23.2"}, ...]`) and assert the observed
version before authenticating recorded Node 26 results. Without that capability,
the historical cross-reader test records unavailable rather than coverage.
