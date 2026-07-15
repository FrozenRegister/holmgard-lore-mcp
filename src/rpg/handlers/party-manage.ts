// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/party-manage.ts
//
// #285 (Party Trust & Betrayal) extends THIS existing handler rather than
// adding a second, colliding rpg{sub:"party"} — the issue was drafted
// assuming that sub didn't exist yet, but it already did (generic grouping:
// create/get/list/add_member/etc., used by combat and world-manage). See
// migration 0013 and docs in the PR description for the full reasoning.
// `form` aliases to `create`; `get_state` aliases to `get` (whose response
// is enriched with trust/morale/watch data below) — no separate action
// needed for either.
//
// Design decisions made explicitly (not fully specified by the issue):
// - `resolve_conflict`'s fight/exile/stolen_resources/grudging_truce outcome
//   bands from average bidirectional trust are this PR's own synthesis —
//   the issue names the four possible outcomes but gives no resolution
//   formula.
// - `betrayal_check` scans the party's trust matrix for the single lowest-
//   trust (from, to) pair as the likely actor/target — the issue's example
//   response implies exactly one such pair is surfaced, but doesn't specify
//   how it's chosen among multiple low-trust relationships.
// - `betrayal_check`'s desperation multipliers are accepted as explicit
//   caller input (default 1.0 each) rather than derived from resource/injury/
//   audience/extraction state this handler doesn't have direct access to
//   (matching #280/#284/#286's "accept as explicit input" precedent).
// - `morale_roll` never forcibly dissolves a party or splits resources when
//   morale crosses under 20 — it reports `dissolved: true` for the narrator
//   to act on, since destructively deleting party_members rows from inside
//   a numeric decay check would be an irreversible action this handler
//   shouldn't take on its own (matching #280/#287's restraint on
//   auto-applying destructive/irreversible consequences).

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import { getWaypoint, getWaypointDistance } from './waypoint-manage'
import type { AppBindings } from '../../types'

const ACTIONS = [
  'create', 'get', 'list', 'update', 'delete', 'add_member', 'remove_member', 'set_leader',
  'trust_shift', 'resolve_conflict', 'betrayal_check', 'morale_roll', 'watch_rotation',
  'begin_march', 'get_march_status', 'cohesion_check', 'group_break', 'cohesion_shift',
] as const
type PartyAction = typeof ACTIONS[number]
const ALIASES: Record<string, PartyAction> = {
  ...CRUD_ALIASES,
  add_character: 'add_member', join: 'add_member',
  remove_character: 'remove_member', leave: 'remove_member', kick: 'remove_member',
  leader: 'set_leader', promote: 'set_leader',
  form: 'create', get_state: 'get',
  trust: 'trust_shift', shift_trust: 'trust_shift',
  conflict: 'resolve_conflict', clash: 'resolve_conflict',
  betrayal: 'betrayal_check', check_betrayal: 'betrayal_check',
  morale: 'morale_roll', morale_check: 'morale_roll',
  watch: 'watch_rotation', assign_watch: 'watch_rotation',
  march: 'begin_march', travel_to: 'begin_march',
  march_status: 'get_march_status',
  cohesion: 'cohesion_check', check_cohesion: 'cohesion_check',
  break: 'group_break', fracture: 'group_break', disband: 'group_break',
  shift: 'cohesion_shift', apply_event: 'cohesion_shift',
} as Record<string, PartyAction>

// Transcribed from the issue's "Trust Events" table. `delta` is applied to
// the trust the acting/affected character has toward the other party.
const TRUST_EVENTS: Record<string, { delta: number; note: string }> = {
  shared_food: { delta: 5, note: 'Shared food/water — scarce resources only.' },
  first_aid: { delta: 10, note: 'First aid administered — successful WIS check.' },
  saved_from_predator: { delta: 15, note: 'Saved from predator — direct intervention in combat.' },
  shared_intel: { delta: 8, note: 'Shared crucial intel — information acted upon.' },
  caught_hoarding: { delta: -15, note: 'Caught hoarding resources — discovered via perception check.' },
  abandoned_in_combat: { delta: -25, note: 'Abandoned during predator attack — fleeing while others fight.' },
  led_predator_to_party: { delta: -40, note: 'Led predator toward party — deliberate misdirection.' },
  stole_from_cache: { delta: -20, note: 'Stole from party cache — discovered.' },
  failed_watch: { delta: -10, note: 'Failed watch shift — party wakes to danger.' },
  successful_watch: { delta: 5, note: 'Successful watch — party warned in time.' },
  extracted_together: { delta: 30, note: 'Extracted together — permanent bond.' },
  left_behind: { delta: -100, note: 'Left behind at extraction — irreparable.' },
}

// Transcribed from the issue's morale decay/recovery lists.
const MORALE_EVENTS: Record<string, { delta: number; note: string }> = {
  yield_death: { delta: -5, note: 'A Yield in the party died.' },
  starvation_day: { delta: -3, note: 'A day of starvation with no rations.' },
  betrayal_discovered: { delta: -8, note: 'A betrayal was discovered.' },
  severe_injury: { delta: -2, note: 'A severe injury in the party.' },
  storm_no_shelter: { delta: -1, note: 'A day of rain/storm with no shelter.' },
  crate_claimed: { delta: 5, note: 'Successful prize crate claim.' },
  meal_shared: { delta: 3, note: 'A full meal shared.' },
  predator_driven_off: { delta: 8, note: 'A predator killed or driven off together.' },
  yield_saved: { delta: 10, note: 'A Yield saved from death.' },
  clear_day: { delta: 2, note: 'Clear weather day with no encounters.' },
}

// Cohesion event deltas — track immediate interpersonal bond strength independently of morale
const COHESION_EVENTS: Record<string, { delta: number; note: string }> = {
  shared_kill: { delta: 8, note: 'Cooperation under pressure' },
  saved_member: { delta: 12, note: 'Saved a party member from death' },
  voluntary_share: { delta: 5, note: 'Voluntary resource sharing' },
  joint_discovery: { delta: 5, note: 'Joint discovery of cache or mechanism' },
  successful_trade: { delta: 4, note: 'Successful trade with another group' },
  partner_injured: { delta: -6, note: 'Partner injured — trust strain' },
  supply_theft_discovered: { delta: -12, note: 'Theft discovered within group' },
  moral_disagreement: { delta: -8, note: 'Irreconcilable moral disagreement' },
  audience_interference: { delta: -5, note: 'Production interference targeted at this group' },
  starvation: { delta: -4, note: 'Rations below threshold' },
  predator_attack: { delta: -6, note: 'Predator attack stress' },
}

function moraleTier(morale: number): { cohesion: string; rollModifier: number; dissolved: boolean } {
  if (morale >= 80) return { cohesion: 'high', rollModifier: 1, dissolved: false }
  if (morale >= 60) return { cohesion: 'stable', rollModifier: 0, dissolved: false }
  if (morale >= 40) return { cohesion: 'strained', rollModifier: -1, dissolved: false }
  if (morale >= 20) return { cohesion: 'breaking', rollModifier: -2, dissolved: false }
  return { cohesion: 'collapse', rollModifier: -2, dissolved: true }
}

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  worldId: z.string().optional(),
  status: z.enum(['active', 'dormant', 'archived']).optional(),
  partyId: z.string().optional(),
  characterId: z.string().optional(),
  role: z.enum(['leader', 'member', 'companion', 'hireling', 'prisoner', 'mount']).optional().default('member'),
  // trust_shift
  fromCharacterId: z.string().optional(),
  towardCharacterId: z.string().optional(),
  eventType: z.string().optional(),
  delta: z.number().optional(),
  // resolve_conflict
  characterAId: z.string().optional(),
  characterBId: z.string().optional(),
  // betrayal_check
  resourceDesperation: z.number().min(1).max(1.5).optional().default(1),
  injuryDesperation: z.number().min(1).max(1.5).optional().default(1),
  audiencePressure: z.number().min(1).max(1.5).optional().default(1),
  extractionPressure: z.number().min(1).max(1.5).optional().default(1),
  // morale_roll
  stressorType: z.string().optional(),
  customDelta: z.number().optional(),
  // watch_rotation
  watchers: z.array(z.object({
    characterId: z.string(),
    conModifier: z.number().optional().default(0),
    rollValue: z.number().int().min(1).max(20).optional(),
  })).optional().default([]),
  // begin_march (#328 — Gotland real-world-distance movement)
  toWaypointId: z.string().optional(),
  toWaypointName: z.string().optional(),
  fromWaypointId: z.string().optional(),
  fromWaypointName: z.string().optional(),
  pace: z.number().positive().optional(),
  // cohesion_check
  stressModifier: z.number().optional().default(0),
  cooperationModifier: z.number().optional().default(0),
  // group_break
  reason: z.string().optional(),
  method: z.enum(['abandonment', 'betrayal', 'death', 'mutual']).optional(),
})

async function getTrustMatrix(db: D1Database, partyId: string): Promise<Array<{ from_character_id: string; to_character_id: string; trust_score: number }>> {
  const { results } = await db.prepare('SELECT from_character_id, to_character_id, trust_score FROM party_trust WHERE party_id = ?').bind(partyId).all()
  return results as Array<{ from_character_id: string; to_character_id: string; trust_score: number }>
}

export async function handlePartyManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'create': {
      if (!a.name) return err('"name" is required')
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO parties (id, name, description, world_id, status, formation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, a.name, a.description ?? null, a.worldId ?? null, a.status ?? 'active', 'standard', now, now).run()
      return ok({ success: true, actionType: 'create', partyId: id, name: a.name })
    }
    case 'get': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      const party = await db.prepare('SELECT * FROM parties WHERE id = ?').bind(partyId).first() as Record<string, unknown> | null
      if (!party) return err(`Party not found: ${partyId}`)
      const { results: members } = await db.prepare(`
        SELECT pm.role, pm.is_active, c.id AS character_id, c.name, c.character_class, c.level, c.hp, c.max_hp
        FROM party_members pm JOIN characters c ON pm.character_id = c.id
        WHERE pm.party_id = ? ORDER BY pm.role DESC
      `).bind(partyId).all()
      const trust = await getTrustMatrix(db, partyId)
      return ok({
        success: true, actionType: match.matched, party: { ...party, members },
        trust, cohesion: moraleTier(party.morale as number).cohesion, watchOrder: JSON.parse((party.watch_order as string) ?? '[]'),
      })
    }
    case 'list': {
      const { results } = await db.prepare('SELECT id, name, status, world_id, created_at FROM parties ORDER BY created_at DESC').all()
      return ok({ success: true, actionType: 'list', parties: results, count: results.length })
    }
    case 'update': {
      if (!a.id) return err('"id" is required')
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.name) { sets.push('name = ?'); vals.push(a.name) }
      if (a.description) { sets.push('description = ?'); vals.push(a.description) }
      if (a.status) { sets.push('status = ?'); vals.push(a.status) }
      vals.push(a.id)
      await db.prepare(`UPDATE parties SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', id: a.id })
    }
    case 'delete': {
      if (!a.id) return err('"id" is required')
      await db.prepare('DELETE FROM parties WHERE id = ?').bind(a.id).run()
      return ok({ success: true, actionType: 'delete', id: a.id })
    }
    case 'add_member': {
      const partyId = a.partyId ?? a.id
      if (!partyId || !a.characterId) return err('"partyId" and "characterId" are required')
      const memberId = crypto.randomUUID()
      await db.prepare('INSERT OR REPLACE INTO party_members (id, party_id, character_id, role, is_active, joined_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(memberId, partyId, a.characterId, a.role, 1, now).run()
      await db.prepare('UPDATE parties SET updated_at = ? WHERE id = ?').bind(now, partyId).run()
      return ok({ success: true, actionType: 'add_member', partyId, characterId: a.characterId, role: a.role })
    }
    case 'remove_member': {
      const partyId = a.partyId ?? a.id
      if (!partyId || !a.characterId) return err('"partyId" and "characterId" are required')
      await db.prepare('DELETE FROM party_members WHERE party_id = ? AND character_id = ?').bind(partyId, a.characterId).run()
      return ok({ success: true, actionType: 'remove_member', partyId, characterId: a.characterId })
    }
    case 'set_leader': {
      const partyId = a.partyId ?? a.id
      if (!partyId || !a.characterId) return err('"partyId" and "characterId" are required')
      await db.prepare("UPDATE party_members SET role = 'member' WHERE party_id = ?").bind(partyId).run()
      await db.prepare("UPDATE party_members SET role = 'leader' WHERE party_id = ? AND character_id = ?").bind(partyId, a.characterId).run()
      return ok({ success: true, actionType: 'set_leader', partyId, leaderId: a.characterId })
    }
    case 'trust_shift': {
      const partyId = a.partyId ?? a.id
      if (!partyId || !a.fromCharacterId || !a.towardCharacterId) return err('"partyId", "fromCharacterId", and "towardCharacterId" are required')
      let delta = a.delta
      let note: string | null = null
      if (delta === undefined) {
        if (!a.eventType) return err('"delta" or "eventType" is required')
        const event = TRUST_EVENTS[a.eventType]
        if (!event) return err(`Unknown eventType: ${a.eventType}`)
        delta = event.delta
        note = event.note
      }
      const existing = await db.prepare('SELECT trust_score FROM party_trust WHERE party_id = ? AND from_character_id = ? AND to_character_id = ?')
        .bind(partyId, a.fromCharacterId, a.towardCharacterId).first() as { trust_score: number } | null
      const newTrust = Math.max(0, Math.min(100, (existing?.trust_score ?? 50) + delta))
      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO party_trust (id, party_id, from_character_id, to_character_id, trust_score, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(party_id, from_character_id, to_character_id) DO UPDATE SET trust_score = excluded.trust_score, updated_at = excluded.updated_at')
        .bind(id, partyId, a.fromCharacterId, a.towardCharacterId, newTrust, now).run()
      return ok({ success: true, actionType: 'trust_shift', partyId, fromCharacterId: a.fromCharacterId, towardCharacterId: a.towardCharacterId, delta, trustScore: newTrust, note })
    }
    case 'resolve_conflict': {
      const partyId = a.partyId ?? a.id
      if (!partyId || !a.characterAId || !a.characterBId) return err('"partyId", "characterAId", and "characterBId" are required')
      const matrix = await getTrustMatrix(db, partyId)
      const aToB = matrix.find(t => t.from_character_id === a.characterAId && t.to_character_id === a.characterBId)?.trust_score ?? 50
      const bToA = matrix.find(t => t.from_character_id === a.characterBId && t.to_character_id === a.characterAId)?.trust_score ?? 50
      const avgTrust = (aToB + bToA) / 2

      let outcome: string
      if (avgTrust >= 60) outcome = 'grudging_truce'
      else if (avgTrust >= 40) outcome = Math.random() < 0.5 ? 'stolen_resources' : 'grudging_truce'
      else if (avgTrust >= 20) outcome = Math.random() < 0.5 ? 'fight' : 'stolen_resources'
      else outcome = Math.random() < 0.5 ? 'exile' : 'fight'

      return ok({ success: true, actionType: 'resolve_conflict', partyId, characterAId: a.characterAId, characterBId: a.characterBId, avgTrust, outcome })
    }
    case 'betrayal_check': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      const matrix = await getTrustMatrix(db, partyId)
      if (matrix.length === 0) return ok({ success: true, actionType: 'betrayal_check', partyId, betrayalLikely: false, likelihood: 0, likelyActor: null, likelyTarget: null, motivation: null, classification: 'loyal' })

      const lowest = matrix.reduce((min, t) => t.trust_score < min.trust_score ? t : min)
      const multipliers = {
        resource_desperation: a.resourceDesperation, injury_desperation: a.injuryDesperation,
        audience_pressure: a.audiencePressure, extraction_pressure: a.extractionPressure,
      }
      const likelihood = (100 - lowest.trust_score) * multipliers.resource_desperation * multipliers.injury_desperation * multipliers.audience_pressure * multipliers.extraction_pressure
      const motivation = Object.entries(multipliers).reduce((max, [k, v]) => v > multipliers[max as keyof typeof multipliers] ? k : max, 'resource_desperation')

      let classification: string
      if (likelihood > 60) classification = 'likely'
      else if (likelihood > 40) classification = 'possible'
      else if (likelihood > 20) classification = 'unlikely'
      else classification = 'loyal'

      return ok({
        success: true, actionType: 'betrayal_check', partyId, betrayalLikely: likelihood > 60, likelihood,
        likelyActor: lowest.from_character_id, likelyTarget: lowest.to_character_id, motivation, classification,
      })
    }
    case 'morale_roll': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      const party = await db.prepare('SELECT morale FROM parties WHERE id = ?').bind(partyId).first() as { morale: number } | null
      if (!party) return err(`Party not found: ${partyId}`)

      let delta = a.customDelta
      let note: string | null = null
      if (delta === undefined) {
        if (!a.stressorType) return err('"customDelta" or "stressorType" is required')
        const event = MORALE_EVENTS[a.stressorType]
        if (!event) return err(`Unknown stressorType: ${a.stressorType}`)
        delta = event.delta
        note = event.note
      }
      const newMorale = Math.max(0, Math.min(100, party.morale + delta))
      const tier = moraleTier(newMorale)
      await db.prepare('UPDATE parties SET morale = ?, cohesion = ?, updated_at = ? WHERE id = ?').bind(newMorale, tier.cohesion, now, partyId).run()

      return ok({ success: true, actionType: 'morale_roll', partyId, delta, morale: newMorale, cohesion: tier.cohesion, rollModifier: tier.rollModifier, dissolved: tier.dissolved, note })
    }
    case 'watch_rotation': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      if (a.watchers.length === 0) return err('"watchers" must be a non-empty array')
      const party = await db.prepare('SELECT id FROM parties WHERE id = ?').bind(partyId).first()
      if (!party) return err(`Party not found: ${partyId}`)

      const results = a.watchers.map(w => {
        const roll = w.rollValue ?? Math.floor(Math.random() * 20) + 1
        const total = roll + w.conModifier
        const criticalFail = roll === 1
        const passed = !criticalFail && total >= 12
        return {
          characterId: w.characterId, roll, total, passed, criticalFail,
          effect: criticalFail
            ? 'Fell asleep — no perception check for this watch.'
            : passed
              ? 'Stayed alert.'
              : '-2 to passive perception, next encounter has +5% threshold.',
        }
      })

      const watchOrder = a.watchers.map(w => w.characterId)
      await db.prepare('UPDATE parties SET watch_order = ?, current_watch = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(watchOrder), watchOrder[0], now, partyId).run()

      return ok({ success: true, actionType: 'watch_rotation', partyId, watchOrder, results })
    }
    case 'begin_march': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      if (!a.toWaypointId && !a.toWaypointName) return err('"toWaypointId" or "toWaypointName" is required')
      const party = await db.prepare('SELECT world_id, current_waypoint_id FROM parties WHERE id = ?').bind(partyId).first() as
        { world_id: string | null; current_waypoint_id: string | null } | null
      if (!party) return err(`Party not found: ${partyId}`)
      if (!party.world_id) return err('Party has no world_id — waypoint movement requires a world-scoped party')

      const toWaypoint = await getWaypoint(db, party.world_id, a.toWaypointId ?? a.toWaypointName!)
      if (!toWaypoint) return err(`Waypoint not found: ${a.toWaypointId ?? a.toWaypointName}`)

      const fromIdentifier = a.fromWaypointId ?? a.fromWaypointName ?? party.current_waypoint_id
      if (!fromIdentifier) return err('Party has no current waypoint — provide "fromWaypointId"/"fromWaypointName" to start the first leg')
      const fromWaypoint = await getWaypoint(db, party.world_id, fromIdentifier)
      if (!fromWaypoint) return err(`Waypoint not found: ${fromIdentifier}`)

      const distance = await getWaypointDistance(db, party.world_id, fromWaypoint.id, toWaypoint.id)
      if (!distance.routable) {
        return ok({
          success: true, actionType: 'begin_march', partyId, blocked: true, reason: distance.reason,
          fromWaypoint: { id: fromWaypoint.id, name: fromWaypoint.name }, toWaypoint: { id: toWaypoint.id, name: toWaypoint.name },
        })
      }

      const sets: string[] = ['travel_target_waypoint_id = ?', 'travel_remaining_km = ?', 'travel_status = ?', 'updated_at = ?']
      const vals: unknown[] = [toWaypoint.id, distance.distanceKm, 'marching', now]
      if (a.pace !== undefined) { sets.push('travel_pace_km_per_day = ?'); vals.push(a.pace) }
      vals.push(partyId)
      await db.prepare(`UPDATE parties SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()

      return ok({
        success: true, actionType: 'begin_march', partyId, blocked: false,
        fromWaypoint: { id: fromWaypoint.id, name: fromWaypoint.name },
        toWaypoint: { id: toWaypoint.id, name: toWaypoint.name },
        distanceKm: distance.distanceKm, travelStatus: 'marching',
      })
    }
    case 'get_march_status': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      const party = await db.prepare(
        'SELECT world_id, current_waypoint_id, travel_target_waypoint_id, travel_remaining_km, travel_pace_km_per_day, travel_status FROM parties WHERE id = ?'
      ).bind(partyId).first() as {
        world_id: string | null; current_waypoint_id: string | null; travel_target_waypoint_id: string | null
        travel_remaining_km: number | null; travel_pace_km_per_day: number; travel_status: string
      } | null
      if (!party) return err(`Party not found: ${partyId}`)

      const currentWaypoint = party.world_id && party.current_waypoint_id ? await getWaypoint(db, party.world_id, party.current_waypoint_id) : null
      const targetWaypoint = party.world_id && party.travel_target_waypoint_id ? await getWaypoint(db, party.world_id, party.travel_target_waypoint_id) : null

      return ok({
        success: true, actionType: 'get_march_status', partyId,
        travelStatus: party.travel_status,
        currentWaypoint: currentWaypoint ? { id: currentWaypoint.id, name: currentWaypoint.name } : null,
        targetWaypoint: targetWaypoint ? { id: targetWaypoint.id, name: targetWaypoint.name } : null,
        remainingKm: party.travel_remaining_km, pace: party.travel_pace_km_per_day,
      })
    }
    case 'cohesion_check': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      const party = await db.prepare('SELECT cohesion_score FROM parties WHERE id = ?').bind(partyId).first() as { cohesion_score: number } | null
      if (!party) return err(`Party not found: ${partyId}`)

      const roll = Math.floor(Math.random() * 20) + 1
      const total = roll + (a.stressModifier ?? 0) + (a.cooperationModifier ?? 0)

      let tier: string, fractureType: string | null = null
      if (total <= 4) {
        tier = 'fracture'
        const fractures = ['betrayal', 'abandonment', 'violence', 'mutual']
        const weights = [0.4, 0.3, 0.2, 0.1]
        const rand = Math.random()
        let cumulative = 0
        for (let i = 0; i < fractures.length; i++) {
          cumulative += weights[i]
          if (rand < cumulative) { fractureType = fractures[i]; break }
        }
      } else if (total <= 8) {
        tier = 'strain'
      } else if (total <= 12) {
        tier = 'stable'
      } else if (total <= 16) {
        tier = 'strong'
      } else {
        tier = 'deepened'
      }

      const cohesionDelta = tier === 'fracture' ? -20 : tier === 'strain' ? -10 : tier === 'stable' ? 0 : tier === 'strong' ? 8 : 15
      const newCohesion = Math.max(0, Math.min(100, party.cohesion_score + cohesionDelta))
      await db.prepare('UPDATE parties SET cohesion_score = ?, updated_at = ? WHERE id = ?').bind(newCohesion, now, partyId).run()

      const outcomes: Record<string, string> = {
        fracture: `Fracture — ${fractureType} (${fractureType === 'betrayal' ? '40%' : fractureType === 'abandonment' ? '30%' : fractureType === 'violence' ? '20%' : '10%'} chance)`,
        strain: 'Argument — trust erosion, one considers leaving',
        stable: 'Functional, not warm, pragmatic cooperation',
        strong: 'Growing trust, mutual reliance',
        deepened: 'Sacrifice, loyalty, bonus on next check',
      }

      return ok({
        success: true, actionType: 'cohesion_check', partyId, roll, total,
        modifiers: { stressModifier: a.stressModifier ?? 0, cooperationModifier: a.cooperationModifier ?? 0 },
        tier, outcome: outcomes[tier], cohesionScore: newCohesion, fractureType,
      })
    }
    case 'group_break': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      if (!a.method) return err('"method" is required (abandonment, betrayal, death, or mutual)')

      const party = await db.prepare('SELECT id FROM parties WHERE id = ?').bind(partyId).first()
      if (!party) return err(`Party not found: ${partyId}`)

      const { results: members } = await db.prepare('SELECT character_id FROM party_members WHERE party_id = ?').bind(partyId).all() as { results: Array<{ character_id: string }> }

      if (a.method === 'mutual') {
        await db.prepare('DELETE FROM party_members WHERE party_id = ?').bind(partyId).run()
      } else {
        await db.prepare('DELETE FROM party_members WHERE party_id = ?').bind(partyId).run()
      }

      await db.prepare('UPDATE parties SET status = ?, updated_at = ? WHERE id = ?').bind('broken', now, partyId).run()

      return ok({
        success: true, actionType: 'group_break', partyId, method: a.method,
        reason: a.reason ?? null, membersAffected: members.length, status: 'broken',
      })
    }
    case 'cohesion_shift': {
      const partyId = a.partyId ?? a.id
      if (!partyId) return err('"partyId" or "id" is required')
      if (!a.eventType) return err('"eventType" is required')

      const event = COHESION_EVENTS[a.eventType]
      if (!event) return err(`Unknown eventType: ${a.eventType}`)

      const party = await db.prepare('SELECT cohesion_score FROM parties WHERE id = ?').bind(partyId).first() as { cohesion_score: number } | null
      if (!party) return err(`Party not found: ${partyId}`)

      const newCohesion = Math.max(0, Math.min(100, party.cohesion_score + event.delta))
      await db.prepare('UPDATE parties SET cohesion_score = ?, updated_at = ? WHERE id = ?').bind(newCohesion, now, partyId).run()

      return ok({
        success: true, actionType: 'cohesion_shift', partyId, eventType: a.eventType,
        delta: event.delta, note: event.note, cohesionScore: newCohesion,
      })
    }
  }
}

// Exported for the narrator to resolve a day (or several) of marching for
// every currently-marching party in a world — deliberately NOT called from
// production-manage.ts's advance_day, which ticks the whole world's hazard/
// weather/resource-degradation/corpse-decomposition at once. Movement
// resolves per-party so one party's march never blocks on another's turn.
// Leftover travel budget beyond arrival is discarded, not carried into a
// next leg — a fresh begin_march starts the next leg.
export async function tickAllPartiesMarch(
  db: D1Database, worldId: string, daysToAdvance = 1
): Promise<Array<{ partyId: string; status: 'marching' | 'arrived'; remainingKm: number | null; arrivedAtWaypointId?: string }>> {
  const now = new Date().toISOString()
  const { results: marching } = await db.prepare(
    'SELECT id, travel_target_waypoint_id, travel_remaining_km, travel_pace_km_per_day FROM parties WHERE world_id = ? AND travel_status = ?'
  ).bind(worldId, 'marching').all() as {
    results: Array<{ id: string; travel_target_waypoint_id: string; travel_remaining_km: number; travel_pace_km_per_day: number }>
  }

  const out: Array<{ partyId: string; status: 'marching' | 'arrived'; remainingKm: number | null; arrivedAtWaypointId?: string }> = []
  for (const party of marching) {
    const remaining = Math.max(0, party.travel_remaining_km - party.travel_pace_km_per_day * daysToAdvance)
    if (remaining <= 0) {
      const target = await getWaypoint(db, worldId, party.travel_target_waypoint_id)
      await db.prepare(
        'UPDATE parties SET current_waypoint_id = ?, current_hex_q = ?, current_hex_r = ?, travel_target_waypoint_id = NULL, travel_remaining_km = NULL, travel_status = ?, updated_at = ? WHERE id = ?'
      ).bind(party.travel_target_waypoint_id, target?.q ?? null, target?.r ?? null, 'stationary', now, party.id).run()
      out.push({ partyId: party.id, status: 'arrived', remainingKm: 0, arrivedAtWaypointId: party.travel_target_waypoint_id })
    } else {
      await db.prepare('UPDATE parties SET travel_remaining_km = ?, updated_at = ? WHERE id = ?').bind(remaining, now, party.id).run()
      out.push({ partyId: party.id, status: 'marching', remainingKm: remaining })
    }
  }
  return out
}
