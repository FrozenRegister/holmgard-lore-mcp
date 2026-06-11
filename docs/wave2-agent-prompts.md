# Wave 2 Agent Prompt — Issue #82

Run this agent ONLY after all 4 Wave 1 agents (#78, #79, #80, #81) have completed and pushed.
This is a single sequential agent — do not parallelize.

---

## Agent #82 — Wire registries + auth guard

You are implementing the wiring step of a 89→9 MCP tool consolidation (Issue #82) on branch `feat/consolidate-tool-surface` in repo `holmgard-lore-mcp`.

Wave 1 created new files but did not hook them up. This step replaces the old registries, updates the auth guard in `src/index.ts`, and updates the Durable Object in `src/do/HolmgardMCP.ts`.

### Branch

Check out `feat/consolidate-tool-surface` before starting.

### Prerequisite check

Before touching any file, verify these files exist (Wave 1 output):

- `src/tools/lore-manage.ts`
- `src/tools/entity-manage.ts`
- `src/tools/world-manage.ts`
- `src/tools/scene-manage.ts`
- `src/tools/continuity-manage.ts`
- `src/rpg/rpg-handler.ts`

If any are missing, stop and report which ones are absent.

### CHANGE 1: Replace src/tools/registry.ts

Read the current file first to confirm its structure. Then replace it entirely:

```typescript
// src/tools/registry.ts
import type { ToolHandler } from './types'
import { handle_lore_manage } from './lore-manage'
import { handle_entity_manage } from './entity-manage'
import { handle_world_manage } from './world-manage'
import { handle_scene_manage } from './scene-manage'
import { handle_continuity_manage } from './continuity-manage'
import { rpgToolRegistry } from '../rpg/registry'

export const toolRegistry: Record<string, ToolHandler> = {
  lore_manage:       handle_lore_manage,
  entity_manage:     handle_entity_manage,
  world_manage:      handle_world_manage,
  scene_manage:      handle_scene_manage,
  continuity_manage: handle_continuity_manage,
  ...rpgToolRegistry,
}
```

### CHANGE 2: Replace src/rpg/registry.ts

Read the current file in full first. It currently has 27+ individual RPG entries plus `agent_manage`, `search_tools`, `load_tool_schema` — all using a `wrap()` factory.

Keep `wrap()` import and usage. Keep `agent_manage`, `search_tools`, `load_tool_schema` verbatim. Remove the 27 individual RPG domain entries. Add `rpg` using `handle_rpg` from `./rpg-handler`.

The `handle_rpg` function is a `ToolHandler` directly (not an RPG fn), so do NOT wrap it:

```typescript
import { handle_rpg } from './rpg-handler'
// ... existing imports for agent/search/load ...

export const rpgToolRegistry: Record<string, ToolHandler> = {
  rpg:              handle_rpg,
  agent_manage:     wrap(handleAgentManage),
  search_tools:     wrap(handleSearchTools),
  load_tool_schema: wrap(handleLoadToolSchema),
}
```

Keep whatever import paths/names the current file uses for `handleAgentManage`, `handleSearchTools`, `handleLoadToolSchema`, and the `wrap` factory.

### CHANGE 3: Update src/index.ts auth guard

Read `src/index.ts` lines 100–160 before editing. Locate the block that looks like:

```typescript
if (toolName === 'ping_tool') {
  return c.json(makeResult(id, { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal' } }), 200)
}
if (toolName === 'check_authentication') {
  return c.json(makeResult(id, {
    content: [{ type: 'text', text: isAuthenticated ? 'Authenticated.' : 'Not authenticated ...' }],
    metadata: { authenticated: isAuthenticated }
  }), 200)
}
if (!isAuthenticated) {
```

Replace those two `if` blocks (the `ping_tool` and `check_authentication` checks only) with:

```typescript
if (toolName === 'lore_manage') {
  const action = typeof args?.action === 'string' ? args.action : null
  if (action === 'ping') {
    return c.json(makeResult(id, { content: [{ type: 'text', text: 'pong' }], metadata: { source: 'internal' } }), 200)
  }
  if (action === 'auth_check') {
    return c.json(makeResult(id, {
      content: [{ type: 'text', text: isAuthenticated ? 'Authenticated.' : 'Not authenticated — request was made without a valid API key.' }],
      metadata: { authenticated: isAuthenticated }
    }), 200)
  }
  // fall through to auth guard + registry for all other lore_manage actions
}
if (!isAuthenticated) {
```

Do NOT touch the legacy bare-method path below the auth guard (`list_topics`, `get_lore`, etc.) — leave it untouched.

### CHANGE 4: Update src/do/HolmgardMCP.ts

Read the file first. Find where `ping_tool` and `check_authentication` are handled inline (it will be similar to the index.ts pattern but inside the DO's tool dispatch method).

Apply the same replacement as Change 3: swap `ping_tool` → `lore_manage { action: 'ping' }` and `check_authentication` → `lore_manage { action: 'auth_check' }`.

Important: In the DO, `check_authentication` / `auth_check` returns `authenticated: true` unconditionally because the DO only receives requests that have already passed the Worker-level auth check. Preserve this — do not use the `isAuthenticated` variable if the DO doesn't have it.

### Phase gate

After all 4 changes:

```powershell
pnpm run type-check
```

Must pass with zero new errors.

Then:

```powershell
pnpm test -- --reporter=verbose
```

Many tests will fail (they still call old tool names). That is expected at this stage — note which test files fail and confirm the failures are all "unknown tool" or "tool not found" errors (not type errors or runtime crashes). The test suite will be fixed in Wave 3.

### Commit

```
feat: wire consolidated registries + update auth guard (lore_manage ping/auth_check) #82
```

Run `.\scripts\pre-commit-validate.ps1 -SkipTests` before committing.
Push to `feat/consolidate-tool-surface`.
