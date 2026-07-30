## ADR: the shared dispatch core is canonical, not either MCP transport (#548)

### Added

- `docs/mcp-transport-canonicalization.md` — decision record for #548 (Phase 7 of #540), resolving which of the two `/mcp` implementations is authoritative. Outcome: **neither transport is canonical — `dispatchToolCall()` + `toolRegistry` is**, and no logic may live in a transport. The `HolmgardMCP` Durable Object is designated the *public* MCP surface (the spec-compliant Streamable HTTP transport we document and point external clients at); the hand-rolled JSON-RPC handler stays permanently, because its bare-method aliases (`get_lore`, `list_topics`, `get_lore_batch`, `get_topic_histories`, `get_world_biomes`) are non-spec by design and the MCP SDK's `Server` structurally cannot serve them.
- The same doc settles #539's Q7: finish the cutover to the homegrown `registerTool()` in `src/tools/register.ts` and retire the hand-written `toolDefinitions` array; do **not** adopt the SDK's `McpServer.registerTool()`. Rationale — `HolmgardMCP.ts` deliberately avoids the `McpServer.tool()` round-trip to keep exact control of the JSON Schema shipped to clients (`tests/live/protocol.test.ts` asserts on that shape per #267), and `McpServer` can only back the DO's `tools/list`, not the bare-method aliases, which would leave the registry split in half again.

### Changed

- `ARCHITECTURE.md` — the *Why two `/mcp` code paths* section now states the canonicality rule and links to the ADR.

### Documented (no code change)

- Two divergences between the transports are recorded as **intentional**: the auth asymmetry (the DO hardcodes `authenticated: true` because the Worker-level middleware gates the request before it reaches the DO — preserved deliberately by #546) and the bare-method gap (structural, per above).
- Two are recorded as **latent bugs**, with follow-up issues: `src/do/context-adapter.ts` stubs every request header to `null`, so any header-reading handler silently behaves differently under the DO; and `HolmgardMCP.ts:69`'s `json.result ?? …` unwrap assumes every handler's JSON-RPC `result` is already MCP-content-block shaped without ever checking.

### Out of scope

- No transport code was changed. This is the decision and the record only; the follow-up work it implies (registration cutover, the two divergence fixes, live smoke coverage for the Streamable HTTP path) is tracked separately.
