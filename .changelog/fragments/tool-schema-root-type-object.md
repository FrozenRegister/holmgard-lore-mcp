### Fix — tool inputSchemas missing root `type: object`
- Adds `type: 'object'` to the root of `lore_manage`, `entity_manage`, `world_manage`, `scene_manage`, and `continuity_manage`'s `inputSchema` (all use a root-level `oneOf` for action dispatch, which alone doesn't satisfy strict MCP client schema validation even though every branch already declares `type: 'object'`).
- Fixes real MCP clients (e.g. the Claude Code CLI's `claude mcp add --transport http`) failing to fetch tools after a successful `initialize`, with `Invalid input: expected "object" (at tools.0.inputSchema.type)`.
- Adds a regression test asserting every tool's `inputSchema.type === 'object'` in `tools/list`.
