// tests/integration/agent-manage.test.ts
// Integration test: agent_manage — NPC AI agent management
// Covers: create, get, list, delete, set_slice, remove_slice, list_slices,
//   narrate, health, budget

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockContext } from '../../unit/mocks'
import { toolRegistry } from '@/tools/registry'

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
    ctx = createMockContext(
      { [CHARACTER_KEY]: JSON.stringify({ text: CHARACTER_TEXT, meta: { version: 1 } }) },
      true,
    )
  })

  describe('Agent lifecycle', () => {
    it('creates, gets, lists, and deletes an agent', async () => {
      const createRes = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
        model: '@cf/meta/llama-3.1-8b-instruct',
        status: 'active',
      })
      const createBody = await jsonBody(createRes)
      expect(createBody.result).toBeDefined()
      const agentId = createBody.result.id || createBody.result.agentId || 'test-agent-1'

      const getRes = await callAgent(ctx, { action: 'get', id: agentId })
      const getBody = await jsonBody(getRes)
      expect(getBody.result).toBeDefined()

      const listRes = await callAgent(ctx, { action: 'list' })
      const listBody = await jsonBody(listRes)
      expect(listBody.result).toBeDefined()

      const deleteRes = await callAgent(ctx, { action: 'delete', id: agentId })
      const deleteBody = await jsonBody(deleteRes)
      expect(deleteBody.result).toBeDefined()
    })
  })

  describe('Agent slices', () => {
    let agentId: string

    beforeEach(async () => {
      const createRes = await callAgent(ctx, { action: 'create', characterId: CHARACTER_KEY })
      const createBody = await jsonBody(createRes)
      agentId = createBody.result.id || createBody.result.agentId
    })

    it('sets, lists, and removes slices', async () => {
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

      const listRes = await callAgent(ctx, { action: 'list_slices', id: agentId })
      const listBody = await jsonBody(listRes)
      expect(listBody.result).toBeDefined()

      if (sliceId) {
        const removeRes = await callAgent(ctx, { action: 'remove_slice', id: agentId, sliceId })
        const removeBody = await jsonBody(removeRes)
        expect(removeBody.result).toBeDefined()
      }
    })
  })

  describe('Agent narration', () => {
    let agentId: string

    beforeEach(async () => {
      const createRes = await callAgent(ctx, { action: 'create', characterId: CHARACTER_KEY })
      const createBody = await jsonBody(createRes)
      agentId = createBody.result.id || createBody.result.agentId
    })

    it('narrates to an agent', async () => {
      const res = await callAgent(ctx, {
        action: 'narrate',
        id: agentId,
        observation: 'A dragon appears in the distance.',
        label: 'dragon-sighting',
      })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Agent health and budget', () => {
    let agentId: string

    beforeEach(async () => {
      const createRes = await callAgent(ctx, { action: 'create', characterId: CHARACTER_KEY })
      const createBody = await jsonBody(createRes)
      agentId = createBody.result.id || createBody.result.agentId
    })

    it('checks agent health', async () => {
      const res = await callAgent(ctx, { action: 'health', id: agentId })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })

    it('gets budget', async () => {
      const res = await callAgent(ctx, { action: 'budget', id: agentId })
      const body = await jsonBody(res)
      expect(body.result).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('does not crash on unknown action', async () => {
      const res = await callAgent(ctx, { action: 'nonexistent_action' })
      expect(res.status).toBe(200)
    })

    it('does not crash on missing action', async () => {
      const res = await callAgent(ctx, {})
      expect(res.status).toBe(200)
    })
  })
})
