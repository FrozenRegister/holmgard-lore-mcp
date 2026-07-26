# Phase 3 — Register agent_manage, search_tools, load_tool_schema via registerTool() (#544)

Bulk registration of three RPG meta-tools using the Phase 1 `registerTool()` infrastructure (#540), following the Phase 2 pattern established by `register-character-manage.ts` (#543).

**Changes:**
- `src/rpg/register-agent-manage.ts` — registers `agent_manage` (NPC AI agent lifecycle, prompt slices, secrets, journal, invocation)
- `src/rpg/register-search-tools.ts` — registers `search_tools` (fuzzy tool discovery)
- `src/rpg/register-load-tool-schema.ts` — registers `load_tool_schema` (JSON schema lookup with did_you_mean)
- `src/rpg/handlers/search-tools.ts` — adds `export` to existing `InputSchema`
- `src/rpg/handlers/load-tool-schema.ts` — adds `export` to existing `InputSchema`
- `src/index.ts` — imports and calls the three new `register*Tool()` functions at module load time

**Test coverage:**
- `tests/unit/agent-manage-register.test.ts` — schema/lookup assertions (pure unit tier)
- `tests/unit/search-tools-register.test.ts` — schema + invoke tests (no KV/D1 bindings)
- `tests/unit/load-tool-schema-register.test.ts` — schema + invoke tests (no KV/D1 bindings)
- `tests/worker/agent-manage-register.test.ts` — invoke tests via MCP endpoint (Workers runtime tier, D1-backed)

**Notes:**
- `agent_manage` touches D1 (agents, agent_prompt_slices, agent_secrets, agent_journal, agent_calls tables) — its invoke tests live in the Workers runtime tier.
- `search_tools` and `load_tool_schema` operate on in-memory indexes only — their invoke tests run in the unit tier.
- Existing `rpgToolRegistry` / `rpgToolDefinitions` paths are untouched; this is a parallel registration path.
