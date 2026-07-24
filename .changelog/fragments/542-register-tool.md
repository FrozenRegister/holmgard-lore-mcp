issue: 542
summary: Add registerTool()/getTools()/getToolHandler() core infrastructure (additive)
---

- **New `src/tools/register.ts`** — Foundational tool registration infrastructure for the #540 gameplan. Exports `RegisteredTool` interface (Zod-based `inputSchema`), `registerTool()` (throws on duplicate), `getTools()`, `getToolHandler()`, `getToolDefinition()`, and `toJsonSchema()` helper. Additive only — zero changes to existing `toolRegistry`/`toolDefinitions`.
- **New dependency: `zod-to-json-schema`** — Converts Zod schemas to JSON Schema for `tools/list` serialization.
- **New tests: `tests/unit/register-tool.test.ts`** — 100% coverage on all exports: registration, duplicate-throw, handler lookup, insertion-order preservation, JSON Schema conversion (nested objects, enums, optionals).
