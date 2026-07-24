// Real-D1 tests for the creature_ai_tick hook and claim death-clearing
// (#445, #440 Phase 3). Exercises the hook end-to-end through runTickDriver plus
// clearDeadPredatorClaims against live characters/creatures.
import { describe } from '../support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from '../support/setup-d1'
import { runTickDriver } from '@/rpg/handlers/tick-hooks'
import { clearDeadPredatorClaims } from '@/rpg/utils/claims'
import { handleCreatureManage } from '@/rpg/handlers/creature-manage'

const WORLD = 'tick-world'
const DATE = '2187-01-10T00:00:00.000Z'

describe('creature_ai_tick hook + death-clearing (#445)', () => {
  const bindings = () => ({ RPG_DB: env.RPG_DB, LORE_DB: env.LORE_DB }) as any
  const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text)

  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(WORLD, WORLD, 'seed', 100, 100, now, now)
      .run()
    await env.RPG_DB.prepare(
      'INSERT OR REPLACE INTO world_state (world_id, current_date) VALUES (?, ?)',
    )
      .bind(WORLD, DATE)
      .run()
  })

  async function insertCharacter(
    id: string,
    opts: { q?: number | null; r?: number | null; hp?: number; claimedBy?: string | null } = {},
  ) {
    const now = new Date().toISOString()
    const claimedBy = opts.claimedBy ?? null
    await env.RPG_DB.prepare(
      `INSERT INTO characters
        (id, name, stats, hp, max_hp, ac, level, created_at, updated_at,
         current_hex_q, current_hex_r, claimed_by, claimed_until)
       VALUES (?, ?, '{}', ?, ?, 10, 1, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        id,
        opts.hp ?? 10,
        opts.hp ?? 10,
        now,
        now,
        opts.q ?? null,
        opts.r ?? null,
        claimedBy,
        claimedBy ? '2999-01-01T00:00:00.000Z' : null,
      )
      .run()
  }

  const register = (args: Record<string, unknown>) =>
    handleCreatureManage(bindings(), { action: 'register', worldId: WORLD, ...args })

  const tick = () =>
    runTickDriver(bindings(), env.RPG_DB, WORLD, DATE, DATE, { hooks: ['creature_ai_tick'] })

  it('is a mutating hook — dry_run is rejected', async () => {
    const result = await runTickDriver(bindings(), env.RPG_DB, WORLD, DATE, DATE, {
      hooks: ['creature_ai_tick'],
      dry_run: true,
    })
    expect(result.success).toBe(false)
    expect(result.narrator_summary).toContain('dry_run is not supported')
  })

  it('moves a feral hunter to melee and flags an encounter', async () => {
    await insertCharacter('char:deer', { q: 2, r: 0 })
    const reg = parse(
      await register({
        creatureKey: 'creature:panther',
        predatorTaxonomy: 'feral',
        currentState: 'hunting',
        hunger: 80,
        movementSpeed: 3,
        currentHexQ: 0,
        currentHexR: 0,
      }),
    )

    const result = await tick()
    expect(result.success).toBe(true)
    expect(result.flagged).toHaveLength(1)
    const data = result.flagged[0].data as { events: unknown[]; creatures_moved: number }
    expect(data.events).toHaveLength(1)
    expect(data.creatures_moved).toBe(1)

    // Creature persisted at the prey's hex.
    const row = await env.RPG_DB.prepare(
      'SELECT current_hex_q, current_hex_r FROM creature_ai_state WHERE id = ?',
    )
      .bind(reg.creatureId)
      .first<{ current_hex_q: number; current_hex_r: number }>()
    expect(row?.current_hex_q).toBe(2)
    expect(row?.current_hex_r).toBe(0)
  })

  it('a Shaper reaching its subject sets a real claim on the character', async () => {
    await insertCharacter('char:subject', { q: 2, r: 0 })
    await register({
      creatureKey: 'creature:shaper',
      predatorTaxonomy: 'shaper',
      currentState: 'stalking',
      creativeDrive: 60,
      movementSpeed: 3,
      currentHexQ: 0,
      currentHexR: 0,
    })

    const result = await tick()
    expect(result.success).toBe(true)

    const claim = await env.RPG_DB.prepare('SELECT claimed_by FROM characters WHERE id = ?')
      .bind('char:subject')
      .first<{ claimed_by: string }>()
    expect(claim?.claimed_by).toBe('creature:shaper')
  })

  it('a stub-taxonomy creature is left untouched (no persistence)', async () => {
    const reg = parse(
      await register({
        creatureKey: 'creature:spore',
        predatorTaxonomy: 'parasitic',
        currentState: 'dormant',
        currentHexQ: 4,
        currentHexR: 4,
      }),
    )
    const result = await tick()
    const data = result.flagged[0].data as { creatures_evaluated: number; creatures_moved: number }
    expect(data.creatures_evaluated).toBe(1)
    expect(data.creatures_moved).toBe(0)

    const row = await env.RPG_DB.prepare('SELECT current_state FROM creature_ai_state WHERE id = ?')
      .bind(reg.creatureId)
      .first<{ current_state: string }>()
    expect(row?.current_state).toBe('dormant') // unchanged
  })

  it('clears claims left by a removed predator, keeps live and non-creature claims', async () => {
    await register({ creatureKey: 'creature:alive' })
    await insertCharacter('char:orphaned', { claimedBy: 'creature:dead' })
    await insertCharacter('char:held', { claimedBy: 'creature:alive' })
    await insertCharacter('char:faction', { claimedBy: 'faction:sterling' })

    const res = await clearDeadPredatorClaims(bindings(), env.RPG_DB, WORLD)
    expect(res.cleared).toEqual(['char:orphaned'])

    const rows = await env.RPG_DB.prepare('SELECT id, claimed_by FROM characters ORDER BY id').all<{
      id: string
      claimed_by: string | null
    }>()
    const byId = Object.fromEntries(rows.results.map((r) => [r.id, r.claimed_by]))
    expect(byId['char:orphaned']).toBeNull()
    expect(byId['char:held']).toBe('creature:alive')
    expect(byId['char:faction']).toBe('faction:sterling')
  })

  it('reports zero work for a world with no creatures', async () => {
    const result = await tick()
    const data = result.flagged[0].data as { creatures_evaluated: number }
    expect(data.creatures_evaluated).toBe(0)
    expect(result.narrator_summary).toContain('0 creature(s)')
  })
})
