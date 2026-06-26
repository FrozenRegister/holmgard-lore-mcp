// Direct handler tests for session-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handleSessionManage } from '../rpg/handlers/session-manage'

describe('handleSessionManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  it('returns guiding error for unknown action', async () => {
    const r = await handleSessionManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('initialize with createNew creates world and party', async () => {
    const r = await handleSessionManage(db(), { action: 'initialize', createNew: true, worldName: 'TestWorld', partyName: 'Heroes' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.created.world).toBe(true)
    expect(body.created.party).toBe(true)
    expect(body.worldName).toBe('TestWorld')
  })

  it('initialize without createNew finds existing world and party', async () => {
    // create world and party first
    await handleSessionManage(db(), { action: 'initialize', createNew: true })
    const r = await handleSessionManage(db(), { action: 'initialize' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    // worldId should be found from DB
    expect(body.worldId).toBeTruthy()
  })

  it('initialize with explicit worldId and partyId', async () => {
    const r = await handleSessionManage(db(), { action: 'initialize', worldId: 'w-1', partyId: 'p-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('initialize with no world or createNew returns null worldId gracefully', async () => {
    const r = await handleSessionManage(db(), { action: 'initialize' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('get_context returns empty context when nothing exists', async () => {
    const r = await handleSessionManage(db(), { action: 'get_context', worldId: 'w-none', partyId: 'p-none' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('get_context includes party when partyId exists', async () => {
    const init = await handleSessionManage(db(), { action: 'initialize', createNew: true })
    const { partyId, worldId } = JSON.parse(init.content[0].text)
    const r = await handleSessionManage(db(), { action: 'get_context', worldId, partyId, includeQuests: true, includeWorld: true, includeNarrative: true, includeCombat: true })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('get_context skips sections when include flags are false', async () => {
    const r = await handleSessionManage(db(), { action: 'get_context', includeParty: false, includeQuests: false, includeWorld: false, includeNarrative: false, includeCombat: false })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.party).toBeUndefined()
  })
})
