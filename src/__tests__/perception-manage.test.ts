// Direct handler tests for perception-manage (not registered in rpgToolRegistry)
import { describe } from './helpers'
import { env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './setup-d1'
import { handlePerceptionManage } from '../rpg/handlers/perception-manage'

describe('handlePerceptionManage', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  const db = () => ({ RPG_DB: env.RPG_DB } as any)

  it('returns guiding error for unknown action', async () => {
    const r = await handlePerceptionManage(db(), { action: 'zap' })
    expect(r.content[0].text).toContain('zap')
  })

  it('assess requires observerId and targetId', async () => {
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-1' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('assess succeeds with roll meeting dc', async () => {
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-1', targetId: 'room-1', rollValue: 20, dc: 12, perceptionType: 'sight' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.succeeded).toBe(true)
    expect(body.isCrit).toBe(true)
  })

  it('assess fails when roll below dc', async () => {
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-2', targetId: 'room-2', rollValue: 5, dc: 15, perceptionType: 'hearing' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.succeeded).toBe(false)
  })

  it('assess uses random roll when rollValue not provided', async () => {
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-3', targetId: 'room-3', perceptionType: 'investigation' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.roll).toBeGreaterThanOrEqual(1)
  })

  it('assess works with different perception types', async () => {
    for (const type of ['smell', 'arcana', 'insight']) {
      const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-4', targetId: 'target-1', rollValue: 18, perceptionType: type as any })
      const body = JSON.parse(r.content[0].text)
      expect(body.success).toBe(true)
    }
  })

  it('assess uses unknown perception type fallback', async () => {
    // rollValue=20 with default dc=12 always succeeds
    const r = await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-5', targetId: 'enc-1', targetKind: 'encounter', rollValue: 20 })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('get_history requires observerId', async () => {
    const r = await handlePerceptionManage(db(), { action: 'get_history' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_history returns assessments for observer', async () => {
    await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-6', targetId: 'room-6', rollValue: 15 })
    const r = await handlePerceptionManage(db(), { action: 'get_history', observerId: 'obs-6' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })

  it('get_latest requires observerId', async () => {
    const r = await handlePerceptionManage(db(), { action: 'get_latest' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_latest returns not found when no assessments', async () => {
    const r = await handlePerceptionManage(db(), { action: 'get_latest', observerId: 'nobody' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('get_latest returns most recent assessment', async () => {
    await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-7', targetId: 'room-7', rollValue: 15 })
    const r = await handlePerceptionManage(db(), { action: 'get_latest', observerId: 'obs-7' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.assessment).toBeDefined()
  })

  it('get_latest filters by targetId', async () => {
    await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-8', targetId: 'target-8', rollValue: 12 })
    const r = await handlePerceptionManage(db(), { action: 'get_latest', observerId: 'obs-8', targetId: 'target-8' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
  })

  it('list_observers requires targetId', async () => {
    const r = await handlePerceptionManage(db(), { action: 'list_observers' })
    const body = JSON.parse(r.content[0].text)
    expect(body.error).toBe(true)
  })

  it('list_observers returns observers for target', async () => {
    await handlePerceptionManage(db(), { action: 'assess', observerId: 'obs-9', targetId: 'shared-target', rollValue: 10 })
    const r = await handlePerceptionManage(db(), { action: 'list_observers', targetId: 'shared-target' })
    const body = JSON.parse(r.content[0].text)
    expect(body.success).toBe(true)
    expect(body.count).toBeGreaterThanOrEqual(1)
  })
})
