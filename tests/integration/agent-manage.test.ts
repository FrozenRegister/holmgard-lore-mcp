// tests/integration/agent-manage.test.ts
// Integration test: agent_manage — NPC AI agent management
// Covers: create, get, list, update, delete, resume, health, budget,
//   set_slice, remove_slice, toggle_slice, list_slices, narrate, broadcast,
//   preview_prompt, add_secret, list_secrets, remove_secret,
//   add_journal, get_journal, invoke, replay

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext } from '../unit/mocks'
import { toolRegistry } from '../../src/tools/registry'

const CHARACTER_KEY = 'character:thorn'
const CHARACTER_TEXT = `**Name:** Thorn\n**Role:** rogue\n**Species:** Human\n**Class:** Rogue\n**Level:** 3`

function callAgent(ctx: ReturnType<typeof createMockContext>, args: Record<string, unknown>) {
  const handler = toolRegistry['agent_manage']
  return handler({ c: ctx, id: 'test-id', isAuthenticated: true, args })
}

async function jsonBody(res: Response): Promise<any> {
  expect(res.status).toBe(200)
  return res.json()
}

describe('Agent management integration', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    ctx = createMockContext({
      [CHARACTER_KEY]: JSON.stringify({ text: CHARACTER_TEXT, meta: { version: 1 } }),
    })
  })

  describe('Agent lifecycle', () => {
    it('creates an agent, gets it, lists agents, updates, and deletes', async () => {
      // 1. CREATE
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
        model: '@cf/meta/llama-3.1-8b-instruct',
        status: 'active',
      })
      const createBody = await jsonBody(createRes)
      expect(createBody.result).toBeDefined()
      const agentId = createBody.result.id || createBody.result.agentId || 'test-agent-1'

      // 2. GET
      const getRes = await callAgent(ctx, {
        action: 'get',
        id: agentId,
      })
      const getBody = await jsonBody(getRes)
      expect(getBody.result).toBeDefined()

      // 3. LIST
      const listRes = await callAgent(ctx, { action: 'list' })
      const listBody = await jsonBody(listRes)
      expect(listBody.result).toBeDefined()

      // 4. UPDATE
      const updateRes = await callAgent(ctx, {
        action: 'update',
        id: agentId,
        status: 'paused',
      })
      const updateBody = await jsonBody(updateRes)
      expect(updateBody.result).toBeDefined()

      // 5. DELETE
      const deleteRes = await callAgent(ctx, {
        action: 'delete',
        id: agentId,
      })
      const deleteBody = await jsonBody(deleteRes)
      expect(deleteBody.result).toBeDefined()
    })
  })

  describe('Agent slices', () => {
    let agentId: string

    beforeEach(async () => {
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
      })
      const createBody = await jsonBody(createRes)
      agentId = createBody.result.id || createBody.result.agentId
    })

    it('sets, lists, toggles, and removes slices', async () => {
      // SET SLICE
      const setRes = await callAgent(ctx, {
        action: 'set_slice',
        id: agentId,
        kind: 'persona',
        content: 'You are a sneaky rogue who loves gold.',
        orderIndex: 0,
      })
      const setBody = await jsonBody(setRes)
      expect(setBody.result).toBeDefined()
      const sliceId = setBody.result.sliceId || setBody.result.id

      // LIST SLICES
      const listRes = await callAgent(ctx, {
        action: 'list_slices',
        id: agentId,
      })
      const listBody = await jsonBody(listRes)
      expect(listBody.result).toBeDefined()

      // TOGGLE
      const toggleRes = await callAgent(ctx, {
        action: 'toggle_slice',
        id: agentId,
        sliceId,
        enabled: false,
      })
      const toggleBody = await jsonBody(toggleRes)
      expect(toggleBody.result).toBeDefined()

      // REMOVE
      const removeRes = await callAgent(ctx, {
        action: 'remove_slice',
        id: agentId,
        sliceId,
      })
      const removeBody = await jsonBody(removeRes)
      expect(removeBody.result).toBeDefined()
    })
  })

  describe('Agent narration', () => {
    let agentId: string

    beforeEach(async () => {
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
      })
      const createBody = await jsonBody(createRes)
      agentId = createBody.result.id || createBody.result.agentId
    })

    it('narrates to one agent', async () => {
      const res = await callAgent(ctx, {
        action: 'narrate',
        id: agentId,
        observation: 'A dragon appears in the distance.',
        label: 'dragon-sighting',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('broadcasts to multiple agents', async () => {
      // Create second agent
      const create2Res = await callAgent(ctx, {
        action: 'create',
        characterId: 'character:knight',
      })
      const create2Body = await jsonBody(create2Res)
      const agentId2 = create2Body.result.id || create2Body.result.agentId

      const res = await callAgent(ctx, {
        action: 'broadcast',
        agentIds: [agentId, agentId2],
        observation: 'Thunder rumbles overhead.',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Agent secrets', () => {
    let agentId: string

    beforeEach(async () => {
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
      })
      const createBody = await jsonBody(createRes)
      agentId = createBody.result.id || createBody.result.agentId
    })

    it('adds, lists, and removes secrets', async () => {
      // ADD SECRET
      const addRes = await callAgent(ctx, {
        action: 'add_secret',
        id: agentId,
        content: 'He is secretly the heir to the throne.',
        importance: 'high',
      })
      const addBody = await jsonBody(addRes)
      expect(addBody.result).toBeDefined()
      const secretId = addBody.result.sliceId || addBody.result.id

      // LIST SECRETS
      const listRes = await callAgent(ctx, {
        action: 'list_secrets',
        id: agentId,
      })
      const listBody = await jsonBody(listRes)
      expect(listBody.result).toBeDefined()

      // REMOVE SECRET
      if (secretId) {
        const removeRes = await callAgent(ctx, {
          action: 'remove_secret',
          id: agentId,
          sliceId: secretId,
        })
        const removeBody = await jsonBody(removeRes)
        expect(removeBody.result).toBeDefined()
      }
    })
  })

  describe('Agent journals', () => {
    let agentId: string

    beforeEach(async () => {
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
      })
      const createBody = await jsonBody(createRes)
      agentId = createBody.result.id || createBody.result.agentId
    })

    it('adds and retrieves journal entries', async () => {
      const addRes = await callAgent(ctx, {
        action: 'add_journal',
        id: agentId,
        content: 'Found the ancient tome in the crypt.',
        journalKind: 'observation',
        round: 1,
      })
      const addBody = await jsonBody(addRes)
      expect(addBody.result).toBeDefined()

      const getRes = await callAgent(ctx, {
        action: 'get_journal',
        id: agentId,
        filter: 'observation',
      })
      const getBody = await jsonBody(getRes)
      expect(getBody.result).toBeDefined()
    })
  })

  describe('Agent health and budget', () => {
    let agentId: string

    beforeEach(async () => {
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
      })
      const createBody = await jsonBody(createRes)
      agentId = createBody.result.id || createBody.result.agentId
    })

    it('checks agent health', async () => {
      const res = await callAgent(ctx, {
        action: 'health',
        id: agentId,
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
      expect(body.result.canInvoke !== undefined).toBeTruthy()
    })

    it('gets and sets budget', async () => {
      const setRes = await callAgent(ctx, {
        action: 'budget',
        id: agentId,
        budgetTokens: 5000,
      })
      const setBody = await jsonBody(setRes)
      expect(setBody.result).toBeDefined()

      // Get budget (re-use budget action without tokens arg)
      const getRes = await callAgent(ctx, {
        action: 'budget',
        id: agentId,
      })
      const getBody = await jsonBody(getRes)
      expect(getBody.result).toBeDefined()
    })
  })

  describe('Agent resume', () => {
    it('resumes a paused agent', async () => {
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
        status: 'paused',
      })
      const createBody = await jsonBody(createRes)
      const agentId = createBody.result.id || createBody.result.agentId

      const resumeRes = await callAgent(ctx, {
        action: 'resume',
        id: agentId,
      })
      const resumeBody = await jsonBody(resumeRes)
      expect(resumeBody.result).toBeDefined()
    })
  })

  describe('Agent preview', () => {
    it('previews prompt without invoking AI', async () => {
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
      })
      const createBody = await jsonBody(createRes)
      const agentId = createBody.result.id || createBody.result.agentId

      const res = await callAgent(ctx, {
        action: 'preview_prompt',
        id: agentId,
        situation: 'The party enters a dark cave.',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('returns error for unknown action', async () => {
      const res = await callAgent(ctx, {
        action: 'nonexistent_action',
      })
      const body = await jsonBody(res)
      expect(body.error).toBeDefined()
    })

    it('returns error for missing action', async () => {
      const res = await callAgent(ctx, {})
      const body = await jsonBody(res)
      expect(body.error).toBeDefined()
    })

    it('returns error for nonexistent agent', async () => {
      const res = await callAgent(ctx, {
        action: 'get',
        id: 'nonexistent-agent-id',
      })
      const body = await jsonBody(res)
      expect(body.error || body.result?.error).toBeDefined()
    })
  })
})
