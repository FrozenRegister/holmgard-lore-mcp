// src/tools/register-entity-manage.ts
// Registration of entity_manage tool via the Phase 1 registerTool() infrastructure (#545).
//
// Top-level z.union (not z.discriminatedUnion) because set_attributes needs a
// .refine() to enforce "at least one attribute" (matching the hand-written
// schema's minProperties: 1 on ENTITY_MANAGE_SCHEMA's set_attributes branch).
// discriminatedUnion's constructor requires every member to be a flat ZodObject
// with a literal discriminator key — wrapping a branch in .refine() produces a
// ZodEffects, which fails that check. Same workaround already used by
// world_manage/continuity_manage for their OR-alias branches (see #545/#603
// review). Note this doesn't surface as minProperties in the generated JSON
// Schema (zod-to-json-schema treats .refine() as an opaque predicate, not a
// translatable constraint) — the constraint is enforced at parse time, not
// documented in tools/list output, same trade-off already accepted for the
// alias-OR branches elsewhere in this phase.

import { z } from 'zod'
import { registerTool, type RegisteredTool } from './register'
import { handle_entity_manage } from './entity-manage'

export const InputSchema = z.union([
  z
    .object({
      action: z.literal('generate'),
      archetype_key: z.string().min(1),
      location_key: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('move'),
      entity_key: z.string().min(1),
      new_location_key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('roll_encounter'),
      location_key: z.string().min(1),
      threat_level: z.number().min(1).max(10).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('advance_stage'),
      entity_key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('batch_stage'),
      location_key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_inventory'),
      entity_key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('transfer_item'),
      from_entity: z.string().min(1),
      to_entity: z.string().min(1),
      item_key: z.string().min(1),
      quantity: z.number().min(1).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_sensory_profile'),
      entity_key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_sensory_profile'),
      entity_key: z.string().min(1),
      temperature: z.string().optional(),
      scent: z.string().optional(),
      texture: z.string().optional(),
      sound_signature: z.string().optional(),
      visual_descriptors: z.string().optional(),
      composite: z.string().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_compatibility'),
      entity_a: z.string().min(1),
      entity_b: z.string().min(1),
      interaction_type: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('analyze_utility'),
      entity_id: z.string().min(1),
      utility_vector: z.enum([
        'GASTRIC',
        'BUTCHERY',
        'INCUBATION',
        'SCULPTURE',
        'PARASITISM',
        'THRALL',
        'DISTRIBUTED',
      ]),
      entity_role: z.enum(['subject', 'actor']).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('list_consumption_timelines'),
      status_filter: z
        .enum(['all', 'imminent', 'days-to-weeks', 'weeks-to-months', 'consumed'])
        .optional(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('create_consumption_timeline'),
      entity_key: z.string().min(1),
      predator_key: z.string().min(1),
      stages: z.number().min(1).max(20),
      stage_timer: z.number().min(1),
      terminal_state: z.string().min(1),
      current_stage: z.number().min(0).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_consumption_timeline'),
      entity_key: z.string().min(1),
      predator_key: z.string().min(1).optional(),
      stages: z.number().min(1).max(20).optional(),
      stage_timer: z.number().min(0).optional(),
      current_stage: z.number().min(0).optional(),
      terminal_state: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('list_active_threads'),
    })
    .strict(),
  z
    .object({
      action: z.literal('resolve_interaction'),
      entity_a_id: z.string().min(1),
      entity_b_id: z.string().min(1),
      action_type: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('destroy'),
      entity_key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_attributes'),
      entity_key: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('set_attributes'),
      entity_key: z.string().min(1),
      attributes: z.record(z.string(), z.number()),
      merge: z.boolean().optional(),
    })
    .strict()
    .refine((val) => Object.keys(val.attributes).length >= 1, {
      message: 'attributes must have at least one property',
      path: ['attributes'],
    }),
])

export function registerEntityManageTool(): void {
  const tool: RegisteredTool = {
    name: 'entity_manage',
    title: 'Entity Manage',
    version: '1.0.0',
    description:
      'Entity lifecycle — generate, move, inventory, encounters, consumption timelines, and interaction resolution. Actions: generate, move, roll_encounter, advance_stage, batch_stage, get_inventory, transfer_item, get_sensory_profile, set_sensory_profile, get_compatibility, analyze_utility, map_integration, list_consumption_timelines, create_consumption_timeline, set_consumption_timeline, list_active_threads, resolve_interaction, get_attributes, set_attributes',
    category: 'lore',
    inputSchema: InputSchema,
    handler: handle_entity_manage,
  }
  registerTool(tool)
}
