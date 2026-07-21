# State model-routing fixtures

- `engine-auto.md` is the canonical engine-auto state. Its two JSON-string scalar carriers are generated and byte-checked through `updateFrontmatterText`.
- `pinned.md` is the canonical pinned-tier state. Its two JSON-string scalar carriers are generated and byte-checked through `updateFrontmatterText`.
- `legacy-nested.md` is a hand-authored representative of the former orchestrator nested form. It is labelled with the `legacy-` prefix and exists only for best-effort fallback coverage; the canonical `parseFrontmatter` and `session-store` readers are not expected to accept it.

The canonical fixtures must pass complete frontmatter parsing, the `session-store` session-reader path, and `JSON.parse` round-trip for both `model_routing_json` and `model_routing_meta_json`.
