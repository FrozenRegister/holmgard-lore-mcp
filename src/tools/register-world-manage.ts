// src/tools/register-world-manage.ts
// Registration of world_manage tool via the Phase 1 registerTool() infrastructure (#545).
//
// Note: Several actions have field-A OR field-B requirements (anyOf in the
// hand-written schema). These are modelled as z.union([variantA, variantB])
// so zod-to-json-schema emits real anyOf — see #545 schema-modeling rules.
//
// Top-level z.union (not z.discriminatedUnion) because the OR-branch actions
// require nested z.union() calls, which are incompatible with discriminatedUnion's
// requirement that every member be a flat ZodObject.

import { z } from 'zod'
import { registerTool, type RegisteredTool } from './register'
import { handle_world_manage } from './world-manage'

// Shared action literal for get_faction_standing union variants
const factionStandingAction = { action: z.literal('get_faction_standing') } as const

export const InputSchema = z.union([
  z
    .object({
      action: z.literal('thread_tick'),
      thread_id: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('get_relationship'),
      entity_a: z.string().min(1),
      entity_b: z.string().min(1),
    })
    .strict(),
  // get_faction_standing: (entity_key OR entity_name) AND (faction_key OR faction_name)
  // 4-way union: each variant has one entity field and one faction field required
  z.union([
    z
      .object({
        ...factionStandingAction,
        entity_key: z.string().min(1),
        faction_key: z.string().min(1),
        entity_name: z.string().min(1).optional(),
        faction_name: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        ...factionStandingAction,
        entity_key: z.string().min(1),
        faction_name: z.string().min(1),
        entity_name: z.string().min(1).optional(),
        faction_key: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        ...factionStandingAction,
        entity_name: z.string().min(1),
        faction_key: z.string().min(1),
        entity_key: z.string().min(1).optional(),
        faction_name: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        ...factionStandingAction,
        entity_name: z.string().min(1),
        faction_name: z.string().min(1),
        entity_key: z.string().min(1).optional(),
        faction_key: z.string().min(1).optional(),
      })
      .strict(),
  ]),
  // get_entity_knowledge: entity_key OR entity_name
  z.union([
    z
      .object({
        action: z.literal('get_entity_knowledge'),
        entity_key: z.string().min(1),
        topic: z.string().min(1),
        entity_name: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('get_entity_knowledge'),
        entity_name: z.string().min(1),
        topic: z.string().min(1),
        entity_key: z.string().min(1).optional(),
      })
      .strict(),
  ]),
  // get_location_occupants: location_key OR location_id
  z.union([
    z
      .object({
        action: z.literal('get_location_occupants'),
        location_key: z.string().min(1),
        location_id: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('get_location_occupants'),
        location_id: z.string().min(1),
        location_key: z.string().min(1).optional(),
      })
      .strict(),
  ]),
  z
    .object({
      action: z.literal('get_reachable_locations'),
      origin_key: z.string().min(1),
    })
    .strict(),
  // sense_environment: entity_key OR entity_name
  z.union([
    z
      .object({
        action: z.literal('sense_environment'),
        location_key: z.string().min(1),
        entity_key: z.string().min(1),
        entity_name: z.string().min(1).optional(),
        radius: z.string().optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('sense_environment'),
        location_key: z.string().min(1),
        entity_name: z.string().min(1),
        entity_key: z.string().min(1).optional(),
        radius: z.string().optional(),
      })
      .strict(),
  ]),
  z
    .object({
      action: z.literal('get_thread_comparison'),
      thread_a: z.string().min(1),
      thread_b: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('check_convergence'),
      thread_a: z.string().min(1),
      thread_b: z.string().min(1),
    })
    .strict(),
])

export function registerWorldManageTool(): void {
  const tool: RegisteredTool = {
    name: 'world_manage',
    title: 'World Manage',
    version: '1.0.0',
    description:
      'World state — threads, relationships, factions, knowledge, locations, and convergence checks. Actions: thread_tick, get_relationship, get_faction_standing, get_entity_knowledge, get_location_occupants, get_reachable_locations, sense_environment, get_thread_comparison, check_convergence',
    category: 'lore',
    inputSchema: InputSchema,
    handler: handle_world_manage,
  }
  registerTool(tool)
}
