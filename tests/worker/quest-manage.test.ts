// Tests for quest_manage tool — D1 quest CRUD and objective management
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach, describe as innerDescribe } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('quest_manage tool', () => {
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

    const resClone = res.clone()
    let json: Record<string, any>
    try {
      json = (await res.json()) as Record<string, any>
    } catch (e) {
      const text = await resClone.text()
      if (text.includes('Internal Server Error') || text.includes('Error:')) {
        return { error: true, message: text }
      }
      throw new Error(`Failed to parse response: ${text}`, { cause: e })
    }

    const text = json.result?.content?.[0]?.text
    if (text) {
      try {
        return JSON.parse(text)
      } catch {
        return { error: true, message: `Failed to parse response text: ${text}` }
      }
    }
    return json
  }

  async function seedWorld() {
    return await callTool('rpg', {
      sub: 'world',
      action: 'create',
      name: `World ${crypto.randomUUID()}`,
      theme: 'fantasy',
    })
  }

  // ── Create Tests ──────────────────────────────────────────────────────────

  innerDescribe('create action', () => {
    it('creates a new quest with required fields only', async () => {
      const world = await seedWorld()
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Slay the Dragon',
      })
      expect(r.success).toBe(true)
      expect(r.questId).toBeTruthy()
      expect(r.name).toBe('Slay the Dragon')
      expect(r.actionType).toBe('create')
    })

    it('creates a quest with all optional fields', async () => {
      const world = await seedWorld()
      const objectives = [
        { description: 'Find the dragon', completed: false },
        { description: 'Defeat the dragon', completed: false },
      ]
      const rewards = { gold: 1000, experience: 5000 }
      const prerequisites = ['quest:explore-map']

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Dragon Slayer',
        description: 'A legendary quest',
        objectives,
        rewards,
        prerequisites,
        giver: 'npc:king',
      })

      expect(r.success).toBe(true)
      expect(r.questId).toBeTruthy()

      // Retrieve to verify fields were stored
      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: r.questId,
      })
      expect(get.quest.description).toBe('A legendary quest')
      expect(get.quest.objectives).toEqual(objectives)
      expect(get.quest.rewards).toEqual(rewards)
      expect(get.quest.prerequisites).toEqual(prerequisites)
      expect(get.quest.giver).toBe('npc:king')
    })

    it('create without name returns error', async () => {
      const world = await seedWorld()
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('name')
      expect(r.message).toContain('required')
    })

    it('create without worldId returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        name: 'Test Quest',
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('worldId')
      expect(r.message).toContain('required')
    })

    it('create with empty objectives array', async () => {
      const world = await seedWorld()
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'No Objectives Quest',
        objectives: [],
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: r.questId,
      })
      expect(get.quest.objectives).toEqual([])
    })

    it('create with empty rewards object', async () => {
      const world = await seedWorld()
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'No Reward Quest',
        rewards: {},
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: r.questId,
      })
      expect(get.quest.rewards).toEqual({})
    })
  })

  // ── Get Tests ─────────────────────────────────────────────────────────────

  innerDescribe('get action', () => {
    it('retrieves a quest by id', async () => {
      const world = await seedWorld()
      const created = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test Quest',
        description: 'Test description',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: created.questId,
      })
      expect(r.success).toBe(true)
      expect(r.quest.name).toBe('Test Quest')
      expect(r.quest.description).toBe('Test description')
      expect(r.quest.id).toBe(created.questId)
    })

    it('retrieves a quest by questId parameter', async () => {
      const world = await seedWorld()
      const created = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Another Quest',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        questId: created.questId,
      })
      expect(r.success).toBe(true)
      expect(r.quest.name).toBe('Another Quest')
    })

    it('get non-existent quest returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: 'nonexistent-quest-id',
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('Quest not found')
    })

    it('get without id or questId returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('required')
    })

    it('get parses JSON fields correctly', async () => {
      const world = await seedWorld()
      const objectives = [
        { description: 'Step 1', completed: true, order: 1 },
        { description: 'Step 2', completed: false, order: 2 },
      ]
      const rewards = { gold: 500, items: ['sword', 'shield'] }
      const prerequisites = ['quest:first']

      const created = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Complex Quest',
        objectives,
        rewards,
        prerequisites,
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: created.questId,
      })
      expect(r.quest.objectives).toEqual(objectives)
      expect(r.quest.rewards).toEqual(rewards)
      expect(r.quest.prerequisites).toEqual(prerequisites)
    })
  })

  // ── List Tests ────────────────────────────────────────────────────────────

  innerDescribe('list action', () => {
    it('lists quests for a world with all filter', async () => {
      const world = await seedWorld()
      await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest 1',
      })
      await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest 2',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
        worldId: world.worldId,
      })
      expect(r.success).toBe(true)
      expect(r.count).toBe(2)
      expect(r.quests).toHaveLength(2)
    })

    it('lists quests with default filter (all)', async () => {
      const world = await seedWorld()
      const quest1 = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Active Quest',
      })
      const quest2 = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Another Quest',
      })
      await callTool('rpg', {
        sub: 'quest',
        action: 'complete',
        id: quest2.questId,
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
        worldId: world.worldId,
      })
      expect(r.success).toBe(true)
      expect(r.count).toBe(2)
    })

    it('filters by active status', async () => {
      const world = await seedWorld()
      const active = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Active Quest',
      })
      const completed = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Completed Quest',
      })
      await callTool('rpg', {
        sub: 'quest',
        action: 'complete',
        id: completed.questId,
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
        worldId: world.worldId,
        filter: 'active',
      })
      expect(r.success).toBe(true)
      expect(r.count).toBe(1)
      expect(r.quests[0].name).toBe('Active Quest')
    })

    it('filters by completed status', async () => {
      const world = await seedWorld()
      await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Active Quest',
      })
      const completed = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Completed Quest',
      })
      await callTool('rpg', {
        sub: 'quest',
        action: 'complete',
        id: completed.questId,
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
        worldId: world.worldId,
        filter: 'completed',
      })
      expect(r.success).toBe(true)
      expect(r.count).toBe(1)
      expect(r.quests[0].name).toBe('Completed Quest')
    })

    it('filters by failed status', async () => {
      const world = await seedWorld()
      const failed = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Failed Quest',
      })
      await callTool('rpg', {
        sub: 'quest',
        action: 'fail',
        id: failed.questId,
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
        worldId: world.worldId,
        filter: 'failed',
      })
      expect(r.success).toBe(true)
      expect(r.count).toBe(1)
      expect(r.quests[0].status).toBe('failed')
    })

    it('returns empty list for non-existent world', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
        worldId: 'nonexistent-world',
      })
      expect(r.success).toBe(true)
      expect(r.count).toBe(0)
      expect(r.quests).toEqual([])
    })

    it('defaults worldId to an empty string when omitted', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
      })
      expect(r.success).toBe(true)
      expect(r.count).toBe(0)
      expect(r.quests).toEqual([])
    })

    it('lists quests ordered by created_at desc', async () => {
      const world = await seedWorld()
      const quest1 = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'First Quest',
      })
      const quest2 = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Second Quest',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
        worldId: world.worldId,
      })
      expect(r.quests[0].name).toBe('Second Quest') // Most recent first
      expect(r.quests[1].name).toBe('First Quest')
    })
  })

  // ── Update Tests ──────────────────────────────────────────────────────────

  innerDescribe('update action', () => {
    it('updates quest name', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Old Name',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        name: 'New Name',
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.name).toBe('New Name')
    })

    it('updates quest description', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
        description: 'Old description',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        description: 'New description',
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.description).toBe('New description')
    })

    it('updates quest status', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
        status: 'active',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        status: 'inactive',
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('inactive')
    })

    it('updates quest objectives', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
        objectives: [{ description: 'Old objective', completed: false }],
      })

      const newObjectives = [
        { description: 'New objective 1', completed: false },
        { description: 'New objective 2', completed: true },
      ]
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        objectives: newObjectives,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives).toEqual(newObjectives)
    })

    it('updates quest rewards', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
        rewards: { gold: 100 },
      })

      const newRewards = { gold: 500, experience: 1000 }
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        rewards: newRewards,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.rewards).toEqual(newRewards)
    })

    it('updates quest prerequisites', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
        prerequisites: ['quest:intro'],
      })

      const newPrereqs = ['quest:intro', 'quest:main']
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        prerequisites: newPrereqs,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.prerequisites).toEqual(newPrereqs)
    })

    it('updates quest giver', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
        giver: 'npc:old-giver',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        giver: 'npc:new-giver',
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.giver).toBe('npc:new-giver')
    })

    it('silently ignores a fields entry already claimed by an explicit param', async () => {
      // Every real quests column (name, description, status, objectives,
      // rewards, prerequisites, giver) already has its own explicit update
      // param, and the rest (id/created_at/updated_at/world_id) are
      // blacklisted — so there is no spare, unclaimed, non-blacklisted column
      // on this table to demonstrate a genuine fields_applied passthrough
      // against. applyDynamicFields's "already claimed" branch (it silently
      // drops fields.name here because the explicit `name` param above wins)
      // is the one real, reachable branch this update case can exercise.
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        name: 'Explicit Name',
        fields: { name: 'Ignored Name' },
      })
      expect(r.success).toBe(true)
      expect(r.fields_applied).not.toContain('name')
      expect(r.fields_rejected).toEqual([])

      const get = await callTool('rpg', { sub: 'quest', action: 'get', id: quest.questId })
      expect(get.quest.name).toBe('Explicit Name')
    })

    it('rejects blacklisted fields on update', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        fields: { world_id: 'different-world' },
      })
      expect(r.success).toBe(true)
      expect(r.fields_rejected).toContainEqual({ field: 'world_id', reason: 'blacklisted' })
    })

    it('update without id or questId returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        name: 'New Name',
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('required')
    })

    it('update with questId parameter', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        questId: quest.questId,
        name: 'Updated',
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.name).toBe('Updated')
    })

    it('update clears description with empty string', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
        description: 'Has description',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'update',
        id: quest.questId,
        description: '',
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.description).toBe('')
    })
  })

  // ── Delete Tests ──────────────────────────────────────────────────────────

  innerDescribe('delete action', () => {
    it('deletes a quest', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest to Delete',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'delete',
        id: quest.questId,
      })
      expect(r.success).toBe(true)
      expect(r.questId).toBe(quest.questId)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.error).toBe(true)
    })

    it('delete with questId parameter', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest to Delete',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'delete',
        questId: quest.questId,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.error).toBe(true)
    })

    it('delete without id or questId returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'delete',
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('required')
    })

    it('delete non-existent quest does not error', async () => {
      // D1 DELETE with no matching rows doesn't error
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'delete',
        id: 'nonexistent',
      })
      expect(r.success).toBe(true)
    })
  })

  // ── Complete Tests ────────────────────────────────────────────────────────

  innerDescribe('complete action', () => {
    it('marks a quest as completed', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Completable Quest',
        status: 'active',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete',
        id: quest.questId,
      })
      expect(r.success).toBe(true)
      expect(r.status).toBe('completed')

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('completed')
    })

    it('complete with questId parameter', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete',
        questId: quest.questId,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('completed')
    })

    it('complete without id or questId returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete',
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('required')
    })

    it('complete updates updated_at timestamp', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const beforeComplete = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      await callTool('rpg', {
        sub: 'quest',
        action: 'complete',
        id: quest.questId,
      })

      const afterComplete = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })

      expect(afterComplete.quest.updated_at).not.toBe(beforeComplete.quest.updated_at)
    })

    it('complete uses "finish" alias', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'finish',
        id: quest.questId,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('completed')
    })

    it('complete uses "done" alias', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'done',
        id: quest.questId,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('completed')
    })
  })

  // ── Fail Tests ────────────────────────────────────────────────────────────

  innerDescribe('fail action', () => {
    it('marks a quest as failed', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Failable Quest',
        status: 'active',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'fail',
        id: quest.questId,
      })
      expect(r.success).toBe(true)
      expect(r.status).toBe('failed')

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('failed')
    })

    it('fail with questId parameter', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'fail',
        questId: quest.questId,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('failed')
    })

    it('fail without id or questId returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'fail',
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('required')
    })

    it('fail uses "abandon" alias', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'abandon',
        id: quest.questId,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('failed')
    })

    it('fail uses "failed" alias', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'failed',
        id: quest.questId,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.status).toBe('failed')
    })
  })

  // ── Add Objective Tests ───────────────────────────────────────────────────

  innerDescribe('add_objective action', () => {
    it('adds an objective to a quest', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest with Objectives',
        objectives: [],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        id: quest.questId,
        objective: { description: 'First objective', completed: false },
      })
      expect(r.success).toBe(true)
      expect(r.objectiveCount).toBe(1)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives).toHaveLength(1)
      expect(get.quest.objectives[0].description).toBe('First objective')
    })

    it('adds multiple objectives sequentially', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [],
      })

      await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        id: quest.questId,
        objective: { description: 'Objective 1', completed: false },
      })

      await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        id: quest.questId,
        objective: { description: 'Objective 2', completed: false, order: 2 },
      })

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives).toHaveLength(2)
      expect(get.quest.objectives[1].order).toBe(2)
    })

    it('add_objective with questId parameter', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        questId: quest.questId,
        objective: { description: 'Test objective', completed: false },
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives).toHaveLength(1)
    })

    it('add_objective without id or questId returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        objective: { description: 'Test', completed: false },
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('required')
    })

    it('add_objective without objective returns error', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        id: quest.questId,
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('objective')
      expect(r.message).toContain('required')
    })

    it('add_objective with string instead of object returns error', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        id: quest.questId,
        objective: 'Just a string',
      })
      // The handler has its own custom "must be an object, not a string" message
      // (see quest-manage.ts's typeof check in the add_objective case), but the
      // zod InputSchema already types `objective` as ObjectiveSchema.optional(),
      // so a string value is rejected by schema validation before the handler's
      // own typeof check ever runs — the actual error is zod's generic message.
      expect(r.error).toBe(true)
      expect(r.message).toContain('Expected object, received string')
    })

    it('add_objective to non-existent quest returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        id: 'nonexistent',
        objective: { description: 'Test', completed: false },
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('Quest not found')
    })

    it('add_objective uses "objective" alias', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'objective',
        id: quest.questId,
        objective: { description: 'Test', completed: false },
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives).toHaveLength(1)
    })

    it('add_objective with order field', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [],
      })

      await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        id: quest.questId,
        objective: { description: 'First', completed: false, order: 1 },
      })

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives[0].order).toBe(1)
    })

    it('add_objective with completed: true', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [],
      })

      await callTool('rpg', {
        sub: 'quest',
        action: 'add_objective',
        id: quest.questId,
        objective: { description: 'Already done', completed: true },
      })

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives[0].completed).toBe(true)
    })
  })

  // ── Complete Objective Tests ──────────────────────────────────────────────

  innerDescribe('complete_objective action', () => {
    it('marks an objective as complete', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [
          { description: 'Objective 1', completed: false },
          { description: 'Objective 2', completed: false },
        ],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: quest.questId,
        objectiveIndex: 0,
      })
      expect(r.success).toBe(true)
      expect(r.objectiveIndex).toBe(0)
      expect(r.allObjectivesComplete).toBe(false)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives[0].completed).toBe(true)
      expect(get.quest.objectives[1].completed).toBe(false)
    })

    it('complete_objective with questId parameter', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [{ description: 'Test', completed: false }],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        questId: quest.questId,
        objectiveIndex: 0,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives[0].completed).toBe(true)
    })

    it('complete_objective returns allObjectivesComplete true when all done', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [
          { description: 'Objective 1', completed: true },
          { description: 'Objective 2', completed: false },
        ],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: quest.questId,
        objectiveIndex: 1,
      })
      expect(r.allObjectivesComplete).toBe(true)
    })

    it('complete_objective without id or questId returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        objectiveIndex: 0,
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('required')
    })

    it('complete_objective without objectiveIndex returns error', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [{ description: 'Test', completed: false }],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: quest.questId,
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('objectiveIndex')
      expect(r.message).toContain('required')
    })

    it('complete_objective with out-of-range index returns error', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [{ description: 'Only one', completed: false }],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: quest.questId,
        objectiveIndex: 5,
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('out of range')
    })

    it('complete_objective to non-existent quest returns error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: 'nonexistent',
        objectiveIndex: 0,
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('Quest not found')
    })

    it('complete_objective uses "tick_objective" alias', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [{ description: 'Test', completed: false }],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'tick_objective',
        id: quest.questId,
        objectiveIndex: 0,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives[0].completed).toBe(true)
    })

    it('complete_objective uses "check_objective" alias', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [{ description: 'Test', completed: false }],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'check_objective',
        id: quest.questId,
        objectiveIndex: 0,
      })
      expect(r.success).toBe(true)

      const get = await callTool('rpg', {
        sub: 'quest',
        action: 'get',
        id: quest.questId,
      })
      expect(get.quest.objectives[0].completed).toBe(true)
    })

    it('complete_objective with negative index handled correctly', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [{ description: 'Test', completed: false }],
      })

      // Negative indices should fail the min(0) constraint or be treated as out of range
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: quest.questId,
        objectiveIndex: -1,
      })
      // Either validation fails or it's treated as out of range
      expect(r.error).toBe(true)
    })

    it('complete_objective on quest with no objectives returns error', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: quest.questId,
        objectiveIndex: 0,
      })
      expect(r.error).toBe(true)
      expect(r.message).toContain('out of range')
    })
  })

  // ── Invalid Input Tests ───────────────────────────────────────────────────

  innerDescribe('input validation', () => {
    it('rejects invalid action with helpful error', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'invalid_action_xyz',
      })
      // Unrecognized actions go through the fuzzy-match "guiding error" path
      // (matchAction/isGuidingError/formatGuidingError in fuzzy-enum.ts), whose
      // `error` field is a category string, not the plain err()-helper's
      // `error: true` boolean — see GuidingError['error'] in fuzzy-enum.ts.
      expect(r.error).toBe('invalid_action')
      expect(r.suggestions).toBeDefined()
    })

    it('rejects invalid status value on create', async () => {
      const world = await seedWorld()
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Test',
        status: 'invalid_status',
      })
      expect(r.error).toBe(true)
    })

    it('rejects invalid filter value on list', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'list',
        worldId: 'some-world',
        filter: 'invalid_filter',
      })
      expect(r.error).toBe(true)
    })

    it('rejects negative objectiveIndex', async () => {
      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: 'some-quest',
        objectiveIndex: -5,
      })
      expect(r.error).toBe(true)
    })

    it('rejects non-integer objectiveIndex', async () => {
      const world = await seedWorld()
      const quest = await callTool('rpg', {
        sub: 'quest',
        action: 'create',
        worldId: world.worldId,
        name: 'Quest',
        objectives: [{ description: 'Test', completed: false }],
      })

      const r = await callTool('rpg', {
        sub: 'quest',
        action: 'complete_objective',
        id: quest.questId,
        objectiveIndex: 0.5,
      })
      expect(r.error).toBe(true)
    })
  })
})
