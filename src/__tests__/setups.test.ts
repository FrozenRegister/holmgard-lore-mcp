import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('plant_setup', () => {
  it('creates a setup entry with tension', async () => {
    const res = await callTool('continuity_manage', { action: 'plant_setup', id: 'locked-door', description: 'The cellar door is locked', tension: 4 })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.key).toBe('setup:locked-door')
    expect(res.result.metadata.tension).toBe(4)
  })

  it('created setup appears in list_unpaid_setups', async () => {
    await callTool('continuity_manage', { action: 'plant_setup', id: 'test-setup-1', description: 'Test setup', tension: 3 })
    const res = await callTool('continuity_manage', { action: 'list_unpaid_setups' })
    const setups = res.result.setups as Array<{ id: string }>
    expect(setups.some(s => s.id === 'test-setup-1')).toBe(true)
  })

  it('defaults tension to 3 when omitted', async () => {
    const res = await callTool('continuity_manage', { action: 'plant_setup', id: 'default-tension', description: 'No tension given' })
    expect(res.result.metadata.tension).toBe(3)
  })

  it('rejects missing description', async () => {
    const res = await callTool('continuity_manage', { action: 'plant_setup', id: 'bad-setup' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('accepts setup_id as an alias for id', async () => {
    const res = await callTool('continuity_manage', { action: 'plant_setup', setup_id: 'church-ambush', description: 'Church courier spotted near the canal', payoff_type: 'threat' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.key).toBe('setup:church-ambush')
  })
})

describe('pay_off_setup', () => {
  it('marks a setup as paid', async () => {
    await callTool('continuity_manage', { action: 'plant_setup', id: 'gun-on-wall', description: 'The gun on the wall', tension: 5 })
    const res = await callTool('continuity_manage', { action: 'pay_off_setup', id: 'gun-on-wall', resolution: 'Fired in chapter 3', paid_in: 'scene:climax' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.status).toBe('paid')
  })

  it('paid setup no longer appears in list_unpaid_setups', async () => {
    await callTool('continuity_manage', { action: 'plant_setup', id: 'will-be-paid', description: 'Will be paid', tension: 2 })
    await callTool('continuity_manage', { action: 'pay_off_setup', id: 'will-be-paid', resolution: 'Resolved' })
    const res = await callTool('continuity_manage', { action: 'list_unpaid_setups' })
    const setups = res.result.setups as Array<{ id: string }>
    expect(setups.some(s => s.id === 'will-be-paid')).toBe(false)
  })

  it('supports abandoned and deferred statuses', async () => {
    await callTool('continuity_manage', { action: 'plant_setup', id: 'dropped', description: 'Will be dropped', tension: 1 })
    const res = await callTool('continuity_manage', { action: 'pay_off_setup', id: 'dropped', resolution: 'Cut from story', status: 'abandoned' })
    expect(res.result.metadata.status).toBe('abandoned')
  })

  it('returns error for nonexistent setup', async () => {
    const res = await callTool('continuity_manage', { action: 'pay_off_setup', id: 'nonexistent-9999', resolution: 'Resolved' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects invalid params (missing resolution)', async () => {
    const res = await callTool('continuity_manage', { action: 'pay_off_setup', id: 'some-setup' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })
})

describe('list_unpaid_setups', () => {
  it('returns open setups sorted by tension descending', async () => {
    await callTool('continuity_manage', { action: 'plant_setup', id: 'low-tension', description: 'Low tension', tension: 1 })
    await callTool('continuity_manage', { action: 'plant_setup', id: 'high-tension', description: 'High tension', tension: 5 })
    const res = await callTool('continuity_manage', { action: 'list_unpaid_setups' })
    expect(res.error).toBeUndefined()
    const setups = res.result.setups as Array<{ id: string; tension: number }>
    expect(setups[0].tension).toBeGreaterThanOrEqual(setups[setups.length - 1].tension)
  })

  it('filters by min_tension', async () => {
    await callTool('continuity_manage', { action: 'plant_setup', id: 'min-t2', description: 'Low', tension: 2 })
    await callTool('continuity_manage', { action: 'plant_setup', id: 'min-t4', description: 'High', tension: 4 })
    const res = await callTool('continuity_manage', { action: 'list_unpaid_setups', min_tension: 3 })
    const setups = res.result.setups as Array<{ tension: number }>
    expect(setups.every(s => s.tension >= 3)).toBe(true)
    expect(setups.some(s => s.tension < 3)).toBe(false)
  })

  it('returns empty when no open setups exist', async () => {
    // Seed a non-setup KV entry so kvList uses KV instead of falling back to
    // the module-level loreDB (which accumulates setup entries across tests).
    await seedKV('placeholder:empty-setups', 'placeholder')
    const res = await callTool('continuity_manage', { action: 'list_unpaid_setups' })
    expect(res.result.metadata.count).toBe(0)
    expect(res.result.content[0].text).toBe('No open setups found.')
  })

  it('rejects invalid params (min_tension not a number)', async () => {
    const res = await callTool('continuity_manage', { action: 'list_unpaid_setups', min_tension: 'high' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })
})
