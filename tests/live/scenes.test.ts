import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Scene Operations', () => {
  let sceneLocKey: string, sceneEntity: string, sceneKey: string
  let choiceKey: string, historyEntity: string

  beforeEach(async () => {
    sceneLocKey = `test:scene-loc-${uid()}`
    sceneEntity = `test:scene-entity-${uid()}`
    sceneKey = `test:scene-${uid()}`
    choiceKey = `test:choice-${uid()}`
    historyEntity = `test:history-entity-${uid()}`

    await Promise.all([
      setLore(sceneLocKey, 'A dim tavern.'),
      setLore(sceneEntity, 'The innkeeper polishes a glass.'),
      setLore(sceneKey, `**Description:** Dark tavern.\n**Entities:** ${sceneEntity}\n**Location:** ${sceneLocKey}\n**Choices:** greet,leave`),
      setLore(choiceKey, '**Outcome-Seed:** The hero accepts.\n**State-Change:** Questing\n**Next-Choices:** choice-b'),
      setLore(historyEntity, '**Status:** Idle\n**Choice-History:** prev-choice@2024-01-01T00:00:00.000Z'),
    ])
  })

  afterEach(async () => {
    await deleteLore(sceneLocKey, sceneEntity, sceneKey, choiceKey, historyEntity)
  })

  it('activate_scene activates and hydrates entities', async () => {
    const res = await tool('scene_manage', { action: 'activate', scene_key: sceneKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/activated/)
  })

  it('activate_scene returns error for missing scene', async () => {
    const res = await tool('scene_manage', { action: 'activate', scene_key: 'scene:ghost' })
    expect(res.error).toBeTruthy()
  })

  it('commit_choice applies state change and records history', async () => {
    const res = await tool('scene_manage', { action: 'commit_choice', choice_id: choiceKey, entity_key: historyEntity })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/committed/)
    // #350 — timeline_events bridge field is always present; null here since
    // this KV-only test entity has no matching D1 character/world_id.
    expect(res.result.timeline_event_id).toBeNull()
  })

  it('commit_choice state change persists', async () => {
    await tool('scene_manage', { action: 'commit_choice', choice_id: choiceKey, entity_key: historyEntity })
    const res = await tool('lore_manage', { action: 'get', query: historyEntity })
    expect(res.result.content[0].text).toMatch(/Questing/)
  })

  it('get_choice_history parses committed entries', async () => {
    const res = await tool('scene_manage', { action: 'get_history', entity_key: historyEntity })
    expect(res.error).toBeUndefined()
  })
})

describe.skipIf(!MCP_API_KEY)('State Stage Operations', () => {
  let stageEntity: string

  beforeEach(async () => {
    stageEntity = `test:stage-entity-${uid()}`
    await setLore(stageEntity, '**State-Stage:** 2\n**State-Total:** 5\n**Stage-Timer:** 4')
  })

  afterEach(async () => { await deleteLore(stageEntity) })

  it('advance_state_stage increments stage and decrements timer', async () => {
    const res = await tool('entity_manage', { action: 'advance_stage', entity_key: stageEntity })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/stage 3/)
  })

  it('advance_state_stage writes back to entity', async () => {
    await tool('entity_manage', { action: 'advance_stage', entity_key: stageEntity })
    const res = await tool('lore_manage', { action: 'get', query: stageEntity })
    expect(res.result.content[0].text).toMatch(/State-Stage.*3/)
  })
})
