// #315 — direct unit tests for the co-habitation host/driver resolution helpers.
import { it, expect, beforeEach } from 'vitest'
import { describe as vDesc, env } from '../../__tests__/helpers'
import { setupRpgDb } from '../../__tests__/setup-d1'
import { resolveCohabitation, resolveEffectiveStats } from './cohabitation'
import type { AppBindings } from '../../types'

vDesc('cohabitation resolution (#315)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function seedChar(id: string, name: string, stats: Record<string, number> = {}, opts: { hostBodyId?: string | null; active?: number; updatedAt?: string; hp?: number; maxHp?: number; ac?: number } = {}) {
    const s = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...stats }
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT OR IGNORE INTO characters (id, name, stats, hp, max_hp, ac, level, character_type, character_class, race, conditions, resistances, vulnerabilities, immunities, known_spells, prepared_spells, cantrips_known, currency, resource_pools, xp, host_body_id, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, JSON.stringify(s), opts.hp ?? 10, opts.maxHp ?? 10, opts.ac ?? 10, 1, 'pc', 'Fighter', 'Human', '[]', '[]', '[]', '[]', '[]', '[]', '[]', '{}', '{}', 0, opts.hostBodyId ?? null, opts.active ?? 1, now, opts.updatedAt ?? now).run()
  }

  const db = () => (env as unknown as AppBindings).RPG_DB!

  // ── resolveCohabitation ──────────────────────────────────────────────────

  it('returns null for a nonexistent character', async () => {
    expect(await resolveCohabitation(db(), 'no-such-id')).toBeNull()
  })

  it('a solo character resolves to itself for hostBodyId and driverId', async () => {
    await seedChar('solo-1', 'Solo')
    const r = await resolveCohabitation(db(), 'solo-1')
    expect(r).toEqual({ hostBodyId: 'solo-1', driverId: 'solo-1', isCohabitating: false })
  })

  it('resolves the active passenger as driver when called on the host id', async () => {
    await seedChar('host-1', 'Katerina', {}, { updatedAt: '2184-01-01T00:00:00.000Z' })
    await seedChar('gen-1', 'Bellona', {}, { hostBodyId: 'host-1', active: 1, updatedAt: '2184-01-02T00:00:00.000Z' })
    await seedChar('fork-1', 'Cordelia', {}, { hostBodyId: 'host-1', active: 0, updatedAt: '2184-01-01T00:00:00.000Z' })

    const r = await resolveCohabitation(db(), 'host-1')
    expect(r).toEqual({ hostBodyId: 'host-1', driverId: 'gen-1', isCohabitating: true })
  })

  it('resolves the same group when called directly on a passenger id', async () => {
    await seedChar('host-2', 'Katerina 2', {}, { updatedAt: '2184-01-01T00:00:00.000Z' })
    await seedChar('gen-2', 'Bellona 2', {}, { hostBodyId: 'host-2', active: 1, updatedAt: '2184-01-02T00:00:00.000Z' })

    const r = await resolveCohabitation(db(), 'gen-2')
    expect(r).toEqual({ hostBodyId: 'host-2', driverId: 'gen-2', isCohabitating: true })
  })

  it('falls back to the host row when nobody in the group is active', async () => {
    await seedChar('host-3', 'Katerina 3', {}, { active: 0, updatedAt: '2184-01-01T00:00:00.000Z' })
    await seedChar('pass-3', 'Passenger 3', {}, { hostBodyId: 'host-3', active: 0, updatedAt: '2184-01-01T00:00:00.000Z' })

    const r = await resolveCohabitation(db(), 'host-3')
    expect(r).toEqual({ hostBodyId: 'host-3', driverId: 'host-3', isCohabitating: true })
  })

  it('falls back to itself when host_body_id is a dangling reference to a nonexistent host', async () => {
    await seedChar('ghost-passenger', 'Ghost Passenger', {}, { hostBodyId: 'no-such-host', active: 1 })
    const r = await resolveCohabitation(db(), 'ghost-passenger')
    expect(r).toEqual({ hostBodyId: 'ghost-passenger', driverId: 'ghost-passenger', isCohabitating: false })
  })

  // ── resolveEffectiveStats ────────────────────────────────────────────────

  it('returns null for a nonexistent character', async () => {
    expect(await resolveEffectiveStats(db(), 'no-such-id')).toBeNull()
  })

  it('a solo character resolves its own stats/hp/ac unchanged', async () => {
    await seedChar('solo-2', 'Solo Two', { str: 14, cha: 9 }, { hp: 22, maxHp: 30, ac: 15 })
    const r = await resolveEffectiveStats(db(), 'solo-2')
    expect(r).toEqual({
      hostBodyId: 'solo-2', driverId: 'solo-2', isCohabitating: false, name: 'Solo Two',
      stats: { str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 9 },
      hp: 22, max_hp: 30, ac: 15,
    })
  })

  it('splits physical (host) vs. mental (driver) stats, and the display name follows the driver', async () => {
    await seedChar('host-4', 'Katerina 4', { str: 12, dex: 14, con: 20, int: 12, wis: 14, cha: 12 }, { hp: 18, maxHp: 20, ac: 13, updatedAt: '2184-01-01T00:00:00.000Z' })
    await seedChar('gen-4', 'Bellona 4', { str: 30, dex: 30, con: 30, int: 20, wis: 6, cha: 18 }, { hostBodyId: 'host-4', active: 1, updatedAt: '2184-01-02T00:00:00.000Z' })

    const r = await resolveEffectiveStats(db(), 'host-4')
    expect(r).toEqual({
      hostBodyId: 'host-4', driverId: 'gen-4', isCohabitating: true, name: 'Bellona 4',
      // str/dex/con/hp/max_hp/ac from the host body; int/wis/cha from the driver.
      stats: { str: 12, dex: 14, con: 20, int: 20, wis: 6, cha: 18 },
      hp: 18, max_hp: 20, ac: 13,
    })
  })

  it('resolves to the host itself (name and mental stats both) when nobody is driving', async () => {
    await seedChar('host-5', 'Katerina 5', { cha: 12 }, { active: 0 })
    await seedChar('pass-5', 'Passenger 5', { cha: 18 }, { hostBodyId: 'host-5', active: 0 })

    const r = await resolveEffectiveStats(db(), 'host-5')
    expect(r?.driverId).toBe('host-5')
    expect(r?.name).toBe('Katerina 5')
    expect(r?.stats.cha).toBe(12)
  })
})
