// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/batch-manage.ts

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = ['batch_create_characters', 'batch_create_npcs', 'batch_distribute_items', 'execute_workflow', 'list_templates', 'get_template'] as const
type BatchAction = typeof ACTIONS[number]
const ALIASES: Record<string, BatchAction> = {
  bulk_characters: 'batch_create_characters', create_characters: 'batch_create_characters', many_characters: 'batch_create_characters',
  bulk_npcs: 'batch_create_npcs', create_npcs: 'batch_create_npcs', many_npcs: 'batch_create_npcs',
  distribute: 'batch_distribute_items', give_items: 'batch_distribute_items', bulk_items: 'batch_distribute_items',
  workflow: 'execute_workflow', run_workflow: 'execute_workflow',
  templates: 'list_templates', all_templates: 'list_templates',
  template: 'get_template', fetch_template: 'get_template',
}

const CharacterSpec = z.object({
  name: z.string(),
  level: z.number().int().min(1).max(20).optional().default(1),
  characterClass: z.string().optional().default('Fighter'),
  race: z.string().optional().default('Human'),
  characterType: z.enum(['pc', 'npc', 'enemy', 'neutral']).optional().default('npc'),
})

const ItemDistribution = z.object({
  characterId: z.string(),
  itemId: z.string(),
  quantity: z.number().int().min(1).optional().default(1),
})

const WorkflowStep = z.object({
  tool: z.string(),
  args: z.record(z.unknown()),
})

const InputSchema = z.object({
  action: z.string(),
  characters: z.array(CharacterSpec).optional().default([]),
  distributions: z.array(ItemDistribution).optional().default([]),
  steps: z.array(WorkflowStep).optional().default([]),
  templateId: z.string().optional(),
  templateName: z.string().optional(),
  category: z.string().optional(),
})

const BUILT_IN_TEMPLATES = [
  { id: 'party-4', name: 'Standard Party (4 PCs)', category: 'party', description: 'Warrior, Mage, Rogue, Cleric' },
  { id: 'dungeon-guards', name: 'Dungeon Guards (6 NPCs)', category: 'encounter', description: '4 guards + 2 lieutenants' },
  { id: 'merchant-caravan', name: 'Merchant Caravan', category: 'npc', description: 'Merchant, 2 guards, handler' },
  { id: 'bandit-gang', name: 'Bandit Gang', category: 'encounter', description: 'Leader + 5 bandits' },
]

export async function handleBatchManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'batch_create_characters':
    case 'batch_create_npcs': {
      if (a.characters.length === 0) return err('"characters" array is required and must not be empty')
      const created: Array<{ id: string; name: string }> = []
      const errors: string[] = []
      for (const spec of a.characters) {
        try {
          const id = randomUUID()
          const maxHp = spec.level * 8
          await db.prepare('INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(id, spec.name, '{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10}', maxHp, maxHp, 10, spec.level, spec.characterType, spec.characterClass, spec.race, '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{"gold":0,"silver":0,"copper":0}', '{}', 0, now, now).run()
          created.push({ id, name: spec.name })
        } catch (e) {
          errors.push(`Failed to create "${spec.name}": ${e instanceof Error ? e.message : 'unknown error'}`)
        }
      }
      return ok({ success: true, actionType: match.matched, created, errors, successCount: created.length, errorCount: errors.length })
    }
    case 'batch_distribute_items': {
      if (a.distributions.length === 0) return err('"distributions" array is required')
      const results: Array<{ characterId: string; itemId: string; success: boolean; error?: string }> = []
      for (const dist of a.distributions) {
        try {
          await db.prepare('INSERT INTO inventory_items (character_id, item_id, quantity, slot) VALUES (?, ?, ?, ?) ON CONFLICT(character_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity')
            .bind(dist.characterId, dist.itemId, dist.quantity, null).run()
          results.push({ characterId: dist.characterId, itemId: dist.itemId, success: true })
        } catch (e) {
          results.push({ characterId: dist.characterId, itemId: dist.itemId, success: false, error: e instanceof Error ? e.message : 'unknown' })
        }
      }
      return ok({ success: true, actionType: 'batch_distribute_items', results, successCount: results.filter(r => r.success).length, errorCount: results.filter(r => !r.success).length })
    }
    case 'execute_workflow': {
      if (a.steps.length === 0) return err('"steps" array is required')
      const stepResults: Array<{ step: number; tool: string; success: boolean; error?: string }> = []
      for (let i = 0; i < a.steps.length; i++) {
        const step = a.steps[i]
        stepResults.push({ step: i, tool: step.tool, success: true })
      }
      return ok({ success: true, actionType: 'execute_workflow', stepsExecuted: a.steps.length, stepResults, note: 'Workflow recorded; individual tool calls must be made separately via tools/call' })
    }
    case 'list_templates': {
      const filtered = a.category ? BUILT_IN_TEMPLATES.filter(t => t.category === a.category) : BUILT_IN_TEMPLATES
      return ok({ success: true, actionType: 'list_templates', templates: filtered, count: filtered.length })
    }
    case 'get_template': {
      if (!a.templateId && !a.templateName) return err('"templateId" or "templateName" is required')
      const tmpl = a.templateId
        ? BUILT_IN_TEMPLATES.find(t => t.id === a.templateId)
        : BUILT_IN_TEMPLATES.find(t => t.name.toLowerCase().includes((a.templateName ?? '').toLowerCase()))
      if (!tmpl) return err(`Template not found: ${a.templateId ?? a.templateName}`)
      const templateData: Record<string, unknown> = {
        'party-4': { characters: [{ name: 'Warrior', characterClass: 'Fighter', characterType: 'pc' }, { name: 'Mage', characterClass: 'Wizard', characterType: 'pc' }, { name: 'Rogue', characterClass: 'Rogue', characterType: 'pc' }, { name: 'Cleric', characterClass: 'Cleric', characterType: 'pc' }] },
        'dungeon-guards': { characters: [{ name: 'Guard 1', characterClass: 'Fighter', characterType: 'enemy' }, { name: 'Guard 2', characterClass: 'Fighter', characterType: 'enemy' }, { name: 'Guard 3', characterClass: 'Fighter', characterType: 'enemy' }, { name: 'Guard 4', characterClass: 'Fighter', characterType: 'enemy' }, { name: 'Lieutenant 1', characterClass: 'Fighter', level: 3, characterType: 'enemy' }, { name: 'Lieutenant 2', characterClass: 'Fighter', level: 3, characterType: 'enemy' }] },
        'merchant-caravan': { characters: [{ name: 'Merchant', characterClass: 'Commoner', characterType: 'npc' }, { name: 'Guard', characterClass: 'Fighter', characterType: 'npc' }, { name: 'Guard', characterClass: 'Fighter', characterType: 'npc' }, { name: 'Handler', characterClass: 'Commoner', characterType: 'npc' }] },
        'bandit-gang': { characters: [{ name: 'Bandit Leader', characterClass: 'Fighter', level: 3, characterType: 'enemy' }, ...Array.from({ length: 5 }, (_, i) => ({ name: `Bandit ${i + 1}`, characterClass: 'Fighter', characterType: 'enemy' as const }))] },
      }
      return ok({ success: true, actionType: 'get_template', template: tmpl, data: templateData[tmpl.id] ?? {} })
    }
  }
}
