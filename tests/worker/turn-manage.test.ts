// Direct handler tests for turn-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleTurnManage } from '@/rpg/handlers/turn-manage'

describe('handleTurnManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB }) as any

  async function createWorld(id: string) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      'INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, id, 'seed', 100, 100, now, now)
      .run()
  }

  it('returns guiding error for unknown action', async () => {
    const r = await handleTurnManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('init requires worldId', async () => {
    const r = await handleTurnManage(db(), { action: 'init' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('init creates turn state', async () => {
    await createWorld('world-1')
    const r = await handleTurnManage(db(), { action: 'init', worldId: 'world-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.currentTurn).toBe(1)
    expect(body.turnPhase).toBe('planning')
  })

  it('init returns error if already initialized', async () => {
    await createWorld('world-2')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-2' })
    const r = await handleTurnManage(db(), { action: 'init', worldId: 'world-2' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
    expect(body.message).toContain('already initialized')
  })

  it('get_status requires worldId', async () => {
    const r = await handleTurnManage(db(), { action: 'get_status' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_status returns not found for unknown world', async () => {
    const r = await handleTurnManage(db(), { action: 'get_status', worldId: 'no-world' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_status returns current turn state', async () => {
    await createWorld('world-3')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-3' })
    const r = await handleTurnManage(db(), { action: 'get_status', worldId: 'world-3' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.currentTurn).toBe(1)
  })

  it('submit_actions requires worldId', async () => {
    const r = await handleTurnManage(db(), { action: 'submit_actions' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('submit_actions requires nationId or partyId', async () => {
    await createWorld('world-4')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-4' })
    const r = await handleTurnManage(db(), { action: 'submit_actions', worldId: 'world-4' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('submit_actions returns not found for unknown world', async () => {
    const r = await handleTurnManage(db(), {
      action: 'submit_actions',
      worldId: 'no-world',
      nationId: 'n1',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('submit_actions records actions', async () => {
    await createWorld('world-5')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-5' })
    const r = await handleTurnManage(db(), {
      action: 'submit_actions',
      worldId: 'world-5',
      nationId: 'nation-1',
      actions: [{ type: 'move', targetId: 'loc-1', description: 'March north' }],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.actionCount).toBe(1)
  })

  it('submit_actions works with partyId', async () => {
    await createWorld('world-5a')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-5a' })
    const r = await handleTurnManage(db(), {
      action: 'submit_actions',
      worldId: 'world-5a',
      partyId: 'party-1',
      actions: [],
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('mark_ready requires worldId', async () => {
    const r = await handleTurnManage(db(), { action: 'mark_ready' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('mark_ready requires nationId or partyId', async () => {
    await createWorld('world-6')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-6' })
    const r = await handleTurnManage(db(), { action: 'mark_ready', worldId: 'world-6' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('mark_ready returns not found for unknown world', async () => {
    const r = await handleTurnManage(db(), {
      action: 'mark_ready',
      worldId: 'no-world',
      nationId: 'n1',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('mark_ready marks nation ready', async () => {
    await createWorld('world-7')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-7' })
    const r = await handleTurnManage(db(), {
      action: 'mark_ready',
      worldId: 'world-7',
      nationId: 'nation-a',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.nationsReady).toContain('nation-a')
  })

  it('mark_ready does not duplicate already-ready entity', async () => {
    await createWorld('world-8')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-8' })
    await handleTurnManage(db(), { action: 'mark_ready', worldId: 'world-8', nationId: 'nation-b' })
    const r = await handleTurnManage(db(), {
      action: 'mark_ready',
      worldId: 'world-8',
      nationId: 'nation-b',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.readyCount).toBe(1)
  })

  it('poll_results requires worldId', async () => {
    const r = await handleTurnManage(db(), { action: 'poll_results' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('poll_results returns not found for unknown world', async () => {
    const r = await handleTurnManage(db(), { action: 'poll_results', worldId: 'no-world' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('poll_results returns current turn state and events', async () => {
    await createWorld('world-9')
    await handleTurnManage(db(), { action: 'init', worldId: 'world-9' })
    await handleTurnManage(db(), {
      action: 'submit_actions',
      worldId: 'world-9',
      nationId: 'n1',
      actions: [],
    })
    const r = await handleTurnManage(db(), { action: 'poll_results', worldId: 'world-9' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.submittedActions).toBeDefined()
  })
})
