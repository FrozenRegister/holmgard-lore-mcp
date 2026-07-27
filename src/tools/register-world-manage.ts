import { registerTool, type RegisteredTool } from './register'
import { handle_world_manage } from './world-manage'
import { z } from 'zod'

const threadTickSchema = z.object({
  action: z.literal('thread_tick'),
  thread_id: z.string().min(1),
})

const getRelationshipSchema = z.object({
  action: z.literal('get_relationship'),
  entity_a: z.string().min(1),
  entity_b: z.string().min(1),
})

// get_faction_standing: (entity_key OR entity_name) AND (faction_key OR faction_name)
// Modeled as 4 variants since z.discriminatedUnion cannot accept z.union options.
const getFactionStandingEntityKeyFactionKey = z.object({
  action: z.literal('get_faction_standing'),
  entity_key: z.string().min(1),
  faction_key: z.string().min(1),
  entity_name: z.string().min(1).optional(),
  faction_name: z.string().min(1).optional(),
})

const getFactionStandingEntityKeyFactionName = z.object({
  action: z.literal('get_faction_standing'),
  entity_key: z.string().min(1),
  faction_name: z.string().min(1),
  entity_name: z.string().min(1).optional(),
  faction_key: z.string().min(1).optional(),
})

const getFactionStandingEntityNameFactionKey = z.object({
  action: z.literal('get_faction_standing'),
  entity_name: z.string().min(1),
  faction_key: z.string().min(1),
  entity_key: z.string().min(1).optional(),
  faction_name: z.string().min(1).optional(),
})

const getFactionStandingEntityNameFactionName = z.object({
  action: z.literal('get_faction_standing'),
  entity_name: z.string().min(1),
  faction_name: z.string().min(1),
  entity_key: z.string().min(1).optional(),
  faction_key: z.string().min(1).optional(),
})

// get_entity_knowledge: entity_key OR entity_name
const getEntityKnowledgeEntityKey = z.object({
  action: z.literal('get_entity_knowledge'),
  entity_key: z.string().min(1),
  topic: z.string().min(1),
  entity_name: z.string().min(1).optional(),
})

const getEntityKnowledgeEntityName = z.object({
  action: z.literal('get_entity_knowledge'),
  entity_name: z.string().min(1),
  topic: z.string().min(1),
  entity_key: z.string().min(1).optional(),
})

// get_location_occupants: location_key OR location_id
const getLocationOccupantsLocationKey = z.object({
  action: z.literal('get_location_occupants'),
  location_key: z.string().min(1),
  location_id: z.string().min(1).optional(),
})

const getLocationOccupantsLocationId = z.object({
  action: z.literal('get_location_occupants'),
  location_id: z.string().min(1),
  location_key: z.string().min(1).optional(),
})

const getReachableLocationsSchema = z.object({
  action: z.literal('get_reachable_locations'),
  origin_key: z.string().min(1),
})

// sense_environment: entity_key OR entity_name
const senseEnvironmentEntityKey = z.object({
  action: z.literal('sense_environment'),
  location_key: z.string().min(1),
  entity_key: z.string().min(1),
  entity_name: z.string().min(1).optional(),
  radius: z.string().optional(),
})

const senseEnvironmentEntityName = z.object({
  action: z.literal('sense_environment'),
  location_key: z.string().min(1),
  entity_name: z.string().min(1),
  entity_key: z.string().min(1).optional(),
  radius: z.string().optional(),
})

const getThreadComparisonSchema = z.object({
  action: z.literal('get_thread_comparison'),
  thread_a: z.string().min(1),
  thread_b: z.string().min(1),
})

const checkConvergenceSchema = z.object({
  action: z.literal('check_convergence'),
  thread_a: z.string().min(1),
  thread_b: z.string().min(1),
})

// world_manage uses z.union at the top level instead of z.discriminatedUnion
// because 4 of its actions have OR-alias variants that require multiple
// objects with the same action literal but different required fields.
// z.discriminatedUnion cannot accept z.union options (it calls
// option.shape[discriminator].value which doesn't exist on z.union).
export const InputSchema = z.union([
  threadTickSchema,
  getRelationshipSchema,
  getFactionStandingEntityKeyFactionKey,
  getFactionStandingEntityKeyFactionName,
  getFactionStandingEntityNameFactionKey,
  getFactionStandingEntityNameFactionName,
  getEntityKnowledgeEntityKey,
  getEntityKnowledgeEntityName,
  getLocationOccupantsLocationKey,
  getLocationOccupantsLocationId,
  getReachableLocationsSchema,
  senseEnvironmentEntityKey,
  senseEnvironmentEntityName,
  getThreadComparisonSchema,
  checkConvergenceSchema,
])

export function registerWorldManageTool(): void {
  const tool: RegisteredTool = {
    name: 'world_manage',
    title: 'World Manage',
    version: '1.0.0',
    description:
      'World state — threads, relationships, factions, knowledge, locations, and convergence checks. Actions: thread_tick, get_relationship, get_faction_standing, get_entity_knowledge, get_location_occupants, get_reachable_locations, sense_environment, get_thread_comparison, check_convergence.',
    category: 'lore',
    inputSchema: InputSchema,
    handler: handle_world_manage,
  }
  registerTool(tool)
}
