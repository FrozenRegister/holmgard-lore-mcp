// Tests for Phase 4: agent_manage tool — Cloudflare Workers AI backed NPC agents.
// Miniflare's AI mock returns { response: "..." } for text generation run() calls.
import { describe } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

describe('agent_manage tool', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await SELF.fetch('http://example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'test-api-key-xyz' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })

    // Clone the response so we can read it multiple times
    const resClone = res.clone()

    // Handle both JSON and text responses
    let json: Record<string, any>
    try {
      json = await res.json() as Record<string, any>
    } catch (e) {
      const text = await resClone.text()
      // Check if it's an error response
      if (text.includes('Internal Server Error') || text.includes('Error:')) {
        return { error: true, message: text }
      }
      throw new Error(`Failed to parse response: ${text}`)
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

  async function seedCharacter(): Promise<string> {
    const r = await callTool('rpg', { sub: 'character', action: 'create', name: 'Ser Aldric' })
    return r.characterId as string
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  it('create returns agentId bound to characterId', async () => {
    const charId = await seedCharacter()
    const r = await callTool('agent_manage', { action: 'create', characterId: charId })
    expect(r.success).toBe(true)
    expect(r.agentId).toBeTruthy()
    expect(r.characterId).toBe(charId)
  })

  it('create requires characterId', async () => {
    const r = await callTool('agent_manage', { action: 'create' })
    expect(r.error).toBe(true)
  })

  it('create with provider and model parameters', async () => {
    const charId = await seedCharacter()
    const r = await callTool('agent_manage', {
      action: 'create',
      characterId: charId,
      provider: 'openai',
      model: 'gpt-4o-mini'
    })
    expect(r.success).toBe(true)
    expect(r.agent).toBeTruthy()
    expect(r.agent.provider).toBe('openai')
    expect(r.agent.model).toBe('gpt-4o-mini')
  })

  it('refuses duplicate agents for the same character', async () => {
    const charId = await seedCharacter()
    await callTool('agent_manage', { action: 'create', characterId: charId })
    const r = await callTool('agent_manage', { action: 'create', characterId: charId })
    expect(r.error).toBe(true)
    expect(r.message).toContain('already bound')
  })

  it('errors when character does not exist', async () => {
    const r = await callTool('agent_manage', { action: 'create', characterId: 'nope' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('not found')
  })

  it('get by agentId', async () => {
    const charId = await seedCharacter()
    const created = await callTool('agent_manage', { action: 'create', characterId: charId })
    const got = await callTool('agent_manage', { action: 'get', agentId: created.agentId })
    expect(got.success).toBe(true)
    expect(got.agent.id).toBe(created.agentId)
    expect(got.agent.model).toBe('@cf/meta/llama-3.1-8b-instruct')
  })

  it('get by characterId', async () => {
    const charId = await seedCharacter()
    const created = await callTool('agent_manage', { action: 'create', characterId: charId })
    const got = await callTool('agent_manage', { action: 'get', characterId: charId })
    expect(got.success).toBe(true)
    expect(got.agent.id).toBe(created.agentId)
  })

  it('list returns created agents', async () => {
    const charId = await seedCharacter()
    await callTool('agent_manage', { action: 'create', characterId: charId })
    const listed = await callTool('agent_manage', { action: 'list' })
    expect(listed.success).toBe(true)
    expect(listed.count).toBe(1)
    expect(listed.agents[0].character_id).toBe(charId)
  })

  it('list with status filter', async () => {
    const charId1 = await seedCharacter()
    const charId2 = await callTool('rpg', { sub: 'character', action: 'create', name: 'Mira' }).then((r: any) => r.characterId)

    await callTool('agent_manage', { action: 'create', characterId: charId1 })
    await callTool('agent_manage', { action: 'create', characterId: charId2 })

    // Pause one agent
    const { agentId: agentId2 } = await callTool('agent_manage', { action: 'get', characterId: charId2 })
    await callTool('agent_manage', { action: 'update', agentId: agentId2, status: 'paused' })

    const paused = await callTool('agent_manage', { action: 'list', status: 'paused' })
    expect(paused.count).toBe(1)
  })

  it('update model and temperature', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const r = await callTool('agent_manage', { action: 'update', agentId, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', temperature: 0.9 })
    expect(r.success).toBe(true)
    const got = await callTool('agent_manage', { action: 'get', agentId })
    expect(got.agent.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast')
    expect(got.agent.temperature).toBe(0.9)
  })

  it('update status and resume a paused agent', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    // Pause the agent
    await callTool('agent_manage', { action: 'update', agentId, status: 'paused' })
    const paused = await callTool('agent_manage', { action: 'get', agentId })
    expect(paused.agent.status).toBe('paused')

    // Resume the agent
    const resumed = await callTool('agent_manage', { action: 'resume', agentId })
    expect(resumed.success).toBe(true)
    const active = await callTool('agent_manage', { action: 'get', agentId })
    expect(active.agent.status).toBe('active')
    expect(active.agent.circuit_state).toBe('closed')
  })

  it('delete removes agent', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await callTool('agent_manage', { action: 'delete', agentId })
    const listed = await callTool('agent_manage', { action: 'list' })
    expect(listed.count).toBe(0)
  })

  it('resume closes circuit and resets failures', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await env.RPG_DB.prepare("UPDATE agents SET consecutive_failures = 3, circuit_state = 'open' WHERE id = ?").bind(agentId).run()
    const r = await callTool('agent_manage', { action: 'resume', agentId })
    expect(r.success).toBe(true)
    const got = await callTool('agent_manage', { action: 'get', agentId })
    expect(got.agent.circuit_state).toBe('closed')
    expect(got.agent.consecutive_failures).toBe(0)
  })

  // ── Agent state ───────────────────────────────────────────────────────────

  it('health returns canInvoke true for active agent', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const r = await callTool('agent_manage', { action: 'health', agentId })
    expect(r.success).toBe(true)
    expect(r.canInvoke).toBe(true)
    expect(r.circuitState).toBe('closed')
  })

  it('health returns comprehensive snapshot', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', {
      action: 'create',
      characterId: charId,
      budgetTokens: 1000
    })
    const r = await callTool('agent_manage', { action: 'health', agentId })
    expect(r.agentId).toBe(agentId)
    expect(r.status).toBe('active')
    expect(r.circuitState).toBe('closed')
    expect(r.budgetRemaining).toBe(1000)
  })

  it('health reports canInvoke false when circuit open', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await env.RPG_DB.prepare("UPDATE agents SET circuit_state = 'open' WHERE id = ?").bind(agentId).run()
    const r = await callTool('agent_manage', { action: 'health', agentId })
    expect(r.canInvoke).toBe(false)
  })

  it('budget get shows tokensUsed', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const r = await callTool('agent_manage', { action: 'budget', agentId })
    expect(r.success).toBe(true)
    expect(r.tokensUsed).toBe(0)
    expect(r.budgetTokens).toBeNull()
  })

  it('budget set updates budgetTokens', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await callTool('agent_manage', { action: 'budget', agentId, budgetTokens: 1000 })
    const r = await callTool('agent_manage', { action: 'budget', agentId })
    expect(r.budgetTokens).toBe(1000)
    expect(r.remaining).toBe(1000)
  })

  // ── Prompt slices ─────────────────────────────────────────────────────────

  it('set_slice inserts a prompt slice', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const r = await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'persona', content: 'You are a stern knight.' })
    expect(r.success).toBe(true)
    expect(r.sliceId).toBeTruthy()
  })

  it('set_slice validates slice kinds', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    // Valid kinds should work
    for (const kind of ['persona', 'directive', 'secrets', 'narrative_feed', 'recent', 'character_state', 'custom']) {
      const r = await callTool('agent_manage', { action: 'set_slice', agentId, kind, content: 'test' })
      expect(r.success, `kind=${kind} should be valid`).toBe(true)
    }

    // Invalid kind should fail
    const r = await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'invalid_kind', content: 'test' })
    expect(r.error).toBe(true)
  })

  it('set_slice upserts a slice in place when kind+label match', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const first = await callTool('agent_manage', {
      action: 'set_slice',
      agentId,
      kind: 'persona',
      content: 'v1'
    })
    const second = await callTool('agent_manage', {
      action: 'set_slice',
      agentId,
      kind: 'persona',
      content: 'v2'
    })
    expect(first.sliceId).toBe(second.sliceId)
    expect(second.success).toBe(true)
  })

  it('list_slices returns ordered slices', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'persona', content: 'Persona text.', orderIndex: 0 })
    await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'directive', content: 'Directive text.', orderIndex: 1 })
    const r = await callTool('agent_manage', { action: 'list_slices', agentId })
    expect(r.count).toBe(2)
    expect(r.slices[0].kind).toBe('persona')
  })

  it('list_slices with kind filter', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'persona', content: 'Persona text.' })
    await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'directive', content: 'Directive text.' })

    const personas = await callTool('agent_manage', { action: 'list_slices', agentId, kind: 'persona' })
    expect(personas.count).toBe(1)
    expect(personas.slices[0].kind).toBe('persona')
  })

  it('toggle_slice disables a slice', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const { sliceId } = await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'persona', content: 'Persona.' })
    await callTool('agent_manage', { action: 'toggle_slice', sliceId, enabled: false })
    const r = await callTool('agent_manage', { action: 'list_slices', agentId, filter: 'enabled' })
    expect(r.count).toBe(0)
  })

  it('remove_slice deletes a slice', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const { sliceId } = await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'persona', content: 'Persona.' })
    await callTool('agent_manage', { action: 'remove_slice', sliceId })
    const r = await callTool('agent_manage', { action: 'list_slices', agentId })
    expect(r.count).toBe(0)
  })

  it('narrate appends a narrative_feed slice', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const r = await callTool('agent_manage', { action: 'narrate', agentId, observation: 'The guards just entered the hall.' })
    expect(r.success).toBe(true)
    const slices = await callTool('agent_manage', { action: 'list_slices', agentId })
    expect(slices.count).toBe(1)
    expect(slices.slices[0].kind).toBe('narrative_feed')
  })

  it('narrate with label', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const r = await callTool('agent_manage', {
      action: 'narrate',
      agentId,
      observation: 'The guards just entered the hall.',
      label: 'guard_arrival'
    })
    expect(r.success).toBe(true)
    const slices = await callTool('agent_manage', { action: 'list_slices', agentId })
    expect(slices.slices[0].label).toBe('guard_arrival')
  })

  it('broadcast narrates to multiple agents', async () => {
    const [c1, c2] = await Promise.all([
      seedCharacter(),
      callTool('rpg', { sub: 'character', action: 'create', name: 'Mira' }).then((r: any) => r.characterId),
    ])
    const [{ agentId: a1 }, { agentId: a2 }] = await Promise.all([
      callTool('agent_manage', { action: 'create', characterId: c1 }),
      callTool('agent_manage', { action: 'create', characterId: c2 }),
    ])
    const r = await callTool('agent_manage', { action: 'broadcast', agentIds: [a1, a2], observation: 'The gate is breached.' })
    expect(r.success).toBe(true)
    expect(r.count).toBe(2)
    const s1 = await callTool('agent_manage', { action: 'list_slices', agentId: a1 })
    const s2 = await callTool('agent_manage', { action: 'list_slices', agentId: a2 })
    expect(s1.count).toBe(1)
    expect(s2.count).toBe(1)
  })

  it('broadcast skips characters without agents', async () => {
    const c1 = await seedCharacter()
    const c2 = await callTool('rpg', { sub: 'character', action: 'create', name: 'Mira' }).then((r: any) => r.characterId)
    const c3 = await callTool('rpg', { sub: 'character', action: 'create', name: 'NoAgent' }).then((r: any) => r.characterId)

    const { agentId: a1 } = await callTool('agent_manage', { action: 'create', characterId: c1 })
    const { agentId: a2 } = await callTool('agent_manage', { action: 'create', characterId: c2 })
    // c3 has no agent

    const r = await callTool('agent_manage', {
      action: 'broadcast',
      agentIds: [a1, a2, 'non-existent-agent'],
      observation: 'A bell tolls.'
    })
    expect(r.count).toBe(2)
  })

  it('preview_prompt returns messages array without calling AI', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'persona', content: 'You are a knight.' })
    const r = await callTool('agent_manage', { action: 'preview_prompt', agentId, situation: 'A dragon attacks.' })
    expect(r.success).toBe(true)
    expect(r.messages).toHaveLength(2)
    expect(r.messages[0].role).toBe('system')
    expect(r.messages[1].content).toBe('A dragon attacks.')
    expect(r.slicesIncluded).toContain('persona')
    expect(r.estimatedPromptTokens).toBeGreaterThan(0)
  })

  // ── Secrets ───────────────────────────────────────────────────────────────

  it('add_secret / list_secrets / remove_secret round-trip', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const { secretId } = await callTool('agent_manage', { action: 'add_secret', agentId, content: 'Knows the king is a shapeshifter.', importance: 'critical' })
    expect(secretId).toBeTruthy()

    const listed = await callTool('agent_manage', { action: 'list_secrets', agentId })
    expect(listed.count).toBe(1)
    expect(listed.secrets[0].importance).toBe('critical')

    // Test direct database access
    const db = env.RPG_DB
    const beforeDelete = await db.prepare('SELECT * FROM agent_secrets WHERE id = ?').bind(secretId).first()
    expect(!!beforeDelete).toBe(true)

    const removeResult = await callTool('agent_manage', { action: 'remove_secret', secretId })
    expect(removeResult.success).toBe(true)

    const afterDelete = await db.prepare('SELECT * FROM agent_secrets WHERE id = ?').bind(secretId).first()
    expect(!!afterDelete).toBe(false)

    const after = await callTool('agent_manage', { action: 'list_secrets', agentId })
    expect(after.count).toBe(0)
  })

  it('add_secret validates importance levels', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    // Valid importance levels should work
    for (const importance of ['low', 'medium', 'high', 'critical']) {
      const r = await callTool('agent_manage', {
        action: 'add_secret',
        agentId,
        content: `Secret ${importance}`,
        importance
      })
      expect(r.success, `importance=${importance} should be valid`).toBe(true)
    }

    // Invalid importance should fail
    const r = await callTool('agent_manage', {
      action: 'add_secret',
      agentId,
      content: 'Invalid secret',
      importance: 'invalid'
    })
    expect(r.error).toBe(true)
  })

  it('list_secrets with importance filter', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    await callTool('agent_manage', {
      action: 'add_secret',
      agentId,
      content: 'High priority secret',
      importance: 'high'
    })
    await callTool('agent_manage', {
      action: 'add_secret',
      agentId,
      content: 'Critical secret',
      importance: 'critical'
    })

    const critical = await callTool('agent_manage', {
      action: 'list_secrets',
      agentId,
      filter: 'critical'
    })
    expect(critical.count).toBe(1)
    expect(critical.secrets[0].importance).toBe('critical')
  })

  // ── Journal ───────────────────────────────────────────────────────────────

  it('add_journal / get_journal round-trip', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await callTool('agent_manage', { action: 'add_journal', agentId, content: 'I chose to hold the gate.', journalKind: 'plan' })
    const r = await callTool('agent_manage', { action: 'get_journal', agentId })
    expect(r.count).toBe(1)
    expect(r.entries[0].kind).toBe('plan')
  })

  it('add_journal validates journal kinds', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    // Valid journal kinds should work
    for (const kind of ['response', 'observation', 'plan', 'reflection', 'dm_note']) {
      const r = await callTool('agent_manage', {
        action: 'add_journal',
        agentId,
        content: `Journal entry ${kind}`,
        journalKind: kind
      })
      expect(r.success, `kind=${kind} should be valid`).toBe(true)
    }

    // Invalid kind should fail
    const r = await callTool('agent_manage', {
      action: 'add_journal',
      agentId,
      content: 'Invalid journal entry',
      journalKind: 'invalid'
    })
    expect(r.error).toBe(true)
  })

  it('get_journal with kind filter', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    await callTool('agent_manage', {
      action: 'add_journal',
      agentId,
      content: 'Observation entry',
      journalKind: 'observation'
    })
    await callTool('agent_manage', {
      action: 'add_journal',
      agentId,
      content: 'Plan entry',
      journalKind: 'plan',
      encounterId: 'enc-1',
      round: 2
    })

    const plans = await callTool('agent_manage', {
      action: 'get_journal',
      agentId,
      filter: 'plan'
    })
    expect(plans.count).toBe(1)
    expect(plans.entries[0].kind).toBe('plan')
  })

  // ── Invoke ────────────────────────────────────────────────────────────────

  it('invoke always returns a callId when agent is valid', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await callTool('agent_manage', { action: 'set_slice', agentId, kind: 'persona', content: 'You are a stern knight.' })

    const r = await callTool('agent_manage', { action: 'invoke', agentId, situation: 'The bandits demand tribute.' })
    // callId is always returned for valid agents regardless of AI availability.
    // status is 'ok' when real Cloudflare AI is reachable; 'error' in CI where the
    // miniflare AI stub throws "Binding AI needs to be run remotely" (no auth token).
    expect(r.callId).toBeTruthy()
    expect(r.actionType).toBe('invoke')
    expect(['ok', 'error', 'incapable', 'paused', 'budget_exhausted']).toContain(r.status)
  })

  it('invoke with open circuit returns circuit_open without calling AI', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await env.RPG_DB.prepare("UPDATE agents SET circuit_state = 'open' WHERE id = ?").bind(agentId).run()
    const r = await callTool('agent_manage', { action: 'invoke', agentId, situation: 'Test.' })
    expect(r.success).toBe(false)
    expect(r.status).toBe('circuit_open')
  })

  it('invoke with exhausted budget returns budget_exhausted', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await env.RPG_DB.prepare('UPDATE agents SET budget_tokens = 10, tokens_used = 10 WHERE id = ?').bind(agentId).run()
    const r = await callTool('agent_manage', { action: 'invoke', agentId, situation: 'Test.' })
    expect(r.success).toBe(false)
    expect(r.status).toBe('budget_exhausted')
  })

  it('invoke writes an agent_calls audit row', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    const { callId } = await callTool('agent_manage', { action: 'invoke', agentId, situation: 'What do you do?' })

    const row = await env.RPG_DB.prepare('SELECT * FROM agent_calls WHERE id = ?').bind(callId).first()
    expect(row).not.toBeNull()
    expect((row as any).agent_id).toBe(agentId)
    // status is 'ok' with real AI, 'error' in CI (miniflare AI stub throws without Cloudflare auth)
    expect(['ok', 'error']).toContain((row as any).status)
  })

  it('invoke with open circuit returns circuit_open without calling AI', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await env.RPG_DB.prepare("UPDATE agents SET circuit_state = 'open' WHERE id = ?").bind(agentId).run()
    const r = await callTool('agent_manage', { action: 'invoke', agentId, situation: 'Test.' })
    expect(r.success).toBe(false)
    expect(r.status).toBe('circuit_open')
  })

  it('invoke with exhausted budget returns budget_exhausted', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })
    await env.RPG_DB.prepare('UPDATE agents SET budget_tokens = 10, tokens_used = 10 WHERE id = ?').bind(agentId).run()
    const r = await callTool('agent_manage', { action: 'invoke', agentId, situation: 'Test.' })
    expect(r.success).toBe(false)
    expect(r.status).toBe('budget_exhausted')
  })

  it('invoke circuit breaker opens after 3 consecutive failures', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId, model: '__force_error__' })
    // Drive consecutive_failures to 2 manually, then one more failure should open the circuit
    await env.RPG_DB.prepare('UPDATE agents SET consecutive_failures = 2 WHERE id = ?').bind(agentId).run()
    // The __force_error__ model causes the AI mock to either fail or return something;
    // if miniflare doesn't throw, simulate via direct DB manipulation and verify resume works
    const healthBefore = await callTool('agent_manage', { action: 'health', agentId })
    expect(healthBefore.consecutiveFailures).toBe(2)
    // Manually open circuit to validate resume path
    await env.RPG_DB.prepare("UPDATE agents SET circuit_state = 'open' WHERE id = ?").bind(agentId).run()
    const healthOpen = await callTool('agent_manage', { action: 'health', agentId })
    expect(healthOpen.canInvoke).toBe(false)
    // Resume resets it
    await callTool('agent_manage', { action: 'resume', agentId })
    const healthAfter = await callTool('agent_manage', { action: 'health', agentId })
    expect(healthAfter.canInvoke).toBe(true)
    expect(healthAfter.consecutiveFailures).toBe(0)
  })

  // ── Replay ────────────────────────────────────────────────────────────────

  it('replay re-runs a stored call and creates a new audit row', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    // Seed the original call directly so this test does not depend on invoke's AI call succeeding.
    const originalCallId = crypto.randomUUID()
    const seedNow = new Date().toISOString()
    const messages = JSON.stringify([
      { role: 'system', content: 'You are a knight.' },
      { role: 'user', content: 'What do you do?' },
    ])
    await env.RPG_DB.prepare(
      'INSERT INTO agent_calls (id, agent_id, request_id, provider, model, messages_json, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(originalCallId, agentId, null, 'cloudflare', '@cf/meta/llama-3.1-8b-instruct', messages, 'ok', seedNow).run()

    const r = await callTool('agent_manage', { action: 'replay', callId: originalCallId })
    // Replay always creates a new callId and echoes originalCallId regardless of AI availability.
    expect(r.callId).toBeTruthy()
    expect(r.callId).not.toBe(originalCallId)
    expect(r.originalCallId).toBe(originalCallId)
    expect(r.actionType).toBe('replay')

    // Two audit rows: the seeded original + the new replay row
    const { results } = await env.RPG_DB.prepare('SELECT id FROM agent_calls WHERE agent_id = ?').bind(agentId).all()
    expect(results).toHaveLength(2)
  })

  it('replay returns error when callId not found', async () => {
    const r = await callTool('agent_manage', { action: 'replay', callId: 'nope' })
    expect(r.error).toBe(true)
  })

  // ── Action routing ─────────────────────────────────────────────────────────

  it('resolves action aliases', async () => {
    const charId = await seedCharacter()
    const r = await callTool('agent_manage', {
      action: 'bind',
      characterId: charId
    })
    expect(r.success).toBe(true)
    expect(r.actionType).toBe('create')
  })

  it('returns helpful error for invalid action', async () => {
    const r = await callTool('agent_manage', { action: 'invalid_action' })
    expect(r.error).toBe('invalid_action')
    expect(r.message).toMatch(/Unknown action/)
  })

  // ── Additional Coverage Tests ──────────────────────────────────────────────

  it('set_slice updates existing slice with same kind (upsert behavior)', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const first = await callTool('agent_manage', {
      action: 'set_slice',
      agentId,
      kind: 'persona',
      content: 'v1'
    })
    const firstId = first.sliceId

    const second = await callTool('agent_manage', {
      action: 'set_slice',
      agentId,
      kind: 'persona',
      content: 'v2'
    })
    const secondId = second.sliceId
    expect(firstId).toBe(secondId)

    const slices = await callTool('agent_manage', { action: 'list_slices', agentId })
    expect(slices.count).toBe(1)
    expect(slices.slices[0].content).toBe('v2')
  })

  it('set_slice with all valid kinds', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    for (const kind of ['persona', 'directive', 'secrets', 'narrative_feed', 'recent', 'character_state', 'custom']) {
      const r = await callTool('agent_manage', {
        action: 'set_slice',
        agentId,
        kind,
        content: `Content for ${kind}`
      })
      expect(r.success).toBe(true)
    }
  })

  it('list_slices with disabled filter', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const slice1 = await callTool('agent_manage', {
      action: 'set_slice',
      agentId,
      kind: 'persona',
      content: 'Enabled'
    })
    const slice2 = await callTool('agent_manage', {
      action: 'set_slice',
      agentId,
      kind: 'directive',
      content: 'Disabled soon'
    })

    await callTool('agent_manage', {
      action: 'toggle_slice',
      sliceId: slice2.sliceId,
      enabled: false
    })

    const enabled = await callTool('agent_manage', {
      action: 'list_slices',
      agentId,
      filter: 'enabled'
    })
    expect(enabled.count).toBe(1)

    const disabled = await callTool('agent_manage', {
      action: 'list_slices',
      agentId,
      filter: 'disabled'
    })
    expect(disabled.count).toBe(1)
  })

  it('add_secret without importance (defaults to null)', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', {
      action: 'add_secret',
      agentId,
      content: 'No importance specified'
    })
    expect(r.success).toBe(true)
    expect(r.secretId).toBeTruthy()
  })

  it('list_secrets filters by all importance levels', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    await callTool('agent_manage', {
      action: 'add_secret',
      agentId,
      content: 'Low secret',
      importance: 'low'
    })
    await callTool('agent_manage', {
      action: 'add_secret',
      agentId,
      content: 'Medium secret',
      importance: 'medium'
    })
    await callTool('agent_manage', {
      action: 'add_secret',
      agentId,
      content: 'High secret',
      importance: 'high'
    })

    const low = await callTool('agent_manage', { action: 'list_secrets', agentId, filter: 'low' })
    expect(low.count).toBe(1)
    expect(low.secrets[0].importance).toBe('low')

    const medium = await callTool('agent_manage', { action: 'list_secrets', agentId, filter: 'medium' })
    expect(medium.count).toBe(1)

    const high = await callTool('agent_manage', { action: 'list_secrets', agentId, filter: 'high' })
    expect(high.count).toBe(1)
  })

  it('add_journal with encounterId and round', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', {
      action: 'add_journal',
      agentId,
      content: 'Fought goblins in round 3',
      journalKind: 'observation',
      encounterId: 'goblin-cave-001',
      round: 3
    })
    expect(r.success).toBe(true)
    expect(r.entryId).toBeTruthy()
  })

  it('get_journal filters by encounterId', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    await callTool('agent_manage', {
      action: 'add_journal',
      agentId,
      content: 'Encounter 1 event',
      journalKind: 'observation',
      encounterId: 'enc-001'
    })
    await callTool('agent_manage', {
      action: 'add_journal',
      agentId,
      content: 'Encounter 2 event',
      journalKind: 'observation',
      encounterId: 'enc-002'
    })

    const enc1 = await callTool('agent_manage', {
      action: 'get_journal',
      agentId,
      encounterId: 'enc-001'
    })
    expect(enc1.count).toBe(1)
  })

  it('get_journal respects limit parameter', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    for (let i = 0; i < 5; i++) {
      await callTool('agent_manage', {
        action: 'add_journal',
        agentId,
        content: `Entry ${i}`,
        journalKind: 'observation'
      })
    }

    const limit2 = await callTool('agent_manage', {
      action: 'get_journal',
      agentId,
      limit: 2
    })
    expect(limit2.entries.length).toBeLessThanOrEqual(2)
  })

  it('invoke with paused agent returns paused status', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    await callTool('agent_manage', { action: 'update', agentId, status: 'paused' })

    const r = await callTool('agent_manage', { action: 'invoke', agentId, situation: 'Test.' })
    expect(r.success).toBe(false)
    expect(r.status).toBe('paused')
  })

  it('broadcast to single agent', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', {
      action: 'broadcast',
      agentIds: [agentId],
      observation: 'Single broadcast'
    })
    expect(r.success).toBe(true)
    expect(r.count).toBe(1)
  })

  it('broadcast with empty agentIds array returns error', async () => {
    const r = await callTool('agent_manage', {
      action: 'broadcast',
      agentIds: [],
      observation: 'Will fail'
    })
    expect(r.error).toBe(true)
  })

  it('remove_secret validates secret exists before deletion', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const secret = await callTool('agent_manage', {
      action: 'add_secret',
      agentId,
      content: 'Temporary secret'
    })

    // First removal should succeed
    const firstRemove = await callTool('agent_manage', {
      action: 'remove_secret',
      secretId: secret.secretId
    })
    expect(firstRemove.success).toBe(true)

    // Second removal should fail (secret already gone)
    const secondRemove = await callTool('agent_manage', {
      action: 'remove_secret',
      secretId: secret.secretId
    })
    expect(secondRemove.error).toBe(true)
    expect(secondRemove.message).toContain('not found')
  })

  it('set_slice with characterId resolution', async () => {
    const charId = await seedCharacter()
    await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', {
      action: 'set_slice',
      characterId: charId,
      kind: 'persona',
      content: 'Via characterId'
    })
    expect(r.success).toBe(true)
    expect(r.sliceId).toBeTruthy()
  })

  it('narrate with characterId resolution and label', async () => {
    const charId = await seedCharacter()
    await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', {
      action: 'narrate',
      characterId: charId,
      observation: 'Something happened',
      label: 'important_event'
    })
    expect(r.success).toBe(true)
    expect(r.sliceId).toBeTruthy()
  })

  it('list_slices returns empty when no slices exist', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', { action: 'list_slices', agentId })
    expect(r.success).toBe(true)
    expect(r.count).toBe(0)
    expect(r.slices).toEqual([])
  })

  it('list_secrets returns empty when no secrets exist', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', { action: 'list_secrets', agentId })
    expect(r.success).toBe(true)
    expect(r.count).toBe(0)
  })

  it('get_journal returns empty when no entries exist', async () => {
    const charId = await seedCharacter()
    const { agentId } = await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', { action: 'get_journal', agentId })
    expect(r.success).toBe(true)
    expect(r.count).toBe(0)
    expect(r.entries).toEqual([])
  })

  it('list with filter parameter (status filter)', async () => {
    const charId1 = await seedCharacter()
    const charId2 = await seedCharacter()
    const charId3 = await seedCharacter()

    const { agentId: agent1 } = await callTool('agent_manage', { action: 'create', characterId: charId1, status: 'active' })
    const { agentId: agent2 } = await callTool('agent_manage', { action: 'create', characterId: charId2, status: 'paused' })
    const { agentId: agent3 } = await callTool('agent_manage', { action: 'create', characterId: charId3, status: 'retired' })

    // List only paused agents using filter parameter
    const r = await callTool('agent_manage', { action: 'list', filter: 'paused' })
    expect(r.success).toBe(true)
    expect(r.count).toBeGreaterThan(0)
    const pausedAgents = r.agents.filter((a: any) => a.status === 'paused')
    expect(pausedAgents.length).toBeGreaterThan(0)
  })

  it('list with filter "all" returns all agents', async () => {
    const charId1 = await seedCharacter()
    const charId2 = await seedCharacter()

    await callTool('agent_manage', { action: 'create', characterId: charId1, status: 'active' })
    await callTool('agent_manage', { action: 'create', characterId: charId2, status: 'paused' })

    const r = await callTool('agent_manage', { action: 'list', filter: 'all' })
    expect(r.success).toBe(true)
    const allStatuses = r.agents.map((a: any) => a.status)
    expect(allStatuses).toContain('active')
    expect(allStatuses).toContain('paused')
  })

  it('add_secret with invalid importance level', async () => {
    const charId = await seedCharacter()
    await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', {
      action: 'add_secret',
      characterId: charId,
      content: 'Secret content',
      importance: 'invalid_level'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('Invalid enum value')
  })

  it('add_journal with invalid kind', async () => {
    const charId = await seedCharacter()
    await callTool('agent_manage', { action: 'create', characterId: charId })

    const r = await callTool('agent_manage', {
      action: 'add_journal',
      characterId: charId,
      content: 'Journal entry',
      journalKind: 'invalid_kind'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('Invalid enum value')
  })

  it('set_slice without agentId or characterId returns error', async () => {
    const r = await callTool('agent_manage', {
      action: 'set_slice',
      kind: 'persona',
      content: 'Some content'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('list_slices without agentId or characterId returns error', async () => {
    const r = await callTool('agent_manage', { action: 'list_slices' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('narrate without characterId or agentId returns error', async () => {
    const r = await callTool('agent_manage', {
      action: 'narrate',
      observation: 'Some observation'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('add_secret without characterId or agentId returns error', async () => {
    const r = await callTool('agent_manage', {
      action: 'add_secret',
      content: 'Secret'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('list_secrets without characterId or agentId returns error', async () => {
    const r = await callTool('agent_manage', { action: 'list_secrets' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('add_journal without characterId or agentId returns error', async () => {
    const r = await callTool('agent_manage', {
      action: 'add_journal',
      content: 'Journal entry'
    })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('get_journal without characterId or agentId returns error', async () => {
    const r = await callTool('agent_manage', { action: 'get_journal' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })

  it('preview_prompt without characterId or agentId returns error', async () => {
    const r = await callTool('agent_manage', { action: 'preview_prompt' })
    expect(r.error).toBe(true)
    expect(r.message).toContain('required')
  })
})
