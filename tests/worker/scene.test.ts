import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'
import { setupRpgDb } from './support/setup-d1'

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

// #350 — narrow bridge: a committed choice mirrors into D1 timeline_events
// when the KV entity resolves to a real D1 character with a world_id.
describe('commit_choice — timeline_events bridge (#350)', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  async function seedWorld(worldId: string) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT INTO worlds (id, name, seed, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(worldId, worldId, 'seed', 10, 10, now, now).run()
  }

  async function seedD1Character(id: string, name: string, worldId: string | null) {
    const now = new Date().toISOString()
    await env.RPG_DB.prepare(
      `INSERT INTO characters (id, name, stats, hp, max_hp, ac, level, world_id, created_at, updated_at)
       VALUES (?, ?, '{}', 10, 10, 10, 1, ?, ?, ?)`
    ).bind(id, name, worldId, now, now).run()
  }

  it('writes a "chose" timeline_events row when the entity resolves to a D1 character with world_id', async () => {
    await seedWorld('world-bridge-1')
    await seedD1Character('char-bridge-1', 'Bridge Hero', 'world-bridge-1')
    await env.LORE_DB.put('choice:bridge-quest', JSON.stringify({
      text: '**Outcome-Seed:** The bridge holds.\n**State-Change:** Crossed', meta: { version: 1 },
    }))
    await env.LORE_DB.put('character:bridge-hero', JSON.stringify({
      text: '**Status:** Idle\n**Location:** location:riverbank', meta: { version: 1, d1_id: 'char-bridge-1' },
    }))

    const res = await callTool('scene_manage', { action: 'commit_choice', choice_id: 'choice:bridge-quest', entity_key: 'character:bridge-hero' })
    expect(res.error).toBeUndefined()
    expect(res.result.timeline_event_id).toBeTruthy()

    const row = await env.RPG_DB.prepare('SELECT * FROM timeline_events WHERE id = ?').bind(res.result.timeline_event_id).first() as Record<string, unknown>
    expect(row.world_id).toBe('world-bridge-1')
    expect(row.verb).toBe('chose')
    expect(row.entity_id).toBe('char-bridge-1')
    expect(row.object_entity).toBe('choice:bridge-quest')
    expect(row.location_id).toBe('location:riverbank')
    expect(row.detail).toContain('choice:bridge-quest')
    expect(row.detail).toContain('Crossed')
  })

  it('returns null timeline_event_id (no error) when the entity has no matching D1 character', async () => {
    await seedKV('choice:unbridged', '**Outcome-Seed:** Nothing links this one.')
    await seedKV('character:no-d1-match', '**Status:** Idle')

    const res = await callTool('scene_manage', { action: 'commit_choice', choice_id: 'choice:unbridged', entity_key: 'character:no-d1-match' })
    expect(res.error).toBeUndefined()
    expect(res.result.timeline_event_id).toBeNull()
  })

  it('returns null timeline_event_id (no error) when the resolved D1 character has no world_id', async () => {
    await seedD1Character('char-worldless', 'Worldless', null)
    await env.LORE_DB.put('choice:worldless-choice', JSON.stringify({ text: '**Outcome-Seed:** Adrift.', meta: { version: 1 } }))
    await env.LORE_DB.put('character:worldless', JSON.stringify({
      text: '**Status:** Idle', meta: { version: 1, d1_id: 'char-worldless' },
    }))

    const res = await callTool('scene_manage', { action: 'commit_choice', choice_id: 'choice:worldless-choice', entity_key: 'character:worldless' })
    expect(res.error).toBeUndefined()
    expect(res.result.timeline_event_id).toBeNull()
  })

  it('returns null timeline_event_id (no error) when meta.d1_id points to a nonexistent D1 character', async () => {
    await seedKV('choice:stale-id-choice', '**Outcome-Seed:** Dangling reference.')
    await env.LORE_DB.put('character:stale-id', JSON.stringify({
      text: '**Status:** Idle', meta: { version: 1, d1_id: 'char-does-not-exist' },
    }))

    const res = await callTool('scene_manage', { action: 'commit_choice', choice_id: 'choice:stale-id-choice', entity_key: 'character:stale-id' })
    expect(res.error).toBeUndefined()
    expect(res.result.timeline_event_id).toBeNull()
  })

  it('records a "chose" event with null location_id when the entity has no Location field', async () => {
    await seedWorld('world-bridge-2')
    await seedD1Character('char-bridge-2', 'Locationless Hero', 'world-bridge-2')
    await seedKV('choice:no-location-choice', '**Outcome-Seed:** Wanders in the void.')
    await env.LORE_DB.put('character:locationless-hero', JSON.stringify({
      text: '**Status:** Idle', meta: { version: 1, d1_id: 'char-bridge-2' },
    }))

    const res = await callTool('scene_manage', { action: 'commit_choice', choice_id: 'choice:no-location-choice', entity_key: 'character:locationless-hero' })
    expect(res.error).toBeUndefined()
    expect(res.result.timeline_event_id).toBeTruthy()

    const row = await env.RPG_DB.prepare('SELECT location_id FROM timeline_events WHERE id = ?').bind(res.result.timeline_event_id).first() as Record<string, unknown>
    expect(row.location_id).toBeNull()
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
    expect(res.result.voice_source).toBe('entity')
  })

  it('falls back to species voice hints when the entity has none of its own', async () => {
    await seedKV('location:tavern', 'The tavern is warm.')
    await seedKV('species:lamia', '**Diction:** Sibilant, measured, drawn-out consonants\n**Register:** Low, hissing undertone')
    await seedKV('character:kavissa', '**Status:** Active\n**Species:** lamia\n**Location:** location:tavern\n**Perception:** 0.8')
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:kavissa', location_key: 'location:tavern', include_voice_hints: true })
    expect(res.result.voice_hints.diction).toBe('Sibilant, measured, drawn-out consonants')
    expect(res.result.voice_hints.register).toBe('Low, hissing undertone')
    expect(res.result.voice_source).toBe('species fallback (species:lamia)')
  })

  it('returns null voice hints with source "none" when neither entity nor species has data', async () => {
    await seedKV('location:tavern', 'The tavern is warm.')
    await seedKV('character:blank-voice', '**Status:** Active\n**Location:** location:tavern\n**Perception:** 0.8')
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:blank-voice', location_key: 'location:tavern', include_voice_hints: true })
    expect(res.result.voice_hints.diction).toBeNull()
    expect(res.result.voice_source).toBe('none')
  })

  it('uses entity Location field when no location_key provided', async () => {
    await seedKV('location:cabin', 'A small cabin.')
    await seedKV('character:recluse', '**Perception:** 0.5\n**Location:** location:cabin')
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:recluse' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.location).toBe('location:cabin')
  })

  it('falls back to scene_key when location_key is omitted', async () => {
    await seedKV('scene:campfire', 'A dying campfire.')
    await seedKV('character:wanderer', '**Perception:** 0.5')
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:wanderer', scene_key: 'scene:campfire' })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.location).toBe('scene:campfire')
  })

  it('returns error for nonexistent POV entity', async () => {
    const res = await callTool('scene_manage', { action: 'render_pov', pov_entity_key: 'character:ghost-9999', location_key: 'location:market' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('render_with_rolls', () => {
  beforeEach(async () => {
    await setupRpgDb(env.RPG_DB)
  })

  it('combines POV rendering with one or more dice rolls (#260)', async () => {
    await seedKV('location:foggy-alley', 'Dark alley.\n[hidden] An assassin lurks in the shadows.')
    await seedKV('character:naive-pov', '**Status:** Scared\n**Perception:** 0.2\n**Location:** location:foggy-alley')
    const res = await callTool('scene_manage', {
      action: 'render_with_rolls',
      pov_entity_key: 'character:naive-pov',
      location_key: 'location:foggy-alley',
      rolls: [{ label: 'perception check', expression: '1d20+2' }],
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.pov).toBe('character:naive-pov')
    expect(res.result.location.filtered_text).not.toContain('assassin')
    expect(res.result.rolls).toHaveLength(1)
    expect(res.result.rolls[0].label).toBe('perception check')
    expect(res.result.rolls[0].expression).toBe('1d20+2')
    expect(typeof res.result.rolls[0].total).toBe('number')
    expect(res.result.rolls[0].calculationId).toBeTruthy()
    expect(res.result.metadata.roll_count).toBe(1)
  })

  it('resolves multiple rolls in one call', async () => {
    await seedKV('location:tavern', 'The tavern is warm.')
    await seedKV('character:bard', '**Status:** Active\n**Location:** location:tavern\n**Perception:** 0.8')
    const res = await callTool('scene_manage', {
      action: 'render_with_rolls',
      pov_entity_key: 'character:bard',
      location_key: 'location:tavern',
      rolls: [
        { label: 'insight check', expression: '1d20+3' },
        { label: 'damage', expression: '2d6' },
      ],
    })
    expect(res.error).toBeUndefined()
    expect(res.result.rolls).toHaveLength(2)
    expect(res.result.rolls.map((r: any) => r.label)).toEqual(['insight check', 'damage'])
  })

  it('records a per-roll error instead of failing the whole request for a malformed expression', async () => {
    await seedKV('location:tavern', 'The tavern is warm.')
    await seedKV('character:bard', '**Status:** Active\n**Location:** location:tavern\n**Perception:** 0.8')
    const res = await callTool('scene_manage', {
      action: 'render_with_rolls',
      pov_entity_key: 'character:bard',
      location_key: 'location:tavern',
      rolls: [{ label: 'bad roll', expression: 'not-dice' }],
    })
    expect(res.error).toBeUndefined()
    expect(res.result.rolls[0].error).toBeDefined()
    expect(res.result.rolls[0].label).toBe('bad roll')
  })

  it('includes voice hints alongside rolls when requested', async () => {
    await seedKV('location:tavern', 'The tavern is warm.')
    await seedKV('character:bard', '**Status:** Active\n**Location:** location:tavern\n**Diction:** archaic and flowery\n**Perception:** 0.8')
    const res = await callTool('scene_manage', {
      action: 'render_with_rolls',
      pov_entity_key: 'character:bard',
      location_key: 'location:tavern',
      include_voice_hints: true,
      rolls: [{ label: 'charm check', expression: '1d20' }],
    })
    expect(res.result.voice_hints.diction).toBe('archaic and flowery')
    expect(res.result.rolls).toHaveLength(1)
  })

  it('returns error for nonexistent POV entity', async () => {
    const res = await callTool('scene_manage', {
      action: 'render_with_rolls',
      pov_entity_key: 'character:ghost-9999',
      location_key: 'location:market',
      rolls: [{ label: 'roll', expression: '1d20' }],
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects an empty rolls array', async () => {
    await seedKV('location:tavern', 'The tavern is warm.')
    await seedKV('character:bard', '**Perception:** 0.8\n**Location:** location:tavern')
    const res = await callTool('scene_manage', {
      action: 'render_with_rolls',
      pov_entity_key: 'character:bard',
      location_key: 'location:tavern',
      rolls: [],
    })
    expect(res.error).toBeDefined()
  })
})
