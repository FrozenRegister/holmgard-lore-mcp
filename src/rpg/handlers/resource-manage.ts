// Resource Survival System (#286) — rpg({ sub: "resource", action: "..." }).
// Prize crates, degradation, scavenging/crafting/improvisation, and starvation
// tracking for the Preserve's survival-horror resource loop, distinct from the
// D&D-style `inventory` sub-handler (gold/daggers/magic dust).
//
// Design decisions made explicitly (not fully specified by the issue —
// documented here and in the PR/changelog rather than guessed silently):
//
// - The issue's per-item "Days Available"/"Degradation" columns are mixed
//   qualitative text ("Frays with use", "Degrades in rain", "Single use").
//   Only the numerically-expressible ones (fixed day counts, "Expires Day N")
//   are turned into `degradationDays`/`expiresOnDay` that `degrade` actually
//   ticks; the rest are carried as a `note` string for the narrator, since
//   "frays with use" isn't a time-based decay this handler can simulate
//   without a use-counter system that's out of scope here.
// - Forage/craft DCs: the issue gives explicit WIS DCs for some forage items
//   (mushrooms 12, medicinal herbs 15, etc.) but not others, and gives no DCs
//   at all for craftable items ("Craft DC scales with complexity" — no
//   numbers). Missing forage DCs default to 8 (common/easy) or 6 (trivial,
//   e.g. driftwood/cave water — no real skill involved in picking it up).
//   Craftable items are bucketed by complexity into DC 10 (basic: rope,
//   splint, torch, grass mat, moss bandage, peat fire, salt), DC 13
//   (moderate: poultice, stone blade, fish trap, salt preservative), or
//   DC 16 (complex: cave shelter). This is this PR's own synthesis.
// - `consume` and `craft` do not mutate character HP/CON/stats or create
//   timed buffs — they return the item's descriptive effect for the narrator
//   to apply narratively, matching #280/#284's precedent of never silently
//   mutating character state from a resource/mechanics handler. Similarly,
//   `degrade` computes and returns starvation-tier penalties as data; it does
//   not write them to `characters.hp`/stats itself.
// - `degrade` cannot know on its own whether an owner ate today (inventory
//   state doesn't distinguish "held" from "consumed"), so it accepts an
//   explicit `ateToday` flag from the caller rather than guessing from
//   inventory contents.

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError } from '../utils/fuzzy-enum'
import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

export const ACTIONS = ['crate_drop', 'consume', 'degrade', 'improvise', 'scavenge', 'craft', 'get_state'] as const
type ResourceAction = typeof ACTIONS[number]
const ALIASES: Record<string, ResourceAction> = {
  drop_crate: 'crate_drop', prize_drop: 'crate_drop',
  use: 'consume',
  tick_degrade: 'degrade', tick: 'degrade',
  jury_rig: 'improvise', macgyver: 'improvise',
  forage: 'scavenge', search: 'scavenge',
  build: 'craft', make: 'craft',
  state: 'get_state', inventory: 'get_state',
}

const OWNER_TYPES = ['character', 'party'] as const

interface CrateItem {
  name: string
  category: 'medical' | 'food' | 'tools' | 'weapon' | 'intel'
  weight: number
  minDay: number
  degradationDays: number | null
  expiresOnDay: number | null
  note: string
}

// Transcribed from the issue's "Prize Crate Contents" table.
const CRATE_TABLE: CrateItem[] = [
  { name: 'Field Dressing', category: 'medical', weight: 20, minDay: 0, degradationDays: null, expiresOnDay: null, note: 'Stops bleeding, +4 to first aid.' },
  { name: 'Antiseptic Vial', category: 'medical', weight: 15, minDay: 0, degradationDays: null, expiresOnDay: 25, note: 'Prevents infection on one wound.' },
  { name: 'Pain Suppressant', category: 'medical', weight: 10, minDay: 10, degradationDays: null, expiresOnDay: null, note: 'Ignore -2 injury penalty for 6 hours.' },
  { name: 'Suture Kit', category: 'medical', weight: 8, minDay: 15, degradationDays: null, expiresOnDay: null, note: '+6 to first aid, closes deep wounds.' },
  { name: 'Broad-Spectrum Antibiotic', category: 'medical', weight: 5, minDay: 20, degradationDays: null, expiresOnDay: 28, note: 'Cures active infection.' },
  { name: 'Trauma Kit', category: 'medical', weight: 3, minDay: 25, degradationDays: null, expiresOnDay: null, note: 'Stabilizes critical injury, prevents death.' },
  { name: 'Standard Ration Pack', category: 'food', weight: 30, minDay: 0, degradationDays: 5, expiresOnDay: null, note: '1 day, 1 person.' },
  { name: 'High-Energy Ration', category: 'food', weight: 15, minDay: 10, degradationDays: 3, expiresOnDay: null, note: '2 days, 1 person, +1 CON for 12h.' },
  { name: 'Water Purification Tablets', category: 'food', weight: 12, minDay: 0, degradationDays: null, expiresOnDay: null, note: '10 uses.' },
  { name: 'MRE with Heating Element', category: 'food', weight: 8, minDay: 5, degradationDays: 7, expiresOnDay: null, note: 'Hot meal, +3 morale.' },
  { name: 'Luxury Item', category: 'food', weight: 3, minDay: 20, degradationDays: null, expiresOnDay: null, note: '+5 audience approval if shared.' },
  { name: 'Fire-Starting Kit', category: 'tools', weight: 18, minDay: 0, degradationDays: null, expiresOnDay: null, note: '20 uses. Degrades in rain.' },
  { name: '50ft Rope', category: 'tools', weight: 15, minDay: 0, degradationDays: null, expiresOnDay: null, note: 'Frays with use.' },
  { name: 'Multi-Tool', category: 'tools', weight: 10, minDay: 10, degradationDays: null, expiresOnDay: null, note: 'Knife, pliers, screwdriver — +2 to craft.' },
  { name: 'Thermal Blanket', category: 'tools', weight: 8, minDay: 15, degradationDays: null, expiresOnDay: null, note: 'Survive cold night without shelter. Tears with use.' },
  { name: 'Signal Mirror', category: 'tools', weight: 5, minDay: 20, degradationDays: null, expiresOnDay: null, note: 'Can signal other Yields or extraction boat at distance.' },
  { name: 'Waterproof Tarp', category: 'tools', weight: 7, minDay: 10, degradationDays: null, expiresOnDay: null, note: 'Shelter, rain protection. Degrades in sun.' },
  { name: 'Survival Knife', category: 'weapon', weight: 8, minDay: 20, degradationDays: null, expiresOnDay: null, note: '1d4 damage, +1 to craft. Dulls with use.' },
  { name: 'Bear Spray', category: 'weapon', weight: 4, minDay: 25, degradationDays: null, expiresOnDay: null, note: 'Deterrent, predator flees on failed CON save DC 15. Single use.' },
  { name: 'Improvised Spear', category: 'weapon', weight: 3, minDay: 15, degradationDays: null, expiresOnDay: null, note: '1d6, reach. Breaks on crit fail.' },
  { name: 'Map Fragment', category: 'intel', weight: 6, minDay: 15, degradationDays: null, expiresOnDay: null, note: 'Reveals 5x5 tile area, shows predator nests.' },
  { name: 'Radio Receiver', category: 'intel', weight: 2, minDay: 25, degradationDays: 3, expiresOnDay: null, note: 'Hears Production broadcasts, 50% chance of useful intel. Battery: 3 days.' },
]

interface BiomeResource {
  name: string
  dc: number
  kind: 'forage' | 'craft'
  note: string
}

// Transcribed from the issue's "Natural Resources (per biome)" table. DCs
// not given by the issue are filled per the header comment's documented
// synthesis (6 trivial / 8 common / 10-13-16 craft complexity tiers).
const BIOME_RESOURCES: Record<string, BiomeResource[]> = {
  pine_forest: [
    { name: 'Edible mushrooms', dc: 12, kind: 'forage', note: 'Vitamin-rich, WIS check to identify safely.' },
    { name: 'Pine needles', dc: 8, kind: 'forage', note: 'Tea, vitamin C.' },
    { name: 'Deadwood', dc: 6, kind: 'forage', note: 'Fire fuel.' },
    { name: 'Resin', dc: 8, kind: 'forage', note: 'Fire starter.' },
    { name: 'Splint', dc: 10, kind: 'craft', note: 'Stabilizes a broken limb.' },
    { name: 'Torch', dc: 10, kind: 'craft', note: 'Light and a weak fire weapon.' },
    { name: 'Lean-to shelter', dc: 13, kind: 'craft', note: 'Rain and wind cover.' },
    { name: 'Improvised spear', dc: 10, kind: 'craft', note: '1d4, breaks on 1-2 (improvised quality).' },
  ],
  meadow: [
    { name: 'Edible greens', dc: 10, kind: 'forage', note: 'Basic nutrition.' },
    { name: 'Medicinal herbs', dc: 15, kind: 'forage', note: '+2 first aid.' },
    { name: 'Grass cordage', dc: 8, kind: 'forage', note: 'Weak rope substitute.' },
    { name: 'Basic rope', dc: 10, kind: 'craft', note: 'Short lengths only.' },
    { name: 'Poultice', dc: 13, kind: 'craft', note: 'Herbal wound treatment.' },
    { name: 'Grass mat', dc: 10, kind: 'craft', note: 'Insulation against cold ground.' },
  ],
  bog: [
    { name: 'Sphagnum moss', dc: 8, kind: 'forage', note: 'Wound dressing, mild antiseptic.' },
    { name: 'Bog water', dc: 6, kind: 'forage', note: 'Must purify before drinking.' },
    { name: 'Willow bark', dc: 14, kind: 'forage', note: 'Pain relief.' },
    { name: 'Peat fire', dc: 10, kind: 'craft', note: 'Smoky, slow-burning.' },
    { name: 'Moss bandage', dc: 10, kind: 'craft', note: 'Basic wound covering.' },
  ],
  limestone_karst: [
    { name: 'Cave water', dc: 6, kind: 'forage', note: 'Clean, mineral-rich.' },
    { name: 'Bat guano', dc: 8, kind: 'forage', note: 'Fire accelerant.' },
    { name: 'Flint nodules', dc: 8, kind: 'forage', note: 'Sparking material.' },
    { name: 'Stone blade', dc: 13, kind: 'craft', note: 'Crude cutting edge.' },
    { name: 'Spark striker', dc: 13, kind: 'craft', note: 'Reliable fire starting.' },
    { name: 'Cave shelter', dc: 16, kind: 'craft', note: 'Strong, defensible cover.' },
  ],
  beach: [
    { name: 'Driftwood', dc: 6, kind: 'forage', note: 'Fire fuel.' },
    { name: 'Edible seaweed', dc: 10, kind: 'forage', note: 'Basic nutrition.' },
    { name: 'Shellfish', dc: 12, kind: 'forage', note: 'CON check — risk of illness.' },
    { name: 'Salt preservative', dc: 13, kind: 'craft', note: 'Extends food shelf life by 2 days.' },
    { name: 'Fish trap', dc: 13, kind: 'craft', note: 'Passive food source.' },
  ],
  coastal_water: [
    { name: 'Fish', dc: 14, kind: 'forage', note: 'DEX to catch barehanded, or use a fish trap.' },
    { name: 'Sea salt', dc: 8, kind: 'forage', note: 'Food preservation.' },
    { name: 'Fish trap', dc: 13, kind: 'craft', note: 'Passive food source.' },
    { name: 'Salt', dc: 10, kind: 'craft', note: 'Evaporated from seawater.' },
  ],
}

// Per-day starvation tiers, transcribed from the issue.
const STARVATION_TIERS: Record<number, { conPenalty: number; strPenalty: number; moralePenalty: number; note: string }> = {
  1: { conPenalty: -1, strPenalty: 0, moralePenalty: -5, note: 'Day 1 without food.' },
  2: { conPenalty: -2, strPenalty: -2, moralePenalty: -10, note: 'Day 2 — encounter threshold +5% (weakened, easier prey).' },
  3: { conPenalty: -3, strPenalty: -3, moralePenalty: -15, note: 'Day 3 — disadvantage on STR/DEX saves.' },
}

function starvationTier(daysWithoutFood: number): { conPenalty: number; strPenalty: number; moralePenalty: number; note: string; deathSaveRequired: boolean } {
  if (daysWithoutFood <= 0) return { conPenalty: 0, strPenalty: 0, moralePenalty: 0, note: 'Fed.', deathSaveRequired: false }
  if (daysWithoutFood >= 4) return { conPenalty: -3, strPenalty: -3, moralePenalty: -15, note: 'Day 4+ — CON DC 12 death save (3 failures = dead from starvation).', deathSaveRequired: true }
  // daysWithoutFood is always an integer streak counter incremented by
  // exactly 1 per degrade tick, so only 1, 2, or 3 ever reach here — every
  // value STARVATION_TIERS is missing a key for is already handled above.
  return { ...STARVATION_TIERS[daysWithoutFood], deathSaveRequired: false }
}

export interface DegradeResult {
  ownerType: 'character' | 'party'
  ownerId: string
  spoiled: string[]
  daysWithoutFood: number
  starvation: ReturnType<typeof starvationTier>
}

// Core degrade-tick logic, shared by the `degrade` action and
// production-manage.ts's advance_day (#283 integration contract step 4 —
// "Tick resource degradation → call resource.degrade").
export async function degradeOwnerResources(db: D1Database, ownerType: 'character' | 'party', ownerId: string, worldId: string, day: number, days: number, ateToday: boolean): Promise<DegradeResult> {
  const now = new Date().toISOString()
  const { results } = await db.prepare('SELECT * FROM resource_inventory WHERE owner_type = ? AND owner_id = ? AND quantity > 0 AND spoiled = 0')
    .bind(ownerType, ownerId).all() as { results: Array<Record<string, unknown>> }

  const spoiledNow: string[] = []
  for (const row of results) {
    let spoiled = false
    if (row.expires_on_day !== null && day >= (row.expires_on_day as number)) spoiled = true
    if (row.degradation_timer !== null) {
      const newTimer = (row.degradation_timer as number) - days
      if (newTimer <= 0) spoiled = true
      else await db.prepare('UPDATE resource_inventory SET degradation_timer = ?, updated_at = ? WHERE id = ?').bind(newTimer, now, row.id).run()
    }
    if (spoiled) {
      await db.prepare('UPDATE resource_inventory SET spoiled = 1, updated_at = ? WHERE id = ?').bind(now, row.id).run()
      spoiledNow.push(row.item_name as string)
    }
  }

  const hasFood = results.some(r => {
    const catalogEntry = CRATE_TABLE.find(c => c.name === r.item_name)
    return catalogEntry?.category === 'food' && (r.quantity as number) > 0
  })

  const state = await db.prepare('SELECT days_without_food FROM resource_owner_state WHERE owner_type = ? AND owner_id = ?').bind(ownerType, ownerId).first() as { days_without_food: number } | null
  let daysWithoutFood = state?.days_without_food ?? 0
  daysWithoutFood = (ateToday || hasFood) ? 0 : daysWithoutFood + 1
  await db.prepare('INSERT INTO resource_owner_state (owner_type, owner_id, world_id, days_without_food, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_type, owner_id) DO UPDATE SET days_without_food = excluded.days_without_food, updated_at = excluded.updated_at')
    .bind(ownerType, ownerId, worldId, daysWithoutFood, now).run()

  return { ownerType, ownerId, spoiled: spoiledNow, daysWithoutFood, starvation: starvationTier(daysWithoutFood) }
}

// Batch-ticks every owner holding resources in a world — used by
// production-manage.ts's advance_day, which operates at world scope and has
// no single character/party to target.
export async function tickAllOwnersDegradation(db: D1Database, worldId: string, day: number): Promise<DegradeResult[]> {
  const { results: owners } = await db.prepare('SELECT DISTINCT owner_type, owner_id FROM resource_inventory WHERE world_id = ?').bind(worldId).all() as
    { results: Array<{ owner_type: 'character' | 'party'; owner_id: string }> }
  const out: DegradeResult[] = []
  for (const o of owners) out.push(await degradeOwnerResources(db, o.owner_type, o.owner_id, worldId, day, 1, false))
  return out
}

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let pick = Math.random() * total
  // Only scan up to (but not including) the last item — subtracting every
  // weight before it always drives `pick` below the last item's own weight,
  // so falling through to it is the natural default, not a dead branch.
  for (let i = 0; i < items.length - 1; i++) {
    pick -= items[i].weight
    if (pick <= 0) return items[i]
  }
  return items[items.length - 1]
}

const InputSchema = z.object({
  action: z.string(),
  worldId: z.string().optional(),
  ownerType: z.enum(OWNER_TYPES).optional(),
  ownerId: z.string().optional(),
  day: z.number().int().min(0).optional().default(0),
  // crate_drop — axial hex coordinates (q, r), matching the world map.
  itemCount: z.number().int().min(1).max(10).optional().default(3),
  q: z.number().int().optional(),
  r: z.number().int().optional(),
  avoidPositions: z.array(z.object({ q: z.number().int(), r: z.number().int() })).optional().default([]),
  minDistance: z.number().min(0).optional().default(3),
  categoryBias: z.enum(['medical', 'food', 'tools', 'weapon', 'intel']).optional(),
  // consume
  inventoryId: z.string().optional(),
  itemName: z.string().optional(),
  quantity: z.number().int().min(1).optional().default(1),
  // degrade
  days: z.number().min(0).optional().default(1),
  ateToday: z.boolean().optional().default(false),
  // improvise / scavenge / craft
  biomeName: z.string().optional(),
  abilityModifier: z.number().optional().default(0),
  rollValue: z.number().int().min(1).max(20).optional(),
})

function biomeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '_')
}

// Axial hex distance (number of hex steps), NOT Euclidean — matches the
// formula used in world-map.ts/combat-map.ts for the same world model.
function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2
}

export async function handleResourceManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()

  switch (match.matched) {
    case 'crate_drop': {
      if (!a.worldId) return err('"worldId" is required')
      const world = await db.prepare('SELECT id FROM worlds WHERE id = ?').bind(a.worldId).first()
      if (!world) return err(`World not found: ${a.worldId}`)

      const available = CRATE_TABLE.filter(item => item.minDay <= a.day && (!a.categoryBias || item.category === a.categoryBias))
      // Every day (day >= 0, enforced by the schema) has at least one
      // minDay:0 item across the full table, so filtering by day alone can
      // never come back empty — only the categoryBias narrowing can.
      const pool = available.length > 0 ? available : CRATE_TABLE.filter(item => item.minDay <= a.day)

      const contents: CrateItem[] = []
      for (let i = 0; i < a.itemCount; i++) contents.push(weightedPick(pool))

      let q = a.q
      let r = a.r
      if (q === undefined || r === undefined) {
        // Pick from real hexes on this world's map — a crate position must
        // correspond to an actual hex, not an arbitrary axial coordinate
        // (unlike a rectangular grid, axial q/r has no width/height bounding
        // box to sample uniformly within).
        const { results: candidates } = await db.prepare('SELECT q, r FROM hexes WHERE world_id = ? ORDER BY RANDOM() LIMIT 20')
          .bind(a.worldId).all() as { results: Array<{ q: number; r: number }> }
        for (const c of candidates) {
          const tooClose = a.avoidPositions.some(p => hexDistance(p.q, p.r, c.q, c.r) < a.minDistance)
          if (!tooClose) { q = c.q; r = c.r; break }
        }
        if (q === undefined || r === undefined) {
          // No candidate cleared minDistance (or the world has no hexes yet)
          // — fall back to the first candidate, or the map origin.
          q = candidates[0]?.q ?? 0
          r = candidates[0]?.r ?? 0
        }
      }

      const id = crypto.randomUUID()
      await db.prepare('INSERT INTO crate_drops (id, world_id, day, q, r, contents, claimed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
        .bind(id, a.worldId, a.day, q, r, JSON.stringify(contents.map(c => ({ name: c.name, category: c.category, note: c.note }))), now, now).run()

      return ok({
        success: true, actionType: 'crate_drop', crateId: id, worldId: a.worldId, day: a.day, q, r,
        contents: contents.map(c => ({ name: c.name, category: c.category, note: c.note })),
        contentsHint: contents.map(c => c.category).join(', '),
      })
    }
    case 'consume': {
      if (!a.ownerType || !a.ownerId) return err('"ownerType" and "ownerId" are required')
      if (!a.inventoryId && !a.itemName) return err('"inventoryId" or "itemName" is required')
      let row: Record<string, unknown> | null
      if (a.inventoryId) {
        row = await db.prepare('SELECT * FROM resource_inventory WHERE id = ? AND owner_type = ? AND owner_id = ?').bind(a.inventoryId, a.ownerType, a.ownerId).first() as Record<string, unknown> | null
      } else {
        row = await db.prepare('SELECT * FROM resource_inventory WHERE owner_type = ? AND owner_id = ? AND item_name = ? AND quantity > 0 LIMIT 1').bind(a.ownerType, a.ownerId, a.itemName).first() as Record<string, unknown> | null
      }
      if (!row) return err(`Resource not found for ${a.ownerType} ${a.ownerId}: ${a.itemName ?? a.inventoryId}`)
      const remaining = Math.max(0, (row.quantity as number) - a.quantity)
      await db.prepare('UPDATE resource_inventory SET quantity = ?, updated_at = ? WHERE id = ?').bind(remaining, now, row.id).run()
      const catalogEntry = CRATE_TABLE.find(c => c.name === row!.item_name)
      return ok({
        success: true, actionType: 'consume', inventoryId: row.id, itemName: row.item_name,
        consumed: a.quantity, remaining, effect: catalogEntry?.note ?? null,
      })
    }
    case 'degrade': {
      if (!a.ownerType || !a.ownerId || !a.worldId) return err('"ownerType", "ownerId", and "worldId" are required')
      const result = await degradeOwnerResources(db, a.ownerType, a.ownerId, a.worldId, a.day, a.days, a.ateToday)
      return ok({ success: true, actionType: 'degrade', ...result })
    }
    case 'improvise':
    case 'craft': {
      if (!a.biomeName || !a.itemName) return err('"biomeName" and "itemName" are required')
      const list = BIOME_RESOURCES[biomeKey(a.biomeName)]
      if (!list) return err(`Unknown biome: ${a.biomeName}`)
      const entry = list.find(r => r.name.toLowerCase() === a.itemName!.toLowerCase() && r.kind === 'craft')
      if (!entry) return err(`No craftable "${a.itemName}" known for biome "${a.biomeName}"`)

      const roll = a.rollValue ?? Math.floor(Math.random() * 20) + 1
      const total = roll + a.abilityModifier
      const succeeded = total >= entry.dc
      // Improvise (WIS, no proper tools) carries a 50% break-on-use chance
      // per the issue; craft (INT, proper materials/tools) does not.
      const improvised = match.matched === 'improvise'
      const breaksOnUse = improvised ? Math.random() < 0.5 : false

      if (succeeded && a.ownerType && a.ownerId && a.worldId) {
        const id = crypto.randomUUID()
        await db.prepare('INSERT INTO resource_inventory (id, world_id, owner_type, owner_id, item_name, category, quantity, degradation_timer, expires_on_day, acquired_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?, ?)')
          .bind(id, a.worldId, a.ownerType, a.ownerId, entry.name, improvised ? 'improvised' : 'crafted', a.day, now, now).run()
      }

      return ok({
        success: true, actionType: match.matched, itemName: entry.name, biomeName: a.biomeName,
        roll, total, dc: entry.dc, succeeded, improvised, breaksOnUse, note: entry.note,
      })
    }
    case 'scavenge': {
      if (!a.biomeName) return err('"biomeName" is required')
      const list = BIOME_RESOURCES[biomeKey(a.biomeName)]
      if (!list) return err(`Unknown biome: ${a.biomeName}`)
      const forageable = list.filter(r => r.kind === 'forage')
      if (forageable.length === 0) return err(`No forageable resources known for biome "${a.biomeName}"`)
      const entry = forageable[Math.floor(Math.random() * forageable.length)]

      const roll = a.rollValue ?? Math.floor(Math.random() * 20) + 1
      const total = roll + a.abilityModifier
      const succeeded = total >= entry.dc

      if (succeeded && a.ownerType && a.ownerId && a.worldId) {
        const id = crypto.randomUUID()
        await db.prepare('INSERT INTO resource_inventory (id, world_id, owner_type, owner_id, item_name, category, quantity, degradation_timer, expires_on_day, acquired_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?, ?)')
          .bind(id, a.worldId, a.ownerType, a.ownerId, entry.name, 'foraged', a.day, now, now).run()
      }

      return ok({
        success: true, actionType: 'scavenge', biomeName: a.biomeName, itemName: entry.name,
        roll, total, dc: entry.dc, succeeded, note: entry.note,
      })
    }
    case 'get_state': {
      if (!a.ownerType || !a.ownerId) return err('"ownerType" and "ownerId" are required')
      const { results } = await db.prepare('SELECT * FROM resource_inventory WHERE owner_type = ? AND owner_id = ? ORDER BY category, item_name').bind(a.ownerType, a.ownerId).all()
      const state = await db.prepare('SELECT days_without_food, updated_at FROM resource_owner_state WHERE owner_type = ? AND owner_id = ?').bind(a.ownerType, a.ownerId).first() as { days_without_food: number; updated_at: string } | null
      const daysWithoutFood = state?.days_without_food ?? 0
      return ok({
        success: true, actionType: 'get_state', ownerType: a.ownerType, ownerId: a.ownerId,
        inventory: results, count: results.length,
        daysWithoutFood, starvation: starvationTier(daysWithoutFood),
      })
    }
  }
}
