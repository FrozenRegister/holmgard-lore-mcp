import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

let preyKey: string
let predatorKey: string

describe.skipIf(!MCP_API_KEY)('Consumption Timelines', () => {
  beforeAll(async () => {
    // Set up a prey entity and a predator entity
    preyKey = `test:prey-${uid()}`
    predatorKey = `test:predator-${uid()}`
    await Promise.all([
      setLore(preyKey, `**Name:** Test Prey\n**Weight-2:** 0.6`),
      setLore(predatorKey, `**Name:** Test Predator\n**Weight-1:** 0.8`),
    ])
  })

  afterAll(async () => {
    await deleteLore(preyKey, predatorKey)
  })

  it('list_consumption_timelines - all statuses', async () => {
    const res = await tool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
    })
    expect(res.error).toBeUndefined()
  })

  it('list_consumption_timelines - imminent only', async () => {
    const res = await tool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'imminent',
    })
    expect(res.error).toBeUndefined()
  })

  it('create_consumption_timeline - success', async () => {
    const res = await tool('entity_manage', {
      action: 'create_consumption_timeline',
      entity_key: preyKey,
      predator_key: predatorKey,
      stages: 5,
      stage_timer: 3,
      terminal_state: 'consumed-nutrient',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.timeline.entity_key).toBe(preyKey)
    expect(res.result.timeline.predator_key).toBe(predatorKey)
  })

  it('create_consumption_timeline - duplicate returns error', async () => {
    const res = await tool('entity_manage', {
      action: 'create_consumption_timeline',
      entity_key: preyKey,
      predator_key: predatorKey,
      stages: 3,
      stage_timer: 1,
      terminal_state: 'consumed-nutrient',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('already exists')
  })

  it('set_consumption_timeline - advance stage', async () => {
    const res = await tool('entity_manage', {
      action: 'set_consumption_timeline',
      entity_key: preyKey,
      current_stage: 2,
      stage_timer: 1,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.timeline.current_stage).toBe(2)
    expect(res.result.timeline.stage_timer).toBe(1)
  })

  it('set_consumption_timeline - terminal detection', async () => {
    const res = await tool('entity_manage', {
      action: 'set_consumption_timeline',
      entity_key: preyKey,
      current_stage: 5,
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.is_terminal).toBe(true)
  })

  it('create_consumption_timeline - non-existent entity returns error', async () => {
    const res = await tool('entity_manage', {
      action: 'create_consumption_timeline',
      entity_key: `test:nonexistent-${uid()}`,
      predator_key: predatorKey,
      stages: 3,
      stage_timer: 1,
      terminal_state: 'consumed-nutrient',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('not found')
  })

  it('set_consumption_timeline - no existing timeline returns error', async () => {
    const freshKey = `test:fresh-${uid()}`
    await setLore(freshKey, '**Name:** Fresh entity')
    const res = await tool('entity_manage', {
      action: 'set_consumption_timeline',
      entity_key: freshKey,
      current_stage: 1,
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('No consumption timeline exists')
    await deleteLore(freshKey)
  })
})

describe.skipIf(!MCP_API_KEY)('Thread Operations', () => {
  it('list_active_threads', async () => {
    const res = await tool('entity_manage', { action: 'list_active_threads' })
    expect(res.error).toBeUndefined()
  })
})
