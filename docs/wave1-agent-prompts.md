# Wave 1 Agent Prompts — Issue #77 Tool Consolidation

**Status:** Agent #78 is complete. The 5 core wrapper files are already on branch `feat/consolidate-tool-surface`.

Run agents #79, #80, and #81 in parallel. After all three complete and push, move to Wave 2.

---

## Agent #79 — Create rpg-handler.ts

You are implementing part of a 89→9 MCP tool consolidation (Issue #79) on branch `feat/consolidate-tool-surface` in repo `holmgard-lore-mcp`. Create ONE new file: `src/rpg/rpg-handler.ts`.

### Branch

Check out `feat/consolidate-tool-surface` before starting. The following files already exist from a prior agent — do not modify them:

- `src/tools/lore-manage.ts`
- `src/tools/entity-manage.ts`
- `src/tools/world-manage.ts`
- `src/tools/scene-manage.ts`
- `src/tools/continuity-manage.ts`

### What you're doing

Creating a single dispatcher that accepts `{ sub: string, action: string, ...rest }` and routes to one of 27 RPG handler functions. RPG handlers have a different signature than ToolHandlers — they take `(env, args)` not `({ c, id, args, isAuthenticated })`. The bridging logic (extract `c.env`, call fn, wrap result in `makeResult`) lives inline in this file.

### Critical facts

- RPG handler signature: `(env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>`
- `ToolHandler` signature: `({ c, id, args, isAuthenticated }) => Promise<Response>`
- `AppBindings` is imported from `'../types'`
- `McpResponse` return type — check `src/rpg/handlers/math-manage.ts` for the actual import path
- `makeError` and `makeResult` are imported from `'../lib/rpc'`
- All 27 RPG handlers live in `src/rpg/handlers/` — read that directory for exact filenames and export names before writing imports

### Sub → handler mapping

Read `src/rpg/registry.ts` to get the exact import names and file paths for all 27 handlers. The sub names are:

```
math, world, character, party, quest, item, inventory, corpse, narrative,
secret, theft, aura, improvisation, npc, session, combat, combat_action,
combat_map, spawn, strategy, turn, spatial, world_map, batch, travel,
perception, scene
```

Note: `combat`, `combat_action`, and `combat_map` are three separate subs.

### FILE: src/rpg/rpg-handler.ts

Structure:

1. Import `ToolHandler` from `'../tools/types'`
2. Import `makeError`, `makeResult` from `'../lib/rpc'`
3. Import `AppBindings` from `'../types'`
4. Import the McpResponse type (check what the RPG handlers use)
5. Import all 27 RPG handler functions from their respective files (copy import lines from `src/rpg/registry.ts` as a reference — those use `wrap()` around the raw fns; you need the raw fns, not the wrapped versions)
6. Define `type RpgFn = (env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>`
7. Define `const SUB_MAP: Record<string, RpgFn>` with all 27 entries
8. Export `handle_rpg: ToolHandler` that:
   - Destructures `{ sub, ...rest }` from args (keep `action` in rest — RPG handlers expect it)
   - Returns error if `sub` is missing or not a string
   - Returns error if `sub` is not found in `SUB_MAP`
   - Calls `await fn(c.env, rest)` and returns `c.json(makeResult(id, result), 200)`

### Verification

After writing the file:

```powershell
pnpm run type-check
```

Zero new type errors. Do NOT modify any existing files.

### Commit

```
feat: add rpg action-router handler (rpg-handler.ts) #79
```

Run `.\scripts\pre-commit-validate.ps1 -SkipTests` before committing.
Push to `feat/consolidate-tool-surface`.

---

## Agent #80 — Replace src/tools/definitions.ts

You are implementing part of a 89→9 MCP tool consolidation (Issue #80) on branch `feat/consolidate-tool-surface` in repo `holmgard-lore-mcp`. You will REPLACE the contents of `src/tools/definitions.ts`.

### Branch

Check out `feat/consolidate-tool-surface` before starting.

### What you're doing

The current `src/tools/definitions.ts` has ~59 individual tool definitions. Replace ALL of them with exactly 5 consolidated definitions using an open schema. Keep the `...rpgToolDefinitions` and `...rpgMetaToolDefinitions` spreads at the bottom unchanged.

### Read first

Read `src/tools/definitions.ts` in full to understand the current structure, the export name, and where the `rpgToolDefinitions` / `rpgMetaToolDefinitions` spreads are.

### Open schema (reuse for all 5 tools)

```typescript
const OPEN_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object' as const,
  properties: {
    action: { type: 'string', description: 'Action to perform (see tool description for valid values)' },
  },
  required: ['action'],
  additionalProperties: true,
}
```

### The 5 tool definitions

Use version `'1.0.0'`. Keep the same overall shape as existing definitions (name, title, version, description, inputSchema).

**lore_manage**
- title: `'Lore Manage'`
- description: `'KV lore store — read, write, search, and mutate lore entries. Actions: get, get_batch, get_section, list, list_maps, search, validate, set, delete, patch, batch_set, batch_mutate, restore, history, increment, append_section'`

**entity_manage**
- title: `'Entity Manage'`
- description: `'Entity lifecycle — generate, move, inventory, encounters, consumption timelines, and interaction resolution. Actions: generate, move, roll_encounter, advance_stage, batch_stage, get_inventory, transfer_item, get_sensory_profile, get_compatibility, analyze_utility, map_integration, list_consumption_timelines, list_active_threads, resolve_interaction'`

**world_manage**
- title: `'World Manage'`
- description: `'World state — threads, relationships, factions, knowledge, locations, and convergence checks. Actions: thread_tick, get_relationship, get_faction_standing, get_entity_knowledge, get_location_occupants, get_reachable_locations, sense_environment, get_thread_comparison, check_convergence'`

**scene_manage**
- title: `'Scene Manage'`
- description: `'Scene management — activate scenes, present and commit choices, scene briefs, and POV rendering. Actions: activate, present_choices, commit_choice, get_history, brief, render_pov'`

**continuity_manage**
- title: `'Continuity Manage'`
- description: `'Continuity tracking — events, tags, bookmarks, world diff, setups, goals, and continuity checks. Actions: append_event, get_event_log, recent_changes, tag_topic, find_by_tag, bookmark_state, world_diff, plant_setup, pay_off_setup, list_unpaid_setups, set_goal, check_continuity'`

### Verification

After replacing the file:

```powershell
pnpm run type-check
```

Zero new type errors. The export name must remain identical to what it was before.

### Commit

```
feat: replace 59 tool definitions with 5 consolidated schemas #80
```

Run `.\scripts\pre-commit-validate.ps1 -SkipTests` before committing.
Push to `feat/consolidate-tool-surface`.

---

## Agent #81 — Replace src/rpg/definitions.ts

You are implementing part of a 89→9 MCP tool consolidation (Issue #81) on branch `feat/consolidate-tool-surface` in repo `holmgard-lore-mcp`. You will REPLACE the contents of `src/rpg/definitions.ts`.

### Branch

Check out `feat/consolidate-tool-surface` before starting.

### What you're doing

The current `src/rpg/definitions.ts` has 27 individual RPG tool definitions. Replace them with ONE `rpg` definition that uses a `sub` enum. Keep the `agent_manage` definition verbatim — copy it exactly from the current file.

### Read first

Read `src/rpg/definitions.ts` in full. Note:

1. The export name (likely `rpgToolDefinitions`)
2. The complete `agent_manage` definition — copy it exactly into the new file

### New file structure

```typescript
// src/rpg/definitions.ts

const SUB_VALUES = [
  'math', 'world', 'character', 'party', 'quest', 'item',
  'inventory', 'corpse', 'narrative', 'secret', 'theft', 'aura',
  'improvisation', 'npc', 'session', 'combat', 'combat_action',
  'combat_map', 'spawn', 'strategy', 'turn', 'spatial',
  'world_map', 'batch', 'travel', 'perception', 'scene',
]

export const rpgToolDefinitions: any[] = [
  {
    name: 'rpg',
    title: 'RPG Engine',
    version: '1.0.0',
    description: 'Mnehmos RPG engine — pass sub (domain) and action. Valid subs: ' + SUB_VALUES.join(', '),
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        sub: {
          type: 'string',
          enum: SUB_VALUES,
          description: 'RPG domain to route to',
        },
        action: {
          type: 'string',
          description: 'Action within the domain',
        },
      },
      required: ['sub', 'action'],
      additionalProperties: true,
    },
  },
  // PASTE the agent_manage definition here verbatim (copied from current file)
]
```

### Critical

- The `agent_manage` definition must be copied exactly — do not summarize or alter it
- Result: `rpgToolDefinitions` has exactly 2 entries: `rpg` and `agent_manage`

### Verification

After replacing the file:

```powershell
pnpm run type-check
```

Zero new type errors. Export name must remain identical.

### Commit

```
feat: replace 27 RPG tool definitions with single rpg multiplexer #81
```

Run `.\scripts\pre-commit-validate.ps1 -SkipTests` before committing.
Push to `feat/consolidate-tool-surface`.
