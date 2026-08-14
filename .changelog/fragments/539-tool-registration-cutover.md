## Cut over `tools/list`/`tools/call` to the `registerTool()` registry (#539, #540)

### Changed

- `tools/list` (both the legacy JSON-RPC handler and the `HolmgardMCP` Durable
  Object's Streamable HTTP handler) and `tools/call` dispatch now read from
  the `registerTool()` registry (`src/tools/register.ts`) for `lore_manage`,
  `entity_manage`, `world_manage`, `scene_manage`, `continuity_manage`,
  `agent_manage`, `character_manage`, `search_tools`, and `load_tool_schema`,
  instead of the hand-written `toolDefinitions`/`toolRegistry` that previously
  duplicated the same information. `rpg` (47 sub-handlers, unmigrated) is the
  one tool still served the old way, via a fallback in `dispatchToolCall()`.
- Removed the now-dead hand-written JSON Schema and registry entries for the
  9 migrated tools from `src/tools/definitions.ts`, `src/tools/registry.ts`,
  `src/rpg/definitions.ts`, `src/rpg/meta-definitions.ts`, and
  `src/rpg/registry.ts` — these tools now have exactly one place their shape
  is defined.
- Fixed a schema-fidelity gap in `registerTool()`'s Zod → JSON Schema
  serialization: `zod-to-json-schema` emits discriminated/plain unions as a
  root-less `{ anyOf: [...] }`, not the `{ type: 'object', oneOf: [...] }`
  shape this repo's tools previously had and MCP clients expect.
  `getToolDefinition()`/`toJsonSchema()` now normalize this.

### Why

Every phase of the #539/#540 gameplan (#541–#548) had already landed as an
additive, parallel-path migration — the `registerTool()` infrastructure and
all 9 tool registrations existed and were fully tested, but production code
never actually switched over to reading from them, so the duplication the
whole project existed to eliminate was still there. This is that cutover.
