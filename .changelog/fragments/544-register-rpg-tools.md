# Phase 3 — Register agent_manage, search_tools, load_tool_schema via registerTool() (#544)

Bulk registration of three RPG tools using the Phase 1 `registerTool()` infrastructure (#540, #542), following the Phase 2 pattern established by #543.

**Changes:**
- `src/rpg/register-load-tool-schema.ts` — new registration file for `load_tool_schema`
- `src/rpg/register-search-tools.ts` — new registration file for `search_tools`
- `src/rpg/register-agent-manage.ts` — new registration file for `agent_manage`
- `src/index.ts` — imports and calls `registerLoadToolSchemaTool()`, `registerSearchToolsTool()`, `registerAgentManageTool()` at module load time
- `tests/unit/load-tool-schema-register.test.ts` — unit-tier: handler resolution, definition shape, JSON schema assertions
- `tests/unit/search-tools-register.test.ts` — unit-tier: handler resolution, definition shape, JSON schema assertions
- `tests/worker/agent-manage-register.test.ts` — worker-tier: handler resolution + MCP endpoint integration (agent_manage uses D1/Workers AI, needs the full runtime)

**Tier split rationale:**
- `load_tool_schema` and `search_tools` are pure computation (no KV/D1 bindings) → unit-tier tests
- `agent_manage` uses D1 (agents table) and Workers AI → worker-tier tests

**Verified: schema completeness** — each handler's `InputSchema` was checked against its dispatch logic. All three schemas already covered every field the handler reads; no schema changes needed.

**Parallel path guarantee:** `rpgToolRegistry` and `rpgToolDefinitions` are untouched. The `rpg` tool mega-dispatcher is explicitly out of scope per the issue spec.
