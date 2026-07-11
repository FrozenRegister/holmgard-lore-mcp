// Tests for GET /api/entities/races and /api/entities/races/:id.
// The races table has no admin write route yet (read-only entity type for now),
// so tests seed rows directly via env.RPG_DB.
import { describe } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach, describe as innerDescribe } from 'vitest'
import { setupRpgDb } from './setup-d1'

describe('Races entity reads', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function seedRace(overrides: Partial<{
    id: string; name: string; description: string; is_extinct: number; parent_race_id: string | null
  }> = {}): Promise<string> {
    const id = overrides.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT INTO races (id, name, description, is_extinct, parent_race_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id,
      overrides.name ?? 'Elf',
      overrides.description ?? 'A long-lived ancestry.',
      overrides.is_extinct ?? 0,
      overrides.parent_race_id ?? null,
      now, now
    ).run()
    return id
  }

  innerDescribe('GET /api/entities/races', () => {
    it('returns an empty list when no races exist', async () => {
      const res = await SELF.fetch('http://example.com/api/entities/races')
      const body = await res.json() as Record<string, any>
      expect(body.races).toEqual([])
      expect(body.total).toBe(0)
    })

    it('returns races ordered by name', async () => {
      await seedRace({ name: 'Zephyrian' })
      await seedRace({ name: 'Aelthari' })
      const res = await SELF.fetch('http://example.com/api/entities/races')
      const body = await res.json() as Record<string, any>
      expect(body.total).toBe(2)
      expect(body.races.map((r: any) => r.name)).toEqual(['Aelthari', 'Zephyrian'])
    })

    it('normalises is_extinct to a boolean and parent_race_id when present', async () => {
      const parentId = await seedRace({ name: 'Ancient Ones', is_extinct: 1 })
      await seedRace({ name: 'Descendants', parent_race_id: parentId })
      const res = await SELF.fetch('http://example.com/api/entities/races')
      const body = await res.json() as Record<string, any>
      const ancient = body.races.find((r: any) => r.name === 'Ancient Ones')
      const descendant = body.races.find((r: any) => r.name === 'Descendants')
      expect(ancient.is_extinct).toBe(true)
      expect(descendant.is_extinct).toBe(false)
      expect(descendant.parent_race_id).toBe(parentId)
      expect(ancient.parent_race_id).toBeNull()
    })
  })

  innerDescribe('GET /api/entities/races/:id', () => {
    it('returns a single race by id', async () => {
      const id = await seedRace({ name: 'Dwarf', description: 'Stout and sturdy.' })
      const res = await SELF.fetch(`http://example.com/api/entities/races/${id}`)
      expect(res.status).toBe(200)
      const body = await res.json() as Record<string, any>
      expect(body.race.name).toBe('Dwarf')
      expect(body.race.description).toBe('Stout and sturdy.')
    })

    it('returns 404 for an unknown race', async () => {
      const res = await SELF.fetch('http://example.com/api/entities/races/nonexistent')
      expect(res.status).toBe(404)
      const body = await res.json() as Record<string, any>
      expect(body.error).toBe('Not found')
    })
  })
})
