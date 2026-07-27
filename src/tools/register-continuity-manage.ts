import { registerTool, type RegisteredTool } from './register'
import { handle_continuity_manage } from './continuity-manage'
import { z } from 'zod'

const appendEventSchema = z.object({
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

const getEventLogSchema = z.object({
  action: z.literal('get_event_log'),
  entity_key: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  thread: z.string().optional(),
  verbs: z.array(z.string()).optional(),
  tier: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

const taxonomyListSchema = z.object({
  action: z.literal('taxonomy_list'),
  tier: z.enum(['high', 'medium', 'low']).optional(),
  category: z.string().optional(),
})

const taxonomySetSchema = z.object({
  action: z.literal('taxonomy_set'),
  verb: z.string().min(1),
  tier: z.enum(['high', 'medium', 'low']),
  category: z.string().min(1),
  description: z.string().optional(),
})

const taxonomyDeleteSchema = z.object({
  action: z.literal('taxonomy_delete'),
  verb: z.string().min(1),
})

const recentChangesSchema = z.object({
  action: z.literal('recent_changes'),
  since: z.string().optional(),
  key_prefix: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

const tagTopicSchema = z.object({
  action: z.literal('tag_topic'),
  key: z.string().min(1),
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
})

const findByTagSchema = z.object({
  action: z.literal('find_by_tag'),
  tags: z.array(z.string().min(1)).min(1),
  mode: z.enum(['any', 'all']).optional(),
  with_excerpt: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

const listTagsSchema = z.object({
  action: z.literal('list_tags'),
  prefix: z.string().optional(),
  with_counts: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
})

const bookmarkStateSchema = z.object({
  action: z.literal('bookmark_state'),
  name: z.string().min(1),
  key_prefix: z.string().optional(),
  note: z.string().optional(),
})

const worldDiffSchema = z.object({
  action: z.literal('world_diff'),
  from: z.string().min(1),
  to: z.string().optional(),
  detail: z.enum(['summary', 'fields', 'text']).optional(),
  key_prefix: z.string().optional(),
})

// plant_setup: id OR setup_id — modeled as 2 variants
const plantSetupId = z.object({
  action: z.literal('plant_setup'),
  id: z.string().min(1),
  description: z.string().min(1),
  setup_id: z.string().min(1).optional(),
  planted_in: z.string().optional(),
  tension: z.number().int().min(1).max(5).optional(),
  expected_in: z.string().optional(),
  actors: z.array(z.string()).optional(),
  payoff_type: z.string().optional(),
})

const plantSetupSetupId = z.object({
  action: z.literal('plant_setup'),
  setup_id: z.string().min(1),
  description: z.string().min(1),
  id: z.string().min(1).optional(),
  planted_in: z.string().optional(),
  tension: z.number().int().min(1).max(5).optional(),
  expected_in: z.string().optional(),
  actors: z.array(z.string()).optional(),
  payoff_type: z.string().optional(),
})

const payOffSetupSchema = z.object({
  action: z.literal('pay_off_setup'),
  id: z.string().min(1),
  resolution: z.string().min(1),
  paid_in: z.string().optional(),
  status: z.enum(['paid', 'abandoned', 'deferred']).optional(),
})

const listUnpaidSetupsSchema = z.object({
  action: z.literal('list_unpaid_setups'),
  actor: z.string().optional(),
  scope: z.enum(['scene', 'chapter', 'story']).optional(),
  min_tension: z.number().int().min(1).max(5).optional(),
})

// set_goal: THREE independent OR-pairs. Deliberate fidelity loss — all six
// aliased fields are optional in a single flat object. The handler's existing
// runtime check enforces the OR requirement. Building the 8-way combinatorial
// union would be verbose and fragile for no validation benefit.
const setGoalSchema = z.object({
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

const checkContinuitySchema = z.object({
  action: z.literal('check_continuity'),
  scope: z.string().optional(),
  checks: z.array(z.enum(['dangling', 'occupancy', 'knowledge', 'inventory'])).optional(),
  severity_floor: z
    .enum(['info', 'warn', 'error', 'low', 'medium', 'moderate', 'high', 'critical'])
    .optional(),
})

// continuity_manage uses z.union at the top level instead of z.discriminatedUnion
// because plant_setup has an OR-alias variant (id OR setup_id) that requires
// multiple objects with the same action literal but different required fields.
export const InputSchema = z.union([
  appendEventSchema,
  getEventLogSchema,
  taxonomyListSchema,
  taxonomySetSchema,
  taxonomyDeleteSchema,
  recentChangesSchema,
  tagTopicSchema,
  findByTagSchema,
  listTagsSchema,
  bookmarkStateSchema,
  worldDiffSchema,
  plantSetupId,
  plantSetupSetupId,
  payOffSetupSchema,
  listUnpaidSetupsSchema,
  setGoalSchema,
  checkContinuitySchema,
])

export function registerContinuityManageTool(): void {
  const tool: RegisteredTool = {
    name: 'continuity_manage',
    title: 'Continuity Manage',
    version: '1.0.0',
    description:
      'Continuity tracking — events, tags, bookmarks, world diff, setups, goals, and continuity checks. Actions: append_event, get_event_log, taxonomy_list, taxonomy_set, taxonomy_delete, recent_changes, tag_topic, find_by_tag, list_tags, bookmark_state, world_diff, plant_setup, pay_off_setup, list_unpaid_setups, set_goal, check_continuity.',
    category: 'lore',
    inputSchema: InputSchema,
    handler: handle_continuity_manage,
  }
  registerTool(tool)
}
