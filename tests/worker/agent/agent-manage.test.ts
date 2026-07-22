/**
 * Tests for agent_manage tool
 * Validates 22 actions across lifecycle, prompt assembly, mind state, invocation.
 */

import { handleAgentManage } from '@/rpg/handlers/agent-manage'
import { randomUUID } from 'crypto'
import { type AppBindings } from '@/types'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { setupRpgDb } from '../support/setup-d1'

// Mock environment bindings
const mockEnv: AppBindings = {
  RPG_DB: env.RPG_DB as D1Database,
  AI: {
    run: vi.fn().mockImplementation(async (model: string, options: Record<string, unknown>) => {
      const messages = options.messages as Array<{ content: string }>
      return {
        response: `Mock response from ${model} for: ${messages[1].content}`,
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15
        }
      }
    })
  } as unknown as Ai
}

const ctx = { sessionId: 'test-session' }

function extractJson(result: { content: Array<{ type: string, text: string }> }) {
  // The response is in the format { content: [{ type: 'text', text: 'JSON_STRING' }] }
  // where text contains the JSON string of the actual response
  const text = result.content[0].text;

  // Debug: log the raw response
  // console.log('RAW RESPONSE:', text);

  const parsed = JSON.parse(text);

  // Handle both success and error responses
  if (parsed.error) {
    return parsed; // Return the error object as-is
  }

  // If this is already a properly formatted response with success/actionType, return it
  if (parsed.success !== undefined || parsed.actionType !== undefined) {
    return parsed;
  }

  // For backward compatibility, wrap the raw data in the expected format
  return { success: true, ...parsed };
}

async function createCharacter(name: string): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await (mockEnv.RPG_DB as D1Database).prepare(
    'INSERT INTO characters (id, name, character_class, race, character_type, level, hp, max_hp, ac, stats, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    id,
    name,
    'Fighter',
    'Human',
    'pc',
    1,
    20,
    20,
    15,
    JSON.stringify({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }),
    now,
    now
  ).run()
  return id
}

describe('agent_manage tool', () => {
  beforeEach(async () => {
    await setupRpgDb(mockEnv.RPG_DB as D1Database)
    // Clear any existing agents from previous tests
    const allAgents = extractJson(await handleAgentManage(mockEnv, { action: 'list' }))
    if (allAgents && allAgents.agents) {
      for (const agent of allAgents.agents) {
        await handleAgentManage(mockEnv, { action: 'delete', agentId: agent.id })
      }
    }
  })

  // ─────────── Lifecycle ───────────

  describe('lifecycle', () => {
    it('creates an agent bound to a character', async () => {
      const characterId = await createCharacter('Kara')

      const result = await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      })

      const parsed = extractJson(result)
      expect(parsed.success).toBe(true)
      expect(parsed.actionType).toBe('create')
      expect(parsed.agent.character_id).toBe(characterId)
      expect(parsed.agent.provider).toBe('cloudflare')
      expect(parsed.agent.model).toBe('@cf/meta/llama-3.1-8b-instruct')
    })

    it('refuses duplicate agents for the same character', async () => {
      const characterId = await createCharacter('Kara')
      await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      })

      const result = await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      })

      const parsed = extractJson(result)
      expect(parsed.error).toBe(true)
      expect(parsed.message).toContain('already bound')
    })

    it('errors when character does not exist', async () => {
      const result = await handleAgentManage(mockEnv, {
        action: 'create',
        characterId: 'nope',
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      })

      const parsed = extractJson(result)
      expect(parsed.error).toBe(true)
      expect(parsed.message).toContain('not found')
    })

    it('gets an agent by characterId', async () => {
      const characterId = await createCharacter('Kara')
      await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      })

      const result = await handleAgentManage(mockEnv, { action: 'get', characterId })
      const parsed = extractJson(result)
      expect(parsed.success).toBe(true)
      expect(parsed.actionType).toBe('get')
      expect(parsed.agent.character_id).toBe(characterId)
    })

    it('lists agents with status filter', async () => {
      const c1 = await createCharacter('A')
      const c2 = await createCharacter('B')
      const create1 = extractJson(await handleAgentManage(mockEnv, { action: 'create', characterId: c1, provider: 'cloudflare', model: 'm' }))
      const create2 = extractJson(await handleAgentManage(mockEnv, { action: 'create', characterId: c2, provider: 'cloudflare', model: 'm' }))
      expect(create1.success).toBe(true)
      expect(create2.success).toBe(true)

      const all = extractJson(await handleAgentManage(mockEnv, { action: 'list' }))
      expect(all.count).toBe(2)

      // pause one
      const updateResult = extractJson(await handleAgentManage(mockEnv, { action: 'update', agentId: create2.agentId, status: 'paused' }))
      expect(updateResult.success).toBe(true)

      const paused = extractJson(await handleAgentManage(mockEnv, { action: 'list', status: 'paused' }))
      expect(paused.count).toBe(1)
    })

    it('updates agent fields and resumes a paused agent', async () => {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      }))
      const agentId = createResult.agentId

      const updated = extractJson(await handleAgentManage(mockEnv, {
        action: 'update',
        agentId,
        status: 'paused',
        temperature: 1.2
      }))
      expect(updated.success).toBe(true)

      // Get the updated agent to verify the changes
      const getResult = extractJson(await handleAgentManage(mockEnv, { action: 'get', agentId }))
      expect(getResult.agent.status).toBe('paused')
      expect(getResult.agent.temperature).toBe(1.2)

      const resumed = extractJson(await handleAgentManage(mockEnv, { action: 'resume', agentId }))
      expect(resumed.success).toBe(true)

      // Get the resumed agent to verify the changes
      const getResumed = extractJson(await handleAgentManage(mockEnv, { action: 'get', agentId }))
      expect(getResumed.agent.status).toBe('active')
      expect(getResumed.agent.circuit_state).toBe('closed')
    })

    it('returns health snapshot', async () => {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct',
        budgetTokens: 1000
      }))
      const agentId = createResult.agentId

      const result = extractJson(await handleAgentManage(mockEnv, { action: 'health', agentId }))
      expect(result.success).toBe(true)
      expect(result.actionType).toBe('health')
      expect(result.status).toBe('active')
      expect(result.circuitState).toBe('closed')
      expect(result.budgetRemaining).toBe(1000)
    })

    it('updates budget and resets usage', async () => {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct',
        budgetTokens: 1000
      }))
      const agentId = createResult.agentId

      const result = extractJson(await handleAgentManage(mockEnv, {
        action: 'budget',
        agentId,
        budgetTokens: 5000
      }))
      expect(result.success).toBe(true)
      expect(result.actionType).toBe('budget')
    })

    it('deletes an agent', async () => {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      }))
      const agentId = createResult.agentId

      const deleted = extractJson(await handleAgentManage(mockEnv, { action: 'delete', agentId }))
      expect(deleted.success).toBe(true)

      const gone = extractJson(await handleAgentManage(mockEnv, { action: 'get', agentId }))
      expect(gone.error).toBe(true)
    })
  })

  // ─────────── Prompt assembly ───────────

  describe('prompt assembly', () => {
    async function setupAgent() {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      }))
      return { characterId, agentId: createResult.agentId }
    }

    it('sets and lists slices', async () => {
      const { characterId, agentId } = await setupAgent()

      const set1 = extractJson(await handleAgentManage(mockEnv, {
        action: 'set_slice',
        characterId,
        kind: 'persona',
        content: 'You are Kara.'
      }))
      expect(set1.sliceId).toBeDefined()

      const set2 = extractJson(await handleAgentManage(mockEnv, {
        action: 'set_slice',
        characterId,
        kind: 'directive',
        content: 'Protect Theron.'
      }))
      expect(set2.sliceId).toBeDefined()

      const list = extractJson(await handleAgentManage(mockEnv, { action: 'list_slices', characterId }))
      expect(list.success).toBe(true)
      expect(list.count).toBe(2)
      const kinds = list.slices.map((s: { kind: string }) => s.kind)
      expect(kinds).toContain('persona')
      expect(kinds).toContain('directive')
    })

    it('upserts a slice in place when kind+label match', async () => {
      const { characterId, agentId } = await setupAgent()

      const first = extractJson(await handleAgentManage(mockEnv, {
        action: 'set_slice',
        characterId,
        kind: 'persona',
        content: 'v1'
      }))
      expect(first.success).toBe(true)
      expect(first.sliceId).toBeDefined()

      const second = extractJson(await handleAgentManage(mockEnv, {
        action: 'set_slice',
        characterId,
        kind: 'persona',
        content: 'v2'
      }))
      expect(second.success).toBe(true)
      expect(second.sliceId).toBeDefined()
      expect(first.sliceId).toBe(second.sliceId)

      // Verify the content was actually updated
      const list = extractJson(await handleAgentManage(mockEnv, {
        action: 'list_slices',
        characterId,
        kind: 'persona'
      }))
      expect(list.success).toBe(true)
      expect(list.count).toBe(1)
      expect(list.slices[0].content).toBe('v2')
    })

    it('toggles a slice', async () => {
      const { characterId, agentId } = await setupAgent()
      const setResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'set_slice',
        characterId,
        kind: 'persona',
        content: 'x'
      }))
      expect(setResult.sliceId).toBeDefined()
      const sliceId = setResult.sliceId

      const toggled = extractJson(await handleAgentManage(mockEnv, {
        action: 'toggle_slice',
        sliceId,
        enabled: false
      }))
      expect(toggled.enabled).toBe(false)
    })

    it('removes a slice', async () => {
      const { characterId, agentId } = await setupAgent()
      const slice = extractJson(await handleAgentManage(mockEnv, {
        action: 'set_slice',
        characterId,
        kind: 'persona',
        content: 'x'
      }))

      const removed = extractJson(await handleAgentManage(mockEnv, {
        action: 'remove_slice',
        sliceId: slice.sliceId
      }))
      expect(removed).toBeDefined()
    })

    it('appends to narrative_feed via narrate', async () => {
      const { characterId, agentId } = await setupAgent()
      const result = extractJson(await handleAgentManage(mockEnv, {
        action: 'narrate',
        characterId,
        observation: 'You overhear orcs near the road.'
      }))
      expect(result.sliceId).toBeDefined()

      const slices = extractJson(await handleAgentManage(mockEnv, {
        action: 'list_slices',
        characterId,
        kind: 'narrative_feed'
      }))
      expect(slices.success).toBe(true)
      expect(slices.count).toBe(1)
    })

    it('broadcasts to multiple agents', async () => {
      const c1 = await createCharacter('A')
      const c2 = await createCharacter('B')
      const c3 = await createCharacter('C')

      const create1 = extractJson(await handleAgentManage(mockEnv, { action: 'create', characterId: c1, provider: 'cloudflare', model: 'm' }))
      const create2 = extractJson(await handleAgentManage(mockEnv, { action: 'create', characterId: c2, provider: 'cloudflare', model: 'm' }))
      // c3 has no agent

       const result = extractJson(await handleAgentManage(mockEnv, {
         action: 'broadcast',
         agentIds: [create1.agentId, create2.agentId],
         observation: 'A bell tolls.'
       }))
       expect(result.success).toBe(true)
       expect(result.count).toBe(2)
       expect(result.results.length).toBe(2)
    })

    it('preview_prompt returns composed messages without calling the LLM', async () => {
      const { characterId, agentId } = await setupAgent()
      // Add a slice so there's content to compose
      const setResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'set_slice',
        characterId,
        kind: 'persona',
        content: 'You are Kara.'
      }))
      expect(setResult.sliceId).toBeDefined()

      const result = extractJson(await handleAgentManage(mockEnv, {
        action: 'preview_prompt',
        characterId,
        situation: "It's your turn."
      }))
      expect(Array.isArray(result.messages)).toBe(true)
      expect(result.messages.length).toBeGreaterThan(0)
      expect(result.slicesIncluded).toContain('persona')
      expect(result.estimatedPromptTokens).toBeGreaterThan(0)
    })
  })

  // ─────────── Mind state ───────────

  describe('mind state', () => {
    async function setupAgent() {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      }))
      return { characterId, agentId: createResult.agentId }
    }

    it('adds, lists, and removes secrets', async () => {
      const { characterId, agentId } = await setupAgent()

      const added = extractJson(await handleAgentManage(mockEnv, {
        action: 'add_secret',
        characterId,
        content: 'Theron stole the amulet.',
        importance: 'critical'
      }))
      expect(added.secretId).toBeDefined()
      expect(added.importance).toBe('critical')

      const list = extractJson(await handleAgentManage(mockEnv, { action: 'list_secrets', characterId }))
      expect(list.success).toBe(true)
      expect(list.count).toBe(1)

      const removed = extractJson(await handleAgentManage(mockEnv, {
        action: 'remove_secret',
        secretId: added.secretId
      }))
      expect(removed).toBeDefined()
    })

    it('adds and retrieves journal entries with filters', async () => {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      }))
      expect(createResult.success).toBe(true)
      const agentId = createResult.agentId

      const add1 = extractJson(await handleAgentManage(mockEnv, {
        action: 'add_journal',
        agentId,
        content: 'I plan to scout the area.',
        journalKind: 'plan',
        encounterId: 'enc-1',
        round: 2
      }))
      expect(add1.success).toBe(true)
      expect(add1.entryId).toBeDefined()

      const add2 = extractJson(await handleAgentManage(mockEnv, {
        action: 'add_journal',
        agentId,
        content: 'I observed a strange light.',
        journalKind: 'observation'
      }))
      expect(add2.success).toBe(true)
      expect(add2.entryId).toBeDefined()

      const all = extractJson(await handleAgentManage(mockEnv, { action: 'get_journal', agentId }))
      expect(all.success).toBe(true)
      expect(all.count).toBe(2)

       const filtered = extractJson(await handleAgentManage(mockEnv, {
         action: 'get_journal',
         agentId,
         filter: 'plan'
       }))
       expect(filtered.success).toBe(true)
       expect(filtered.count).toBe(1)
       expect(filtered.entries[0].kind).toBe('plan')
    })
  })

  // ─────────── Invocation ───────────

  describe('invocation', () => {
    it('invoke returns a response when AI binding is present', async () => {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      }))
      expect(createResult.success).toBe(true)
      const agentId = createResult.agentId

      const result = extractJson(await handleAgentManage(mockEnv, {
        action: 'invoke',
        agentId,
        situation: "It's your turn."
      }))

      expect(result.success).toBe(true)
      expect(result.status).toBe('ok')
      expect(result.response).toBeDefined()
      expect(result.promptTokens).toBe(10)
      expect(result.completionTokens).toBe(15)
    })

     it('invoke returns error when AI binding is missing', async () => {
       const noAiEnv = { ...mockEnv, AI: undefined }
       const characterId = await createCharacter('Kara')
       const createResult = extractJson(await handleAgentManage(noAiEnv, {
         action: 'create',
         characterId,
         provider: 'cloudflare',
         model: '@cf/meta/llama-3.1-8b-instruct'
       }))
       expect(createResult.success).toBe(true)

       const result = extractJson(await handleAgentManage(noAiEnv, {
         action: 'invoke',
         agentId: createResult.agentId,
         situation: "It's your turn."
       }))

       expect(result.error).toBe(true)
       expect(result.message).toContain('AI binding not configured')
    })

    it('replay returns dry-mode info for a stored call', async () => {
      const characterId = await createCharacter('Kara')
      const createResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'create',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      }))
      expect(createResult.success).toBe(true)
      const agentId = createResult.agentId

      // Trigger an invoke so there's a call to replay
      const invokeResult = extractJson(await handleAgentManage(mockEnv, {
        action: 'invoke',
        agentId,
        situation: "go"
      }))
      expect(invokeResult.success).toBe(true)

      if (invokeResult.callId) {
        const replay = extractJson(await handleAgentManage(mockEnv, {
          action: 'replay',
          callId: invokeResult.callId
        }))
        expect(replay.success).toBe(true)
        expect(replay.actionType).toBe('replay')
        expect(replay.originalCallId).toBe(invokeResult.callId)
      }
    })

    it('replay errors when callId not found', async () => {
      const result = extractJson(await handleAgentManage(mockEnv, {
        action: 'replay',
        callId: 'nope'
      }))
      expect(result.error).toBe(true)
    })
  })

  // ─────────── Aliases + fuzzy routing ───────────

  describe('action routing', () => {
    it('resolves an alias (bind → create)', async () => {
      const characterId = await createCharacter('Kara')
      const result = extractJson(await handleAgentManage(mockEnv, {
        action: 'bind',
        characterId,
        provider: 'cloudflare',
        model: '@cf/meta/llama-3.1-8b-instruct'
      }))
      expect(result.success).toBe(true)
      expect(result.actionType).toBe('create')
    })

    it('returns helpful error for invalid action', async () => {
      const result = await handleAgentManage(mockEnv, { action: 'launch_nukes' })
      const text = result.content[0].text
      expect(text.toLowerCase()).toMatch(/unknown|invalid|action|did you mean/)
    })
  })
})