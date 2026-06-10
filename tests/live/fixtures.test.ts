import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Canonical Fixture Tests', () => {
  let alphaKey: string, actorKey: string, betaKey: string, locKey: string, sceneKey: string

  beforeAll(async () => {
    alphaKey = `entity:canonical-subject-alpha-${uid()}`
    actorKey = `entity:canonical-actor-primary-${uid()}`
    betaKey = `entity:canonical-subject-beta-${uid()}`
    locKey = `location:canonical-transit-hub-${uid()}`
    sceneKey = `scene:canonical-threshold-${uid()}`

    await Promise.all([
      setLore(alphaKey, 'Status: Active, Stage-2-of-4\nCurrent-Stage: 2\nTotal-Stages: 4\nWeight-1 (Drive): 30\nWeight-2 (Vulnerability): 55'),
      setLore(actorKey, 'Status: Active, Processing\nWeight-1 (Drive): 85\nWeight-2 (Vulnerability): 10\nState-Level: 0'),
      setLore(betaKey, 'Status: Stage-3-of-4, Modified-Consciousness\nWeight-1 (Drive): 10\nWeight-2 (Vulnerability): 75'),
      setLore(locKey, 'Type: threshold-zone\nExits:\n- target: location:canonical-dest-a\n  travel-cost: 2-hours\n- target: location:canonical-dest-b\n  travel-cost: 30-minutes'),
      setLore(sceneKey, 'Thread: canonical-primary-cycle\nChoices:\n- id: investigate\n- id: search\n- id: retreat'),
    ])
  })

  afterAll(async () => {
    await deleteLore(alphaKey, actorKey, betaKey, locKey, sceneKey)
  })

  it('advance_state_stage reads Stage-2-of-4 from Status field', async () => {
    const res = await tool('advance_state_stage', { entity_key: alphaKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Stage-3-of-4/)
  })

  it('advance_state_stage handles Stage-3-of-4 terminal state', async () => {
    const res = await tool('advance_state_stage', { entity_key: betaKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Stage-4-of-4/)
  })

  it('resolve_interaction normalizes integer weights', async () => {
    const res = await tool('resolve_interaction', {
      entity_a_id: actorKey, entity_b_id: alphaKey, action_type: 'process',
    })
    expect(res.error).toBeUndefined()
    const w1: number = res.result.metadata.weight_1
    const w2: number = res.result.metadata.weight_2
    expect(w1).toBeGreaterThan(0.84)
    expect(w1).toBeLessThan(0.86)
    expect(w2).toBeGreaterThan(0.54)
    expect(w2).toBeLessThan(0.56)
  })

  it('get_reachable_locations parses YAML-style Exits', async () => {
    const res = await tool('get_reachable_locations', { origin_key: locKey })
    expect(res.result.locations).toHaveLength(2)
  })

  it('activate_scene extracts YAML choice IDs', async () => {
    const res = await tool('activate_scene', { scene_key: sceneKey })
    const choices: string[] = res.result.available_choices
    expect(choices).toContain('investigate')
    expect(choices).toContain('retreat')
  })
})

describe.skipIf(!MCP_API_KEY)('Weight Integer Boundaries', () => {
  let minKey: string, maxKey: string, targetKey: string

  beforeAll(async () => {
    minKey = `entity:canonical-min-drive-${uid()}`
    maxKey = `entity:canonical-max-drive-${uid()}`
    targetKey = `entity:canonical-passive-target-${uid()}`
    await Promise.all([
      setLore(minKey, 'Weight-1 (Drive): 5\nState-Level: 0'),
      setLore(maxKey, 'Weight-1 (Drive): 95\nState-Level: 0'),
      setLore(targetKey, 'Weight-2: 0'),
    ])
  })

  afterAll(async () => { await deleteLore(minKey, maxKey, targetKey) })

  it('Weight-1:5 normalizes to ~0.05', async () => {
    const res = await tool('resolve_interaction', {
      entity_a_id: minKey, entity_b_id: targetKey, action_type: 'test',
    })
    const w1: number = res.result.metadata.weight_1
    expect(w1).toBeGreaterThan(0.049)
    expect(w1).toBeLessThan(0.051)
  })

  it('Weight-1:95 normalizes to ~0.95', async () => {
    const res = await tool('resolve_interaction', {
      entity_a_id: maxKey, entity_b_id: targetKey, action_type: 'test',
    })
    const w1: number = res.result.metadata.weight_1
    expect(w1).toBeGreaterThan(0.949)
    expect(w1).toBeLessThan(0.951)
  })
})
