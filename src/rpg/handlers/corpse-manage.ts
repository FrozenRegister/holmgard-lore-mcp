// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/corpse-manage.ts
//
// Corpse Ecology (#288) extends this handler with Preserve-specific actions
// (register/decompose/scavenge_check/loot_corpse/recover/get_state/
// psychological_impact) additive to the legacy D&D create/get/list/loot/
// decay/generate_loot/delete actions — see migration 0014's header comment
// for why loot is tracked as a JSON snapshot rather than corpse_inventory
// (FK'd to the wrong item system) or resource_inventory (CHECK constraint).
//
// Design decisions made explicitly (not fully specified by the issue):
// - `decompose` recomputes stage fresh from `death_at` + elapsed hours each
//   call (same "recompute, don't accumulate" pattern as production-manage's
//   perimeter/hazard) rather than incrementally advancing a state machine.
// - Disease-risk DCs/names and scavenger-attraction percentages per stage
//   are transcribed directly from the issue's tables. Psychological-impact
//   DCs are only given for 4 of the 6 stages (fresh/bloat/active_decay,
//   stranger, plus fresh/party_member) — the given values factor cleanly
//   into `stageBaseDC + (party_member ? 6 : 0)`, so early/advanced_decay/
//   skeletal's base DCs (11/13/11) are this PR's own interpolation using
//   that same formula, documented here rather than guessed silently.
// - `recover` requires the corpse already be at Bloat stage or later (per
//   the issue's "checked at Bloat stage onward"), but does not itself roll
//   the daily 25%-chance/audience-vote-acceleration — that would require
//   wiring a new per-corpse daily check into production.advance_day beyond
//   what the issue's own integration contract asks for. The caller (narrator
//   or a future production-cycle extension) decides when to call `recover`.
// - Disease exposure from `loot_corpse` is returned as data, never applied
//   to the looter's character record automatically — matching #280/#286/
//   #287's established restraint against mutating character state from a
//   mechanics/resolution handler.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'
import { handleResourceManage } from './resource-manage'

const ACTIONS = [
  'create', 'get', 'list', 'loot', 'decay', 'generate_loot', 'delete',
  'register', 'decompose', 'scavenge_check', 'loot_corpse', 'recover', 'get_state', 'psychological_impact',
] as const
type CorpseAction = typeof ACTIONS[number]
const ALIASES: Record<string, CorpseAction> = {
  ...CRUD_ALIASES,
  spawn_corpse: 'create', add_corpse: 'create',
  pillage: 'loot', search: 'loot',
  rot: 'decay', advance_decay: 'decay',
  roll_loot: 'generate_loot', drop_loot: 'generate_loot',
  die: 'register', record_death: 'register',
  tick_decomposition: 'decompose', advance_decomposition: 'decompose',
  check_scavengers: 'scavenge_check',
  plunder: 'loot_corpse', loot_preserve: 'loot_corpse',
  production_recover: 'recover', memorial_recover: 'recover',
  preserve_state: 'get_state',
  wis_save: 'psychological_impact', trauma_check: 'psychological_impact',
} as Record<string, CorpseAction>

const DECAY_STATES = ['fresh', 'decaying', 'skeletal', 'gone'] as const

const RECOVERY_TYPES = ['memorial_package', 'warning_display', 'trophy_recovery', 'research_recovery'] as const
const RELATIONSHIPS = ['stranger', 'party_member', 'betrayed_them', 'saved_them'] as const

interface DecompositionStage {
  name: 'fresh' | 'early' | 'bloat' | 'active_decay' | 'advanced_decay' | 'skeletal'
  minHours: number
  diseaseRisk: number
  diseaseDC: number | null
  disease: string | null
  scavengerAttraction: number
  lootDC: number
  lootDescription: string
}

// Transcribed from the issue's "Decomposition Stages" and "Corpse Loot
// Table" (lootDC/lootDescription come from the latter, which gives cleaner
// numeric DEX DCs than the former's prose).
const STAGES: DecompositionStage[] = [
  { name: 'fresh', minHours: 0, diseaseRisk: 0, diseaseDC: null, disease: null, scavengerAttraction: 0, lootDC: 8, lootDescription: 'All inventory, band (data), clothing.' },
  { name: 'early', minHours: 6, diseaseRisk: 5, diseaseDC: 10, disease: 'wound_infection', scavengerAttraction: 10, lootDC: 10, lootDescription: 'All inventory, band (data corrupted), clothing (stained).' },
  { name: 'bloat', minHours: 24, diseaseRisk: 25, diseaseDC: 14, disease: 'blood_poisoning', scavengerAttraction: 25, lootDC: 14, lootDescription: '50% inventory (contaminated), band (dead), clothing (ruined).' },
  { name: 'active_decay', minHours: 72, diseaseRisk: 50, diseaseDC: 16, disease: 'preserve_rot', scavengerAttraction: 40, lootDC: 16, lootDescription: '20% inventory (heavily contaminated).' },
  { name: 'advanced_decay', minHours: 168, diseaseRisk: 10, diseaseDC: 12, disease: 'tetanus', scavengerAttraction: 10, lootDC: 12, lootDescription: 'Metal items only.' },
  { name: 'skeletal', minHours: 336, diseaseRisk: 0, diseaseDC: null, disease: null, scavengerAttraction: 5, lootDC: 10, lootDescription: 'Metal items, bone fragments (crafting material).' },
]

// See file header — fresh/bloat/active_decay are the issue's own given
// values; early/advanced_decay/skeletal are this PR's interpolation using
// the same `base + (party_member ? 6 : 0)` formula the given values satisfy.
const STAGE_BASE_DC: Record<DecompositionStage['name'], number> = {
  fresh: 10, early: 11, bloat: 12, active_decay: 14, advanced_decay: 13, skeletal: 11,
}

function stageFromHours(hours: number): DecompositionStage {
  let stage = STAGES[0]
  for (const s of STAGES) if (hours >= s.minHours) stage = s
  return stage
}

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  characterId: z.string().optional(),
  characterName: z.string().optional(),
  characterType: z.string().optional().default('npc'),
  worldId: z.string().optional(),
  // #377 — accept snake_case world_id as an alias for camelCase worldId
  world_id: z.string().optional(),
  encounterId: z.string().optional(),
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
  state: z.enum(DECAY_STATES).optional(),
  lootedBy: z.string().optional(),
  filter: z.enum(['all', 'fresh', 'unlooted']).optional().default('all'),
  worldIdFilter: z.string().optional(),
  // #288 — register
  deathAt: z.string().optional(),
  causeOfDeath: z.string().optional(),
  // #288 — decompose
  hoursSinceDeath: z.number().min(0).optional(),
  // #288 — loot_corpse
  looterCharacterId: z.string().optional(),
  dexModifier: z.number().optional().default(0),
  rollValue: z.number().int().min(1).max(20).optional(),
  // #288 — recover
  recoveryType: z.enum(RECOVERY_TYPES).optional(),
  // #288 — psychological_impact
  observerCharacterId: z.string().optional(),
  relationship: z.enum(RELATIONSHIPS).optional().default('stranger'),
  multipleCorpses: z.boolean().optional().default(false),
  wisModifier: z.number().optional().default(0),
})

// Batch decomposition tick, shared with production-manage.ts's advance_day
// (#283 integration contract step "tick corpse decomposition → call
// corpse.decompose" — deferred as a documented no-op in #299 since #288
// hadn't shipped yet; wired in for real here).
export async function tickAllCorpseDecomposition(db: D1Database, worldId: string, now: string): Promise<Array<{ corpseId: string; previousStage: string; newStage: string; isLandmark: boolean }>> {
  const { results } = await db.prepare('SELECT id, death_at, decomposition_stage FROM corpses WHERE world_id = ? AND recovered = 0 AND death_at IS NOT NULL')
    .bind(worldId).all() as { results: Array<{ id: string; death_at: string; decomposition_stage: string }> }
  const out: Array<{ corpseId: string; previousStage: string; newStage: string; isLandmark: boolean }> = []
  for (const c of results) {
    const hoursSinceDeath = (new Date(now).getTime() - new Date(c.death_at).getTime()) / 3_600_000
    const stage = stageFromHours(hoursSinceDeath)
    const isLandmark = stage.name === 'advanced_decay' || stage.name === 'skeletal'
    await db.prepare('UPDATE corpses SET decomposition_stage = ?, is_landmark = ?, updated_at = ? WHERE id = ?').bind(stage.name, isLandmark ? 1 : 0, now, c.id).run()
    out.push({ corpseId: c.id, previousStage: c.decomposition_stage, newStage: stage.name, isLandmark })
  }
  return out
}

export async function handleCorpseManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  // #377 — normalize snake_case world_id → camelCase worldId
  if (a.worldId === undefined && a.world_id !== undefined) a.worldId = a.world_id
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.characterId || !a.characterName) return err('"characterId" and "characterName" are required')
      const id = crypto.randomUUID()
      await db.prepare(`INSERT INTO corpses (id, character_id, character_name, character_type, world_id, encounter_id, position_x, position_y, state, state_updated_at, harvestable_resources, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fresh', ?, '[]', ?, ?)`)
        .bind(id, a.characterId, a.characterName, a.characterType, a.worldId ?? null, a.encounterId ?? null, a.positionX ?? null, a.positionY ?? null, now, now, now).run()
      return ok({ success: true, actionType: 'create', corpseId: id, characterName: a.characterName, state: 'fresh' })
    }
    case 'get': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT * FROM corpses WHERE id = ?').bind(a.id).first()
      if (!row) return err(`Corpse not found: ${a.id}`)
      const { results: loot } = await db.prepare('SELECT ci.item_id, ci.quantity, ci.looted, i.name FROM corpse_inventory ci JOIN items i ON ci.item_id = i.id WHERE ci.corpse_id = ?').bind(a.id).all()
      return ok({ success: true, actionType: 'get', corpse: { ...row, harvestable_resources: JSON.parse((row as any).harvestable_resources ?? '[]') }, loot })
    }
    case 'list': {
      let query = 'SELECT id, character_name, character_type, state, looted, world_id, encounter_id FROM corpses WHERE 1=1'
      const binds: unknown[] = []
      if (a.worldIdFilter) { query += ' AND world_id = ?'; binds.push(a.worldIdFilter) }
      if (a.filter === 'fresh') { query += " AND state = 'fresh'" }
      if (a.filter === 'unlooted') { query += ' AND looted = 0' }
      const { results } = await db.prepare(query + ' ORDER BY created_at DESC').bind(...binds).all()
      return ok({ success: true, actionType: 'list', corpses: results, count: results.length })
    }
    case 'loot': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE corpses SET looted = 1, looted_by = ?, looted_at = ?, updated_at = ? WHERE id = ?').bind(a.lootedBy ?? 'unknown', now, now, a.id).run()
      await db.prepare('UPDATE corpse_inventory SET looted = 1 WHERE corpse_id = ?').bind(a.id).run()
      const { results: items } = await db.prepare('SELECT item_id, quantity FROM corpse_inventory WHERE corpse_id = ?').bind(a.id).all()
      return ok({ success: true, actionType: 'loot', corpseId: a.id, itemsLooted: items })
    }
    case 'decay': {
      if (!a.id) return err('"id" is required')
      const row = await db.prepare('SELECT state FROM corpses WHERE id = ?').bind(a.id).first() as { state: string } | null
      if (!row) return err(`Corpse not found: ${a.id}`)
      const idx = DECAY_STATES.indexOf(row.state as typeof DECAY_STATES[number])
      const nextState = idx < DECAY_STATES.length - 1 ? DECAY_STATES[idx + 1] : 'gone'
      await db.prepare('UPDATE corpses SET state = ?, state_updated_at = ?, updated_at = ? WHERE id = ?').bind(nextState, now, now, a.id).run()
      return ok({ success: true, actionType: 'decay', corpseId: a.id, previousState: row.state, newState: nextState })
    }
    case 'generate_loot': {
      if (!a.id) return err('"id" is required')
      await db.prepare('UPDATE corpses SET loot_generated = 1, updated_at = ? WHERE id = ?').bind(now, a.id).run()
      return ok({ success: true, actionType: 'generate_loot', corpseId: a.id, note: 'Loot generation is handled by combat logic. Mark corpse inventory items manually.' })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      await db.prepare('DELETE FROM corpses WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', id: a.id })
    }
    case 'register': {
      if (!a.characterId || !a.characterName) return err('"characterId" and "characterName" are required')
      const deathAt = a.deathAt ?? now
      const snapshotRes = await handleResourceManage(env, { action: 'get_state', ownerType: 'character', ownerId: a.characterId })
      const snapshotBody = JSON.parse(snapshotRes.content[0].text) as { success?: boolean; inventory?: Array<{ item_name: string; category: string; quantity: number }> }
      const snapshot = snapshotBody.success && snapshotBody.inventory
        ? snapshotBody.inventory.map(i => ({ itemName: i.item_name, category: i.category, quantity: i.quantity }))
        : []
      const id = crypto.randomUUID()
      await db.prepare(`INSERT INTO corpses (id, character_id, character_name, character_type, world_id, encounter_id, position_x, position_y, state, state_updated_at, harvestable_resources, created_at, updated_at, death_at, cause_of_death, decomposition_stage, preserve_inventory_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'fresh', ?, '[]', ?, ?, ?, ?, 'fresh', ?)`)
        .bind(id, a.characterId, a.characterName, a.characterType, a.worldId ?? null, a.encounterId ?? null, a.positionX ?? null, a.positionY ?? null, now, now, now, deathAt, a.causeOfDeath ?? null, JSON.stringify(snapshot)).run()
      return ok({
        success: true, actionType: 'register', corpseId: id, characterName: a.characterName,
        deathAt, causeOfDeath: a.causeOfDeath ?? null, inventorySnapshot: snapshot, decompositionStage: 'fresh',
      })
    }
    case 'decompose': {
      if (!a.id) return err('"id" (corpse UUID) is required. Optional: "hoursSinceDeath" (number) to override the computed elapsed time')
      const row = await db.prepare('SELECT death_at, decomposition_stage, recovered FROM corpses WHERE id = ?').bind(a.id).first() as { death_at: string | null; decomposition_stage: string; recovered: number } | null
      if (!row) return err(`Corpse not found: ${a.id}`)
      if (row.recovered) return err(`Corpse ${a.id} has already been recovered by Production and is no longer tracked`)
      const deathAtMs = row.death_at ? new Date(row.death_at).getTime() : new Date(now).getTime()
      const hoursSinceDeath = a.hoursSinceDeath ?? (new Date(now).getTime() - deathAtMs) / 3_600_000
      const stage = stageFromHours(hoursSinceDeath)
      const isLandmark = stage.name === 'advanced_decay' || stage.name === 'skeletal'
      await db.prepare('UPDATE corpses SET decomposition_stage = ?, is_landmark = ?, updated_at = ? WHERE id = ?').bind(stage.name, isLandmark ? 1 : 0, now, a.id).run()
      return ok({
        success: true, actionType: 'decompose', corpseId: a.id, hoursSinceDeath,
        previousStage: row.decomposition_stage, decompositionStage: stage.name, isLandmark,
        diseaseRiskPercent: stage.diseaseRisk, scavengerAttractionPercent: stage.scavengerAttraction,
      })
    }
    case 'scavenge_check': {
      if (!a.worldId || a.positionX === undefined || a.positionY === undefined) return err('"worldId", "positionX", and "positionY" are required')
      const { results } = await db.prepare('SELECT id, decomposition_stage FROM corpses WHERE world_id = ? AND position_x = ? AND position_y = ? AND recovered = 0')
        .bind(a.worldId, a.positionX, a.positionY).all() as { results: Array<{ id: string; decomposition_stage: string }> }
      let totalAttraction = 0
      const breakdown: Array<{ corpseId: string; stage: string; attractionPercent: number }> = []
      for (const c of results) {
        const stage = STAGES.find(s => s.name === c.decomposition_stage) ?? STAGES[0]
        totalAttraction += stage.scavengerAttraction
        breakdown.push({ corpseId: c.id, stage: stage.name, attractionPercent: stage.scavengerAttraction })
      }
      return ok({
        success: true, actionType: 'scavenge_check', worldId: a.worldId, positionX: a.positionX, positionY: a.positionY,
        corpseCount: results.length, totalScavengerAttractionPercent: totalAttraction,
        productionInterventionRecommended: results.length >= 3, corpses: breakdown,
      })
    }
    case 'loot_corpse': {
      if (!a.id) return err('"id" (corpse UUID) is required. Also requires "looterCharacterId" (character UUID doing the looting)')
      if (!a.looterCharacterId) return err('"looterCharacterId" (character UUID) is required. Optional: "dexModifier" (number), "rollValue" (1-20)')
      const row = await db.prepare('SELECT decomposition_stage, preserve_inventory_snapshot, recovered FROM corpses WHERE id = ?').bind(a.id).first() as
        { decomposition_stage: string; preserve_inventory_snapshot: string; recovered: number } | null
      if (!row) return err(`Corpse not found: ${a.id}`)
      if (row.recovered) return err(`Corpse ${a.id} has already been recovered by Production`)
      const stage = STAGES.find(s => s.name === row.decomposition_stage) ?? STAGES[0]
      const roll = a.rollValue ?? Math.floor(Math.random() * 20) + 1
      const total = roll + a.dexModifier
      const succeeded = total >= stage.lootDC
      if (!succeeded) {
        return ok({ success: true, actionType: 'loot_corpse', corpseId: a.id, roll, total, dc: stage.lootDC, succeeded: false, itemsLooted: [] })
      }

      const snapshot = JSON.parse(row.preserve_inventory_snapshot) as Array<{ itemName: string; category: string; quantity: number }>
      let lootable: Array<{ itemName: string; category: string; quantity: number }>
      if (stage.name === 'advanced_decay' || stage.name === 'skeletal') {
        lootable = snapshot.filter(i => i.category === 'tools' || i.category === 'weapon')
        if (stage.name === 'skeletal') lootable = [...lootable, { itemName: 'Bone Fragments', category: 'crafting_material', quantity: 1 }]
      } else if (stage.name === 'bloat' || stage.name === 'active_decay') {
        const fraction = stage.name === 'bloat' ? 0.5 : 0.2
        lootable = snapshot.filter(() => Math.random() < fraction)
      } else {
        lootable = snapshot
      }
      const remaining = snapshot.filter(i => !lootable.some(l => l.itemName === i.itemName))
      await db.prepare('UPDATE corpses SET preserve_inventory_snapshot = ?, looted = 1, looted_by = ?, looted_at = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(remaining), a.looterCharacterId, now, now, a.id).run()

      let diseaseExposure: { disease: string; dc: number } | null = null
      if (stage.diseaseRisk > 0 && Math.random() * 100 < stage.diseaseRisk) {
        diseaseExposure = { disease: stage.disease!, dc: stage.diseaseDC! }
      }

      return ok({ success: true, actionType: 'loot_corpse', corpseId: a.id, roll, total, dc: stage.lootDC, succeeded: true, itemsLooted: lootable, diseaseExposure })
    }
    case 'recover': {
      if (!a.id) return err('"id" (corpse UUID) is required. Optional: "recoveryType" (memorial_package | warning_display | trophy_recovery | research_recovery). Corpse must be at Bloat stage or later')
      const row = await db.prepare('SELECT decomposition_stage, recovered FROM corpses WHERE id = ?').bind(a.id).first() as { decomposition_stage: string; recovered: number } | null
      if (!row) return err(`Corpse not found: ${a.id}`)
      if (row.recovered) return err(`Corpse ${a.id} has already been recovered`)
      const eligible: string[] = ['bloat', 'active_decay', 'advanced_decay', 'skeletal']
      if (!eligible.includes(row.decomposition_stage)) return err(`Corpse must be at Bloat stage or later to be recovered (currently ${row.decomposition_stage})`)
      const recoveryType = a.recoveryType ?? RECOVERY_TYPES[Math.floor(Math.random() * RECOVERY_TYPES.length)]
      await db.prepare('UPDATE corpses SET recovered = 1, recovery_type = ?, updated_at = ? WHERE id = ?').bind(recoveryType, now, a.id).run()
      return ok({ success: true, actionType: 'recover', corpseId: a.id, recoveryType })
    }
    case 'get_state': {
      if (!a.id) return err('"id" (corpse UUID) is required. Use "list" with worldIdFilter to find corpse IDs. Example: { action: "get_state", id: "corpse-uuid" }')
      const row = await db.prepare('SELECT * FROM corpses WHERE id = ?').bind(a.id).first() as Record<string, unknown> | null
      if (!row) return err(`Corpse not found: ${a.id}`)
      const stage = STAGES.find(s => s.name === row.decomposition_stage) ?? STAGES[0]
      return ok({
        success: true, actionType: 'get_state', corpseId: a.id, characterName: row.character_name,
        decompositionStage: row.decomposition_stage, isLandmark: row.is_landmark === 1, recovered: row.recovered === 1, recoveryType: row.recovery_type,
        lootDC: stage.lootDC, lootDescription: stage.lootDescription, diseaseRiskPercent: stage.diseaseRisk, scavengerAttractionPercent: stage.scavengerAttraction,
        inventorySnapshot: JSON.parse((row.preserve_inventory_snapshot as string) ?? '[]'),
      })
    }
    case 'psychological_impact': {
      if (!a.id) return err('"id" (corpse UUID) is required')
      if (!a.observerCharacterId) return err('"observerCharacterId" (character UUID of the observer) is required. Optional: "relationship" (stranger | party_member | betrayed_them | saved_them), "wisModifier" (number), "rollValue" (1-20)')
      const row = await db.prepare('SELECT decomposition_stage FROM corpses WHERE id = ?').bind(a.id).first() as { decomposition_stage: DecompositionStage['name'] } | null
      if (!row) return err(`Corpse not found: ${a.id}`)

      let dc: number
      if (a.relationship === 'betrayed_them') dc = 18
      else if (a.relationship === 'saved_them') dc = 20
      else dc = STAGE_BASE_DC[row.decomposition_stage] + (a.relationship === 'party_member' ? 6 : 0)
      if (a.multipleCorpses) dc += 3

      const roll = a.rollValue ?? Math.floor(Math.random() * 20) + 1
      const total = roll + a.wisModifier
      const criticalFail = roll === 1
      const succeeded = !criticalFail && total >= dc
      const margin = dc - total

      let outcome: string
      let effect: string
      if (criticalFail) {
        outcome = 'break'
        effect = 'Character freezes. Cannot act for 1d4 hours. Production broadcasts the breakdown.'
      } else if (succeeded) {
        outcome = 'steady'
        effect = 'No lasting effect.'
      } else if (margin <= 4) {
        outcome = 'shaken'
        effect = '-2 to next roll.'
      } else if (margin <= 9) {
        outcome = 'disturbed'
        effect = '-1 WIS for 24 hours. Flashbacks. Sleep interrupted.'
      } else {
        outcome = 'traumatized'
        effect = '-2 WIS for 1d6 days. Disadvantage on perception checks.'
      }

      return ok({
        success: true, actionType: 'psychological_impact', corpseId: a.id, observerCharacterId: a.observerCharacterId,
        roll, total, dc, margin, succeeded, criticalFail, outcome, effect,
      })
    }
  }
}
