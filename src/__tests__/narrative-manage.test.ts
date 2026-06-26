// Direct handler tests for narrative-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleNarrativeManage } from '../rpg/handlers/narrative-manage'

describe('handleNarrativeManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)
  const WORLD = 'world-1'

  beforeEach(async () => {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare('INSERT OR IGNORE INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(WORLD, WORLD, 'seed', 100, 100, now, now).run()
  })

  it('returns guiding error for unknown action', async () => {
    const r = await handleNarrativeManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('create requires worldId and content', async () => {
    const r = await handleNarrativeManage(db(), { action: 'create', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('create inserts a new narrative note', async () => {
    const r = await handleNarrativeManage(db(), { action: 'create', worldId: WORLD, content: 'The heroes arrived', type: 'session_log', tags: ['combat'], entityId: 'char-1', entityType: 'character' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.noteId).toBeTruthy()
    expect(body.type).toBe('session_log')
  })

  it('get requires id', async () => {
    const r = await handleNarrativeManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found', async () => {
    const r = await handleNarrativeManage(db(), { action: 'get', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns note with parsed fields', async () => {
    const c = await handleNarrativeManage(db(), { action: 'create', worldId: WORLD, content: 'Dragon appeared', metadata: { importance: 'high' } })
    const { noteId } = JSON.parse(c.content[0].text)
    const r = await handleNarrativeManage(db(), { action: 'get', id: noteId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.note.content).toBe('Dragon appeared')
  })

  it('list returns notes for world', async () => {
    await handleNarrativeManage(db(), { action: 'create', worldId: WORLD, content: 'Note A' })
    const r = await handleNarrativeManage(db(), { action: 'list', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('list filters by type', async () => {
    const r = await handleNarrativeManage(db(), { action: 'list', worldId: WORLD, filter: { type: 'plot_thread' } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list filters by status', async () => {
    const r = await handleNarrativeManage(db(), { action: 'list', worldId: WORLD, filter: { status: 'active' } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list filters by entityId', async () => {
    const r = await handleNarrativeManage(db(), { action: 'list', worldId: WORLD, filter: { entityId: 'char-1' } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('update requires id', async () => {
    const r = await handleNarrativeManage(db(), { action: 'update' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update modifies note fields', async () => {
    const c = await handleNarrativeManage(db(), { action: 'create', worldId: WORLD, content: 'Old content' })
    const { noteId } = JSON.parse(c.content[0].text)
    const r = await handleNarrativeManage(db(), { action: 'update', id: noteId, content: 'New content', visibility: 'player_visible', tags: ['updated'], status: 'dormant', metadata: { key: 'val' } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('delete requires id', async () => {
    const r = await handleNarrativeManage(db(), { action: 'delete' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete removes note', async () => {
    const c = await handleNarrativeManage(db(), { action: 'create', worldId: WORLD, content: 'To delete' })
    const { noteId } = JSON.parse(c.content[0].text)
    const r = await handleNarrativeManage(db(), { action: 'delete', id: noteId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('archive requires id', async () => {
    const r = await handleNarrativeManage(db(), { action: 'archive' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('archive marks note as archived', async () => {
    const c = await handleNarrativeManage(db(), { action: 'create', worldId: WORLD, content: 'Archive me' })
    const { noteId } = JSON.parse(c.content[0].text)
    const r = await handleNarrativeManage(db(), { action: 'archive', id: noteId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.status).toBe('archived')
  })

  it('resolve requires id', async () => {
    const r = await handleNarrativeManage(db(), { action: 'resolve' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('resolve marks note as resolved', async () => {
    const c = await handleNarrativeManage(db(), { action: 'create', worldId: WORLD, content: 'Resolve me' })
    const { noteId } = JSON.parse(c.content[0].text)
    const r = await handleNarrativeManage(db(), { action: 'resolve', id: noteId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.status).toBe('resolved')
  })
})
