import { registerTool, type RegisteredTool } from './register'
import { handle_entity_manage } from './entity-manage'
import { z } from 'zod'

const generateSchema = z.object({
  action: z.literal('generate'),
  archetype_key: z.string().min(1),
  location_key: z.string().optional(),
})

const moveSchema = z.object({
  action: z.literal('move'),
  entity_key: z.string().min(1),
  new_location_key: z.string().min(1),
})

const rollEncounterSchema = z.object({
  action: z.literal('roll_encounter'),
  location_key: z.string().min(1),
  threat_level: z.number().int().min(1).max(10).optional(),
})

const advanceStageSchema = z.object({
  action: z.literal('advance_stage'),
  entity_key: z.string().min(1),
})

const batchStageSchema = z.object({
  action: z.literal('batch_stage'),
  location_key: z.string().min(1),
})

const getInventorySchema = z.object({
  action: z.literal('get_inventory'),
  entity_key: z.string().min(1),
})

const transferItemSchema = z.object({
  action: z.literal('transfer_item'),
  from_entity: z.string().min(1),
  to_entity: z.string().min(1),
  item_key: z.string().min(1),
  quantity: z.number().int().min(1).optional(),
})

const getSensoryProfileSchema = z.object({
  action: z.literal('get_sensory_profile'),
  entity_key: z.string().min(1),
})

const setSensoryProfileSchema = z.object({
  action: z.literal('set_sensory_profile'),
  entity_key: z.string().min(1),
  temperature: z.string().optional(),
  scent: z.string().optional(),
  texture: z.string().optional(),
  sound_signature: z.string().optional(),
  visual_descriptors: z.string().optional(),
  composite: z.string().optional(),
})

const getCompatibilitySchema = z.object({
  action: z.literal('get_compatibility'),
  entity_a: z.string().min(1),
  entity_b: z.string().min(1),
  interaction_type: z.string().min(1),
})

const analyzeUtilitySchema = z.object({
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

const listConsumptionTimelinesSchema = z.object({
  action: z.literal('list_consumption_timelines'),
  status_filter: z
    .enum(['all', 'imminent', 'days-to-weeks', 'weeks-to-months', 'consumed'])
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
})

const createConsumptionTimelineSchema = z.object({
  action: z.literal('create_consumption_timeline'),
  entity_key: z.string().min(1),
  predator_key: z.string().min(1),
  stages: z.number().int().min(1).max(20),
  stage_timer: z.number().int().min(1),
  terminal_state: z.string().min(1),
  current_stage: z.number().int().min(0).optional(),
})

const setConsumptionTimelineSchema = z.object({
  action: z.literal('set_consumption_timeline'),
  entity_key: z.string().min(1),
  predator_key: z.string().min(1).optional(),
  stages: z.number().int().min(1).max(20).optional(),
  stage_timer: z.number().int().min(0).optional(),
  current_stage: z.number().int().min(0).optional(),
  terminal_state: z.string().min(1).optional(),
})

const listActiveThreadsSchema = z.object({
  action: z.literal('list_active_threads'),
})

const resolveInteractionSchema = z.object({
  action: z.literal('resolve_interaction'),
  entity_a_id: z.string().min(1),
  entity_b_id: z.string().min(1),
  action_type: z.string().min(1),
})

const destroySchema = z.object({
  action: z.literal('destroy'),
  entity_key: z.string().min(1),
})

const getAttributesSchema = z.object({
  action: z.literal('get_attributes'),
  entity_key: z.string().min(1),
})

const setAttributesSchema = z.object({
  action: z.literal('set_attributes'),
  entity_key: z.string().min(1),
  attributes: z.record(z.string(), z.number()).refine((a) => Object.keys(a).length > 0, {
    message: 'attributes must have at least one field',
  }),
  merge: z.boolean().optional(),
})

export const InputSchema = z.discriminatedUnion('action', [
  generateSchema,
  moveSchema,
  rollEncounterSchema,
  advanceStageSchema,
  batchStageSchema,
  getInventorySchema,
  transferItemSchema,
  getSensoryProfileSchema,
  setSensoryProfileSchema,
  getCompatibilitySchema,
  analyzeUtilitySchema,
  listConsumptionTimelinesSchema,
  createConsumptionTimelineSchema,
  setConsumptionTimelineSchema,
  listActiveThreadsSchema,
  resolveInteractionSchema,
  destroySchema,
  getAttributesSchema,
  setAttributesSchema,
])

export function registerEntityManageTool(): void {
  const tool: RegisteredTool = {
    name: 'entity_manage',
    title: 'Entity Manage',
    version: '1.0.0',
    description:
      'Entity lifecycle — generate, move, inventory, encounters, consumption timelines, and interaction resolution. Actions: generate, move, roll_encounter, advance_stage, batch_stage, get_inventory, transfer_item, get_sensory_profile, set_sensory_profile, get_compatibility, analyze_utility, list_consumption_timelines, create_consumption_timeline, set_consumption_timeline, list_active_threads, resolve_interaction, destroy, get_attributes, set_attributes.',
    category: 'lore',
    inputSchema: InputSchema,
    handler: handle_entity_manage,
  }
  registerTool(tool)
}
