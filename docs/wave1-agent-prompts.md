# Wave 1 Agent Prompts — Issue #77 Tool Consolidation

Run all 4 agents in parallel on branch `feat/consolidate-tool-surface`.
After all 4 complete, point one agent at Issue #82.

---

## Agent #78 — Create 5 core wrapper files

You are implementing part of a 89→9 MCP tool consolidation (Issue #78) on branch `feat/consolidate-tool-surface` in repo `holmgard-lore-mcp`. Do NOT touch any existing handler files. Create ONLY the 5 files listed below.

### Branch

Check out `feat/consolidate-tool-surface` before starting. All work goes on that branch.

### What you're doing

Creating 5 new "action-router" wrapper files in `src/tools/`. Each file exports a single ToolHandler that reads an `action` param from args, looks it up in a map, strips action from args, and delegates to the existing handler. Existing handlers are NOT modified.

### Critical facts (verified from registry.ts)

- `handle_get_lore_batch` and `handle_get_lore_section` are imported from `./system` (NOT `./lore`)
- `handle_append_to_section` is imported from `./lore` (NOT `./entity`)
- `handle_move_entity` is imported from `./lore` (NOT `./entity`)
- `makeError` is imported from `'../lib/rpc'`
- `ToolHandler` type is imported from `'./types'`

### FILE 1: src/tools/lore-manage.ts

```typescript
import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_list_topics, handle_list_maps, handle_get_lore, handle_get_lore_batch, handle_get_lore_section, handle_validate_topic_exists, handle_search_lore } from './system'
import { handle_set_lore, handle_delete_lore, handle_patch_lore, handle_batch_set_lore, handle_batch_mutate, handle_restore_lore, handle_get_topic_histories, handle_increment_topic_field, handle_append_to_section } from './lore'

const ACTION_MAP: Record<string, ToolHandler> = {
  get:            handle_get_lore,
  get_batch:      handle_get_lore_batch,
  get_section:    handle_get_lore_section,
  list:           handle_list_topics,
  list_maps:      handle_list_maps,
  search:         handle_search_lore,
  validate:       handle_validate_topic_exists,
  set:            handle_set_lore,
  delete:         handle_delete_lore,
  patch:          handle_patch_lore,
  batch_set:      handle_batch_set_lore,
  batch_mutate:   handle_batch_mutate,
  restore:        handle_restore_lore,
  history:        handle_get_topic_histories,
  increment:      handle_increment_topic_field,
  append_section: handle_append_to_section,
}

export const handle_lore_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
```

### FILE 2: src/tools/entity-manage.ts

```typescript
import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_resolve_interaction, handle_analyze_utility, handle_map_integration, handle_generate_entity, handle_roll_encounter, handle_advance_state_stage, handle_process_stage_batch, handle_get_sensory_profile, handle_get_compatibility, handle_get_inventory, handle_transfer_item, handle_list_consumption_timelines, handle_list_active_threads } from './entity'
import { handle_move_entity } from './lore'

const ACTION_MAP: Record<string, ToolHandler> = {
  generate:                   handle_generate_entity,
  move:                       handle_move_entity,
  roll_encounter:             handle_roll_encounter,
  advance_stage:              handle_advance_state_stage,
  batch_stage:                handle_process_stage_batch,
  get_inventory:              handle_get_inventory,
  transfer_item:              handle_transfer_item,
  get_sensory_profile:        handle_get_sensory_profile,
  get_compatibility:          handle_get_compatibility,
  analyze_utility:            handle_analyze_utility,
  map_integration:            handle_map_integration,
  list_consumption_timelines: handle_list_consumption_timelines,
  list_active_threads:        handle_list_active_threads,
  resolve_interaction:        handle_resolve_interaction,
}

export const handle_entity_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
```

### FILE 3: src/tools/world-manage.ts

```typescript
import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_thread_tick, handle_get_relationship, handle_get_faction_standing, handle_get_entity_knowledge, handle_get_location_occupants, handle_get_reachable_locations, handle_sense_environment, handle_get_thread_comparison, handle_check_convergence } from './world'

const ACTION_MAP: Record<string, ToolHandler> = {
  thread_tick:             handle_thread_tick,
  get_relationship:        handle_get_relationship,
  get_faction_standing:    handle_get_faction_standing,
  get_entity_knowledge:    handle_get_entity_knowledge,
  get_location_occupants:  handle_get_location_occupants,
  get_reachable_locations: handle_get_reachable_locations,
  sense_environment:       handle_sense_environment,
  get_thread_comparison:   handle_get_thread_comparison,
  check_convergence:       handle_check_convergence,
}

export const handle_world_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
```

### FILE 4: src/tools/scene-manage.ts

```typescript
import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_activate_scene, handle_present_choices, handle_commit_choice, handle_get_choice_history, handle_scene_brief, handle_render_pov } from './scene'

const ACTION_MAP: Record<string, ToolHandler> = {
  activate:        handle_activate_scene,
  present_choices: handle_present_choices,
  commit_choice:   handle_commit_choice,
  get_history:     handle_get_choice_history,
  brief:           handle_scene_brief,
  render_pov:      handle_render_pov,
}

export const handle_scene_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
```

### FILE 5: src/tools/continuity-manage.ts

```typescript
import type { ToolHandler } from './types'
import { makeError } from '../lib/rpc'
import { handle_append_event, handle_get_event_log, handle_recent_changes, handle_tag_topic, handle_find_by_tag, handle_bookmark_state, handle_world_diff, handle_plant_setup, handle_pay_off_setup, handle_list_unpaid_setups, handle_set_goal, handle_check_continuity } from './meta'

const ACTION_MAP: Record<string, ToolHandler> = {
  append_event:       handle_append_event,
  get_event_log:      handle_get_event_log,
  recent_changes:     handle_recent_changes,
  tag_topic:          handle_tag_topic,
  find_by_tag:        handle_find_by_tag,
  bookmark_state:     handle_bookmark_state,
  world_diff:         handle_world_diff,
  plant_setup:        handle_plant_setup,
  pay_off_setup:      handle_pay_off_setup,
  list_unpaid_setups: handle_list_unpaid_setups,
  set_goal:           handle_set_goal,
  check_continuity:   handle_check_continuity,
}

export const handle_continuity_manage: ToolHandler = ({ c, id, args, isAuthenticated }) => {
  const { action, ...rest } = args
  if (!action || typeof action !== 'string')
    return Promise.resolve(c.json(makeError(id, -32602, 'Missing required param: action'), 200))
  const handler = ACTION_MAP[action]
  if (!handler)
    return Promise.resolve(c.json(makeError(id, -32602, `Unknown action "${action}"`), 200))
  return handler({ c, id, args: rest, isAuthenticated })
}
```

### Verification

After writing all 5 files, run:

```powershell
pnpm run type-check
```

All 5 files must compile with zero new errors. Do NOT modify any existing files.

### Commit

```
feat: add 5 core action-router wrappers (lore/entity/world/scene/continuity-manage) #78
```

Run `.\scripts\pre-commit-validate.ps1 -SkipTests` before committing.
Push to `feat/consolidate-tool-surface`.

---

## Agent #79 — Create rpg-handler.ts

You are implementing part of a 89→9 MCP tool consolidation (Issue #79) on branch `feat/consolidate-tool-surface` in repo `holmgard-lore-mcp`. Create ONE new file: `src/rpg/rpg-handler.ts`.

### Branch

Check out `feat/consolidate-tool-surface` before starting.

### What you're doing

Creating a single action-router that accepts `{ sub: string, action: string, ...rest }` and dispatches to one of 27 RPG handler functions. The RPG handlers have a different signature than ToolHandlers — they take `(env, args)` not `({ c, id, args, isAuthenticated })`. The wrapping logic (extract `c.env`, call fn, wrap result in `makeResult`) is inline in this file.

### Critical facts

- RPG handler signature: `(env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>`
- `ToolHandler` signature: `({ c, id, args, isAuthenticated }) => Promise<Response>`
- `AppBindings` is imported from `'../types'`
- `McpResponse` return type — check `src/rpg/handlers/math-manage.ts` for the actual import path
- `makeError` and `makeResult` are imported from `'../lib/rpc'`
- All 27 RPG handlers live in `src/rpg/handlers/` — read that directory to get exact filenames and export names before writing imports

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
5. Import all 27 RPG handler functions from their respective files (copy import lines from `src/rpg/registry.ts` as a reference — those use `wrap()` around the raw fns, so you need the raw fns, not the wrapped versions)
6. Define `type RpgFn = (env: AppBindings, args: Record<string, unknown>) => Promise<McpResponse>`
7. Define `const SUB_MAP: Record<string, RpgFn>` with all 27 entries
8. Export `handle_rpg: ToolHandler` that:
   - Destructures `{ sub, ...rest }` from args (keep `action` in rest — RPG handlers expect it)
   - Returns error if sub is missing or not a string
   - Returns error if sub not found in SUB_MAP
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
