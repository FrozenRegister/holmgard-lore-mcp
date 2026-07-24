# Tool Registration API

`src/tools/register.ts` provides the core tool registration infrastructure for the Holmgard Lore MCP. This is the foundational layer for the gameplan to collapse tool registration and transport dispatch to a single source of truth (issue #540).

## Overview

The registration system is additive — it exists alongside the existing `toolRegistry` and `toolDefinitions` without modifying them. Phase 1 (#542) introduces the infrastructure; Phase 2 (#543) and later phases migrate real tools onto it.

## API

### `registerTool(tool: RegisteredTool): void`

Register a tool. Throws `Error` if a tool with the same name is already registered — this is a drift guard at import time, catching the same class of bug as Phase 0's CI check but one layer earlier.

```typescript
registerTool({
  name: 'my_tool',
  title: 'My Tool',
  version: '1.0.0',
  description: 'Does useful things',
  category: 'lore', // optional: 'lore' | 'rpg'
  inputSchema: z.object({ ... }), // Zod schema
  handler: async ({ c, id, args }) => { ... }, // ToolHandler
})
```

### `getTools(): RegisteredTool[]`

Returns all registered tools in insertion order (array push preserves order).

### `getToolHandler(name: string): ToolHandler | undefined`

Look up a handler by tool name. Returns `undefined` if not found.

### `getToolDefinition(name: string): SerializedToolDefinition | undefined`

Serialize a tool definition for `tools/list` response. Converts the Zod `inputSchema` to JSON Schema via `zod-to-json-schema`. Returns `undefined` if not found.

### `toJsonSchema(tool: RegisteredTool): Record<string, unknown>`

Convert a tool's Zod inputSchema to JSON Schema. Used internally by `getToolDefinition()`.

## Types

### `RegisteredTool`

```typescript
interface RegisteredTool {
  name: string
  title: string
  version: string
  description: string
  category?: string        // 'lore' | 'rpg' — unused today, cheap to add now
  inputSchema: z.ZodTypeAny // Zod schema — NOT hand-written JSON Schema
  handler: ToolHandler      // same signature as ToolHandler in src/tools/types.ts
}
```

### `SerializedToolDefinition`

```typescript
interface SerializedToolDefinition {
  name: string
  title: string
  version: string
  description: string
  inputSchema: Record<string, unknown> // JSON Schema (converted from Zod)
}
```

## Design Decisions

- **Zod, not JSON Schema**: `inputSchema` is a Zod schema, not hand-written JSON Schema. This gives us runtime validation with TypeScript inference, and `zod-to-json-schema` handles serialization for `tools/list`.
- **Duplicate throws**: Registration throws on duplicate name rather than silently overwriting. This catches drift at import time.
- **Insertion order**: Plain array push preserves insertion order, matching today's behavior.
- **Additive**: Existing `toolRegistry` and `toolDefinitions` remain unchanged. This infrastructure is exercised by its own tests; later phases migrate real tools.

## Testing

Unit tests in `tests/unit/register-tool.test.ts` cover:
- Registration and duplicate-throw
- `getTools()` ordering preservation
- `getToolHandler()` lookup (found and not-found)
- `getToolDefinition()` serialization
- `toJsonSchema()` conversion (nested objects, enums, optionals)

All tests run in the unit tier (no Workers runtime needed) via `pnpm test -- tests/unit/register-tool.test.ts`.
