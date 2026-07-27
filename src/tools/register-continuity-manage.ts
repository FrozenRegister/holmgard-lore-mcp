// src/tools/register-continuity-manage.ts
// Registration of continuity_manage tool via the Phase 1 registerTool() infrastructure (#545).
//
// Note: Two actions have field-A OR field-B requirements (anyOf in the
// hand-written schema). plant_setup is modelled as z.union([variantA, variantB])
// so zod-to-json-schema emits real anyOf.
//
// set_goal has THREE independent OR-pairs (entity, goal, description) — an
// 8-way combinatorial union would be correct but verbose. Instead, all six
// aliased fields are kept optional in a single flat Zod object and the handler's
// existing runtime check enforces the OR requirement. This is a deliberate
// fidelity loss documented in PR #545.
//
// Top-level z.union (not z.discriminatedUnion) because plant_setup uses a nested
// z.union(), which is incompatible with discriminatedUnion's requirement that
// every member be a flat ZodObject.

import { z } from 'zod'
import { registerTool, type RegisteredTool } from './register'
import { handle_continuity_manage } from './continuity-manage'

export const InputSchema = z.union([
  z
    .object({
      action: z.literal('append_event'),
      entity_key: z.string().min(1),
      verb: z.string().min(1),
      object: z.string().optional(),
      location: z.string().optional(),
      thread: z.string().optional(),
      detail: z.string().optional(),
      description: z.string().optional(),
      at: z.string().optional(),
      date: z.string().optional(),
      source: z.string().optional(),
      world_id: z.string().optional(),
      entity_id: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_event_log'),
      entity_key: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      since: z.string().optional(),
      until: z.string().optional(),
      thread: z.string().optional(),
      verbs: z.array(z.string()).optional(),
      tier: z.string().optional(),
      limit: z.number().min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('taxonomy_list'),
      tier: z.enum(['high', 'medium', 'low']).optional(),
      category: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('taxonomy_set'),
      verb: z.string().min(1),
      tier: z.enum(['high', 'medium', 'low']),
      category: z.string().min(1),
      description: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('taxonomy_delete'),
      verb: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('recent_changes'),
      since: z.string().optional(),
      key_prefix: z.string().optional(),
      limit: z.number().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('tag_topic'),
      key: z.string().min(1),
      add: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('find_by_tag'),
      tags: z.array(z.string()).min(1),
      mode: z.enum(['any', 'all']).optional(),
      with_excerpt: z.boolean().optional(),
      limit: z.number().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('list_tags'),
      prefix: z.string().optional(),
      with_counts: z.boolean().optional(),
      limit: z.number().min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('bookmark_state'),
      name: z.string().min(1),
      key_prefix: z.string().optional(),
      note: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('world_diff'),
      from: z.string().min(1),
      to: z.string().optional(),
      detail: z.enum(['summary', 'fields', 'text']).optional(),
      key_prefix: z.string().optional(),
    })
    .strict(),
  // plant_setup: id OR setup_id
  z.union([
    z
      .object({
        action: z.literal('plant_setup'),
        id: z.string().min(1),
        description: z.string().min(1),
        setup_id: z.string().min(1).optional(),
        planted_in: z.string().optional(),
        tension: z.number().min(1).max(5).optional(),
        expected_in: z.string().optional(),
        actors: z.array(z.string()).optional(),
        payoff_type: z.string().optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('plant_setup'),
        setup_id: z.string().min(1),
        description: z.string().min(1),
        id: z.string().min(1).optional(),
        planted_in: z.string().optional(),
        tension: z.number().min(1).max(5).optional(),
        expected_in: z.string().optional(),
        actors: z.array(z.string()).optional(),
        payoff_type: z.string().optional(),
      })
      .strict(),
  ]),
  z
    .object({
      action: z.literal('pay_off_setup'),
      id: z.string().min(1),
      resolution: z.string().min(1),
      paid_in: z.string().optional(),
      status: z.enum(['paid', 'abandoned', 'deferred']).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('list_unpaid_setups'),
      actor: z.string().optional(),
      scope: z.enum(['scene', 'chapter', 'story']).optional(),
      min_tension: z.number().min(1).max(5).optional(),
    })
    .strict(),
  // set_goal: FLAT — all six aliased fields optional, handler validates ORs at runtime
  z
    .object({
      action: z.literal('set_goal'),
      entity_key: z.string().min(1).optional(),
      entity_name: z.string().min(1).optional(),
      goal_id: z.string().min(1).optional(),
      goal_name: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      goal_description: z.string().min(1).optional(),
      parent: z.string().optional(),
      status: z.enum(['active', 'blocked', 'achieved', 'abandoned']).optional(),
      obstacle: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('check_continuity'),
      scope: z.string().optional(),
      checks: z.array(z.enum(['dangling', 'occupancy', 'knowledge', 'inventory'])).optional(),
      severity_floor: z
        .enum(['info', 'warn', 'error', 'low', 'medium', 'moderate', 'high', 'critical'])
        .optional(),
    })
    .strict(),
])

export function registerContinuityManageTool(): void {
  const tool: RegisteredTool = {
    name: 'continuity_manage',
    title: 'Continuity Manage',
    version: '1.0.0',
    description:
      'Continuity tracking — events, tags, bookmarks, world diff, setups, goals, and continuity checks. Actions: append_event, get_event_log, taxonomy_list, taxonomy_set, taxonomy_delete, recent_changes, tag_topic, find_by_tag, list_tags, bookmark_state, world_diff, plant_setup, pay_off_setup, list_unpaid_setups, set_goal, check_continuity',
    category: 'lore',
    inputSchema: InputSchema,
    handler: handle_continuity_manage,
  }
  registerTool(tool)
}
