// Direct handler tests for drama-manage (sub: "drama" in rpg tool)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleDramaManage } from '../rpg/handlers/drama-manage'

describe('handleDramaManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const now = new Date().toISOString()

  async function seedChar(id: string, name: string, stats: Record<string, number> = {}, opts: { hostBodyId?: string | null; active?: number; hp?: number; maxHp?: number; updatedAt?: string } = {}) {
    const s = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...stats }
    const updatedAt = opts.updatedAt ?? now
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, host_body_id, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, JSON.stringify(s), opts.hp ?? 10, opts.maxHp ?? 10, 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, opts.hostBodyId ?? null, opts.active ?? 1, now, updatedAt).run()
  }

  // ---------------------------------------------------------------------------
  // unknown action
  // ---------------------------------------------------------------------------

  it('returns guiding error for unknown action', async () => {
    const r = await handleDramaManage(db(), { action: 'zap_everything' })
    expect(r.content[0].text).toContain('zap_everything')
  })

  // ---------------------------------------------------------------------------
  // roll_ability
  // ---------------------------------------------------------------------------

  it('roll_ability: requires character', async () => {
    const r = await handleDramaManage(db(), { action: 'roll_ability', ability: 'cha' })
    const body = JSON.parse(r.content[0].text) as { error: boolean }
    expect(body.error).toBe(true)
  })

  it('roll_ability: requires ability', async () => {
    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'char-x' })
    const body = JSON.parse(r.content[0].text) as { error: boolean }
    expect(body.error).toBe(true)
  })

  it('roll_ability: errors on unknown character', async () => {
    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'missing-id', ability: 'cha' })
    const body = JSON.parse(r.content[0].text) as { error: boolean; message: string }
    expect(body.error).toBe(true)
    expect(body.message).toContain('missing-id')
  })

  it('roll_ability: returns roll + modifier for known character', async () => {
    await seedChar('char-ra', 'Bellona', { cha: 18 }) // CHA 18 → mod +4
    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'char-ra', ability: 'cha' })
    const body = JSON.parse(r.content[0].text) as { success: boolean; character: string; score: number; modifier: number; roll: number; total: number; isNat1: boolean; isNat20: boolean }
    expect(body.success).toBe(true)
    expect(body.character).toBe('Bellona')
    expect(body.score).toBe(18)
    expect(body.modifier).toBe(4)
    expect(body.roll).toBeGreaterThanOrEqual(1)
    expect(body.roll).toBeLessThanOrEqual(20)
    expect(body.total).toBe(body.roll + 4)
    expect(typeof body.isNat1).toBe('boolean')
    expect(typeof body.isNat20).toBe('boolean')
  })

  it('roll_ability: advantage flag rolls twice and keeps higher (structure check)', async () => {
    await seedChar('char-adv', 'Adv Char', { int: 14 })
    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'char-adv', ability: 'int', advantage: true })
    const body = JSON.parse(r.content[0].text) as { success: boolean; roll: number; total: number }
    expect(body.success).toBe(true)
    expect(body.roll).toBeGreaterThanOrEqual(1)
  })

  it('roll_ability: disadvantage flag (structure check)', async () => {
    await seedChar('char-dis', 'Dis Char', { wis: 12 })
    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'char-dis', ability: 'wis', disadvantage: true })
    const body = JSON.parse(r.content[0].text) as { success: boolean; roll: number }
    expect(body.success).toBe(true)
    expect(body.roll).toBeGreaterThanOrEqual(1)
  })

  // ---------------------------------------------------------------------------
  // opposed_check
  // ---------------------------------------------------------------------------

  it('opposed_check: requires all four fields', async () => {
    const r = await handleDramaManage(db(), { action: 'opposed_check', character_a: 'x', ability_a: 'cha' })
    const body = JSON.parse(r.content[0].text) as { error: boolean }
    expect(body.error).toBe(true)
  })

  it('opposed_check: errors when character_a not found', async () => {
    await seedChar('char-oc-b', 'Side B')
    const r = await handleDramaManage(db(), { action: 'opposed_check', character_a: 'missing', ability_a: 'cha', character_b: 'char-oc-b', ability_b: 'wis' })
    const body = JSON.parse(r.content[0].text) as { error: boolean; message: string }
    expect(body.error).toBe(true)
    expect(body.message).toContain('missing')
  })

  it('opposed_check: errors when character_b not found', async () => {
    await seedChar('char-oc-a', 'Side A')
    const r = await handleDramaManage(db(), { action: 'opposed_check', character_a: 'char-oc-a', ability_a: 'cha', character_b: 'missing-b', ability_b: 'wis' })
    const body = JSON.parse(r.content[0].text) as { error: boolean; message: string }
    expect(body.error).toBe(true)
    expect(body.message).toContain('missing-b')
  })

  it('opposed_check: resolves two characters with winner/margin', async () => {
    await seedChar('char-oa', 'Bellona Keel', { cha: 20 })
    await seedChar('char-ob', 'Magdalena Kastelic', { wis: 16 })
    const r = await handleDramaManage(db(), { action: 'opposed_check', character_a: 'char-oa', ability_a: 'cha', character_b: 'char-ob', ability_b: 'wis' })
    const body = JSON.parse(r.content[0].text) as { success: boolean; winner: string; margin: number; a: { modifier: number }; b: { modifier: number } }
    expect(body.success).toBe(true)
    expect(['a', 'b', 'tie']).toContain(body.winner)
    expect(body.margin).toBeGreaterThanOrEqual(0)
    expect(body.a.modifier).toBe(5) // (20-10)/2
    expect(body.b.modifier).toBe(3) // (16-10)/2
  })

  it('opposed_check: accepts advantage/disadvantage side flags', async () => {
    await seedChar('char-adv-a', 'Adv A', { cha: 14 })
    await seedChar('char-adv-b', 'Dis B', { cha: 12 })
    const r = await handleDramaManage(db(), { action: 'opposed_check', character_a: 'char-adv-a', ability_a: 'cha', character_b: 'char-adv-b', ability_b: 'cha', advantage: 'a', disadvantage: 'b' })
    const body = JSON.parse(r.content[0].text) as { success: boolean; winner: string }
    expect(body.success).toBe(true)
    expect(['a', 'b', 'tie']).toContain(body.winner)
  })

  // ---------------------------------------------------------------------------
  // group_check
  // ---------------------------------------------------------------------------

  it('group_check: requires non-empty side_a', async () => {
    const r = await handleDramaManage(db(), { action: 'group_check', side_a: [], side_b: [{ character: 'x', ability: 'cha' }] })
    const body = JSON.parse(r.content[0].text) as { error: boolean }
    expect(body.error).toBe(true)
  })

  it('group_check: requires non-empty side_b', async () => {
    const r = await handleDramaManage(db(), { action: 'group_check', side_a: [{ character: 'x', ability: 'cha' }], side_b: [] })
    const body = JSON.parse(r.content[0].text) as { error: boolean }
    expect(body.error).toBe(true)
  })

  it('group_check: best mode — resolves group vs group', async () => {
    await seedChar('char-ga1', 'Ally One', { cha: 16 })
    await seedChar('char-ga2', 'Ally Two', { cha: 14 })
    await seedChar('char-gb1', 'Foe One', { wis: 12 })
    const r = await handleDramaManage(db(), {
      action: 'group_check',
      mode: 'best',
      side_a: [{ character: 'char-ga1', ability: 'cha' }, { character: 'char-ga2', ability: 'cha' }],
      side_b: [{ character: 'char-gb1', ability: 'wis' }],
    })
    const body = JSON.parse(r.content[0].text) as { success: boolean; winner: string; pooled_score_a: number; pooled_score_b: number; rolls_a: unknown[]; rolls_b: unknown[] }
    expect(body.success).toBe(true)
    expect(['a', 'b', 'tie']).toContain(body.winner)
    expect(body.rolls_a).toHaveLength(2)
    expect(body.rolls_b).toHaveLength(1)
  })

  it('group_check: sum mode aggregates modifiers', async () => {
    await seedChar('char-gs1', 'Sum One', { cha: 18 })
    await seedChar('char-gs2', 'Sum Two', { cha: 10 })
    await seedChar('char-gs3', 'Foe Sum', { wis: 14 })
    const r = await handleDramaManage(db(), {
      action: 'group_check',
      mode: 'sum',
      side_a: [{ character: 'char-gs1', ability: 'cha' }, { character: 'char-gs2', ability: 'cha' }],
      side_b: [{ character: 'char-gs3', ability: 'wis' }],
    })
    const body = JSON.parse(r.content[0].text) as { success: boolean; winner: string }
    expect(body.success).toBe(true)
    expect(['a', 'b', 'tie']).toContain(body.winner)
  })

  it('group_check: pool mode applies helper bonus', async () => {
    await seedChar('char-gp1', 'Pool Lead', { cha: 16 })
    await seedChar('char-gp2', 'Pool Helper', { cha: 14 })
    await seedChar('char-gp3', 'Pool Foe', { wis: 12 })
    const r = await handleDramaManage(db(), {
      action: 'group_check',
      mode: 'pool',
      side_a: [{ character: 'char-gp1', ability: 'cha' }, { character: 'char-gp2', ability: 'cha' }],
      side_b: [{ character: 'char-gp3', ability: 'wis' }],
    })
    const body = JSON.parse(r.content[0].text) as { success: boolean; winner: string }
    expect(body.success).toBe(true)
    expect(['a', 'b', 'tie']).toContain(body.winner)
  })

  it('group_check: notFound character produces notFound entry', async () => {
    await seedChar('char-gf1', 'Found One', { cha: 14 })
    await seedChar('char-gf2', 'Found Two', { cha: 12 })
    const r = await handleDramaManage(db(), {
      action: 'group_check',
      mode: 'best',
      side_a: [{ character: 'char-gf1', ability: 'cha' }, { character: 'not-in-db', ability: 'cha' }],
      side_b: [{ character: 'char-gf2', ability: 'cha' }],
    })
    const body = JSON.parse(r.content[0].text) as { success: boolean; rolls_a: Array<{ notFound: boolean }> }
    expect(body.success).toBe(true)
    const missing = body.rolls_a.find(r => r.notFound)
    expect(missing).toBeDefined()
  })

  // ---------------------------------------------------------------------------
  // social_combat
  // ---------------------------------------------------------------------------

  it('social_combat: requires at least 2 participants', async () => {
    const r = await handleDramaManage(db(), { action: 'social_combat', participants: [{ character: 'x', leverage: 0 }] })
    const body = JSON.parse(r.content[0].text) as { error: boolean }
    expect(body.error).toBe(true)
  })

  it('social_combat: runs multi-round leverage contest', async () => {
    await seedChar('char-sc1', 'Diplomat', { cha: 18 })
    await seedChar('char-sc2', 'Rival', { cha: 14 })
    const r = await handleDramaManage(db(), {
      action: 'social_combat',
      participants: [
        { character: 'char-sc1', goal: 'Force concession', leverage: 3 },
        { character: 'char-sc2', goal: 'Maintain control', leverage: 5 },
      ],
      rounds: 2,
      arena: 'Geneva boardroom',
      stakes: 'Hardware supply chain',
    })
    const body = JSON.parse(r.content[0].text) as {
      success: boolean; winner: string; winner_goal: string | null
      rounds: Array<{ round: number; rolls: unknown[]; winner_idx: number; leverage_after: number[] }>
      final_leverage: number[]; leverage_delta: number[]
      arena: string | null; stakes: string | null
    }
    expect(body.success).toBe(true)
    expect(body.rounds).toHaveLength(2)
    expect(body.final_leverage).toHaveLength(2)
    expect(body.leverage_delta).toHaveLength(2)
    expect(body.arena).toBe('Geneva boardroom')
    expect(body.stakes).toBe('Hardware supply chain')
  })

  it('social_combat: works without arena/stakes and with unknown character (uses defaults)', async () => {
    await seedChar('char-sc3', 'Known')
    const r = await handleDramaManage(db(), {
      action: 'social_combat',
      participants: [{ character: 'char-sc3', leverage: 0 }, { character: 'unknown-sc', leverage: 0 }],
      rounds: 1,
    })
    const body = JSON.parse(r.content[0].text) as { success: boolean; arena: null; stakes: null }
    expect(body.success).toBe(true)
    expect(body.arena).toBeNull()
    expect(body.stakes).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // dramatic_conflict
  // ---------------------------------------------------------------------------

  it('dramatic_conflict: requires at least 2 sides', async () => {
    const r = await handleDramaManage(db(), {
      action: 'dramatic_conflict',
      sides: [{ name: 'Solo', actors: ['x'], primary_ability: 'cha', momentum: 0 }],
    })
    const body = JSON.parse(r.content[0].text) as { error: boolean }
    expect(body.error).toBe(true)
  })

  it('dramatic_conflict: resolves multi-tick campaign', async () => {
    await seedChar('char-dc1', 'Catherine', { cha: 18 })
    await seedChar('char-dc2', 'Bellona', { cha: 16 })
    await seedChar('char-dc3', 'Margarete', { int: 20 })
    const r = await handleDramaManage(db(), {
      action: 'dramatic_conflict',
      title: 'Sovereign Defection Campaign',
      sides: [
        { name: 'Keel Coalition', actors: ['char-dc1', 'char-dc2'], primary_ability: 'cha', momentum: 3 },
        { name: 'Kessler Defense', actors: ['char-dc3'], primary_ability: 'int', momentum: -1 },
      ],
      ticks: 2,
      external_factors: [
        { name: 'Personhood ruling', modifier: -2, affects: 'Keel Coalition' },
        { name: 'Patrimoine seed', modifier: 2, affects: 'Keel Coalition' },
      ],
    })
    const body = JSON.parse(r.content[0].text) as {
      success: boolean; winner: string; title: string
      ticks: Array<{ tick: number; side_results: Array<{ side: string; external_bonus: number; total: number }>; winner_name: string; momentum_after: number[] }>
      final_momentum: number[]; momentum_shift: number[]
    }
    expect(body.success).toBe(true)
    expect(body.title).toBe('Sovereign Defection Campaign')
    expect(body.ticks).toHaveLength(2)
    expect(body.final_momentum).toHaveLength(2)
    expect(body.momentum_shift).toHaveLength(2)
    // external factors applied: Keel Coalition gets net +0 from -2+2
    const keel = body.ticks[0].side_results.find(s => s.side === 'Keel Coalition')!
    expect(keel.external_bonus).toBe(0) // -2 + 2 = 0
  })

  it('dramatic_conflict: side with no actors in D1 uses default score', async () => {
    await seedChar('char-dc4', 'Known Actor', { cha: 14 })
    const r = await handleDramaManage(db(), {
      action: 'dramatic_conflict',
      sides: [
        { name: 'Side A', actors: ['char-dc4'], primary_ability: 'cha', momentum: 0 },
        { name: 'Side B', actors: ['unknown-actor'], primary_ability: 'cha', momentum: 0 },
      ],
      ticks: 1,
    })
    const body = JSON.parse(r.content[0].text) as { success: boolean; winner: string }
    expect(body.success).toBe(true)
    expect(['Side A', 'Side B']).toContain(body.winner)
  })

  it('dramatic_conflict: side with empty actors array uses default score', async () => {
    await seedChar('char-dc5', 'Lone Wolf', { cha: 16 })
    const r = await handleDramaManage(db(), {
      action: 'dramatic_conflict',
      sides: [
        { name: 'Empty Side', actors: [], primary_ability: 'cha', momentum: 0 },
        { name: 'Lone Side', actors: ['char-dc5'], primary_ability: 'cha', momentum: 0 },
      ],
      ticks: 1,
    })
    const body = JSON.parse(r.content[0].text) as { success: boolean }
    expect(body.success).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // co-habitation stat resolution (#315) — Katerina Sloane hosting the Fork
  // (Cordelia Keel) and the General (Bellona Keel); physical stats always from
  // the host body, mental stats from whoever is currently driving (active=1).
  // ---------------------------------------------------------------------------

  it('roll_ability: a mental check on the host id uses the active passenger\'s score, not the host\'s own', async () => {
    await seedChar('kat-host', 'Katerina Sloane', { cha: 12 }, { updatedAt: now })
    // General is driving (active, more recently updated than the host row).
    await seedChar('kat-general', 'Bellona Keel', { cha: 18 }, { hostBodyId: 'kat-host', active: 1, updatedAt: '2184-01-02T00:00:00.000Z' })
    await seedChar('kat-fork', 'Cordelia Keel', { cha: 15 }, { hostBodyId: 'kat-host', active: 0, updatedAt: now })

    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'kat-host', ability: 'cha' })
    const body = JSON.parse(r.content[0].text) as { success: boolean; character: string; score: number }
    expect(body.success).toBe(true)
    expect(body.character).toBe('Bellona Keel')
    expect(body.score).toBe(18)
  })

  it('roll_ability: a physical check on the host id always uses the host\'s own score, even while a passenger drives', async () => {
    await seedChar('kat-host2', 'Katerina Sloane 2', { str: 12 }, { updatedAt: now })
    await seedChar('kat-general2', 'Bellona Keel 2', { str: 20 }, { hostBodyId: 'kat-host2', active: 1, updatedAt: '2184-01-02T00:00:00.000Z' })

    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'kat-host2', ability: 'str' })
    const body = JSON.parse(r.content[0].text) as { success: boolean; character: string; score: number }
    expect(body.success).toBe(true)
    // Name still follows the driver (the General is "speaking"/acting) but the
    // physical score is Katerina's own body, not the General's.
    expect(body.character).toBe('Bellona Keel 2')
    expect(body.score).toBe(12)
  })

  it('roll_ability: calling directly on the passenger\'s own id resolves the same group', async () => {
    await seedChar('kat-host3', 'Katerina Sloane 3', { cha: 12 }, { updatedAt: now })
    await seedChar('kat-general3', 'Bellona Keel 3', { cha: 18 }, { hostBodyId: 'kat-host3', active: 1, updatedAt: '2184-01-02T00:00:00.000Z' })

    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'kat-general3', ability: 'cha' })
    const body = JSON.parse(r.content[0].text) as { success: boolean; character: string; score: number }
    expect(body.character).toBe('Bellona Keel 3')
    expect(body.score).toBe(18)
  })

  it('opposed_check: co-habitating driver resolves correctly against a solo opponent', async () => {
    await seedChar('kat-host4', 'Katerina Sloane 4', { cha: 12 }, { updatedAt: now })
    await seedChar('kat-fork4', 'Cordelia Keel 4', { cha: 18 }, { hostBodyId: 'kat-host4', active: 1, updatedAt: '2184-01-02T00:00:00.000Z' })
    await seedChar('rival', 'Rival Diplomat', { cha: 10 })

    const r = await handleDramaManage(db(), {
      action: 'opposed_check', character_a: 'kat-host4', ability_a: 'cha', character_b: 'rival', ability_b: 'cha',
    })
    const body = JSON.parse(r.content[0].text) as { success: boolean; a: { character: string; score: number }; b: { character: string; score: number } }
    expect(body.success).toBe(true)
    expect(body.a.character).toBe('Cordelia Keel 4')
    expect(body.a.score).toBe(18)
    expect(body.b.character).toBe('Rival Diplomat')
    expect(body.b.score).toBe(10)
  })

  it('roll_ability: a solo (non-co-habitating) character is unaffected by cohabitation resolution', async () => {
    await seedChar('solo-char', 'Plain Villager', { cha: 14 })
    const r = await handleDramaManage(db(), { action: 'roll_ability', character: 'solo-char', ability: 'cha' })
    const body = JSON.parse(r.content[0].text) as { success: boolean; character: string; score: number }
    expect(body.character).toBe('Plain Villager')
    expect(body.score).toBe(14)
  })
})
