# Phase 2 — Register character_manage via registerTool() (#543)

Pilot registration of `character_manage` tool using the new Phase 1 `registerTool()` infrastructure (#540, #542). This adds a parallel registration path while keeping the existing `rpgToolRegistry` unchanged.

**Changes:**
- `src/rpg/register-character-manage.ts`: New registration module that calls `registerTool()` with character_manage's handler and InputSchema
- `src/rpg/registry.ts`: Export `wrap()` function to enable handler wrapping in the registration file
- `src/rpg/handlers/character-manage.ts`: Export `InputSchema` for reuse in registration
- `src/index.ts`: Import and call `registerCharacterManageTool()` at module load time

**Tests:**
- `tests/unit/character-manage-register.test.ts`: Unit tests for registration, handler lookup, schema serialization
- `tests/worker/character-manage-register.test.ts`: Integration tests for handler invocation via MCP endpoint

Both test suites exercise the registered tool handler and verify schema correctness per Phase 1 patterns.
