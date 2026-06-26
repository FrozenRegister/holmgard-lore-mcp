// Direct handler tests for secret-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleSecretManage } from '../rpg/handlers/secret-manage'

describe('handleSecretManage', () => {
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
    const r = await handleSecretManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('create requires all required fields', async () => {
    const r = await handleSecretManage(db(), { action: 'create', worldId: WORLD, name: 'Secret' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('create inserts a new secret', async () => {
    const r = await handleSecretManage(db(), {
      action: 'create', worldId: WORLD, name: 'Hidden Vault',
      publicDescription: 'A mysterious door', secretDescription: 'Contains gold', sensitivity: 'high',
      revealConditions: ['Find the key'], linkedEntityId: 'loc-1', linkedEntityType: 'location',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.secretId).toBeTruthy()
  })

  it('get requires id', async () => {
    const r = await handleSecretManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found', async () => {
    const r = await handleSecretManage(db(), { action: 'get', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns secret with parsed arrays', async () => {
    const c = await handleSecretManage(db(), { action: 'create', worldId: WORLD, name: 'Key', publicDescription: 'A key', secretDescription: 'Opens vault' })
    const { secretId } = JSON.parse(c.content[0].text)
    const r = await handleSecretManage(db(), { action: 'get', id: secretId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.secret.name).toBe('Key')
  })

  it('list returns secrets for world', async () => {
    await handleSecretManage(db(), { action: 'create', worldId: WORLD, name: 'S1', publicDescription: 'p', secretDescription: 's' })
    const r = await handleSecretManage(db(), { action: 'list', worldId: WORLD })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('list filters by revealed status', async () => {
    const r = await handleSecretManage(db(), { action: 'list', worldId: WORLD, filter: { revealed: false } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list filters by linkedEntityId', async () => {
    const r = await handleSecretManage(db(), { action: 'list', worldId: WORLD, filter: { linkedEntityId: 'loc-1' } })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('update requires id', async () => {
    const r = await handleSecretManage(db(), { action: 'update' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('update modifies secret fields', async () => {
    const c = await handleSecretManage(db(), { action: 'create', worldId: WORLD, name: 'Old', publicDescription: 'p', secretDescription: 's' })
    const { secretId } = JSON.parse(c.content[0].text)
    const r = await handleSecretManage(db(), { action: 'update', id: secretId, name: 'New', publicDescription: 'np', secretDescription: 'ns', sensitivity: 'low', revealConditions: ['cond'] })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('delete requires id', async () => {
    const r = await handleSecretManage(db(), { action: 'delete' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('delete removes secret', async () => {
    const c = await handleSecretManage(db(), { action: 'create', worldId: WORLD, name: 'Del', publicDescription: 'p', secretDescription: 's' })
    const { secretId } = JSON.parse(c.content[0].text)
    const r = await handleSecretManage(db(), { action: 'delete', id: secretId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('reveal requires id', async () => {
    const r = await handleSecretManage(db(), { action: 'reveal' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('reveal marks secret as revealed', async () => {
    const c = await handleSecretManage(db(), { action: 'create', worldId: WORLD, name: 'Rev', publicDescription: 'p', secretDescription: 's' })
    const { secretId } = JSON.parse(c.content[0].text)
    const r = await handleSecretManage(db(), { action: 'reveal', id: secretId, revealedBy: 'player-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.revealedAt).toBeTruthy()
  })

  it('check_reveal requires id', async () => {
    const r = await handleSecretManage(db(), { action: 'check_reveal' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('check_reveal returns not found for unknown id', async () => {
    const r = await handleSecretManage(db(), { action: 'check_reveal', id: 'no-id' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('check_reveal returns reveal conditions', async () => {
    const c = await handleSecretManage(db(), { action: 'create', worldId: WORLD, name: 'Chk', publicDescription: 'p', secretDescription: 's', revealConditions: ['cond-a'] })
    const { secretId } = JSON.parse(c.content[0].text)
    const r = await handleSecretManage(db(), { action: 'check_reveal', id: secretId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.revealConditions).toContain('cond-a')
  })
})
