// Phase 4: agent_manage — NPC AI agent tool backed by Cloudflare Workers AI.
// Each agent is bound 1:1 to a character and emits plain-text intent when invoked.
// Storage: D1 (agents, agent_prompt_slices, agent_secrets, agent_journal, agent_calls).

import { z } from 'zod'
import { matchAction, isGuidingError, formatGuidingError, CRUD_ALIASES } from '../utils/fuzzy-enum'

import { ok, err, type McpResponse } from '../utils/response'
import type { AppBindings } from '../../types'

const ACTIONS = [
  'create', 'get', 'list', 'update', 'delete', 'resume', 'health', 'budget',
  'set_slice', 'remove_slice', 'toggle_slice', 'list_slices', 'narrate', 'broadcast', 'preview_prompt',
  'add_secret', 'list_secrets', 'remove_secret',
  'add_journal', 'get_journal',
  'invoke', 'replay',
] as const
type AgentAction = typeof ACTIONS[number]

const ALIASES: Record<string, AgentAction> = {
  ...CRUD_ALIASES,
  new_agent: 'create', bind: 'create',
  fetch: 'get', find: 'get',
  restart: 'resume', reset: 'resume', open_circuit: 'resume',
  status: 'health', check: 'health',
  tokens: 'budget', usage: 'budget',
  upsert_slice: 'set_slice', add_slice: 'set_slice', update_slice: 'set_slice',
  delete_slice: 'remove_slice',
  enable_slice: 'toggle_slice', disable_slice: 'toggle_slice',
  get_slices: 'list_slices',
  observe: 'narrate', feed: 'narrate',
  broadcast_observation: 'broadcast',
  dry_run: 'preview_prompt', preview: 'preview_prompt',
  secret: 'add_secret', add_knowledge: 'add_secret',
  get_secrets: 'list_secrets',
  journal: 'add_journal', log: 'add_journal',
  read_journal: 'get_journal',
  run: 'invoke', call: 'invoke', think: 'invoke',
  rerun: 'replay', replay_call: 'replay',
} as Record<string, AgentAction>

const InputSchema = z.object({
  action: z.string(),
  id: z.string().optional(),
  agentId: z.string().optional(),
  characterId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(['active', 'paused', 'retired']).optional(),
  autoOnTurn: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  budgetTokens: z.number().int().min(0).optional(),
  // slices
  sliceId: z.string().optional(),
  kind: z.string().optional(),
  label: z.string().optional(),
  content: z.string().optional(),
  orderIndex: z.number().int().optional(),
  enabled: z.boolean().optional(),
  // invoke
  situation: z.string().optional(),
  encounterId: z.string().optional(),
  requestId: z.string().optional(),
  agentIds: z.array(z.string()).optional(),
  observation: z.string().optional(),
  callId: z.string().optional(),
  // journal / secrets
  importance: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  secretId: z.string().optional(),
  journalKind: z.enum(['response', 'observation', 'plan', 'reflection', 'dm_note']).optional(),
  round: z.number().int().optional(),
  // filters
  limit: z.number().int().min(1).max(200).optional().default(50),
  filter: z.string().optional(),
})

export async function handleAgentManage(env: AppBindings, args: Record<string, unknown>): Promise<McpResponse> {
  const parsed = InputSchema.safeParse(args)
  if (!parsed.success) return err(parsed.error.issues.map(i => i.message).join('; '))
  const a = parsed.data
  const match = matchAction(a.action, ACTIONS, ALIASES)
  if (isGuidingError(match)) return formatGuidingError(match)
  const db = env.RPG_DB!
  const now = new Date().toISOString()
  const agentId = a.id ?? a.agentId

  // Helper to resolve agentId from characterId if needed
  async function resolveAgentId(): Promise<string | null> {
    if (agentId) return agentId;
    if (a.characterId) {
      const agent = await db.prepare('SELECT id FROM agents WHERE character_id = ?').bind(a.characterId).first() as { id: string } | null;
      return agent?.id ?? null;
    }
    return null;
  }

  switch (match.matched) {

    // ── Lifecycle ────────────────────────────────────────────────────────────

    case 'create': {
      if (!a.characterId) return err('"characterId" is required')
      const id = crypto.randomUUID()
      const model = a.model ?? '@cf/meta/llama-3.1-8b-instruct'
      const status = a.status ?? 'active'
      const autoOnTurn = a.autoOnTurn ? 1 : 0
      const temperature = a.temperature ?? 0.7
      const maxTokens = a.maxTokens ?? 512
      const budgetTokens = a.budgetTokens ?? null
      const provider = a.provider ?? 'cloudflare'

      try {
        await db.prepare(
          'INSERT INTO agents (id, character_id, provider, model, status, auto_on_turn, temperature, max_tokens, budget_tokens, tokens_used, consecutive_failures, circuit_state, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,0,\'closed\',?,?)'
        ).bind(
          id, a.characterId, provider, model, status, autoOnTurn, temperature, maxTokens, budgetTokens, now, now
        ).run()
      } catch (e) {
        if (e instanceof Error && e.message.includes('UNIQUE constraint failed: agents.character_id')) {
          return err(`Character already bound to an agent`)
        }
        if (e instanceof Error && e.message.includes('FOREIGN KEY constraint failed')) {
          return err(`Character not found: ${a.characterId}`)
        }
        throw e
      }

      const agent = {
        id,
        character_id: a.characterId,
        provider,
        model,
        status,
        auto_on_turn: autoOnTurn,
        temperature,
        max_tokens: maxTokens,
        budget_tokens: budgetTokens,
        tokens_used: 0,
        consecutive_failures: 0,
        circuit_state: 'closed',
        created_at: now,
        updated_at: now
      }

      return ok({ success: true, actionType: 'create', agentId: id, characterId: a.characterId, agent })
    }

    case 'get': {
      const row = agentId
        ? await db.prepare('SELECT * FROM agents WHERE id = ?').bind(agentId).first()
        : a.characterId
          ? await db.prepare('SELECT * FROM agents WHERE character_id = ?').bind(a.characterId).first()
          : null
      if (!row) return err(agentId ? `Agent not found: ${agentId}` : a.characterId ? `No agent for character: ${a.characterId}` : '"id"/"agentId" or "characterId" is required')
      return ok({ success: true, actionType: 'get', agentId: row.id, agent: row })
    }

    case 'list': {
      let query = 'SELECT * FROM agents'
      const binds: unknown[] = []

      // Handle status filter (from status parameter)
      if (a.status) {
        query += ' WHERE status = ?';
        binds.push(a.status)
      }
      // Handle filter parameter (can be 'all', 'enabled', 'disabled', or status values)
      else if (a.filter) {
        if (a.filter !== 'all') {
          query += ' WHERE status = ?';
          binds.push(a.filter)
        }
      }
      // Default to only active agents if no filter is specified
      else {
        query += ' WHERE status = ?';
        binds.push('active')
      }

      query += ' ORDER BY created_at DESC LIMIT ?'; binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list', agents: results, count: results.length })
    }

    case 'update': {
      if (!agentId) return err('"id" or "agentId" is required')
      const sets: string[] = ['updated_at = ?']
      const vals: unknown[] = [now]
      if (a.model !== undefined) { sets.push('model = ?'); vals.push(a.model) }
      if (a.status !== undefined) { sets.push('status = ?'); vals.push(a.status) }
      if (a.autoOnTurn !== undefined) { sets.push('auto_on_turn = ?'); vals.push(a.autoOnTurn ? 1 : 0) }
      if (a.temperature !== undefined) { sets.push('temperature = ?'); vals.push(a.temperature) }
      if (a.maxTokens !== undefined) { sets.push('max_tokens = ?'); vals.push(a.maxTokens) }
      if (a.budgetTokens !== undefined) { sets.push('budget_tokens = ?'); vals.push(a.budgetTokens) }
      vals.push(agentId)
      await db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
      return ok({ success: true, actionType: 'update', agentId })
    }

    case 'delete': {
      if (!agentId) return err('"id" or "agentId" is required')
      await db.prepare('DELETE FROM agents WHERE id = ?').bind(agentId).run()
      return ok({ success: true, actionType: 'delete', agentId })
    }

    case 'resume': {
      if (!agentId) return err('"id" or "agentId" is required')
      await db.prepare(
        "UPDATE agents SET consecutive_failures = 0, circuit_state = 'closed', status = 'active', updated_at = ? WHERE id = ?"
      ).bind(now, agentId).run()
      return ok({ success: true, actionType: 'resume', agentId, message: 'Circuit closed, failure counter reset, status set to active.' })
    }

    // ── Agent state ──────────────────────────────────────────────────────────

    case 'health': {
      if (!agentId) return err('"id" or "agentId" is required')
      const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').bind(agentId).first() as Record<string, unknown> | null
      if (!agent) return err(`Agent not found: ${agentId}`)
      const canInvoke = agent.status === 'active' && agent.circuit_state === 'closed' && !!env.AI
        && (!agent.budget_tokens || (agent.tokens_used as number) < (agent.budget_tokens as number))
      const budgetRemaining = agent.budget_tokens ? (agent.budget_tokens as number) - (agent.tokens_used as number) : null
      return ok({
        success: true,
        actionType: 'health',
        agentId,
        canInvoke,
        status: agent.status,
        circuitState: agent.circuit_state,
        consecutiveFailures: agent.consecutive_failures,
        tokensUsed: agent.tokens_used,
        budgetTokens: agent.budget_tokens,
        budgetRemaining,
        aiBindingPresent: !!env.AI
      })
    }

    case 'budget': {
      if (!agentId) return err('"id" or "agentId" is required')
      if (a.budgetTokens !== undefined) {
        await db.prepare('UPDATE agents SET budget_tokens = ?, updated_at = ? WHERE id = ?').bind(a.budgetTokens, now, agentId).run()
        return ok({ success: true, actionType: 'budget', agentId, budgetTokens: a.budgetTokens })
      }
      const agent = await db.prepare('SELECT tokens_used, budget_tokens FROM agents WHERE id = ?').bind(agentId).first() as Record<string, unknown> | null
      if (!agent) return err(`Agent not found: ${agentId}`)
      return ok({ success: true, actionType: 'budget', agentId, tokensUsed: agent.tokens_used, budgetTokens: agent.budget_tokens, remaining: agent.budget_tokens ? (agent.budget_tokens as number) - (agent.tokens_used as number) : null })
    }

    // ── Prompt slices ────────────────────────────────────────────────────────

    case 'set_slice': {
      const resolvedAgentId = await resolveAgentId();
      if (!resolvedAgentId || !a.kind || !a.content) return err('"agentId"/"id"/"characterId", "kind", and "content" are required')
      const agentId = resolvedAgentId;

      // Validate slice kind
      const validKinds = ['persona', 'directive', 'secrets', 'narrative_feed', 'recent', 'character_state', 'custom']
      if (!validKinds.includes(a.kind)) {
        return err(`Invalid slice kind: ${a.kind}. Valid kinds are: ${validKinds.join(', ')}`)
      }

      const sliceId = a.sliceId ?? crypto.randomUUID()
      await db.prepare(
        'INSERT INTO agent_prompt_slices (id, agent_id, kind, label, content, order_index, enabled, updated_at) VALUES (?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, label=excluded.label, content=excluded.content, order_index=excluded.order_index, updated_at=excluded.updated_at'
      ).bind(sliceId, agentId, a.kind, a.label ?? null, a.content, a.orderIndex ?? 0, now).run()

      // For upsert behavior, check if we're updating an existing slice with same kind+label
      if (!a.sliceId) {
        const existing = await db.prepare(
          'SELECT id FROM agent_prompt_slices WHERE agent_id = ? AND kind = ? AND label IS ? AND id != ?'
        ).bind(agentId, a.kind, a.label ?? null, sliceId).first()

        if (existing) {
          // Update the existing slice instead
          await db.prepare(
            'UPDATE agent_prompt_slices SET content = ?, order_index = ?, updated_at = ? WHERE id = ?'
          ).bind(a.content, a.orderIndex ?? 0, now, existing.id).run()

          // Delete the newly created slice
          await db.prepare('DELETE FROM agent_prompt_slices WHERE id = ?').bind(sliceId).run()
          return ok({ success: true, actionType: 'set_slice', agentId, sliceId: existing.id as string, kind: a.kind })
        }
      }

      return ok({ success: true, actionType: 'set_slice', agentId, sliceId, kind: a.kind })
    }

    case 'remove_slice': {
      const resolvedAgentId = await resolveAgentId();
      if (!a.sliceId) return err('"sliceId" is required')
      await db.prepare('DELETE FROM agent_prompt_slices WHERE id = ?').bind(a.sliceId).run()
      return ok({ success: true, actionType: 'remove_slice', sliceId: a.sliceId })
    }

    case 'toggle_slice': {
      const resolvedAgentId = await resolveAgentId();
      if (!a.sliceId || a.enabled === undefined) return err('"sliceId" and "enabled" are required')
      await db.prepare('UPDATE agent_prompt_slices SET enabled = ?, updated_at = ? WHERE id = ?').bind(a.enabled ? 1 : 0, now, a.sliceId).run()
      return ok({ success: true, actionType: 'toggle_slice', sliceId: a.sliceId, enabled: a.enabled })
    }

    case 'list_slices': {
      const resolvedAgentId = await resolveAgentId();
      if (!resolvedAgentId) return err('"id"/"agentId"/"characterId" is required')
      const agentId = resolvedAgentId;
      let query = 'SELECT id, kind, label, content, order_index, enabled FROM agent_prompt_slices WHERE agent_id = ?'
      const binds: unknown[] = [agentId]
      if (a.filter === 'enabled') { query += ' AND enabled = 1' }
      else if (a.filter === 'disabled') { query += ' AND enabled = 0' }
      else if (a.kind) { query += ' AND kind = ?'; binds.push(a.kind) }
      query += ' ORDER BY order_index'
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list_slices', agentId, slices: results, count: results.length })
    }

    case 'narrate': {
      const resolvedAgentId = await resolveAgentId();
      if (!resolvedAgentId || !a.observation) return err('"agentId"/"id"/"characterId" and "observation" are required')
      const agentId = resolvedAgentId;
      const sliceId = crypto.randomUUID()
      await db.prepare(
        'INSERT INTO agent_prompt_slices (id, agent_id, kind, label, content, order_index, enabled, updated_at) VALUES (?,?,\'narrative_feed\',?,?,999,1,?)'
      ).bind(sliceId, agentId, a.label ?? null, a.observation, now).run()
      return ok({ success: true, actionType: 'narrate', agentId, sliceId })
    }

    case 'broadcast': {
      if (!a.agentIds || a.agentIds.length === 0 || !a.observation) return err('"agentIds" (array) and "observation" are required')

      // Filter out non-existent agents
      const validAgents = await Promise.all(a.agentIds.map(async (aid) => {
        const agent = await db.prepare('SELECT id FROM agents WHERE id = ?').bind(aid).first()
        return agent ? aid : null
      }))

      const validAgentIds = validAgents.filter(aid => aid !== null) as string[]

      const rows = await Promise.all(validAgentIds.map(async (aid) => {
        const sliceId = crypto.randomUUID()
        await db.prepare(
          'INSERT INTO agent_prompt_slices (id, agent_id, kind, label, content, order_index, enabled, updated_at) VALUES (?,?,\'narrative_feed\',?,?,999,1,?)'
        ).bind(sliceId, aid, a.label ?? null, a.observation, now).run()
        return { agentId: aid, sliceId }
      }))
      return ok({ success: true, actionType: 'broadcast', count: rows.length, results: rows })
    }

    case 'preview_prompt': {
      const resolvedAgentId = await resolveAgentId();
      if (!resolvedAgentId) return err('"id"/"agentId"/"characterId" is required')
      const agentId = resolvedAgentId;
      const { results: slices } = await db.prepare(
        'SELECT kind, label, content, order_index FROM agent_prompt_slices WHERE agent_id = ? AND enabled = 1 ORDER BY order_index'
      ).bind(agentId).all()
      const systemContent = slices.map((s: Record<string, unknown>) => s.content as string).join('\n\n')
      const messages = [
        { role: 'system', content: systemContent || 'You are an NPC in a fantasy roleplaying game.' },
        { role: 'user', content: a.situation ?? 'What do you do?' },
      ]
      const slicesIncluded = slices.map((s: Record<string, unknown>) => s.kind as string)
      const estimatedPromptTokens = Math.ceil(JSON.stringify(messages).length / 4)
      return ok({ success: true, actionType: 'preview_prompt', agentId, messages, slicesIncluded, estimatedPromptTokens })
    }

    // ── Secrets ──────────────────────────────────────────────────────────────

    case 'add_secret': {
      const resolvedAgentId = await resolveAgentId();
      if (!resolvedAgentId || !a.content) return err('"agentId"/"id"/"characterId" and "content" are required')
      const agentId = resolvedAgentId;

      // Validate importance levels
      const validImportance = ['low', 'medium', 'high', 'critical']
      if (a.importance && !validImportance.includes(a.importance)) {
        return err(`Invalid importance level: ${a.importance}. Valid levels are: ${validImportance.join(', ')}`)
      }

      const secretId = crypto.randomUUID()
      await db.prepare(
        'INSERT INTO agent_secrets (id, agent_id, content, importance, created_at) VALUES (?,?,?,?,?)'
      ).bind(secretId, agentId, a.content, a.importance ?? 'medium', now).run()
      return ok({ success: true, actionType: 'add_secret', agentId, secretId, importance: a.importance ?? 'medium' })
    }

    case 'list_secrets': {
      const resolvedAgentId = await resolveAgentId();
      if (!resolvedAgentId) return err('"id"/"agentId"/"characterId" is required')
      const agentId = resolvedAgentId;
      let query = 'SELECT id, content, importance, created_at FROM agent_secrets WHERE agent_id = ?'
      const binds: unknown[] = [agentId]
      if (a.filter) {
        if (a.filter !== 'all') {
          query += ' AND importance = ?';
          binds.push(a.filter)
        }
      }
      query += ' ORDER BY created_at DESC LIMIT ?'; binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'list_secrets', agentId, secrets: results, count: results.length })
    }

    case 'remove_secret': {
      if (!a.secretId) return err('"secretId" is required')
      // First get the agent_id before deletion
      const agentIdResult = await db.prepare('SELECT agent_id FROM agent_secrets WHERE id = ?').bind(a.secretId).first() as { agent_id: string } | null
      if (!agentIdResult) return err(`Secret not found: ${a.secretId}`)
      const agentId = agentIdResult.agent_id

      // Delete the secret
      const deleteResult = await db.prepare('DELETE FROM agent_secrets WHERE id = ?').bind(a.secretId).run()

      // Check if the deletion was successful
      if (!deleteResult.success || deleteResult.meta.changes === 0) {
        return err(`Secret not found: ${a.secretId}`)
      }

      return ok({ success: true, actionType: 'remove_secret', agentId, secretId: a.secretId })
    }

    // ── Journal ──────────────────────────────────────────────────────────────

    case 'add_journal': {
      const resolvedAgentId = await resolveAgentId();
      if (!resolvedAgentId || !a.content) return err('"agentId"/"id"/"characterId" and "content" are required')
      const agentId = resolvedAgentId;

      // Validate journal kinds
      const validKinds = ['response', 'observation', 'plan', 'reflection', 'dm_note']
      if (a.journalKind && !validKinds.includes(a.journalKind)) {
        return err(`Invalid journal kind: ${a.journalKind}. Valid kinds are: ${validKinds.join(', ')}`)
      }

      const entryId = crypto.randomUUID()
      await db.prepare(
        'INSERT INTO agent_journal (id, agent_id, kind, encounter_id, round, content, created_at) VALUES (?,?,?,?,?,?,?)'
      ).bind(entryId, agentId, a.journalKind ?? 'observation', a.encounterId ?? null, a.round ?? null, a.content, now).run()
      return ok({ success: true, actionType: 'add_journal', agentId, entryId, kind: a.journalKind ?? 'observation' })
    }

    case 'get_journal': {
      const resolvedAgentId = await resolveAgentId();
      if (!resolvedAgentId) return err('"id"/"agentId"/"characterId" is required')
      const agentId = resolvedAgentId;
      let query = 'SELECT id, kind, encounter_id, round, content, created_at FROM agent_journal WHERE agent_id = ?'
      const binds: unknown[] = [agentId]
      if (a.filter && a.filter !== 'all') { query += ' AND kind = ?'; binds.push(a.filter) }
      if (a.encounterId) { query += ' AND encounter_id = ?'; binds.push(a.encounterId) }
      query += ' ORDER BY created_at DESC LIMIT ?'; binds.push(a.limit)
      const { results } = await db.prepare(query).bind(...binds).all()
      return ok({ success: true, actionType: 'get_journal', agentId, entries: results, count: results.length })
    }

    // ── Invocation ───────────────────────────────────────────────────────────

    case 'invoke': {
      if (!agentId) return err('"id" or "agentId" is required')
      if (!env.AI) return err('AI binding not configured — enable the "ai" binding in wrangler.jsonc')
      const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').bind(agentId).first() as Record<string, unknown> | null
      if (!agent) return err(`Agent not found: ${agentId}`)
      if (agent.status !== 'active') return ok({ success: false, actionType: 'invoke', status: 'paused', reason: `Agent status is ${agent.status}` })
      if (agent.circuit_state === 'open') return ok({ success: false, actionType: 'invoke', status: 'circuit_open', reason: 'Circuit breaker open — call resume to reset' })
      if (agent.budget_tokens && (agent.tokens_used as number) >= (agent.budget_tokens as number))
        return ok({ success: false, actionType: 'invoke', status: 'budget_exhausted', tokensUsed: agent.tokens_used, budgetTokens: agent.budget_tokens })

      const { results: slices } = await db.prepare(
        'SELECT content FROM agent_prompt_slices WHERE agent_id = ? AND enabled = 1 ORDER BY order_index'
      ).bind(agentId).all()
      const systemContent = slices.map((s: Record<string, unknown>) => s.content as string).join('\n\n')
      const messages = [
        { role: 'system' as const, content: systemContent || 'You are an NPC in a fantasy roleplaying game.' },
        { role: 'user' as const, content: a.situation ?? 'What do you do?' },
      ]

      const callId = crypto.randomUUID()
      const started = Date.now()
      let callStatus = 'ok'
      let rawResponse = ''
      let errorMessage: string | null = null
      let promptTokens = 0
      let completionTokens = 0

      try {
        const result = await (env.AI as any).run(agent.model as string, {
          messages,
          max_tokens: (agent.max_tokens as number) ?? 512,
          temperature: (agent.temperature as number) ?? 0.7,
        }) as { response?: string; result?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
        rawResponse = result.response ?? result.result ?? ''
        promptTokens = result.usage?.prompt_tokens ?? 0
        completionTokens = result.usage?.completion_tokens ?? 0
        const totalTokens = promptTokens + completionTokens
        await db.prepare(
          "UPDATE agents SET consecutive_failures = 0, circuit_state = 'closed', tokens_used = tokens_used + ?, updated_at = ? WHERE id = ?"
        ).bind(totalTokens, now, agentId).run()
      } catch (e) {
        callStatus = 'error'
        errorMessage = e instanceof Error ? e.message : String(e)
        await db.prepare(
          "UPDATE agents SET consecutive_failures = consecutive_failures + 1, circuit_state = CASE WHEN consecutive_failures + 1 >= 3 THEN 'open' ELSE circuit_state END, updated_at = ? WHERE id = ?"
        ).bind(now, agentId).run()
      }

      const durationMs = Date.now() - started
      await db.prepare(
        'INSERT INTO agent_calls (id, agent_id, request_id, provider, model, messages_json, raw_response, prompt_tokens, completion_tokens, duration_ms, status, error_message, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(callId, agentId, a.requestId ?? null, agent.provider as string, agent.model as string, JSON.stringify(messages), rawResponse, promptTokens, completionTokens, durationMs, callStatus, errorMessage, now).run()

      if (callStatus !== 'ok') return ok({ success: false, actionType: 'invoke', status: callStatus, callId, reason: errorMessage })
      return ok({ success: true, actionType: 'invoke', status: 'ok', callId, response: rawResponse, promptTokens, completionTokens, durationMs })
    }

    case 'replay': {
      if (!a.callId) return err('"callId" is required')
      if (!env.AI) return err('AI binding not configured')
      const storedCall = await db.prepare('SELECT * FROM agent_calls WHERE id = ?').bind(a.callId).first() as Record<string, unknown> | null
      if (!storedCall) return err(`Call not found: ${a.callId}`)
      const messages = JSON.parse(storedCall.messages_json as string)
      const replayAgentId = storedCall.agent_id as string

      const agent = await db.prepare('SELECT model, temperature, max_tokens FROM agents WHERE id = ?').bind(replayAgentId).first() as Record<string, unknown> | null
      if (!agent) return err(`Agent not found for stored call`)

      const callId = crypto.randomUUID()
      const started = Date.now()
      let callStatus = 'ok', rawResponse = '', errorMessage: string | null = null
      let promptTokens = 0, completionTokens = 0
      try {
        const result = await (env.AI as any).run(agent.model as string, {
          messages,
          max_tokens: (agent.max_tokens as number) ?? 512,
          temperature: (agent.temperature as number) ?? 0.7,
        }) as { response?: string; result?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
        rawResponse = result.response ?? result.result ?? ''
        promptTokens = result.usage?.prompt_tokens ?? 0
        completionTokens = result.usage?.completion_tokens ?? 0
      } catch (e) {
        callStatus = 'error'
        errorMessage = e instanceof Error ? e.message : String(e)
      }
      const durationMs = Date.now() - started
      await db.prepare(
        'INSERT INTO agent_calls (id, agent_id, request_id, provider, model, messages_json, raw_response, prompt_tokens, completion_tokens, duration_ms, status, error_message, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(callId, replayAgentId, `replay:${a.callId}`, storedCall.provider as string, agent.model as string, JSON.stringify(messages), rawResponse, promptTokens, completionTokens, durationMs, callStatus, errorMessage, now).run()

      if (callStatus !== 'ok') return ok({ success: false, actionType: 'replay', status: callStatus, callId, originalCallId: a.callId, reason: errorMessage })
      return ok({ success: true, actionType: 'replay', status: 'ok', originalCallId: a.callId, callId, response: rawResponse, promptTokens, completionTokens, durationMs })
    }
  }
}