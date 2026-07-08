# Typed Handlers Pattern

This document describes the typed handlers refactoring pattern used to add compile-time type safety to MCP tool handlers.

## Overview

The typed handlers pattern converts tool handlers from receiving untyped `args` (requiring runtime schema parsing) to receiving pre-validated, typed arguments. This provides:

- **Compile-time type safety** — TypeScript catches invalid field access at build time
- **Single parse point** — Validation happens at the dispatcher boundary, not per-handler
- **Cleaner handler code** — No repetitive `schema.safeParse()` calls or type assertions

## Architecture

### Components

1. **Zod Schema** — Defines input validation shape with `.transform()` and `.pipe()` for alias normalization
2. **TypedToolHandler<Schema>** — Handler function typed to receive pre-validated args
3. **ActionSpec** — Pairs schema + handler + example args (for error responses)
4. **defineAction()** — Helper to create ActionSpec from schema, handler, and examples
5. **makeActionDispatcher()** — Dispatcher that:
   - Looks up action in ACTION_MAP
   - For ActionSpec: parses args once, calls handler with typed args
   - For legacy ToolHandler: calls directly with unparsed args

## Schema Pattern

Use `.transform().pipe()` to apply alias normalization:

```typescript
export const appendEventSchema = z.object({
  entity_key: z.string().min(1),
  // ... required fields ...
  at: z.string().optional(),
  detail: z.string().optional(),
  // Alias fields must be included here for validation to accept them
  date: z.string().optional(),
  description: z.string().optional(),
}).transform(args => applyAliases(args, { 
  date: 'at', 
  description: 'detail' 
})).pipe(z.object({
  // Final shape after transformation
  entity_key: z.string().min(1),
  at: z.string().optional(),
  detail: z.string().optional(),
  // ... other fields ...
}))
```

**Key points:**
- First `z.object()`: accepts both canonical and alias names
- `.transform()`: normalizes aliases to canonical names via `applyAliases()`
- `.pipe()`: validates final shape has only canonical names

## Handler Signature

Legacy (pre-refactor):
```typescript
export async function handle_append_event({ c, id, args }: ToolContext): Promise<Response> {
  const schema = z.object({ /* ... */ })
  const parsed = schema.safeParse(args)
  if (!parsed.success) return c.json(invalidParamsError(...))
  // Now use parsed.data
}
```

Typed (post-refactor):
```typescript
export async function handle_append_event({ c, id, args }: TypedToolContext<typeof appendEventSchema>): Promise<Response> {
  // args is already typed and validated — no schema.safeParse() needed
  // Direct field access with full type safety
}
```

## Migration

Refactoring is done in phases:

1. **PR N (event/changelog)** — First ~5 handlers
2. **PR N+1 (setup/continuity)** — Remaining handlers in same tool

Each phase:
- Extracts schemas from handler code
- Updates handler signatures to `TypedToolHandler<Schema>`
- Creates ActionSpec entries in ACTION_MAP
- Keeps legacy handlers unmigrated (supports mixed ACTION_MAP)
- Dispatcher handles both typed and legacy handlers transparently

## Testing

Tests must provide proper context with mocked env bindings:

```typescript
const res = await handle_tool({
  c: {
    json: (body) => body,
    env: { 
      LORE_DB: { get: async () => Promise.resolve(null) }
      // ... other bindings ...
    }
  },
  id: 'test-1',
  args: { action: 'append_event', /* ... */ },
  isAuthenticated: true,
})
```

## Coverage

All new code must have 100% patch coverage. Handlers require:
- Happy path test
- Error cases (missing required fields, invalid inputs)
- Optional parameter combinations
- DB failures if applicable

## References

- `src/tools/types.ts` — TypedToolHandler, ActionSpec, defineAction, makeActionDispatcher definitions
- `src/tools/world.ts` — Example: world_manage refactored handlers (entity_manage, lore_manage)
- `src/tools/meta.ts` — Example: continuity_manage refactored handlers (event/changelog)
- Issue #237 — Original typed handlers refactoring (world_manage)
- Issue #242 — continuity_manage refactoring (this PR)
