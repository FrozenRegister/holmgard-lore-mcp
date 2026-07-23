## [0.3.1] — Unreleased

### Fixed

- **DO Streamable HTTP path missing `normalizeParamCasing` bridge (#516).** The global parameter-casing bridge introduced in PR #514 was only wired into the legacy JSON-RPC handler (`src/index.ts`), not the Durable Object's `CallToolRequestSchema` handler (`src/do/HolmgardMCP.ts`). Since the MCP SDK connects through the DO's Streamable HTTP path, `world_id` → `worldId` aliasing (and all other cross-casing bridges) never fired for any real-world MCP call. This meant ~35 RPG handlers rejected `world_id` with "'worldId' is required" despite the bridge being correctly implemented and tested. The fix wraps the existing `coerceTransportArgs` call with `normalizeParamCasing` in the DO handler.
