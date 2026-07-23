// src/index.ts — slim entry point
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { AppBindings } from './types'
import { makeResult, makeError, validateRequest } from './lib/rpc'
import { kvGet, kvList, getKV } from './lib/kv'
import { parseKvEntry } from './lib/lore'
import rateLimitMiddleware, { wsReconnectRateLimit } from './middleware/rate-limit'
import { requestIdMiddleware, type RequestIdVariables } from './middleware/request-id'
import { toolDefinitions } from './tools/definitions'
import { toolRegistry } from './tools/registry'
import { coerceTransportArgs } from './lib/coerce-transport-args'
import adminRoutes from './admin/routes'
import changesRouter from './changes/route'
import { HolmgardMCP } from './do/HolmgardMCP'
import {
  setToolIndex,
  setSchemaIndex,
  registerRpgSubSchema,
  registerRpgAlias,
} from './rpg/registry'
import { mathManageSchemaDoc } from './rpg/definitions'
import { handleBiomeManage } from './rpg/handlers/biome-manage'
import internalRoutes from './internal/routes'
import entityReadsRouter from './api/entity-reads'

// Export the DO class so wrangler can bind it
export { HolmgardMCP }

// Initialize meta-tool indexes once at module load time
setToolIndex(toolDefinitions.map((t: any) => ({ name: t.name, description: t.description ?? '' })))
// mathManageSchemaDoc is schema-index-only — it documents rpg({sub:'math',...})'s
// dice-notation grammar for load_tool_schema, but "math_manage" has no registry
// handler of its own, so it must not be added to the tool index (that would
// advertise a callable tool that 404s on tools/call).
setSchemaIndex(
  [...toolDefinitions, mathManageSchemaDoc].map((t: any) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema,
  })),
)

// #339 — register rpg sub-level schemas so load_tool_schema({ toolName: "rpg", sub: "corpse" }) works.
// These are static documentation schemas describing each sub's parameters,
// extracted from their Zod InputSchema definitions.
// #404 (Tier 1) — a sub-level alias (same handler, different name a narrator
// might reach for) reuses its canonical entry's description/schema via
// `aliasOf` instead of hand-copying them — the exact copy-paste fragility
// that made "stealth"'s old duplicated entry drift from "perception"'s.
type SubSchemaEntry =
  | { sub: string; description: string; schema: Record<string, unknown> }
  | { sub: string; aliasOf: string }

const SUB_SCHEMAS: SubSchemaEntry[] = [
  // ── Already registered (kept as-is) ──────────────────────────────────────
  {
    sub: 'corpse',
    description:
      'Corpse ecology — decomposition, scavenging, looting, psychological impact. Actions: create, get, list, loot, decay, generate_loot, delete, register, decompose, scavenge_check, loot_corpse, recover, get_state, psychological_impact. NOTE: "id" is the corpse UUID (primary key of the corpses table), NOT a character ID. "characterId" is the dead character\'s UUID (required for create/register). "looterCharacterId" and "observerCharacterId" are living characters acting on the corpse. See docs/parameter-naming-conventions.md for the full cross-tool reference.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: {
          type: 'string',
          description:
            'Corpse UUID (primary key of corpses table). Required for get/loot/decay/decompose/loot_corpse/recover/get_state/psychological_impact. NOT a character ID — use "characterId" for the dead character.',
        },
        characterId: {
          type: 'string',
          description:
            "Dead character's UUID. Required for create/register. Stored in corpses.character_id.",
        },
        characterName: {
          type: 'string',
          description: "Dead character's name. Required for create/register.",
        },
        worldId: {
          type: 'string',
          description:
            'World UUID. Accepts snake_case "world_id" as alias. Required for scavenge_check.',
        },
        world_id: {
          type: 'string',
          description:
            'Snake_case alias for worldId (cross-tool compatibility with non-RPG tools).',
        },
        hoursSinceDeath: {
          type: 'number',
          description: 'Override computed elapsed time (decompose only)',
        },
        looterCharacterId: {
          type: 'string',
          description: 'Character UUID of the looter (loot_corpse only)',
        },
        observerCharacterId: {
          type: 'string',
          description: 'Character UUID of the observer (psychological_impact only)',
        },
        recoveryType: {
          type: 'string',
          enum: ['memorial_package', 'warning_display', 'trophy_recovery', 'research_recovery'],
        },
        relationship: {
          type: 'string',
          enum: ['stranger', 'party_member', 'betrayed_them', 'saved_them'],
        },
      },
      required: ['action'],
    },
  },
  {
    sub: 'quest',
    description:
      'Quest management. Actions: create, get, list, update, delete, complete, fail, add_objective, complete_objective.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        questId: { type: 'string' },
        worldId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        objective: {
          type: 'object',
          description: '{ description: string, completed?: boolean, order?: number }',
        },
        rewards: { type: 'object' },
        prerequisites: { type: 'array', items: { type: 'string' } },
        fields: {
          type: 'object',
          additionalProperties: true,
          description:
            '#425 — arbitrary D1 column passthrough for `update`. Blacklist: id, created_at, updated_at, world_id.',
        },
      },
      required: ['action'],
    },
  },
  {
    sub: 'combat',
    description:
      'Combat encounter management. Actions: create_encounter, get_encounter, list_encounters, add_combatant, remove_combatant, start, end, next_turn, get_state, death_save, legendary_action, lair_action.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string', description: 'Encounter ID' },
        regionId: { type: 'string' },
        characterId: { type: 'string' },
        token: {
          type: 'object',
          description:
            '{ name: string, type: "pc"|"npc"|"enemy"|"neutral", initiative?: number, hp?: number }',
        },
        filter: { type: 'string', enum: ['all', 'active', 'completed'] },
      },
      required: ['action'],
    },
  },
  // #466 — corrected to match combat-action.ts's real 13 actions (previously
  // advertised 7, only 4 of which overlapped; 'cast'/'use_item'/'defend' were
  // phantom actions that don't exist on the handler).
  {
    sub: 'combat_action',
    description:
      'In-combat action log. Actions: attack (roll to hit + damage against one or more targets), apply_damage, heal, apply_condition, remove_condition (toggle a condition tag on the target character), use_ability, get_log (encounter action history), get_turn_summary, dash, dodge, disengage, help, ready. Aliases: hit/strike/swing->attack, damage/hurt/wound->apply_damage, restore/cure/recover->heal, condition/add_condition/afflict->apply_condition, cure_condition/end_condition->remove_condition, ability/special/skill->use_ability, log/history->get_log, summary/turn_summary->get_turn_summary, sprint/move_action->dash, evade->dodge, retreat/withdraw->disengage, assist->help, prepare/hold_action/delay->ready.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        encounterId: {
          type: 'string',
          description: 'Required to log the action; several actions no-op the log without it.',
        },
        actorId: { type: 'string' },
        actorName: { type: 'string' },
        targetIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required for attack.',
        },
        round: { type: 'integer', minimum: 1, description: 'default 1' },
        turnIndex: { type: 'integer', minimum: 0, description: 'default 0' },
        attackRoll: { type: 'integer' },
        damage: { type: 'integer', minimum: 0 },
        damageExpression: { type: 'string', description: 'Dice notation, e.g. "2d6+3"' },
        damageType: { type: 'string' },
        healAmount: { type: 'integer', minimum: 0 },
        conditionName: { type: 'string', description: 'apply_condition/remove_condition' },
        abilityName: { type: 'string', description: 'use_ability' },
        description: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'get_log, default 20' },
      },
      required: ['action'],
    },
  },
  // ── #366 — character: add find_by_name and kill ─────────────────────────
  // Discovered while wiring up the #468 drift guard — move_to_location/
  // move_to_tile (#313) are real actions on the handler but weren't advertised
  // here, nor were the locationKey/q/r/mapId params they need.
  {
    sub: 'character',
    description:
      'Character CRUD and management. Actions: create, get, list, update, delete, search, find_by_name, add_xp, get_progression, level_up, cast_spell, snapshot, activate, list_passengers, recompute_derived, kill, move_to_location (#313 — narrative location_key), move_to_tile (#313 — hex-axial q/r/mapId; independent of move_to_location, a character can be dual-mode).',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        characterId: { type: 'string' },
        name: { type: 'string' },
        worldId: { type: 'string' },
        characterClass: { type: 'string' },
        race: { type: 'string' },
        level: { type: 'number' },
        hp: { type: 'number' },
        maxHp: { type: 'number' },
        ac: { type: 'number' },
        stats: { type: 'object' },
        query: { type: 'string', description: 'Search query for search action' },
        xp: { type: 'number' },
        spellName: { type: 'string' },
        slotLevel: { type: 'number' },
        limit: { type: 'number' },
        killerId: { type: 'string' },
        causeOfDeath: { type: 'string' },
        locationKey: { type: 'string', description: 'Required for move_to_location.' },
        q: { type: 'integer', description: 'Required for move_to_tile — hex-axial column.' },
        r: { type: 'integer', description: 'Required for move_to_tile — hex-axial row.' },
        mapId: { type: 'string', description: 'move_to_tile, default "main".' },
        fields: {
          type: 'object',
          additionalProperties: true,
          description:
            '#425 — arbitrary D1 column passthrough for `update`, e.g. columns with no dedicated param yet. Blacklist: id, created_at, updated_at, world_id.',
        },
      },
      required: ['action'],
    },
  },
  // #404 (Tier 1) — plural alias.
  { sub: 'characters', aliasOf: 'character' },
  {
    sub: 'aura',
    description:
      'Aura and concentration management. Actions: create, get, list, remove, expire, get_affecting, concentrate, break_concentration, check_save, check_duration.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string', description: 'Aura instance UUID from create' },
        ownerId: { type: 'string' },
        targetId: { type: 'string' },
        characterId: { type: 'string' },
        spellName: { type: 'string' },
        spellLevel: { type: 'number' },
        radius: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    sub: 'secret',
    description:
      'Secret management (hidden knowledge, backstory). Actions: create, get, list, update, delete, reveal, check_reveal.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string', description: 'Secret UUID from create' },
        worldId: { type: 'string' },
        name: { type: 'string' },
        publicDescription: { type: 'string' },
        secretDescription: { type: 'string' },
        linkedEntityId: { type: 'string' },
        sensitivity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        fields: {
          type: 'object',
          additionalProperties: true,
          description:
            '#425 — arbitrary D1 column passthrough for `update` (e.g. notes, linked_entity_type, leak_patterns, category). Blacklist: id, created_at, updated_at, world_id.',
        },
      },
      required: ['action'],
    },
  },
  {
    sub: 'narrative',
    description:
      'Narrative notes (plot threads, session logs). Actions: create, get, list, update, delete, archive, resolve.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string', description: 'Note UUID (noteId) from create' },
        worldId: { type: 'string' },
        type: {
          type: 'string',
          enum: ['plot_thread', 'canonical_moment', 'npc_voice', 'foreshadowing', 'session_log'],
        },
        content: { type: 'string' },
        visibility: { type: 'string', enum: ['dm_only', 'player_visible'] },
      },
      required: ['action'],
    },
  },
  {
    sub: 'production',
    description:
      'Production cycle — advance_day, perimeter, extraction. Actions: advance_day, get_state, update_state, set_schedule, list_events.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        worldId: { type: 'string' },
        daysToAdvance: { type: 'number' },
        fields: {
          type: 'object',
          additionalProperties: true,
          description:
            '#425 — arbitrary world_state column passthrough for `update_state` (e.g. production_mood, era, tick_speed — columns with no other write path). Blacklist: world_id.',
        },
      },
      required: ['action', 'worldId'],
    },
  },
  { sub: 'stealth', aliasOf: 'perception' },

  // ── #360 — item: add schema with search action ───────────────────────────
  {
    sub: 'item',
    description: 'Item CRUD and search. Actions: create, get, list, update, delete, search.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string' },
        weight: { type: 'number' },
        value: { type: 'number' },
        query: { type: 'string', description: 'Search query for search action' },
        itemType: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },

  // ── #361 — resource: fix to match actual handler actions ─────────────────
  {
    sub: 'resource',
    description:
      'Resource survival — prize crates, degradation, scavenging, crafting, improvisation. Actions: crate_drop, consume, degrade, improvise, scavenge, craft, get_state.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        ownerType: { type: 'string', enum: ['character', 'party'] },
        ownerId: { type: 'string' },
        worldId: { type: 'string' },
        itemName: { type: 'string' },
        category: { type: 'string', enum: ['medical', 'food', 'tools', 'weapon', 'intel'] },
        quantity: { type: 'number' },
        dayNumber: { type: 'number' },
        ateToday: { type: 'boolean' },
        complexity: { type: 'string', enum: ['basic', 'moderate', 'complex'] },
      },
      required: ['action'],
    },
  },

  // ── #361 — broadcast: fix to match actual handler actions ────────────────
  {
    sub: 'broadcast',
    description:
      'Broadcast and production intervention — audience approval, votes, interventions, Celeste moments. Actions: audience_pulse, resolve_vote, production_intervene, celeste_moment, get_state, trigger_event.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        worldId: { type: 'string' },
        characterId: { type: 'string' },
        voteType: {
          type: 'string',
          enum: ['fan_favorite', 'mercy_kill', 'hazard_boost', 'prize_drop_location', 'showdown'],
        },
        interventionType: {
          type: 'string',
          enum: [
            'drone_harassment',
            'predator_release',
            'audio_broadcast',
            'fake_prize_drop',
            'perimeter_pulse',
            'celeste_spotlight',
            'medical_intervention',
            'sabotage',
          ],
        },
        eventType: { type: 'string' },
        direction: { type: 'string', enum: ['positive', 'negative'] },
        winningOption: { type: 'string' },
      },
      required: ['action', 'worldId'],
    },
  },

  // ── #362 — all previously missing rpg subs ───────────────────────────────
  // Discovered while wiring up the #468 drift guard — solve/simplify are real
  // ACTIONS on the handler (they just return a "not available in Workers"
  // stub response) but weren't advertised here.
  {
    sub: 'math',
    description:
      'Dice rolling, probability, and projectile physics. Actions: roll, probability, projectile, get_history, solve, simplify (solve/simplify are algebra stubs — no nerdamer/CAS dependency in Workers — they return success: false with an explanatory message; use roll for dice math).',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        expression: { type: 'string', description: 'Dice notation (e.g. "2d20kh1+5", "4d6dl1")' },
        target: { type: 'number' },
        comparison: { type: 'string', enum: ['gte', 'lte', 'eq', 'gt', 'lt'] },
        sides: { type: 'number' },
        velocity: { type: 'number' },
        angle: { type: 'number' },
        gravity: { type: 'number' },
        height: { type: 'number' },
        sessionId: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    sub: 'world',
    description:
      'World generation and management. Actions: create, get, list, delete, update, generate, get_state. "id" and "worldId" are interchangeable aliases for the world UUID. Accepts snake_case "world_id" as alias for "worldId" (cross-tool compatibility).',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string', description: 'World UUID (alias for worldId)' },
        worldId: { type: 'string', description: 'World UUID (alias for id)' },
        world_id: {
          type: 'string',
          description: 'Snake_case alias for worldId (cross-tool compatibility with non-RPG tools)',
        },
        name: { type: 'string' },
        seed: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
        landRatio: { type: 'number' },
        environment: { type: 'object' },
        theme: { type: 'string' },
        fields: {
          type: 'object',
          additionalProperties: true,
          description:
            '#425 — arbitrary D1 column passthrough for `update` (e.g. universe_id). Blacklist: id, created_at, updated_at.',
        },
      },
      required: ['action'],
    },
  },
  // Discovered while wiring up the #468 drift guard — cohesion_check/
  // group_break/cohesion_shift are real actions on the handler but weren't
  // advertised here, nor were their stressModifier/method/eventType params.
  {
    sub: 'party',
    description:
      'Party management — creation, membership, trust, morale, march, cohesion. Actions: create, get, list, update, delete, add_member, remove_member, set_leader, trust_shift, resolve_conflict, betrayal_check, morale_roll, watch_rotation, begin_march, get_march_status, cohesion_check (d20 roll + modifiers vs. cohesion_score), group_break (dissolve the party — abandonment/betrayal/death/mutual), cohesion_shift (apply a named cohesion event).',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        partyId: { type: 'string' },
        name: { type: 'string' },
        worldId: { type: 'string' },
        characterId: { type: 'string' },
        role: {
          type: 'string',
          enum: ['leader', 'member', 'companion', 'hireling', 'prisoner', 'mount'],
        },
        fromCharacterId: { type: 'string' },
        towardCharacterId: { type: 'string' },
        status: { type: 'string', enum: ['active', 'dormant', 'archived'] },
        stressModifier: { type: 'number', description: 'cohesion_check' },
        cooperationModifier: { type: 'number', description: 'cohesion_check' },
        reason: { type: 'string', description: 'group_break' },
        method: {
          type: 'string',
          enum: ['abandonment', 'betrayal', 'death', 'mutual'],
          description: 'Required for group_break.',
        },
        eventType: {
          type: 'string',
          description:
            "Required for cohesion_shift and (as an alternative to delta) trust_shift — a key into the handler's cohesion/trust event tables.",
        },
        fields: {
          type: 'object',
          additionalProperties: true,
          description:
            '#425 — arbitrary D1 column passthrough for `update` (e.g. formation, current_location, current_quest_id, current_poi, last_played_at). Blacklist: id, created_at, updated_at, world_id.',
        },
      },
      required: ['action'],
    },
  },
  {
    sub: 'inventory',
    description:
      'Character inventory management. Actions: add, remove, list, get, transfer, equip, unequip, use_item.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        characterId: { type: 'string' },
        itemId: { type: 'string' },
        quantity: { type: 'number' },
        slot: { type: 'string' },
        targetCharacterId: { type: 'string' },
        worldId: { type: 'string' },
      },
      required: ['action'],
    },
  },
  // #462 — corrected to match theft-manage.ts's real stolen-item-ledger actions
  // (previously advertised attempt/check_dc/get_result/list_attempts — none of
  // which exist on the handler).
  {
    sub: 'theft',
    description:
      'Stolen-item ledger — record thefts, track heat level, fence or recover items. Actions: steal (record a theft, heat starts "burning"), fence (mark sold/fenced), recover, cool_heat (step heat down one level toward "cold"), report (mark reported to guards), get, list (filter by thief/heat/recovered). Aliases: pick_pocket/pickpocket/theft->steal, sell_stolen/fence_item->fence, retrieve/find->get, all/search->list, restore/returned->recover, reduce_heat/heat_down->cool_heat, guards/report_theft->report.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: {
          type: 'string',
          description:
            'Stolen-item record UUID from steal. Required for fence/get/recover/cool_heat/report.',
        },
        itemId: { type: 'string', description: 'Required for steal.' },
        stolenFrom: { type: 'string', description: 'Required for steal.' },
        stolenBy: { type: 'string', description: 'Required for steal.' },
        stolenLocation: { type: 'string' },
        witnesses: { type: 'array', items: { type: 'string' } },
        bounty: { type: 'integer', minimum: 0, description: 'default 0' },
        fencedTo: { type: 'string', description: 'fence' },
        filter: {
          type: 'object',
          properties: {
            thief: { type: 'string' },
            heat: { type: 'string', enum: ['burning', 'hot', 'warm', 'cool', 'cold'] },
            recovered: { type: 'boolean' },
          },
          description: 'list',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'list, default 50' },
      },
      required: ['action'],
    },
  },
  // #463 — corrected to match improvisation-manage.ts's real custom-effect-ledger
  // actions (previously advertised attempt/check_dc/get_result/list_recipes — a
  // DC-based skill-check shape that doesn't exist on the handler).
  {
    sub: 'improvisation',
    description:
      'Custom-effect ledger — boons, curses, and other ad-hoc buffs/debuffs a DM applies mid-session, with duration tracking and per-round ticking. Actions: apply (create an effect on a target), get, list (all active), remove, tick (advance rounds-remaining and expire), list_by_target. Aliases: create/add_effect/improvise->apply, fetch/find->get, all/active->list, delete/end/dispel->remove, advance/round/next_round->tick, for/on/affecting->list_by_target.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'integer', description: 'Effect ID from apply. Required for get/remove/tick.' },
        targetId: { type: 'string', description: 'Required for apply. Character/NPC UUID.' },
        targetType: {
          type: 'string',
          enum: ['character', 'npc'],
          description: 'default character',
        },
        name: { type: 'string', description: 'Required for apply.' },
        description: { type: 'string' },
        sourceType: {
          type: 'string',
          enum: ['divine', 'arcane', 'natural', 'cursed', 'psionic', 'unknown'],
          description: 'default unknown',
        },
        sourceEntityId: { type: 'string' },
        sourceEntityName: { type: 'string' },
        category: {
          type: 'string',
          enum: ['boon', 'curse', 'neutral', 'transformative'],
          description: 'default neutral',
        },
        powerLevel: { type: 'integer', minimum: 1, maximum: 5, description: 'default 1' },
        mechanics: { type: 'array', items: { type: 'string' } },
        durationType: {
          type: 'string',
          enum: ['rounds', 'minutes', 'hours', 'days', 'permanent', 'until_removed'],
          description: 'default rounds',
        },
        durationValue: { type: 'integer' },
        triggers: { type: 'array', items: { type: 'string' } },
        removalConditions: { type: 'array', items: { type: 'string' } },
        stackable: { type: 'boolean', description: 'default false' },
        rounds: {
          type: 'integer',
          minimum: 1,
          description: 'tick — how many rounds to advance, default 1',
        },
      },
      required: ['action'],
    },
  },
  // Discovered while wiring up the #468 drift guard — corrected to match
  // npc-manage.ts's real actions (previously advertised generate/delete/react/
  // get_dialogue — none of which exist on the handler — only get/list/update
  // overlapped; the real handler has no delete action at all).
  {
    sub: 'npc',
    description:
      "NPC creation, relationships, memories, and location. Actions: create, get, list, update, get_full_context (character + relationships + recent memories), get_relationship, update_relationship (familiarity/disposition/notes), record_memory, get_history (conversation memories between a character and NPC), get_recent (a character's recent NPC interactions), get_context (lightweight NPC + recent memories), interact (records/bumps a relationship, optionally logs a memory), assign_to_location (locationKey or hexQ/hexR). Aliases: new_npc/spawn_npc->create, context->get_context, full->get_full_context, relationship/relation->get_relationship, update_rel/set_relationship->update_relationship, memory/remember->record_memory, history/conversations->get_history, recent/recent_interactions->get_recent, talk/speak->interact, all_npcs/browse_npcs->list, place/relocate/move->assign_to_location.",
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: {
          type: 'string',
          description: 'NPC characterId — used by get_full_context/get_context.',
        },
        worldId: { type: 'string' },
        name: { type: 'string', description: 'Required for create.' },
        class: { type: 'string', description: 'create, default Commoner' },
        race: { type: 'string', description: 'create, default Human' },
        background: { type: 'string', description: 'create, default Folk Hero' },
        alignment: { type: 'string' },
        stats: { type: 'object', description: '{ str, dex, con, int, wis, cha }, each default 10' },
        hp: { type: 'integer' },
        maxHp: { type: 'integer' },
        ac: { type: 'integer', description: 'default 10' },
        level: { type: 'integer', minimum: 1, maximum: 20, description: 'default 1' },
        factionId: { type: 'string' },
        characterId: {
          type: 'string',
          description:
            'The PC/observer side of a relationship — required for get_relationship/update_relationship/record_memory/get_history/get_recent/interact.',
        },
        npcId: {
          type: 'string',
          description:
            'Alternate key for id on get/update/assign_to_location; required alongside characterId for get_relationship/update_relationship/record_memory/get_history/interact.',
        },
        familiarity: {
          type: 'string',
          enum: ['stranger', 'acquaintance', 'friend', 'close_friend', 'rival', 'enemy'],
          description: 'update_relationship, default stranger',
        },
        disposition: {
          type: 'string',
          enum: ['hostile', 'unfriendly', 'neutral', 'friendly', 'helpful'],
          description: 'update_relationship, default neutral',
        },
        notes: { type: 'string', description: 'update_relationship' },
        summary: { type: 'string', description: 'Required for record_memory.' },
        importance: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'record_memory, default medium',
        },
        topics: { type: 'array', items: { type: 'string' }, description: 'record_memory' },
        context: {
          type: 'string',
          description: 'interact — optional memory text to log alongside the interaction.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'list/get_history/get_recent, default 10',
        },
        locationKey: {
          type: 'string',
          description: 'assign_to_location (one of locationKey or hexQ/hexR required).',
        },
        hexQ: { type: 'integer', description: 'assign_to_location' },
        hexR: { type: 'integer', description: 'assign_to_location' },
      },
      required: ['action'],
    },
  },
  // #404 (Tier 1) — descriptive alias for dialogue/reaction actions.
  { sub: 'npc_dialogue', aliasOf: 'npc' },
  // #464 — corrected to match session-manage.ts's real find-or-create + context
  // shape (previously advertised a CRUD action set — create/get/list/end/
  // get_summary/save_checkpoint — none of which exist on the handler).
  {
    sub: 'session',
    description:
      'Session bootstrap and narrative context. Actions: initialize (find an existing world/party to play in, or make one with createNew), get_context (aggregated party/quests/world/narrative/combat snapshot for an AI narrator). Aliases: init/start/setup/initialize_session/start_session->initialize, context/narrative/narrative_context/get_narrative/summary->get_context.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        worldId: { type: 'string' },
        partyId: { type: 'string' },
        createNew: {
          type: 'boolean',
          description:
            'initialize, default false — create a new world/party instead of reusing the most recent existing one',
        },
        worldName: { type: 'string' },
        partyName: { type: 'string' },
        includeParty: { type: 'boolean', description: 'get_context, default true' },
        includeQuests: { type: 'boolean', description: 'get_context, default true' },
        includeWorld: { type: 'boolean', description: 'get_context, default true' },
        includeNarrative: { type: 'boolean', description: 'get_context, default true' },
        includeCombat: { type: 'boolean', description: 'get_context, default true' },
        narrativeLimit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'get_context, default 10',
        },
      },
      required: ['action'],
    },
  },
  // Discovered while wiring up the #468 drift guard — corrected to match
  // combat-map.ts's real square-grid battlefield actions (previously advertised
  // place_token/remove_token/get_adjacent/measure_distance — none of which exist
  // on the handler; only create/get/move_token overlapped).
  {
    sub: 'combat_map',
    description:
      'Square-grid tactical battlefield — terrain, tokens, ASCII rendering, AoE templates. Actions: create, get (by id or encounterId), update (terrain/dimensions), move_token, render (ASCII grid), delete, get_terrain, set_terrain, calculate_aoe (circle/square/line template from an origin). Aliases: new_map/setup_map/init_battlefield->create, fetch/show/load->get, edit/modify/patch->update, move/reposition->move_token, display/ascii/view->render, remove/destroy/clear->delete, terrain/read_terrain->get_terrain, update_terrain/paint_terrain->set_terrain, aoe/area_of_effect/blast_radius->calculate_aoe.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: {
          type: 'string',
          description:
            'Battlefield UUID from create. Required for update/move_token/delete/set_terrain.',
        },
        encounterId: {
          type: 'string',
          description:
            'Required for create; fallback lookup key for get/render/get_terrain when id is omitted.',
        },
        width: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'create/update, default 10',
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'create/update, default 10',
        },
        terrain: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              x: { type: 'integer' },
              y: { type: 'integer' },
              type: { type: 'string' },
            },
          },
          description: 'update/set_terrain',
        },
        tokenId: { type: 'string', description: 'Required for move_token.' },
        x: { type: 'integer', description: 'move_token' },
        y: { type: 'integer', description: 'move_token' },
        origin: {
          type: 'object',
          properties: { x: { type: 'integer' }, y: { type: 'integer' } },
          description: 'Required for calculate_aoe.',
        },
        target: {
          type: 'object',
          properties: { x: { type: 'integer' }, y: { type: 'integer' } },
          description: 'calculate_aoe — required when shape is line.',
        },
        shape: {
          type: 'string',
          enum: ['circle', 'square', 'line'],
          description: 'calculate_aoe, default circle',
        },
        size: { type: 'integer', minimum: 1, maximum: 30, description: 'calculate_aoe, default 1' },
      },
      required: ['action'],
    },
  },
  // #467 — added 'place_character' (#340), which existed on the handler but was
  // never surfaced here, plus the q/r/mapId/characterId params it needs.
  {
    sub: 'spawn',
    description:
      'Entity spawning — characters, encounters, locations, and placing an existing character on the hex map. Actions: spawn_character, spawn_encounter, spawn_location, add_to_encounter (place a token on a tactical encounter grid), list_spawned, place_character (position an existing character on a world hex map — #340; requires the character to already exist, unlike spawn_character). Aliases: character/spawn_npc/create_character->spawn_character, encounter/new_encounter/setup_encounter->spawn_encounter, location/populate->spawn_location, add/join/insert->add_to_encounter, list/show_all->list_spawned, place/place_npc->place_character.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        name: { type: 'string' },
        characterType: {
          type: 'string',
          enum: ['pc', 'npc', 'enemy', 'neutral'],
          description: 'default enemy',
        },
        characterClass: { type: 'string', description: 'default Fighter' },
        race: { type: 'string', description: 'default Human' },
        level: { type: 'integer', minimum: 1, maximum: 20, description: 'default 1' },
        hp: { type: 'integer' },
        maxHp: { type: 'integer' },
        ac: { type: 'integer', description: 'default 10' },
        stats: { type: 'object', description: '{ str, dex, con, int, wis, cha }, each default 10' },
        encounterId: { type: 'string', description: 'Required for add_to_encounter.' },
        regionId: { type: 'string' },
        count: { type: 'integer', minimum: 1, maximum: 20, description: 'default 1' },
        initiative: { type: 'number', description: 'add_to_encounter' },
        position: {
          type: 'object',
          properties: { x: { type: 'integer' }, y: { type: 'integer' } },
          description: 'add_to_encounter tactical-grid position',
        },
        characterId: {
          type: 'string',
          description: 'Required for add_to_encounter and place_character.',
        },
        worldId: { type: 'string' },
        q: { type: 'integer', description: 'Required for place_character — hex-axial column.' },
        r: { type: 'integer', description: 'Required for place_character — hex-axial row.' },
        mapId: { type: 'string', description: 'place_character, default "main"' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'list_spawned, default 20',
        },
      },
      required: ['action'],
    },
  },
  {
    sub: 'strategy',
    description:
      'Grand strategy — nations, alliances, regions. Actions: create_nation, get_state, propose_alliance, claim_region, resolve_turn, list_nations.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        worldId: { type: 'string' },
        nationId: { type: 'string' },
        name: { type: 'string' },
        leader: { type: 'string' },
        ideology: { type: 'string', enum: ['democracy', 'autocracy', 'theocracy', 'tribal'] },
        aggression: { type: 'number' },
        trust: { type: 'number' },
      },
      required: ['action'],
    },
  },
  // Discovered while wiring up the #468 drift guard — corrected to match
  // turn-manage.ts's real world-level (nation/party) turn-phase actions
  // (previously advertised start/next/get_current/set_initiative/skip/reset —
  // an encounter-level initiative-tracker shape that doesn't exist on the
  // handler — 0% overlap. Per-encounter initiative lives on combat_manage/
  // combat_action instead).
  {
    sub: 'turn',
    description:
      'World-level turn phase tracking — nations/parties submit actions and mark ready each turn. Actions: init (start turn 1 for a world), get_status, submit_actions (log an action batch for a nation/party this turn), mark_ready, poll_results (status + recently submitted actions). Aliases: initialize/setup/start/create->init, status/state/check->get_status, submit/action/post_actions->submit_actions, ready/confirm/done->mark_ready, poll/results/get_results->poll_results.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        worldId: { type: 'string', description: 'Required for all actions.' },
        nationId: {
          type: 'string',
          description: 'submit_actions/mark_ready — one of nationId or partyId required.',
        },
        partyId: {
          type: 'string',
          description: 'submit_actions/mark_ready — one of nationId or partyId required.',
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              targetId: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['type'],
          },
          description: 'submit_actions',
        },
      },
      required: ['action'],
    },
  },
  // Discovered while wiring up the #468 drift guard — corrected to match
  // spatial-manage.ts's real room-graph (room_nodes) actions (previously
  // advertised get_neighbors/get_in_radius/check_line_of_sight/get_distance/
  // get_path — a coordinate-based spatial-query shape that doesn't exist on
  // the handler — 0% overlap; hex-axial coordinate spatial queries live on
  // world_map instead).
  {
    sub: 'spatial',
    description:
      'Room-graph (room_nodes) locations — look/generate/update rooms, exits, room-to-room movement, and node networks. Actions: look (room detail, increments visit count), generate (create a room; validates biome against the per-world registry when worldId is set), update, get_exits, move (follow an exit by direction), list, network_create, network_get, network_list. Aliases: describe/observe/inspect->look, create/new_room/spawn->generate, edit/modify/patch->update, exits/doors->get_exits, go/travel/walk->move, rooms/all_rooms->list, create_network/new_network->network_create, get_network/fetch_network->network_get, list_networks/networks->network_list.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        roomId: { type: 'string', description: 'Required for look/update/get_exits/move.' },
        name: { type: 'string', description: 'Required for generate/network_create.' },
        description: {
          type: 'string',
          description: 'generate/update — ignored if under 10 chars.',
        },
        biome: {
          type: 'string',
          description:
            'generate/update, default dungeon — validated against the world biome registry when worldId is set and the registry is non-empty.',
        },
        atmosphere: { type: 'array', items: { type: 'string' } },
        exits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              direction: { type: 'string' },
              targetRoomId: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['direction', 'targetRoomId'],
          },
        },
        entityIds: { type: 'array', items: { type: 'string' } },
        direction: { type: 'string', description: 'Required for move.' },
        networkId: { type: 'string', description: 'Required for network_get.' },
        worldId: {
          type: 'string',
          description: 'generate/update/network_create — also gates biome validation.',
        },
        networkType: {
          type: 'string',
          enum: ['cluster', 'linear'],
          description: 'network_create, default cluster',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'list/network_list, default 20',
        },
        worldIdFilter: { type: 'string', description: 'list' },
      },
      required: ['action'],
    },
  },
  // #423 — rewritten to match the actual hex-axial handler (world-map.ts),
  // rewritten for #320/#308-Phase-2 from a square-grid model this schema still
  // described until now. Coordinates are hex-axial q,r, not square x,y.
  {
    sub: 'world_map',
    description:
      'Hex world map — hex tiles, landmarks, zones, POIs, SVG export, distance/pathfinding (#430). Actions: overview, region, hexes, patch, batch, preview, find_poi, suggest_poi, update_poi, query_zone, list_zones, render_svg, distance, pathfind. Aliases: update/update_tiles/update_hexes/modify→patch, tiles/get_tiles/get_hexes/hex_data→hexes, bulk/bulk_import/import_hexes→batch, search_poi/get_poi→find_poi, render/ascii/view→preview, svg/export_svg/map_svg→render_svg, dist/get_distance→distance, route/find_path/navigate/find_route→pathfind. Coordinates are hex-axial q,r (not square x,y). distance/pathfind report straightLineKm/totalKm/totalDays only when the world is geo-calibrated via waypoint.calibrate — otherwise those fields are null with an explanatory note, though hexDistance/path/terrainBreakdown hex counts are always accurate.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        worldId: { type: 'string', description: 'World UUID (required for most actions)' },
        mapId: { type: 'string', description: 'Map identifier (default "main")' },
        q: { type: 'integer', description: 'Hex-axial column coordinate' },
        r: { type: 'integer', description: 'Hex-axial row coordinate' },
        width: { type: 'integer', description: 'Viewport width in hexes (hexes/preview/overview)' },
        height: {
          type: 'integer',
          description: 'Viewport height in hexes (hexes/preview/overview)',
        },
        hexes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              q: { type: 'integer' },
              r: { type: 'integer' },
              biome: { type: 'string' },
              elevation: { type: 'integer' },
              moisture: { type: 'integer' },
              temperature: { type: 'integer' },
              waterDepth: {
                type: ['number', 'null'],
                description:
                  "Fording depth in meters (#431). null = no explicit fording rule for this hex (defers to the biome's movement cost). Takes precedence over biome cost for foot/horse/carriage/car when set; ignored for aircraft.",
              },
            },
          },
          description: 'Hex tile array for patch/batch actions',
        },
        validateBiomes: {
          type: 'boolean',
          description: 'Validate biomes against registry (batch, default true)',
        },
        regionId: { type: 'string', description: 'Region UUID (region/overview)' },
        query: { type: 'string', description: 'Search query or POI name' },
        structureType: { type: 'string', description: 'Landmark category' },
        structureId: { type: 'string', description: 'Landmark UUID (update_poi only)' },
        name: { type: 'string', description: 'Landmark name' },
        radius: { type: 'number', description: 'Zone circle radius in hexes' },
        polygon: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Zone polygon as [q,r] pairs',
        },
        ringInner: { type: 'number', description: 'Zone ring inner radius' },
        ringOuter: { type: 'number', description: 'Zone ring outer radius' },
        ringPoints: { type: 'integer', description: 'Zone ring point count' },
        zoneType: { type: 'string', description: 'Zone type from zone_type registry' },
        predatorRef: { type: 'string', description: 'Entity lore key for zone predator' },
        threatLevel: { type: 'number', description: 'Threat level 0-100' },
        dominanceRank: { type: 'integer' },
        renderWidth: { type: 'integer', description: 'SVG viewport width in hexes (1-200)' },
        renderHeight: { type: 'integer', description: 'SVG viewport height in hexes (1-200)' },
        showStructures: { type: 'boolean' },
        showZones: { type: 'boolean' },
        showPerimeter: { type: 'boolean' },
        gridLabels: { type: 'boolean' },
        highlight: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              q: { type: 'number' },
              r: { type: 'number' },
              label: { type: 'string' },
              color: { type: 'string' },
            },
          },
        },
        from: {
          type: 'object',
          properties: { q: { type: 'integer' }, r: { type: 'integer' } },
          description: 'Origin hex for distance/pathfind (#430)',
        },
        to: {
          type: 'object',
          properties: { q: { type: 'integer' }, r: { type: 'integer' } },
          description: 'Destination hex for distance/pathfind (#430)',
        },
        mode: {
          type: 'string',
          enum: ['foot', 'horse', 'carriage', 'car', 'aircraft'],
          description:
            'Transport mode for distance/pathfind (#430). Defaults to foot. Same per-hex cost model as travel.move_hex (#429/#431).',
        },
        avoid: {
          type: 'array',
          items: { type: 'string' },
          description:
            "pathfind only (#430). Biome names or zone_type values to route around — matched against each world's own dynamic registries, not a fixed list.",
        },
      },
      required: ['action'],
    },
  },
  // #404 (Tier 1) — shorter alias. Inherits the corrected schema above automatically.
  { sub: 'maps', aliasOf: 'world_map' },
  // Discovered while wiring up the #468 drift guard — corrected to match
  // batch-manage.ts's real bulk-character/template actions (previously
  // advertised create_many/update_many/delete_many/get_many — a generic-CRUD
  // shape that doesn't exist on the handler — 0% overlap).
  {
    sub: 'batch',
    description:
      'Bulk character creation, item distribution, and starter templates. Actions: batch_create_characters, batch_create_npcs (same handler, different default characterType), batch_distribute_items, execute_workflow (records a sequence of tool-call steps — does not execute them; individual tool calls must still be made separately), list_templates, get_template (by templateId or a name substring match). Aliases: bulk_characters/create_characters/many_characters->batch_create_characters, bulk_npcs/create_npcs/many_npcs->batch_create_npcs, distribute/give_items/bulk_items->batch_distribute_items, workflow/run_workflow->execute_workflow, templates/all_templates->list_templates, template/fetch_template->get_template.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        characters: {
          type: 'array',
          description:
            'Required (non-empty) for batch_create_characters/batch_create_npcs. Each item: { name (required), level, characterClass, race, characterType, stats, hp, maxHp, ac }.',
          items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
        distributions: {
          type: 'array',
          description:
            'Required (non-empty) for batch_distribute_items. Each item: { characterId, itemId, quantity }.',
          items: {
            type: 'object',
            properties: {
              characterId: { type: 'string' },
              itemId: { type: 'string' },
              quantity: { type: 'integer', minimum: 1 },
            },
            required: ['characterId', 'itemId'],
          },
        },
        steps: {
          type: 'array',
          description:
            'Required (non-empty) for execute_workflow. Each item: { tool, args }. Recorded only — individual tool calls must still be made separately via tools/call.',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              args: { type: 'object', additionalProperties: true },
            },
            required: ['tool', 'args'],
          },
        },
        templateId: {
          type: 'string',
          description:
            'get_template — one of: party-4, dungeon-guards, merchant-caravan, bandit-gang.',
        },
        templateName: {
          type: 'string',
          description:
            'get_template, substring match on template name (used if templateId is omitted).',
        },
        category: {
          type: 'string',
          description: 'list_templates filter — party | encounter | npc.',
        },
      },
      required: ['action'],
    },
  },
  // #429 — corrected description/schema to match travel-manage.ts's actual actions
  // (previously advertised a stale action set — begin/advance/get_status/arrive/
  // check_encounter — none of which exist on the handler — plus a "speed" enum
  // that was never implemented). Added "mode" (#429) for move_hex passability
  // and effective-speed calculation.
  {
    sub: 'travel',
    description:
      'Party/character travel. Actions: travel (room-graph movement via toRoomId or fromRoomId+direction), loot (search a room), rest (short/long, restores HP), move_hex (hex-grid party movement, mode-aware passability — #429). Aliases: move/go/journey/traverse→travel, search/forage/find/gather→loot, camp/sleep/recover/short_rest/long_rest→rest, hex_move/hex_travel/move_to_hex→move_hex.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        partyId: { type: 'string' },
        fromRoomId: { type: 'string' },
        toRoomId: { type: 'string' },
        direction: { type: 'string' },
        restType: { type: 'string', enum: ['short', 'long'] },
        roomId: { type: 'string' },
        characterIds: { type: 'array', items: { type: 'string' } },
        resolveEncounter: { type: 'boolean' },
        worldId: { type: 'string' },
        q: { type: 'integer' },
        r: { type: 'integer' },
        toQ: { type: 'integer' },
        toR: { type: 'integer' },
        mode: {
          type: 'string',
          enum: ['foot', 'horse', 'carriage', 'car', 'aircraft'],
          description:
            "Transport mode for move_hex (#429). Defaults to foot. Governs passability and effective speed via the destination biome's per-mode movement cost, or its explicit water_depth fording rule when set (#431, takes precedence over biome cost; response includes swimRisk: true for a >0.6m ford by foot/horse).",
        },
        partySize: { type: 'integer' },
        timeOfDay: { type: 'string', enum: ['dawn', 'dusk', 'night', 'midday', 'day'] },
        noiseLevel: { type: 'string', enum: ['loud', 'moderate', 'silent'] },
        weather: { type: 'string', enum: ['clear', 'rain', 'snow', 'fog'] },
      },
      required: ['action'],
    },
  },
  // Discovered while wiring up the #468 drift guard — corrected to match
  // perception-manage.ts's real actions (previously advertised check/
  // passive_perception/group_check/oppose_stealth — only "stealth_check"
  // overlapped with the real handler).
  {
    sub: 'perception',
    description:
      'Perception assessments and stealth/opposed checks. Actions: assess (roll vs. DC, persists an assessment record), get_history, get_latest, list_observers (who has assessed a target), stealth_check (#284 — opposed yield-vs-predator stealth roll, same math encounter.resolve/check reuse), perception_contested (#284 — opposed observer-vs-actor roll). Aliases: check/perceive/observe/inspect/roll->assess, history/past->get_history, latest/current/last->get_latest, observers/watchers->list_observers, stealth/sneak/hide_check->stealth_check, contested/opposed_check/spot_check->perception_contested.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        observerId: { type: 'string', description: 'Required for assess/get_history/get_latest.' },
        targetId: { type: 'string', description: 'Required for assess/list_observers.' },
        targetKind: {
          type: 'string',
          enum: ['room', 'encounter', 'scene'],
          description: 'assess, default room',
        },
        rollValue: {
          type: 'integer',
          minimum: 1,
          maximum: 30,
          description:
            'Override the d20 roll (testing) — assess/stealth_check/perception_contested.',
        },
        dc: { type: 'integer', minimum: 1, maximum: 30, description: 'assess, default 12' },
        perceptionType: {
          type: 'string',
          enum: ['sight', 'hearing', 'smell', 'arcana', 'investigation', 'insight'],
          description: 'assess, default sight',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'get_history/list_observers, default 20',
        },
        stealthMode: {
          type: 'string',
          enum: ['active', 'passive', 'rushed', 'hiding'],
          description: 'stealth_check, default active',
        },
        coverType: { type: 'string', description: 'stealth_check' },
        windDirection: {
          type: 'string',
          enum: ['toward', 'away', 'crosswind', 'none'],
          description: 'stealth_check, default none',
        },
        distanceZone: {
          type: 'string',
          enum: ['core', 'edge', 'unknown'],
          description: 'stealth_check, default unknown',
        },
        yieldBleeding: { type: 'boolean', description: 'stealth_check' },
        yieldCookingOrFire: { type: 'boolean', description: 'stealth_check' },
        isNight: { type: 'boolean', description: 'stealth_check' },
        partySize: { type: 'integer', minimum: 1, description: 'stealth_check, default 1' },
        yieldStealthBonus: { type: 'number', description: 'stealth_check' },
        predatorPerceptionBonus: { type: 'number', description: 'stealth_check' },
        observerModifier: { type: 'number', description: 'perception_contested' },
        actorModifier: { type: 'number', description: 'perception_contested' },
      },
      required: ['action'],
    },
  },
  // ── #366 — scene: add state_snapshot ────────────────────────────────────
  // Discovered while wiring up the #468 drift guard — missing set_conflict_type/
  // get_conflict_type (#316 conflict-type routing) and the conflictTypeId param.
  {
    sub: 'scene',
    description:
      "Scene management — narrative scenes with participants. Actions: create, get, list, update, delete, get_latest, state_snapshot, set_conflict_type, get_conflict_type (#316 — link/read a scene's conflict-type routing).",
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        worldId: { type: 'string' },
        title: { type: 'string' },
        whenLabel: { type: 'string' },
        placeLabel: { type: 'string' },
        narration: { type: 'string' },
        participants: { type: 'array', items: { type: 'string' } },
        previousSceneId: { type: 'string' },
        limit: { type: 'number' },
        sceneId: { type: 'string' },
        include: { type: 'object' },
        conflictTypeId: {
          type: ['string', 'null'],
          description:
            'set_conflict_type (required, pass null to clear) / returned by get_conflict_type',
        },
      },
      required: ['action'],
    },
  },
  {
    sub: 'rest',
    description: 'Rest mechanics — short and long rest recovery. Actions: long_rest, short_rest.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        characterId: { type: 'string' },
        partyId: { type: 'string' },
        healAmount: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    sub: 'scroll',
    description:
      'Magic scroll creation and usage. Actions: create, use, identify, get_dc, get_details.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        spellName: { type: 'string' },
        spellLevel: { type: 'number' },
        saveDc: { type: 'number' },
        casterId: { type: 'string' },
        worldId: { type: 'string' },
      },
      required: ['action'],
    },
  },
  // #465 — corrected to match event-manage.ts's real poll-based queue (#206;
  // Cloudflare Workers has no long-lived connection to push events over, so
  // this is emit/poll/ack, not the create/get/list/resolve/trigger/get_active
  // CRUD shape previously advertised here — 0% overlap).
  {
    sub: 'event',
    description:
      'Poll-based event queue — Cloudflare Workers has no long-lived connection to push events over, so this is emit/poll/ack instead of pub/sub. Actions: emit (publish an event), poll (fetch, defaults to unconsumed-only), ack (mark consumed by id or ids), list_types (known eventType/sourceType values — custom eventType strings are also accepted). Aliases: publish/send/notify->emit, subscribe/list/get_events/unsubscribe->poll, consume/mark_read/dismiss->ack, types/topics->list_types.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        eventType: { type: 'string', description: 'Required for emit.' },
        payload: { type: 'object', additionalProperties: true, description: 'Required for emit.' },
        sourceType: { type: 'string', enum: ['npc', 'combat', 'world', 'system', 'scheduler'] },
        sourceId: { type: 'string' },
        priority: { type: 'integer', description: 'emit, default 0' },
        id: { type: 'integer', description: 'ack, single event ID' },
        ids: { type: 'array', items: { type: 'integer' }, description: 'ack, multiple event IDs' },
        unconsumedOnly: { type: 'boolean', description: 'poll, default true' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'poll, default 50' },
      },
      required: ['action'],
    },
  },
  // #462 — corrected to match drama-manage.ts's real ability-check/conflict-
  // resolution actions (previously advertised inject_complication/
  // resolve_tension/escalate/introduce_twist/check_pacing/get_active_threads —
  // none of which exist on the handler — 0% overlap).
  {
    sub: 'drama',
    description:
      'Ability checks and narrative conflict resolution — opposed checks, group checks, social combat, multi-side dramatic conflicts. Actions: roll_ability (single check, optional advantage/disadvantage), opposed_check (character_a vs character_b), group_check (side_a vs side_b, mode: best|sum|pool), social_combat (multi-round negotiation among participants), dramatic_conflict (multi-side campaign-level conflict over ticks). Aliases: ability/roll->roll_ability, oppose/duel->opposed_check, group/pool->group_check, social/negotiate->social_combat, conflict/campaign->dramatic_conflict.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        character: { type: 'string', description: 'roll_ability' },
        ability: { type: 'string', description: 'roll_ability' },
        advantage: { type: ['boolean', 'string'], description: 'roll_ability' },
        disadvantage: { type: ['boolean', 'string'], description: 'roll_ability' },
        character_a: { type: 'string', description: 'opposed_check' },
        ability_a: { type: 'string', description: 'opposed_check' },
        character_b: { type: 'string', description: 'opposed_check' },
        ability_b: { type: 'string', description: 'opposed_check' },
        side_a: {
          type: 'array',
          items: {
            type: 'object',
            properties: { character: { type: 'string' }, ability: { type: 'string' } },
          },
          description: 'group_check',
        },
        side_b: {
          type: 'array',
          items: {
            type: 'object',
            properties: { character: { type: 'string' }, ability: { type: 'string' } },
          },
          description: 'group_check',
        },
        mode: {
          type: 'string',
          enum: ['best', 'sum', 'pool'],
          description: 'group_check, default best',
        },
        participants: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              character: { type: 'string' },
              goal: { type: 'string' },
              leverage: { type: 'number' },
            },
          },
          description: 'social_combat',
        },
        rounds: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'social_combat, default 3',
        },
        arena: { type: 'string', description: 'social_combat' },
        stakes: { type: 'string', description: 'social_combat' },
        title: { type: 'string', description: 'dramatic_conflict' },
        sides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              actors: { type: 'array', items: { type: 'string' } },
              primary_ability: { type: 'string' },
              momentum: { type: 'number' },
            },
          },
          description: 'dramatic_conflict',
        },
        ticks: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'dramatic_conflict, default 4',
        },
        external_factors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              modifier: { type: 'number' },
              affects: { type: 'string' },
            },
          },
          description: 'dramatic_conflict',
        },
      },
      required: ['action'],
    },
  },
  // #312 — corrected description/schema to match time-manage.ts's actual actions
  // (previously advertised a stale action set — get_current/set_time/get_calendar/
  // check_event/get_phase — none of which exist on the handler). Added owner-based
  // clock-lock actions (set_owner/get_owner) and the "owner" param on advance.
  {
    sub: 'time',
    description:
      'In-game time and calendar. Actions: set_date, get_date, get_age, advance, get_timeline, jump_to, set_owner, get_owner. "advance" accepts an optional "owner" (agent self-identifier) to guard against a different agent moving the same world\'s clock — see set_owner/get_owner.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        world_id: { type: 'string' },
        worldId: { type: 'string' },
        date: { type: 'string' },
        era: { type: 'string' },
        character_id: { type: 'string' },
        by: { type: 'string', description: 'e.g. "3 months", "1 year", "7 days"' },
        from: { type: 'string' },
        to: { type: 'string' },
        thread: { type: 'string' },
        mode: { type: 'string', enum: ['observe', 'play'] },
        limit: { type: 'number' },
        owner: {
          type: ['string', 'null'],
          description:
            'Agent self-identifier for the clock-lock guard on advance/set_owner/get_owner',
        },
      },
      required: ['action'],
    },
  },
  // Discovered while wiring up the #468 drift guard — corrected to match
  // timeline-manage.ts's real D1-backed event/branch actions (previously
  // advertised get_state/snapshot/restore/check_paradox/list_branches — none of
  // which exist on the handler; only create_branch overlapped).
  {
    sub: 'timeline',
    description:
      'D1-backed narrative timeline — events, branches, perspectives, gap analysis. Actions: get_events (filter by thread/entity/verb/date range/branch), get_gap (canonical events + present characters between two events), get_perspectives (characters present in a date range), create_branch, switch_branch (set the active branch), compare_branches, merge_branch (move events from one branch to another). Aliases: events/list->get_events, gap/between->get_gap, characters/pov->get_perspectives, branch/fork->create_branch, switch->switch_branch, compare/diff->compare_branches, merge->merge_branch. Accepts both "worldId" and snake_case "world_id".',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        world_id: { type: 'string' },
        worldId: { type: 'string', description: 'Alias for world_id' },
        thread: { type: 'string' },
        from: {
          type: 'string',
          description: 'get_events: ISO date lower bound. get_perspectives: required.',
        },
        to: {
          type: 'string',
          description: 'get_events: ISO date upper bound. get_perspectives: required.',
        },
        entity_id: { type: 'string' },
        verb: { type: 'string' },
        canonical_only: { type: 'boolean' },
        before_event_id: { type: 'string', description: 'Required for get_gap.' },
        after_event_id: { type: 'string', description: 'Required for get_gap.' },
        name: { type: 'string', description: 'Required for create_branch.' },
        forked_at_event_id: {
          type: 'string',
          description: 'Required for create_branch — pivot event.',
        },
        reason: { type: 'string' },
        branch_id: { type: 'string', description: 'Required for switch_branch.' },
        branch_a: { type: 'string', description: 'Required for compare_branches.' },
        branch_b: { type: 'string', description: 'Required for compare_branches.' },
        source_branch_id: { type: 'string', description: 'Required for merge_branch.' },
        target_branch_id: { type: 'string', description: 'Required for merge_branch.' },
        event_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required (non-empty) for merge_branch.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['action'],
    },
  },
  // #429 — corrected stale "terrainType" field (never implemented; the real
  // fields are category/glyph/colorHex/baseThreat) and added modeCosts.
  {
    sub: 'biome',
    description:
      'Per-world biome registry and terrain movement rules. Actions: register, list, get, update, delete, validate, seed_defaults.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        biomeId: { type: 'string' },
        worldId: { type: 'string' },
        name: { type: 'string' },
        glyph: { type: 'string' },
        category: {
          type: 'string',
          enum: [
            'terrain',
            'aquatic',
            'urban',
            'hazard',
            'magical',
            'coastal',
            'subterranean',
            'void',
            'custom',
          ],
        },
        colorHex: { type: 'string' },
        movementCost: {
          type: 'number',
          description: 'Foot-equivalent baseline cost. Higher = slower, 0 = impassable.',
        },
        baseThreat: { type: 'number' },
        modeCosts: {
          type: 'object',
          additionalProperties: { type: 'number' },
          description:
            'Per-travel-mode cost overrides (#429), e.g. {"carriage": 0, "horse": 2.5}. Same semantics as movementCost. A mode with no entry falls back to movementCost. On update, shallow-merged into the existing object.',
        },
        description: { type: 'string' },
      },
      required: ['action'],
    },
  },
  // Discovered while wiring up the #468 drift guard — corrected to match
  // encounter-manage.ts's real hex-based threat-roll engine (#280; previously
  // advertised create_table/get_table/list_tables/roll_encounter/add_entry/
  // remove_entry — none of which exist on the handler — only "resolve" overlapped).
  {
    sub: 'encounter',
    description:
      'Encounter resolution engine (#280) — resolves a 1d100 threat check (biome + zone threat + contextual modifiers) at a hex, optionally with a stealth/perception opposed check first, and can assign injuries. Actions: resolve (full roll, selects an encounter type and persists injuries), check (lightweight — just the trigger roll, no type selection/injury persistence), list_types, add_type (register a predator/encounter type for a world), check_infection (infection staging for a prior injury). Aliases: encounter/trigger/roll_encounter->resolve, check_encounter/peek/threat_check->check, types/list_encounter_types->list_types, register_type/new_type/create_type->add_type, infection/infection_check->check_infection.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        worldId: { type: 'string', description: 'Required for resolve/check/list_types/add_type.' },
        q: { type: 'integer', description: 'Required for resolve/check.' },
        r: { type: 'integer', description: 'Required for resolve/check.' },
        partySize: { type: 'integer', minimum: 1, description: 'default 1' },
        timeOfDay: { type: 'string', enum: ['dawn', 'dusk', 'night', 'midday', 'day'] },
        noiseLevel: { type: 'string', enum: ['loud', 'moderate', 'silent'] },
        scentModifiers: {
          type: 'array',
          items: { type: 'string', enum: ['blood', 'cooking', 'fire'] },
        },
        partyInjuries: { type: 'array', items: { type: 'string' } },
        weather: { type: 'string', enum: ['clear', 'rain', 'snow', 'fog'] },
        includeInjuries: { type: 'boolean', description: 'resolve, default true' },
        characterIds: { type: 'array', items: { type: 'string' } },
        stealthCheck: {
          type: 'boolean',
          description:
            '#284 — opposed stealth/perception check before the threat roll, default false',
        },
        stealthMode: {
          type: 'string',
          enum: ['active', 'passive', 'rushed', 'hiding'],
          description: 'default active',
        },
        coverType: { type: 'string' },
        windDirection: {
          type: 'string',
          enum: ['toward', 'away', 'crosswind', 'none'],
          description: 'default none',
        },
        distanceZone: {
          type: 'string',
          enum: ['core', 'edge', 'unknown'],
          description: 'default unknown',
        },
        yieldBleeding: { type: 'boolean' },
        yieldCookingOrFire: { type: 'boolean' },
        isNight: { type: 'boolean' },
        yieldStealthBonus: { type: 'number' },
        predatorPerceptionBonus: { type: 'number' },
        yieldStealthRoll: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Override the yield-side stealth d20 (testing).',
        },
        predatorName: { type: 'string', description: 'add_type' },
        category: {
          type: 'string',
          enum: ['predator', 'environmental', 'system', 'passive'],
          description: 'add_type (required)',
        },
        aggression: {
          type: 'string',
          enum: ['curious', 'hunting', 'territorial', 'starving', 'fleeing'],
          description: 'add_type, default curious',
        },
        baseWeight: { type: 'number', minimum: 0, description: 'add_type, default 1.0' },
        minThreat: { type: 'number', minimum: 0, maximum: 100, description: 'add_type, default 0' },
        requiresCore: {
          type: 'boolean',
          description:
            "add_type — only selectable when the hex falls within this predator's own zone",
        },
        description: { type: 'string', description: 'add_type' },
        categoryFilter: {
          type: 'string',
          enum: ['predator', 'environmental', 'system', 'passive'],
          description: 'list_types',
        },
        characterId: { type: 'string', description: 'check_infection' },
        injuryId: { type: 'string', description: 'Required for check_infection.' },
        hoursSinceInjury: { type: 'number', minimum: 0, description: 'check_infection, default 0' },
        treatmentReceived: {
          type: 'string',
          enum: ['none', 'basic', 'professional'],
          description: 'check_infection, default none',
        },
      },
      required: ['action'],
    },
  },
  {
    sub: 'zone_type',
    description:
      'Zone type registry — map zone classification. Actions: register, list, get, update, delete, validate, seed_defaults.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        zoneTypeId: { type: 'string' },
        worldId: { type: 'string' },
        name: { type: 'string' },
        glyph: { type: 'string' },
        colorHex: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    sub: 'waypoint',
    description:
      'Waypoint registry — named map coordinates and distance matrix. Actions: register, list, get, update, delete, validate, seed_defaults, calibrate, hex_to_latlon.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: { type: 'string' },
        waypointId: { type: 'string' },
        worldId: { type: 'string' },
        name: { type: 'string' },
        lat: { type: 'number' },
        lon: { type: 'number' },
        q: { type: 'number' },
        r: { type: 'number' },
      },
      required: ['action'],
    },
  },
  // ── #366 — weather: lazy-population forecasts ─────────────────────────
  {
    sub: 'weather',
    description:
      'Weather forecasts per world/day. Actions: get_forecast, set_forecast, list_forecasts. "worldId" is required for all actions — accepts snake_case "world_id" as alias (cross-tool compatibility).',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        worldId: { type: 'string', description: 'World UUID (required for all weather actions)' },
        world_id: {
          type: 'string',
          description: 'Snake_case alias for worldId (cross-tool compatibility with non-RPG tools)',
        },
        day: { type: 'number' },
        weather: { type: 'string', enum: ['storm', 'rain', 'overcast', 'clear'] },
        fog: { type: 'boolean' },
        encounterModifier: { type: 'number' },
        movementModifier: { type: 'number' },
        season: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['action', 'worldId'],
    },
  },
  // Discovered while wiring up the #468 drift guard — "conflict_type" is a real
  // SUB_MAP entry (rpg-handler.ts) and is listed in rpg's SUB_VALUES
  // (definitions.ts), but had no SUB_SCHEMAS entry at all — the drift-guard test
  // fails immediately without it, since load_tool_schema({sub:'conflict_type'})
  // otherwise falls through to a fuzzy "did you mean" response. #316's conflict
  // type taxonomy: physical/social/hybrid scene routing, CRUD actions.
  {
    sub: 'conflict_type',
    description:
      'Conflict type taxonomy (#316) — physical/social/hybrid scene routing for dual-agent (combat/drama) resolution. Actions: list, create, update, delete. Aliases: register/add/new/make/insert->create, remove/destroy/erase/drop->delete, all/query/browse->list, modify/edit/patch/change/set->update.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        id: {
          type: 'string',
          description: 'Required for update/delete. Slugified from name on create.',
        },
        name: { type: 'string', description: 'Required for create.' },
        description: { type: 'string' },
        resolver: {
          type: 'string',
          enum: ['combat', 'drama', 'both'],
          description: 'Required for create.',
        },
      },
      required: ['action'],
    },
  },
]

for (const s of SUB_SCHEMAS) {
  if ('aliasOf' in s) {
    // Trusted by construction — every aliasOf target above names a real
    // canonical entry in this same static array (see the comment on
    // SubSchemaEntry). Not a defensive check: an invalid aliasOf would be a
    // typo caught by any test exercising load_tool_schema for that alias,
    // not a runtime condition to guard against.
    const canonical = SUB_SCHEMAS.find(
      (c): c is Extract<SubSchemaEntry, { schema: unknown }> =>
        'schema' in c && c.sub === s.aliasOf,
    )!
    registerRpgSubSchema(s.sub, canonical.description, canonical.schema)
    registerRpgAlias(s.sub, s.aliasOf)
  } else {
    registerRpgSubSchema(s.sub, s.description, s.schema)
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

const getIsAuthenticated = (c: any): boolean => {
  const key = c.env.MCP_API_KEY
  return !key || c.req.header('X-Api-Key') === key
}

// Pre-built Streamable HTTP handler — routes spec-compliant MCP SDK clients to
// the HolmgardMCP DO via the agents SDK session management.
const mcpServeHandler = HolmgardMCP.serve('/mcp', {
  binding: 'MCP_OBJECT',
  transport: 'streamable-http',
})

const app = new Hono<{ Bindings: AppBindings; Variables: RequestIdVariables }>()

app.use('*', requestIdMiddleware)
app.use('*', rateLimitMiddleware)

app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret', 'X-Api-Key'],
  }) as any,
)

// ── Health check endpoint ────────────────────────────────────────────────────
// GET /health — returns basic service status. Intentionally unauthenticated so
// orchestrators, load balancers, and monitoring tools can probe it.
app.get('/health', (c) => {
  return c.json(
    {
      status: 'ok',
      timestamp: Date.now(),
    },
    200,
  )
})

// ── Streamable HTTP middleware (spec 2025-03-26) ──────────────────────────────
// Intercepts requests with Streamable HTTP transport markers before route
// handlers run. Legacy raw JSON-RPC requests fall through via next().
app.use('/mcp', wsReconnectRateLimit)

app.use('/mcp', async (c, next) => {
  const sessionId = c.req.header('Mcp-Session-Id')
  const acceptHeader = c.req.header('Accept') ?? ''
  const isStreamableHttp =
    !!sessionId ||
    (acceptHeader.includes('application/json') && acceptHeader.includes('text/event-stream'))

  if (!isStreamableHttp || !c.env.MCP_OBJECT) return next()

  const apiKey = c.env.MCP_API_KEY
  if (apiKey && c.req.header('X-Api-Key') !== apiKey) {
    return c.json({ error: 'Unauthorized: valid X-Api-Key header required' }, 401)
  }

  return mcpServeHandler.fetch(c.req.raw, c.env as any, c.executionCtx as any)
})

app.get('/mcp', (c) => {
  c.header('Content-Type', 'application/json')
  c.header('Cache-Control', 'no-store')
  return c.json(makeError(null, -32600, 'Invalid Request: use POST JSON-RPC'), 200)
})

app.post('/mcp', async (c) => {
  // ── Legacy hand-rolled JSON-RPC handler ───────────────────────────────────
  // Streamable HTTP requests are handled by the app.use('/mcp', ...) middleware
  // above and never reach this handler.
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(makeError(null, -32700, 'Parse error: invalid JSON'), 200)
  }

  const requestId = c.get('requestId')

  try {
    try {
      console.log('MCP incoming:', JSON.stringify({ request_id: requestId, body }))
    } catch {
      /* ignore log error */
    }

    const validated = validateRequest(body)
    if (!validated.ok) return c.json(validated.error, 200)

    const req = validated.req
    const id = req.id ?? null
    const method = req.method!
    const params = (req.params ?? {}) as Record<string, unknown>

    // ── initialize ────────────────────────────────────────────────────────────
    if (method === 'initialize') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(
        makeResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { list: true, call: true } },
          serverInfo: {
            name: 'holmgard-lore-mcp',
            version: '0.3.0',
            description: 'Holmgard lore MCP',
          },
        }),
        200,
      )
    }

    if (method === 'ping') {
      return c.json(makeResult(id, {}), 200)
    }

    // ── tools/list ────────────────────────────────────────────────────────────
    if (method === 'tools/list') {
      c.header('Cache-Control', 'no-store')
      c.header('Content-Type', 'application/json')
      return c.json(makeResult(id, { tools: toolDefinitions }), 200)
    }

    // ── tools/call ────────────────────────────────────────────────────────────
    if (method === 'tools/call') {
      const toolName = params?.name
      const args = coerceTransportArgs((params?.arguments ?? {}) as Record<string, any>)
      if (!toolName || typeof toolName !== 'string')
        return c.json(makeError(id, -32602, 'Invalid params: missing tool name'), 200)

      const isAuthenticated = getIsAuthenticated(c)

      if (toolName === 'lore_manage') {
        const action = typeof args?.action === 'string' ? args.action : null
        if (action === 'ping') {
          return c.json(
            makeResult(id, {
              content: [{ type: 'text', text: 'pong' }],
              metadata: { source: 'internal' },
            }),
            200,
          )
        }
        if (action === 'auth_check') {
          return c.json(
            makeResult(id, {
              content: [
                {
                  type: 'text',
                  text: isAuthenticated
                    ? 'Authenticated.'
                    : 'Not authenticated — request was made without a valid API key.',
                },
              ],
              metadata: { authenticated: isAuthenticated },
            }),
            200,
          )
        }
        // fall through to auth guard + registry for all other lore_manage actions
      }

      if (!isAuthenticated) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }

      const handler = toolRegistry[toolName]
      if (handler) {
        return handler({ c, id, args, isAuthenticated })
      }

      return c.json(makeError(id, -32601, `Method not found: tool "${toolName}"`), 200)
    }

    // ── Legacy bare-method handlers (pre-tools/call clients) ──────────────────
    // In production (MCP_API_KEY is set) require same auth check as tools/call.

    if (method === 'list_topics') {
      if (!getIsAuthenticated(c)) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys = await kvList(c)
      return c.json(makeResult(id, { keys }), 200)
    }

    if (method === 'get_lore') {
      if (!getIsAuthenticated(c)) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const key = (params?.key ?? params?.query ?? '').toString().toLowerCase()
      if (!key) return c.json(makeError(id, -32602, 'Invalid params: missing key'), 200)

      const raw = await kvGet(c, key)
      if (!raw) return c.json(makeError(id, -32601, `No lore found for key: ${key}`), 200)

      const { text, meta } = parseKvEntry(raw)
      return c.json(makeResult(id, { key, text, meta }), 200)
    }

    if (method === 'get_world_biomes') {
      if (!getIsAuthenticated(c)) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const worldId = (params?.worldId ?? '').toString()
      if (!worldId) return c.json(makeError(id, -32602, 'Invalid params: missing worldId'), 200)
      if (!c.env.RPG_DB) return c.json(makeError(id, -32603, 'RPG_DB not available', null), 200)

      // Reuses biome-manage.ts's existing `list` action — one handler, two
      // envelopes (content-block for tools/call via rpg{sub:'biome'}, clean
      // structured JSON here) — same pattern as get_lore/list_topics.
      const listResult = await handleBiomeManage(c.env, { action: 'list', worldId })
      const parsed = JSON.parse(listResult.content[0].text) as {
        error?: boolean
        message?: string
        biomes?: unknown[]
        count?: number
      }
      if (parsed.error)
        return c.json(makeError(id, -32000, parsed.message ?? 'Failed to list biomes', null), 200)
      return c.json(makeResult(id, { worldId, biomes: parsed.biomes, count: parsed.count }), 200)
    }

    if (method === 'get_lore_batch') {
      const MCP_LEGACY_API_KEY = c.env.MCP_API_KEY
      if (MCP_LEGACY_API_KEY && c.req.header('X-Api-Key') !== MCP_LEGACY_API_KEY) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys: string[] = Array.isArray(params?.keys)
        ? params.keys.map((k: string) => k.trim().toLowerCase())
        : []
      if (!keys.length)
        return c.json(makeError(id, -32602, 'Invalid params: missing keys array'), 200)
      const rawValues = await Promise.all(keys.map((k) => kvGet(c, k)))
      const results: Record<string, any> = {}
      keys.forEach((k, i) => {
        results[k] = rawValues[i] ? parseKvEntry(rawValues[i]!) : null
      })
      return c.json(makeResult(id, { results }), 200)
    }

    if (method === 'get_topic_histories') {
      const MCP_LEGACY_API_KEY = c.env.MCP_API_KEY
      if (MCP_LEGACY_API_KEY && c.req.header('X-Api-Key') !== MCP_LEGACY_API_KEY) {
        return c.json(makeError(id, -32001, 'Unauthorized: valid X-Api-Key header required'), 200)
      }
      const keys: string[] = Array.isArray(params?.keys)
        ? params.keys.map((k: string) => k.trim().toLowerCase())
        : []
      if (!keys.length)
        return c.json(makeError(id, -32602, 'Invalid params: missing keys array'), 200)

      const kv = getKV(c)
      if (!kv) return c.json(makeError(id, -32603, 'KV not available', null), 200)

      const histories: Record<string, Array<{ text: string; meta: Record<string, unknown> }>> = {}

      try {
        for (const key of keys) {
          const historyKey = `_history:${key}`
          const historyRaw = await kv.get(historyKey)
          const snapshots: Array<{ text: string; meta: Record<string, unknown> }> = []

          if (historyRaw) {
            const historyList: string[] = JSON.parse(historyRaw)
            for (const snapshot of historyList) {
              snapshots.push(parseKvEntry(snapshot))
            }
          }

          histories[key] = snapshots
        }
      } catch {
        return c.json(makeError(id, -32603, 'Failed to read histories', null), 200)
      }

      return c.json(makeResult(id, histories), 200)
    }

    return c.json(makeError(id, -32601, `Method not found: ${method}`), 200)
  } catch (e: unknown) {
    console.error(
      JSON.stringify({
        request_id: requestId,
        error: 'Unhandled exception in MCP handler',
        message: e instanceof Error ? e.message : String(e),
      }),
    )
    return c.json(
      makeError(null, -32603, 'Internal error', {
        message: e instanceof Error ? e.message : String(e),
        request_id: requestId,
      }),
      200,
    )
  }
})

// ── CSP violation reporting ──────────────────────────────────────────────────────
app.post('/csp-report', async (c) => {
  try {
    const report = (await c.req.json()) as Record<string, unknown>
    const timestamp = new Date().toISOString()

    const violation = {
      timestamp,
      blockedUri: report['blocked-uri'] || 'unknown',
      violatedDirective: report['violated-directive'] || 'unknown',
      sourceFile: report['source-file'] || 'unknown',
      lineNumber: report['line-number'],
      columnNumber: report['column-number'],
      originalPolicy: report['original-policy'] || 'unknown',
      disposition: report['disposition'] || 'enforce',
    }

    console.log('[CSP Violation]', JSON.stringify(violation))

    return c.json({ status: 'reported' }, 200)
  } catch (e) {
    console.error('[CSP Report] Error processing report:', e)
    return c.json({ error: 'Failed to process CSP report' }, 400)
  }
})

// ── Admin routes ──────────────────────────────────────────────────────────────
app.route('/admin', adminRoutes)

// ── Internal routes ────────────────────────────────────────────────────────────
app.route('/internal', internalRoutes)

// ── Entity list reads (open, no auth) ─────────────────────────────────────────
app.route('/api/entities', entityReadsRouter)

// ── GET /changes ──────────────────────────────────────────────────────────────
app.route('/changes', changesRouter)

app.all('*', (c) => c.text('Not Found', 404))

export default app
