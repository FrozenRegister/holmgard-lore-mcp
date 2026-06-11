# Wave 3 Agent Prompts — Issues #83 and #84

Run both agents in parallel ONLY after Wave 2 (#82) has completed and pushed.

---

## Agent #83 — Refactor worker tests

You are implementing the test refactor step of a 89→9 MCP tool consolidation (Issue #83) on branch `feat/consolidate-tool-surface` in repo `holmgard-lore-mcp`.

All test files in `src/__tests__/` still call old tool names. Replace every old tool call with the new consolidated tool + action form.

### Branch

Check out `feat/consolidate-tool-surface` before starting.

### Complete mapping table

All `callTool('old_name', args)` → `callTool('new_name', { action/sub: '...', ...args })` replacements:

#### lore_manage

| Old tool | New call |
|---|---|
| `ping_tool` | `lore_manage, { action: 'ping' }` |
| `check_authentication` | `lore_manage, { action: 'auth_check' }` |
| `get_lore` | `lore_manage, { action: 'get', ...args }` |
| `get_lore_batch` | `lore_manage, { action: 'get_batch', ...args }` |
| `get_lore_section` | `lore_manage, { action: 'get_section', ...args }` |
| `list_topics` | `lore_manage, { action: 'list', ...args }` |
| `list_maps` | `lore_manage, { action: 'list_maps', ...args }` |
| `search_lore` | `lore_manage, { action: 'search', ...args }` |
| `validate_topic_exists` | `lore_manage, { action: 'validate', ...args }` |
| `set_lore` | `lore_manage, { action: 'set', ...args }` |
| `delete_lore` | `lore_manage, { action: 'delete', ...args }` |
| `patch_lore` | `lore_manage, { action: 'patch', ...args }` |
| `batch_set_lore` | `lore_manage, { action: 'batch_set', ...args }` |
| `batch_mutate` | `lore_manage, { action: 'batch_mutate', ...args }` |
| `restore_lore` | `lore_manage, { action: 'restore', ...args }` |
| `get_topic_histories` | `lore_manage, { action: 'history', ...args }` |
| `increment_topic_field` | `lore_manage, { action: 'increment', ...args }` |
| `append_to_section` | `lore_manage, { action: 'append_section', ...args }` |

#### entity_manage

| Old tool | New call |
|---|---|
| `generate_entity` | `entity_manage, { action: 'generate', ...args }` |
| `move_entity` | `entity_manage, { action: 'move', ...args }` |
| `roll_encounter` | `entity_manage, { action: 'roll_encounter', ...args }` |
| `advance_state_stage` | `entity_manage, { action: 'advance_stage', ...args }` |
| `process_stage_batch` | `entity_manage, { action: 'batch_stage', ...args }` |
| `get_inventory` | `entity_manage, { action: 'get_inventory', ...args }` |
| `transfer_item` | `entity_manage, { action: 'transfer_item', ...args }` |
| `get_sensory_profile` | `entity_manage, { action: 'get_sensory_profile', ...args }` |
| `get_compatibility` | `entity_manage, { action: 'get_compatibility', ...args }` |
| `analyze_utility` | `entity_manage, { action: 'analyze_utility', ...args }` |
| `map_integration` | `entity_manage, { action: 'map_integration', ...args }` |
| `list_consumption_timelines` | `entity_manage, { action: 'list_consumption_timelines', ...args }` |
| `list_active_threads` | `entity_manage, { action: 'list_active_threads', ...args }` |
| `resolve_interaction` | `entity_manage, { action: 'resolve_interaction', ...args }` |

#### world_manage

| Old tool | New call |
|---|---|
| `thread_tick` | `world_manage, { action: 'thread_tick', ...args }` |
| `get_relationship` | `world_manage, { action: 'get_relationship', ...args }` |
| `get_faction_standing` | `world_manage, { action: 'get_faction_standing', ...args }` |
| `get_entity_knowledge` | `world_manage, { action: 'get_entity_knowledge', ...args }` |
| `get_location_occupants` | `world_manage, { action: 'get_location_occupants', ...args }` |
| `get_reachable_locations` | `world_manage, { action: 'get_reachable_locations', ...args }` |
| `sense_environment` | `world_manage, { action: 'sense_environment', ...args }` |
| `get_thread_comparison` | `world_manage, { action: 'get_thread_comparison', ...args }` |
| `check_convergence` | `world_manage, { action: 'check_convergence', ...args }` |

#### scene_manage

| Old tool | New call |
|---|---|
| `activate_scene` | `scene_manage, { action: 'activate', ...args }` |
| `present_choices` | `scene_manage, { action: 'present_choices', ...args }` |
| `commit_choice` | `scene_manage, { action: 'commit_choice', ...args }` |
| `get_choice_history` | `scene_manage, { action: 'get_history', ...args }` |
| `scene_brief` | `scene_manage, { action: 'brief', ...args }` |
| `render_pov` | `scene_manage, { action: 'render_pov', ...args }` |

#### continuity_manage

| Old tool | New call |
|---|---|
| `append_event` | `continuity_manage, { action: 'append_event', ...args }` |
| `get_event_log` | `continuity_manage, { action: 'get_event_log', ...args }` |
| `recent_changes` | `continuity_manage, { action: 'recent_changes', ...args }` |
| `tag_topic` | `continuity_manage, { action: 'tag_topic', ...args }` |
| `find_by_tag` | `continuity_manage, { action: 'find_by_tag', ...args }` |
| `bookmark_state` | `continuity_manage, { action: 'bookmark_state', ...args }` |
| `world_diff` | `continuity_manage, { action: 'world_diff', ...args }` |
| `plant_setup` | `continuity_manage, { action: 'plant_setup', ...args }` |
| `pay_off_setup` | `continuity_manage, { action: 'pay_off_setup', ...args }` |
| `list_unpaid_setups` | `continuity_manage, { action: 'list_unpaid_setups', ...args }` |
| `set_goal` | `continuity_manage, { action: 'set_goal', ...args }` |
| `check_continuity` | `continuity_manage, { action: 'check_continuity', ...args }` |

#### rpg (was individual tool names)

| Old tool | New call |
|---|---|
| `math_manage` | `rpg, { sub: 'math', ...args }` |
| `character_manage` | `rpg, { sub: 'character', ...args }` |
| `party_manage` | `rpg, { sub: 'party', ...args }` |
| `quest_manage` | `rpg, { sub: 'quest', ...args }` |
| `item_manage` | `rpg, { sub: 'item', ...args }` |
| `inventory_manage` | `rpg, { sub: 'inventory', ...args }` |
| `corpse_manage` | `rpg, { sub: 'corpse', ...args }` |
| `narrative_manage` | `rpg, { sub: 'narrative', ...args }` |
| `secret_manage` | `rpg, { sub: 'secret', ...args }` |
| `theft_manage` | `rpg, { sub: 'theft', ...args }` |
| `aura_manage` | `rpg, { sub: 'aura', ...args }` |
| `improvisation_manage` | `rpg, { sub: 'improvisation', ...args }` |
| `npc_manage` | `rpg, { sub: 'npc', ...args }` |
| `session_manage` | `rpg, { sub: 'session', ...args }` |
| `combat_manage` | `rpg, { sub: 'combat', ...args }` |
| `combat_action` | `rpg, { sub: 'combat_action', ...args }` |
| `combat_map` | `rpg, { sub: 'combat_map', ...args }` |
| `spawn_manage` | `rpg, { sub: 'spawn', ...args }` |
| `strategy_manage` | `rpg, { sub: 'strategy', ...args }` |
| `turn_manage` | `rpg, { sub: 'turn', ...args }` |
| `spatial_manage` | `rpg, { sub: 'spatial', ...args }` |
| `world_map` | `rpg, { sub: 'world_map', ...args }` |
| `batch_manage` | `rpg, { sub: 'batch', ...args }` |
| `travel_manage` | `rpg, { sub: 'travel', ...args }` |
| `perception_manage` | `rpg, { sub: 'perception', ...args }` |

#### Unchanged (no rename needed)

- `agent_manage` — keep as-is
- `search_tools` — keep as-is
- `load_tool_schema` — keep as-is

### Critical collision cases — MANUAL AUDIT REQUIRED

**`world_manage`** appears in two contexts:
- Tests in `src/__tests__/world.test.ts` (or similar) using the core lore-layer `world_manage` tool → keep as `world_manage, { action: '...', ...args }`
- Tests in `src/__tests__/rpg-tools.test.ts` using the RPG world domain handler → change to `rpg, { sub: 'world', ...args }`

Before replacing, grep for every `world_manage` occurrence and read each call site to determine which context it's in.

**`scene_manage`** — same collision:
- Core scene tool tests → keep as `scene_manage, { action: '...', ...args }`
- RPG scene tests → change to `rpg, { sub: 'scene', ...args }`

### tools/list assertion

Find any test asserting the tool count (e.g., `toHaveLength(89)`) and update it to `toHaveLength(9)`. Also update any array of expected tool names to match the 9 new names: `lore_manage`, `entity_manage`, `world_manage`, `scene_manage`, `continuity_manage`, `rpg`, `agent_manage`, `search_tools`, `load_tool_schema`.

### Verification

```powershell
pnpm test -- --reporter=verbose src/__tests__/
```

All tests must pass. Fix any failures.

### Commit

```
test: refactor worker test suite for consolidated 9-tool surface #83
```

Run `.\scripts\pre-commit-validate.ps1 -SkipTests` before committing.
Push to `feat/consolidate-tool-surface`.

---

## Agent #84 — Refactor live tests

You are implementing the live test refactor step of a 89→9 MCP tool consolidation (Issue #84) on branch `feat/consolidate-tool-surface` in repo `holmgard-lore-mcp`.

All test files in `tests/live/` still call old tool names. Apply the same mapping as Issue #83 to the live test suite.

### Branch

Check out `feat/consolidate-tool-surface` before starting.

### Scope

Directory: `tests/live/`

Read each file before editing. Apply the full mapping table from Issue #83 (same table — all the same renames). Pay special attention to:

1. **Helper functions** — `tests/live/helpers.ts` (or similar) likely has shorthand functions like `setLore(key, text)` that call `set_lore` internally. Update these helpers to call `lore_manage` with `action: 'set'` etc. Then confirm callers of the helpers don't need further changes.

2. **tools/list count assertion** — find any assertion like `toHaveLength(89)` and update to `toHaveLength(9)`. Update expected tool name arrays to the 9 new names.

3. **world_manage / scene_manage collision** — same manual audit as #83. Read each call site to determine whether it's the core lore-layer tool or the RPG sub before replacing.

### Verification

Live tests require `MCP_API_KEY` in the environment and run against the deployed worker. Since Wave 2 has not been deployed yet, you cannot run live tests against production. Instead:

1. Confirm all live test files are syntactically valid TypeScript:

```powershell
pnpm run type-check
```

2. Spot-check 3–5 test files to confirm the renames look correct.

3. Note in your commit message that live tests were not run against production (Wave 2 deployment is a manual step after all waves complete).

### Commit

```
test: refactor live smoke test suite for consolidated 9-tool surface #84
```

Run `.\scripts\pre-commit-validate.ps1 -SkipTests` before committing.
Push to `feat/consolidate-tool-surface`.

---

## After Wave 3 completes

Run the full test suite locally:

```powershell
pnpm test -- --reporter=verbose
```

Then open a PR from `feat/consolidate-tool-surface` → `main` with title:

```
feat: consolidate 89 MCP tools → 9 action-router tools (#77)
```

Add a CHANGELOG.md entry under `[Unreleased] > Changed` documenting the breaking change with the full old→new mapping table before creating the PR.
