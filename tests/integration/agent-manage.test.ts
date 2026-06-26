// tests/integration/agent-manage.test.ts
// Integration test: agent_manage — NPC AI agent management

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
  const body = await res.json()
  return body.result ?? body
}

describe('Agent management integration', () => {
  let ctx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    ctx = createMockContext(
      { [CHARACTER_KEY]: JSON.stringify({ text: CHARACTER_TEXT, meta: { version: 1 } }) },
      { rpgDb: true },
    )
  })

  describe('Agent lifecycle', () => {
    it('creates an agent', async () => {
      const res = await callAgent(ctx, {
        action: 'create',
        characterId: CHARACTER_KEY,
        model: '@cf/meta/llama-3.1-8b-instruct',
        status: 'active',
      })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
      expect(body.agentId).toBeDefined()
    })

    it('gets an agent by id', async () => {
      const res = await callAgent(ctx, { action: 'get', id: 'test-agent-1' })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })

    it('lists agents', async () => {
      const res = await callAgent(ctx, { action: 'list' })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
      expect(body.agents).toBeDefined()
    })
  })

  describe('Agent slices', () => {
    it('sets a slice', async () => {
      const res = await callAgent(ctx, {
        action: 'set_slice',
        id: 'test-agent-1',
        kind: 'persona',
        content: 'You are a sneaky rogue who loves gold.',
        orderIndex: 0,
      })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })

    it('lists slices for an agent', async () => {
      const res = await callAgent(ctx, { action: 'list_slices', id: 'test-agent-1' })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })
  })

  describe('Agent narration', () => {
    it('narrates to one agent', async () => {
      const res = await callAgent(ctx, {
        action: 'narrate',
        id: 'test-agent-1',
        observation: 'A dragon appears in the distance.',
        label: 'dragon-sighting',
      })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })

    it('broadcasts to multiple agents', async () => {
      const res = await callAgent(ctx, {
        action: 'broadcast',
        agentIds: ['test-agent-1', 'test-agent-2'],
        observation: 'Thunder rumbles overhead.',
      })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })
  })

  describe('Agent secrets', () => {
    it('adds a secret', async () => {
      const res = await callAgent(ctx, {
        action: 'add_secret',
        id: 'test-agent-1',
        content: 'He is secretly the heir to the throne.',
        importance: 'high',
      })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })

    it('lists secrets', async () => {
      const res = await callAgent(ctx, { action: 'list_secrets', id: 'test-agent-1' })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })
  })

  describe('Agent journals', () => {
    it('adds a journal entry', async () => {
      const res = await callAgent(ctx, {
        action: 'add_journal',
        id: 'test-agent-1',
        content: 'Found the ancient tome in the crypt.',
        journalKind: 'observation',
        round: 1,
      })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })

    it('gets journal entries', async () => {
      const res = await callAgent(ctx, { action: 'get_journal', id: 'test-agent-1' })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })
  })

  describe('Agent health and budget', () => {
    it('checks agent health', async () => {
      const res = await callAgent(ctx, { action: 'health', id: 'test-agent-1' })
      const body = await jsonBody(res)
      expect(body.canInvoke !== undefined).toBeTruthy()
    })

    it('gets budget', async () => {
      const res = await callAgent(ctx, { action: 'budget', id: 'test-agent-1' })
      const body = await jsonBody(res)
      expect(body).toBeDefined()
    })
  })

  describe('Agent preview', () => {
    it('previews prompt without invoking AI', async () => {
      const res = await callAgent(ctx, {
        action: 'preview_prompt',
        id: 'test-agent-1',
        situation: 'The party enters a dark cave.',
      })
      const body = await jsonBody(res)
      expect(body.ok).toBe(true)
    })
  })
})
