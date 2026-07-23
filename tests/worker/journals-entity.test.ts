// Tests for GET /api/entities/journals, /journals/:id, and /journals/:id/participants.
// Journals have no admin write route yet (read-only entity type for now), so
// journal/journal_participants rows are seeded directly via env.RPG_DB.
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach, describe as innerDescribe } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('Journals entity reads', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    const json = (await res.json()) as Record<string, any>
    const text = json.result?.content?.[0]?.text
    return text ? JSON.parse(text) : json
  }

  async function seedJournal(
    overrides: Partial<{
      id: string
      name: string
      entry: string
      date_year: number
      date_month: number
      date_day: number
      calendar_id: string | null
      is_private: number
    }> = {},
  ): Promise<string> {
    const id = overrides.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT INTO journals (id, name, entry, date_year, date_month, date_day, calendar_id, is_private, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        overrides.name ?? 'Session 1',
        overrides.entry ?? 'The party arrived at the tavern.',
        overrides.date_year ?? 2184,
        overrides.date_month ?? 7,
        overrides.date_day ?? 1,
        overrides.calendar_id ?? null,
        overrides.is_private ?? 0,
        now,
        now,
      )
      .run()
    return id
  }

  async function addParticipant(journalId: string, entityType: string, entityId: string) {
    await env.RPG_DB.prepare(
      'INSERT INTO journal_participants (id, journal_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), journalId, entityType, entityId, new Date().toISOString())
      .run()
  }

  innerDescribe('GET /api/entities/journals', () => {
    it('returns an empty list when no journals exist', async () => {
      const res = await SELF.fetch('http://example.com/api/entities/journals')
      const body = (await res.json()) as Record<string, any>
      expect(body.journals).toEqual([])
      expect(body.total).toBe(0)
    })

    it('returns journals ordered by date descending', async () => {
      await seedJournal({ name: 'Early Session', date_year: 2184, date_month: 1, date_day: 1 })
      await seedJournal({ name: 'Later Session', date_year: 2184, date_month: 7, date_day: 1 })
      const res = await SELF.fetch('http://example.com/api/entities/journals')
      const body = (await res.json()) as Record<string, any>
      expect(body.total).toBe(2)
      expect(body.journals.map((j: any) => j.name)).toEqual(['Later Session', 'Early Session'])
    })

    it('does not include the entry field in the list view', async () => {
      await seedJournal()
      const res = await SELF.fetch('http://example.com/api/entities/journals')
      const body = (await res.json()) as Record<string, any>
      expect(body.journals[0].entry).toBeUndefined()
    })
  })

  innerDescribe('GET /api/entities/journals/:id', () => {
    it('returns a single journal by id, including entry text', async () => {
      const id = await seedJournal({ name: 'The Ambush', entry: 'Bandits struck at dusk.' })
      const res = await SELF.fetch(`http://example.com/api/entities/journals/${id}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, any>
      expect(body.journal.name).toBe('The Ambush')
      expect(body.journal.entry).toBe('Bandits struck at dusk.')
    })

    it('returns 404 for an unknown journal', async () => {
      const res = await SELF.fetch('http://example.com/api/entities/journals/nonexistent')
      expect(res.status).toBe(404)
    })
  })

  innerDescribe('GET /api/entities/journals/:id/participants', () => {
    it('returns an empty list when a journal has no participants', async () => {
      const journalId = await seedJournal()
      const res = await SELF.fetch(
        `http://example.com/api/entities/journals/${journalId}/participants`,
      )
      const body = (await res.json()) as Record<string, any>
      expect(body.participants).toEqual([])
      expect(body.total).toBe(0)
    })

    it('resolves character, location, quest, and nation participant names', async () => {
      const journalId = await seedJournal()

      const char = await callTool('character_manage', { action: 'create', name: 'Syreth' })

      const now = new Date().toISOString()
      const roomId = crypto.randomUUID()
      await env.RPG_DB.prepare(
        `INSERT INTO room_nodes (id, name, base_description, biome_context, atmospherics, exits, entity_ids, created_at, updated_at, visited_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          roomId,
          'The Rusty Tankard',
          'A dim, smoky tavern.',
          'dungeon',
          '[]',
          '[]',
          '[]',
          now,
          now,
          0,
        )
        .run()

      const world = await callTool('rpg', {
        sub: 'world',
        action: 'create',
        name: `World ${crypto.randomUUID()}`,
        theme: 'fantasy',
      })
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Find the Amulet',
        description: 'A quest.',
      })

      const nationId = crypto.randomUUID()
      await env.RPG_DB.prepare(
        `INSERT INTO nations (id, world_id, name, leader, ideology, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(nationId, world.worldId, 'The Sunlit Kingdom', 'Queen Elowen', 'monarchy', now, now)
        .run()

      await addParticipant(journalId, 'character', char.characterId)
      await addParticipant(journalId, 'location', roomId)
      await addParticipant(journalId, 'quest', quest.questId)
      await addParticipant(journalId, 'nation', nationId)

      const res = await SELF.fetch(
        `http://example.com/api/entities/journals/${journalId}/participants`,
      )
      const body = (await res.json()) as Record<string, any>
      expect(body.total).toBe(4)
      const byType = Object.fromEntries(
        body.participants.map((p: any) => [p.entity_type, p.entity_name]),
      )
      expect(byType.character).toBe('Syreth')
      expect(byType.location).toBe('The Rusty Tankard')
      expect(byType.quest).toBe('Find the Amulet')
      expect(byType.nation).toBe('The Sunlit Kingdom')
    })

    it('falls back to "Unknown" for an unrecognized entity_type', async () => {
      const journalId = await seedJournal()
      await addParticipant(journalId, 'artifact', 'some-artifact-id')
      const res = await SELF.fetch(
        `http://example.com/api/entities/journals/${journalId}/participants`,
      )
      const body = (await res.json()) as Record<string, any>
      expect(body.participants[0].entity_name).toBe('Unknown')
    })

    it('falls back to "Unknown" when the referenced entity no longer exists', async () => {
      const journalId = await seedJournal()
      await addParticipant(journalId, 'character', 'deleted-character-id')
      const res = await SELF.fetch(
        `http://example.com/api/entities/journals/${journalId}/participants`,
      )
      const body = (await res.json()) as Record<string, any>
      expect(body.participants[0].entity_name).toBe('Unknown')
    })
  })
})
