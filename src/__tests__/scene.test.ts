import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('activate_scene', () => {
  it('activates scene and writes system:active-scene', async () => {
    await seedKV('scene:intro', '**Description:** A dark tavern.\n**Entities:** character:innkeeper\n**Location:** location:tavern\n**Choices:** greet,leave')
    await seedKV('character:innkeeper', 'The innkeeper polishes a glass.')
    await seedKV('location:tavern', 'A low-ceilinged room.')
    const res = await callTool('scene_manage', { action: 'activate', scene_key: 'scene:intro' })
    expect(res.result.scene_key).toBe('scene:intro')
    expect(res.result.present_entities).toContain('character:innkeeper')
    expect(res.result.available_choices).toContain('greet')
    expect(res.result.entity_data['character:innkeeper']).toBeTruthy()
    expect(res.result.metadata.written).toBe(1)
  })

  it('returns error for missing scene', async () => {
    const res = await callTool('scene_manage', { action: 'activate', scene_key: 'scene:no-such' })
    expect(res.error).toBeDefined()
  })
})

describe('present_choices', () => {
  it('returns valid choices that meet requirements', async () => {
    await seedKV('scene:dungeon', '**Description:** A door ahead.\n- enter: Walk through the door\n- lockpick: Pick the lock [requires: lockpick]\n- smash: Smash the door [min-weight: 0.8]')
    await seedKV('character:rogue', '**Inventory:** lockpick×1\n**Weight-1:** 0.5')
    const res = await callTool('scene_manage', { action: 'present_choices', scene_key: 'scene:dungeon', entity_key: 'character:rogue' })
    const validIds = res.result.valid_choices.map((c: { id: string }) => c.id)
    expect(validIds).toContain('enter')
    expect(validIds).toContain('lockpick')
    const blockedIds = res.result.blocked_choices.map((c: { id: string }) => c.id)
    expect(blockedIds).toContain('smash')
  })

  it('blocks choices requiring missing item', async () => {
    await seedKV('scene:chest', '- open: Open the chest [requires: key]')
    await seedKV('character:no-key', '**Inventory:** rope×1')
    const res = await callTool('scene_manage', { action: 'present_choices', scene_key: 'scene:chest', entity_key: 'character:no-key' })
    expect(res.result.valid_choices).toHaveLength(0)
    expect(res.result.blocked_choices[0].blocked_reason).toContain('key')
  })
})

describe('commit_choice', () => {
  it('applies state change and appends to Choice-History', async () => {
    await seedKV('choice:accept-quest', '**Outcome-Seed:** The hero begins the journey.\n**State-Change:** Questing\n**Next-Choices:** choice:find-clue, choice:rest')
    await seedKV('character:hero', '**Status:** Idle\n**Choice-History:**')
    const res = await callTool('scene_manage', { action: 'commit_choice', choice_id: 'choice:accept-quest', entity_key: 'character:hero' })
    expect(res.result.outcome_seed).toContain('journey')
    expect(res.result.state_change).toBe('Questing')
    expect(res.result.next_choices).toContain('choice:find-clue')
    const hero = await callTool('lore_manage', { action: 'get', query: 'character:hero' })
    expect(hero.result.text).toContain('Questing')
    expect(hero.result.text).toContain('choice:accept-quest')
  })

  it('returns error for missing choice entry', async () => {
    await seedKV('character:player', 'A player.')
    const res = await callTool('scene_manage', { action: 'commit_choice', choice_id: 'choice:no-such', entity_key: 'character:player' })
    expect(res.error).toBeDefined()
  })
})

describe('get_choice_history', () => {
  it('parses Choice-History into structured entries', async () => {
    await seedKV('character:veteran', '**Choice-History:** choice:join-guild@2024-01-01T00:00:00.000Z, choice:betray-ally@2024-06-01T00:00:00.000Z')
    const res = await callTool('scene_manage', { action: 'get_history', entity_key: 'character:veteran' })
    expect(res.result.history).toHaveLength(2)
    expect(res.result.history[0].choice_id).toBe('choice:join-guild')
    expect(res.result.history[0].timestamp).toBeTruthy()
  })

  it('returns empty history for entity with no Choice-History field', async () => {
    await seedKV('character:fresh', 'No choices yet.')
    const res = await callTool('scene_manage', { action: 'get_history', entity_key: 'character:fresh' })
    expect(res.result.history).toHaveLength(0)
    expect(res.result.raw_history).toBeNull()
  })
})

describe('scene_brief', () => {
  it('returns location text and present entities', async () => {
    await seedKV('location:market', 'A busy marketplace')
    await seedKV('character:vendor', '**Status:** Active\n**Location:** location:market')
    const res = await callTool('scene_manage', { action: 'brief', location_key: 'location:market' })
    expect(res.error).toBeUndefined()
    expect(res.result.location.key).toBe('location:market')
    expect(res.result.entities.length).toBe(1)
    expect(res.result.entities[0].key).toBe('character:vendor')
  })

  it('includes open setups for present actors', async () => {
    await seedKV('location:hall', 'The great hall')
    await seedKV('character:noble', '**Status:** Active\n**Location:** location:hall')
    await callTool('continuity_manage', { action: 'plant_setup', id: 'noble-secret', description: 'Noble hides a secret', tension: 4, actors: ['character:noble'] })
    const res = await callTool('scene_manage', { action: 'brief', location_key: 'location:hall' })
    const setupIds = (res.result.open_setups as Array<{ id: string }>).map(s => s.id)
    expect(setupIds).toContain('noble-secret')
  })

  it('includes entity goal when set', async () => {
    await seedKV('location:den', 'A den')
    await seedKV('character:schemer', '**Status:** Active\n**Location:** location:den\n**Goal:main:** active | Take over the guild')
    const res = await callTool('scene_manage', { action: 'brief', location_key: 'location:den' })
    expect(res.result.entities[0].top_goal).toContain('main:')
  })

  it('returns error when no location or scene key provided', async () => {
    const res = await callTool('scene_manage', { action: 'brief' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('returns error for nonexistent location', async () => {
    const res = await callTool('scene_manage', { action: 'brief', location_key: 'location:nonexistent-9999' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('render_pov', () => {
  it('filters [hidden] lines for low-perception POV', async () => {
    await seedKV('location:foggy-alley', 'Dark alley.\n[hidden] An assassin lurks in the shadows.')
    await seedKV('character:naive-pov', '**Status:** Scared\n**Perception:** 0.2\n**Location:** location:foggy-alley')
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:naive-pov', location_key: 'location:foggy-alley' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.pov).toBe('character:naive-pov')
    expect(res.result.location.filtered_text).not.toContain('assassin')
  })

  it('keeps [hidden] lines for high-perception POV', async () => {
    await seedKV('location:shadows', 'The room.\n[hidden] A safe is behind the painting.')
    await seedKV('character:sharp-eyes', '**Perception:** 0.9\n**Location:** location:shadows')
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:sharp-eyes', location_key: 'location:shadows' })
    expect(res.result.location.filtered_text).toContain('safe')
  })

  it('includes voice hints when requested', async () => {
    await seedKV('location:tavern', 'The tavern is warm.')
    await seedKV('character:bard', '**Status:** Active\n**Location:** location:tavern\n**Diction:** archaic and flowery\n**Perception:** 0.8')
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:bard', location_key: 'location:tavern', include_voice_hints: true })
    expect(res.result.voice_hints).toBeDefined()
    expect(res.result.voice_hints.diction).toBe('archaic and flowery')
  })

  it('uses entity Location field when no location_key provided', async () => {
    await seedKV('location:cabin', 'A small cabin.')
    await seedKV('character:recluse', '**Perception:** 0.5\n**Location:** location:cabin')
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:recluse' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.location).toBe('location:cabin')
  })

  it('returns error for nonexistent POV entity', async () => {
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:ghost-9999', location_key: 'location:market' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})
