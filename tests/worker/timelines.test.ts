import {
  describe,
  rpc,
  callTool,
  callToolWithApiKey,
  seedKV,
  ADMIN_SECRET,
  parseEncounterTable,
} from './support/helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('list_consumption_timelines', () => {
  it('returns empty when no character keys have timelines', async () => {
    await seedKV('location:dungeon', '**Consumption-Timeline:** 1 hour')
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
    })
    // location:* key is not scanned — only character:* keys
    expect(res.result.timelines).toHaveLength(0)
    expect(res.result.content[0].text).toBe('No consumption timelines found.')
  })

  it('parses Consumption-Timeline field from character:* entries', async () => {
    await seedKV(
      'character:prey-alpha',
      '**Status:** Active\n**Consumption-Timeline:** 3 days\n**Processor:** Alpha',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
    })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:prey-alpha')
    expect(res.result.timelines[0].timeline_remaining).toBe('3 days')
    expect(res.result.timelines[0].current_status).toBe('Active')
  })

  it('skips characters with no timeline field', async () => {
    await seedKV('character:predator', 'No consumption timeline here.')
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
    })
    expect(res.result.timelines).toHaveLength(0)
  })

  it('status_filter=imminent matches hours', async () => {
    await seedKV(
      'character:soon',
      '**Status:** Imminent\n**Consumption-Timeline:** 2 hours\n**Processor:** Beta',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'imminent',
    })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:soon')
  })

  it('status_filter=imminent matches "1 day" (PS1 test 16D)', async () => {
    await seedKV(
      'character:one-day',
      '**Status:** Imminent\n**Consumption-Timeline:** 1 day\n**Processor:** Alpha',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'imminent',
    })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:one-day')
  })

  it('status_filter=imminent excludes weeks', async () => {
    await seedKV(
      'character:weeks-away',
      '**Status:** Active\n**Consumption-Timeline:** 3 weeks\n**Processor:** Beta',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'imminent',
    })
    expect(res.result.timelines).toHaveLength(0)
  })

  it('status_filter=days-to-weeks includes days', async () => {
    await seedKV(
      'character:days-prey',
      '**Status:** Active\n**Consumption-Timeline:** 5 days\n**Processor:** Gamma',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'days-to-weeks',
    })
    expect(res.result.timelines).toHaveLength(1)
  })

  it('status_filter=consumed matches consumed entries', async () => {
    await seedKV(
      'character:done',
      '**Status:** Consumed\n**Consumption-Timeline:** consumed\n**Processor:** Delta',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'consumed',
    })
    expect(res.result.timelines).toHaveLength(1)
  })

  it('status_filter=days-to-weeks excludes entries with no day or week in timeline', async () => {
    await seedKV(
      'character:months-away',
      '**Status:** Active\n**Consumption-Timeline:** 3 months\n**Processor:** Alpha',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'days-to-weeks',
    })
    expect(res.result.timelines).toHaveLength(0)
  })

  it('status_filter=weeks-to-months includes weeks entries', async () => {
    await seedKV(
      'character:weeks-prey',
      '**Status:** Active\n**Consumption-Timeline:** 3 weeks\n**Processor:** Gamma',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'weeks-to-months',
    })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:weeks-prey')
  })

  it('status_filter=weeks-to-months excludes entries with no week, month, or year in timeline', async () => {
    await seedKV(
      'character:hours-prey',
      '**Status:** Active\n**Consumption-Timeline:** 6 hours\n**Processor:** Beta',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'weeks-to-months',
    })
    expect(res.result.timelines).toHaveLength(0)
  })

  it('status_filter=consumed excludes entries without consumed in timeline', async () => {
    await seedKV(
      'character:alive',
      '**Status:** Active\n**Consumption-Timeline:** 3 days\n**Processor:** Alpha',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'consumed',
    })
    expect(res.result.timelines).toHaveLength(0)
  })
})

describe('list_consumption_timelines — Projected-Consumption-Timeline fallback', () => {
  it('parses legacy Projected-Consumption-Timeline field', async () => {
    await seedKV(
      'character:legacy-prey',
      '**Status:** Imminent\n**Projected-Consumption-Timeline:** 2 days\n**Processor:** Beta',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
    })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:legacy-prey')
    expect(res.result.timelines[0].timeline_remaining).toBe('2 days')
  })

  it('prefers primary Consumption-Timeline over Projected fallback when both present', async () => {
    await seedKV(
      'character:dual-field',
      '**Status:** Active\n**Consumption-Timeline:** 5 days\n**Projected-Consumption-Timeline:** 10 days\n**Processor:** Gamma',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
    })
    expect(res.result.timelines[0].timeline_remaining).toBe('5 days')
  })

  it('legacy fallback entry appears in status_filter=imminent when matching', async () => {
    await seedKV(
      'character:legacy-imminent',
      '**Status:** Imminent\n**Projected-Consumption-Timeline:** 3 hours\n**Processor:** Alpha',
    )
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'imminent',
    })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.timelines[0].character_key).toBe('character:legacy-imminent')
  })
})

describe('list_consumption_timelines — pagination', () => {
  it('limit restricts the number of keys fetched', async () => {
    await seedKV('character:a', '**Consumption-Timeline:** 1 day')
    await seedKV('character:b', '**Consumption-Timeline:** 2 days')
    await seedKV('character:c', '**Consumption-Timeline:** 3 days')
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
      limit: 2,
      offset: 0,
    })
    expect(res.result.timelines).toHaveLength(2)
    expect(res.result.metadata.limit).toBe(2)
    expect(res.result.metadata.offset).toBe(0)
    expect(res.result.metadata.total_keys).toBe(3)
  })

  it('offset skips earlier keys', async () => {
    await seedKV('character:a', '**Consumption-Timeline:** 1 day')
    await seedKV('character:b', '**Consumption-Timeline:** 2 days')
    await seedKV('character:c', '**Consumption-Timeline:** 3 days')
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
      limit: 10,
      offset: 2,
    })
    expect(res.result.timelines).toHaveLength(1)
    expect(res.result.metadata.offset).toBe(2)
  })

  it('offset beyond total returns empty timelines', async () => {
    await seedKV('character:a', '**Consumption-Timeline:** 1 day')
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
      limit: 10,
      offset: 5,
    })
    expect(res.result.timelines).toHaveLength(0)
    expect(res.result.content[0].text).toBe('No consumption timelines found.')
  })

  it('defaults limit=50 offset=0 when not provided', async () => {
    await seedKV('character:only', '**Consumption-Timeline:** 1 week')
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
    })
    expect(res.result.metadata.limit).toBe(50)
    expect(res.result.metadata.offset).toBe(0)
  })

  it('rejects limit below minimum (0)', async () => {
    const res = await callTool('entity_manage', { action: 'list_consumption_timelines', limit: 0 })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects limit above maximum (101)', async () => {
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      limit: 101,
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects negative offset', async () => {
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      offset: -1,
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('skips stale index entries where kvGet returns null', async () => {
    // Seed the index with a key that has no KV entry (simulates a stale index)
    await env.LORE_DB.put('_idx:prefix:character', JSON.stringify(['character:ghost-key']))
    const res = await callTool('entity_manage', {
      action: 'list_consumption_timelines',
      status_filter: 'all',
    })
    expect(res.result.timelines).toHaveLength(0)
  })
})

describe('list_active_threads', () => {
  it('returns message when system:active-narratives key is absent', async () => {
    const res = await callTool('entity_manage', { action: 'list_active_threads' })
    expect(res.result.content[0].text).toBe('No active narratives found.')
    expect(res.result.threads).toHaveLength(0)
  })

  it('parses Ascension and Dissolution thread entries', async () => {
    await seedKV(
      'system:active-narratives',
      [
        '**Ascension Threads**',
        '  - **SilverThread** (alice)',
        '**Dissolution Threads**',
        '  - **DarkThread** (bob)',
      ].join('\n'),
    )
    const res = await callTool('entity_manage', { action: 'list_active_threads' })
    expect(res.result.threads).toHaveLength(2)
    const names = res.result.threads.map((t: { thread_name: string }) => t.thread_name)
    expect(names).toContain('SilverThread')
    expect(names).toContain('DarkThread')
    const silver = res.result.threads.find(
      (t: { thread_name: string }) => t.thread_name === 'SilverThread',
    )
    expect(silver.category).toBe('Ascension')
    expect(silver.character).toBe('alice')
  })
})
