// Tests for quest milestones: POST/PATCH/DELETE /admin/quests/:questId/milestones
// and GET /api/entities/quests/:id/milestones.
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach, describe as innerDescribe } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

const ADMIN_SECRET = 'test-secret-123'

describe('Quest Milestones', () => {
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

  async function seedQuest(): Promise<string> {
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
      name: 'Test Quest',
      description: 'A quest for milestone tests.',
    })
    return quest.questId
  }

  async function adminPost(path: string, body: Record<string, unknown>) {
    return SELF.fetch(`http://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  async function adminPatch(path: string, body: Record<string, unknown>) {
    return SELF.fetch(`http://example.com${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  async function adminDelete(path: string, body: Record<string, unknown>) {
    return SELF.fetch(`http://example.com${path}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  async function getMilestones(questId: string) {
    const res = await SELF.fetch(`http://example.com/api/entities/quests/${questId}/milestones`)
    return res.json() as Promise<Record<string, any>>
  }

  innerDescribe('POST /admin/quests/:questId/milestones', () => {
    it('creates a milestone with sort_order 0 for the first one', async () => {
      const questId = await seedQuest()
      const res = await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'Find the map',
        secret: ADMIN_SECRET,
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, any>
      expect(body.ok).toBe(true)
      expect(body.sort_order).toBe(0)
      expect(body.id).toBeTruthy()
    })

    it('auto-increments sort_order for subsequent milestones', async () => {
      const questId = await seedQuest()
      await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'First',
        secret: ADMIN_SECRET,
      })
      const res = await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'Second',
        secret: ADMIN_SECRET,
      })
      const body = (await res.json()) as Record<string, any>
      expect(body.sort_order).toBe(1)
    })

    it('rejects missing title', async () => {
      const questId = await seedQuest()
      const res = await adminPost(`/admin/quests/${questId}/milestones`, { secret: ADMIN_SECRET })
      expect(res.status).toBe(400)
      const body = (await res.json()) as Record<string, any>
      expect(body.error).toContain('title')
    })

    it('rejects whitespace-only title', async () => {
      const questId = await seedQuest()
      const res = await adminPost(`/admin/quests/${questId}/milestones`, {
        title: '   ',
        secret: ADMIN_SECRET,
      })
      expect(res.status).toBe(400)
    })

    it('rejects unauthorized requests', async () => {
      const questId = await seedQuest()
      const res = await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'X',
        secret: 'wrong',
      })
      expect(res.status).toBe(401)
    })

    it('accepts all optional fields', async () => {
      const questId = await seedQuest()
      await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'Defeat the boss',
        notes: 'Bring potions',
        status: 'in_progress',
        linked_entity_type: 'character',
        linked_entity_id: 'char-1',
        color: '#ff0000',
        is_private: true,
        secret: ADMIN_SECRET,
      })
      const listBody = await getMilestones(questId)
      expect(listBody.milestones[0].status).toBe('in_progress')
      expect(listBody.milestones[0].notes).toBe('Bring potions')
      expect(listBody.milestones[0].linked_entity_type).toBe('character')
      expect(listBody.milestones[0].linked_entity_id).toBe('char-1')
      expect(listBody.milestones[0].color).toBe('#ff0000')
      expect(listBody.milestones[0].is_private).toBe(true)
    })

    it('500 responses never expose internal details', async () => {
      const questId = await seedQuest()
      const res = await SELF.fetch(`http://example.com/admin/quests/${questId}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      })
      expect(res.status).toBe(500)
      const body = (await res.json()) as Record<string, any>
      expect(body.ok).toBe(false)
      expect(typeof body.error).toBe('string')
    })
  })

  innerDescribe('PATCH /admin/quests/:questId/milestones/:milestoneId', () => {
    async function seedMilestone(questId: string): Promise<string> {
      const res = await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'Original',
        secret: ADMIN_SECRET,
      })
      const body = (await res.json()) as Record<string, any>
      return body.id
    }

    it('updates every patchable field', async () => {
      const questId = await seedQuest()
      const milestoneId = await seedMilestone(questId)
      const res = await adminPatch(`/admin/quests/${questId}/milestones/${milestoneId}`, {
        title: 'Updated',
        status: 'completed',
        notes: 'done',
        linked_entity_type: 'location',
        linked_entity_id: 'loc-1',
        color: '#00ff00',
        is_private: true,
        sort_order: 5,
        secret: ADMIN_SECRET,
      })
      expect(res.status).toBe(200)
      const listBody = await getMilestones(questId)
      const m = listBody.milestones[0]
      expect(m.title).toBe('Updated')
      expect(m.status).toBe('completed')
      expect(m.notes).toBe('done')
      expect(m.linked_entity_type).toBe('location')
      expect(m.linked_entity_id).toBe('loc-1')
      expect(m.color).toBe('#00ff00')
      expect(m.is_private).toBe(true)
      expect(m.sort_order).toBe(5)
    })

    it('supports partial updates (only touches provided fields)', async () => {
      const questId = await seedQuest()
      const milestoneId = await seedMilestone(questId)
      const res = await adminPatch(`/admin/quests/${questId}/milestones/${milestoneId}`, {
        status: 'failed',
        secret: ADMIN_SECRET,
      })
      expect(res.status).toBe(200)
      const listBody = await getMilestones(questId)
      expect(listBody.milestones[0].title).toBe('Original')
      expect(listBody.milestones[0].status).toBe('failed')
    })

    it('rejects unauthorized requests', async () => {
      const questId = await seedQuest()
      const milestoneId = await seedMilestone(questId)
      const res = await adminPatch(`/admin/quests/${questId}/milestones/${milestoneId}`, {
        title: 'X',
        secret: 'wrong',
      })
      expect(res.status).toBe(401)
    })

    it('500 responses never expose internal details', async () => {
      const questId = await seedQuest()
      const milestoneId = await seedMilestone(questId)
      const res = await SELF.fetch(
        `http://example.com/admin/quests/${questId}/milestones/${milestoneId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: '{not valid json',
        },
      )
      expect(res.status).toBe(500)
    })
  })

  innerDescribe('DELETE /admin/quests/:questId/milestones/:milestoneId', () => {
    it('deletes a milestone', async () => {
      const questId = await seedQuest()
      const createRes = await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'To delete',
        secret: ADMIN_SECRET,
      })
      const { id } = (await createRes.json()) as Record<string, any>
      const res = await adminDelete(`/admin/quests/${questId}/milestones/${id}`, {
        secret: ADMIN_SECRET,
      })
      expect(res.status).toBe(200)
      const listBody = await getMilestones(questId)
      expect(listBody.milestones).toHaveLength(0)
    })

    it('rejects unauthorized requests', async () => {
      const questId = await seedQuest()
      const createRes = await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'X',
        secret: ADMIN_SECRET,
      })
      const { id } = (await createRes.json()) as Record<string, any>
      const res = await adminDelete(`/admin/quests/${questId}/milestones/${id}`, {
        secret: 'wrong',
      })
      expect(res.status).toBe(401)
    })

    it('500 responses never expose internal details', async () => {
      const questId = await seedQuest()
      const res = await SELF.fetch(
        `http://example.com/admin/quests/${questId}/milestones/whatever`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: '{not valid json',
        },
      )
      expect(res.status).toBe(500)
    })
  })

  innerDescribe('GET /api/entities/quests/:id/milestones', () => {
    it('returns milestones ordered by sort_order', async () => {
      const questId = await seedQuest()
      await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'First',
        secret: ADMIN_SECRET,
      })
      await adminPost(`/admin/quests/${questId}/milestones`, {
        title: 'Second',
        secret: ADMIN_SECRET,
      })
      const body = await getMilestones(questId)
      expect(body.total).toBe(2)
      expect(body.milestones.map((m: any) => m.title)).toEqual(['First', 'Second'])
    })

    it('returns an empty array for a quest with no milestones', async () => {
      const questId = await seedQuest()
      const body = await getMilestones(questId)
      expect(body.milestones).toEqual([])
      expect(body.total).toBe(0)
    })
  })
})
