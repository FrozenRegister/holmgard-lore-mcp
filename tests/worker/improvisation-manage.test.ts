// Direct handler tests for improvisation-manage (not registered in rpgToolRegistry)
import { describe } from './support/helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'
import { handleImprovisationManage } from '@/rpg/handlers/improvisation-manage'

describe('handleImprovisationManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB }) as any

  it('returns guiding error for unknown action', async () => {
    const r = await handleImprovisationManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('apply requires targetId and name', async () => {
    const r = await handleImprovisationManage(db(), { action: 'apply', targetId: 'char-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('apply creates a custom effect', async () => {
    const r = await handleImprovisationManage(db(), {
      action: 'apply',
      targetId: 'char-1',
      name: 'Cursed Touch',
      category: 'curse',
      sourceType: 'arcane',
      powerLevel: 3,
      durationType: 'rounds',
      durationValue: 5,
      mechanics: ['disadvantage on attack'],
      triggers: ['on hit'],
      removalConditions: ['remove curse'],
      stackable: false,
      description: 'A dark curse',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.effectId).toBeTruthy()
    expect(body.name).toBe('Cursed Touch')
  })

  it('get requires id', async () => {
    const r = await handleImprovisationManage(db(), { action: 'get' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns not found', async () => {
    const r = await handleImprovisationManage(db(), { action: 'get', id: 99999 })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get returns effect with parsed arrays', async () => {
    const c = await handleImprovisationManage(db(), {
      action: 'apply',
      targetId: 'char-2',
      name: 'Boon',
      durationType: 'permanent',
    })
    const { effectId } = JSON.parse(c.content[0].text)
    const r = await handleImprovisationManage(db(), { action: 'get', id: effectId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.effect.name).toBe('Boon')
  })

  it('list returns active effects', async () => {
    await handleImprovisationManage(db(), { action: 'apply', targetId: 'char-3', name: 'Shield' })
    const r = await handleImprovisationManage(db(), { action: 'list' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('remove requires id', async () => {
    const r = await handleImprovisationManage(db(), { action: 'remove' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('remove deactivates effect', async () => {
    const c = await handleImprovisationManage(db(), {
      action: 'apply',
      targetId: 'char-4',
      name: 'Poison',
    })
    const { effectId } = JSON.parse(c.content[0].text)
    const r = await handleImprovisationManage(db(), { action: 'remove', id: effectId })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('tick advances rounds and expires effects', async () => {
    await handleImprovisationManage(db(), {
      action: 'apply',
      targetId: 'char-5',
      name: 'Haste',
      durationType: 'rounds',
      durationValue: 1,
    })
    const r = await handleImprovisationManage(db(), { action: 'tick', rounds: 2 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roundsAdvanced).toBe(2)
    expect(body.expired).toBeGreaterThanOrEqual(0)
  })

  it('list_by_target requires targetId', async () => {
    const r = await handleImprovisationManage(db(), { action: 'list_by_target' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list_by_target returns effects for target', async () => {
    await handleImprovisationManage(db(), {
      action: 'apply',
      targetId: 'target-6',
      name: 'Fire Shield',
    })
    const r = await handleImprovisationManage(db(), {
      action: 'list_by_target',
      targetId: 'target-6',
    })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })
})
