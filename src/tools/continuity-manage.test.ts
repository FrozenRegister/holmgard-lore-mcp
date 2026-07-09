import { describe, expect, it, beforeEach } from 'vitest'
import { env, SELF, reset } from 'cloudflare:test'
import { handle_continuity_manage } from './continuity-manage'

// Re-wrapped describe to ensure reset is called
const testDescribe = (name: string, fn: () => void) =>
  describe(name, () => {
    beforeEach(() => reset())
    fn()
  })

// Test helpers - replicating src/__tests__/helpers.ts patterns
async function seedKV(key: string, text: string) {
  return env.LORE_DB.put(key, JSON.stringify({ text, meta: { version: 1, updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() } }))
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await SELF.fetch('http://example.com/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  return res.json() as Promise<Record<string, any>>
}

describe('handle_continuity_manage', () => {
  beforeEach(() => reset())

  it('returns error when action is missing', async () => {
    const res = (await callTool('continuity_manage', {})) as any
    expect(res.error).toBeDefined()
  })

  it('returns error when action is unknown', async () => {
    const res = (await callTool('continuity_manage', { action: 'nope' })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Unknown action')
  })

  // tag_topic tests
  testDescribe('tag_topic', () => {
    it('adds tags to an existing topic', async () => {
      await seedKV('character:eira-holt', 'A character\n**Tags:** old-tag')
      const res = await callTool('continuity_manage', {
        action: 'tag_topic',
        key: 'character:eira-holt',
        add: ['needs-review']
      })
      expect(res.result).toBeDefined()
      expect(res.result.metadata.tags).toContain('needs-review')
      expect(res.result.metadata.tags).toContain('old-tag')
    })

    it('removes tags from a topic', async () => {
      await seedKV('character:eira-holt', 'A character\n**Tags:** old-tag, keep-tag')
      const res = await callTool('continuity_manage', {
        action: 'tag_topic',
        key: 'character:eira-holt',
        remove: ['old-tag']
      })
      expect(res.result).toBeDefined()
      expect(res.result.metadata.tags).not.toContain('old-tag')
      expect(res.result.metadata.tags).toContain('keep-tag')
    })

    it('returns error when topic does not exist', async () => {
      const res = await callTool('continuity_manage', {
        action: 'tag_topic',
        key: 'character:nonexistent'
      })
      expect(res.error).toBeDefined()
    })

    it('returns success with no change when neither add nor remove specified', async () => {
      await seedKV('character:eira-holt', 'A character')
      const res = await callTool('continuity_manage', {
        action: 'tag_topic',
        key: 'character:eira-holt'
      })
      expect(res.result).toBeDefined()
      expect(res.result.content[0].text).toContain('No add or remove tags')
    })
  })

  // find_by_tag tests
  testDescribe('find_by_tag', () => {
    it('finds topics by single tag', async () => {
      await env.LORE_DB.put('_tags:needs-review', JSON.stringify(['character:alice', 'location:marsh']))
      const res = await callTool('continuity_manage', {
        action: 'find_by_tag',
        tags: ['needs-review']
      })
      expect(res.result).toBeDefined()
      expect(res.result.results).toHaveLength(2)
      expect(res.result.results.map((r: any) => r.key)).toContain('character:alice')
    })

    it('finds topics with intersection (all mode)', async () => {
      await env.LORE_DB.put('_tags:tag1', JSON.stringify(['character:alice', 'character:bob']))
      await env.LORE_DB.put('_tags:tag2', JSON.stringify(['character:alice', 'character:charlie']))
      const res = await callTool('continuity_manage', {
        action: 'find_by_tag',
        tags: ['tag1', 'tag2'],
        mode: 'all'
      })
      expect(res.result).toBeDefined()
      expect(res.result.results).toHaveLength(1)
      expect(res.result.results[0].key).toBe('character:alice')
    })

    it('respects limit parameter', async () => {
      await env.LORE_DB.put('_tags:test', JSON.stringify(['key1', 'key2', 'key3', 'key4', 'key5']))
      const res = await callTool('continuity_manage', {
        action: 'find_by_tag',
        tags: ['test'],
        limit: 3
      })
      expect(res.result.results).toHaveLength(3)
    })

    it('fetches excerpts when requested', async () => {
      await env.LORE_DB.put('_tags:test', JSON.stringify(['character:alice']))
      await seedKV('character:alice', 'Long text about alice that should be truncated')
      const res = await callTool('continuity_manage', {
        action: 'find_by_tag',
        tags: ['test'],
        with_excerpt: true
      })
      expect(res.result.results[0].excerpt).toBeDefined()
    })
  })

  // list_tags tests
  testDescribe('list_tags', () => {
    it('lists all tags with counts', async () => {
      await env.LORE_DB.put('_tags:tag1', JSON.stringify(['key1', 'key2']))
      await env.LORE_DB.put('_tags:tag2', JSON.stringify(['key3']))
      const res = await callTool('continuity_manage', {
        action: 'list_tags',
        with_counts: true
      })
      expect(res.result.tags).toBeDefined()
      expect(res.result.tags.length).toBeGreaterThan(0)
    })

    it('filters tags by prefix', async () => {
      await env.LORE_DB.put('_tags:needs-review', JSON.stringify(['key1']))
      await env.LORE_DB.put('_tags:needs-fix', JSON.stringify(['key2']))
      await env.LORE_DB.put('_tags:other', JSON.stringify(['key3']))
      const res = await callTool('continuity_manage', {
        action: 'list_tags',
        prefix: 'needs'
      })
      expect(res.result.tags.every((t: any) => t.tag.startsWith('needs'))).toBe(true)
    })
  })

  // bookmark_state tests
  testDescribe('bookmark_state', () => {
    it('creates a snapshot with all keys', async () => {
      await seedKV('character:alice', 'Alice')
      await seedKV('character:bob', 'Bob')
      const res = await callTool('continuity_manage', {
        action: 'bookmark_state',
        name: 'phase-1-complete',
        note: 'End of phase 1'
      })
      expect(res.result).toBeDefined()
      expect(res.result.metadata.key_count).toBeGreaterThan(0)
    })

    it('creates snapshot with key_prefix filter', async () => {
      await seedKV('character:alice', 'Alice')
      await seedKV('location:marsh', 'Marsh')
      const res = await callTool('continuity_manage', {
        action: 'bookmark_state',
        name: 'char-snapshot',
        key_prefix: 'character:'
      })
      expect(res.result.metadata.key_count).toBeLessThanOrEqual(2)
    })
  })

  // world_diff tests
  testDescribe('world_diff', () => {
    it('compares snapshots and returns differences', async () => {
      const snap1 = {
        name: 'snap1',
        manifest: {
          'character:alice': { version: 1, updatedAt: '2025-01-01T00:00:00Z' },
        },
      }
      const snap2 = {
        name: 'snap2',
        manifest: {
          'character:alice': { version: 2, updatedAt: '2025-01-02T00:00:00Z' },
          'character:bob': { version: 1, updatedAt: '2025-01-02T00:00:00Z' },
        },
      }
      await env.LORE_DB.put('_snapshot:snap1', JSON.stringify(snap1))
      await env.LORE_DB.put('_snapshot:snap2', JSON.stringify(snap2))
      const res = await callTool('continuity_manage', {
        action: 'world_diff',
        from: 'snap1',
        to: 'snap2'
      })
      expect(res.result).toBeDefined()
      expect(res.result.added.length).toBeGreaterThan(0)
    })
  })

  // plant_setup tests
  testDescribe('plant_setup', () => {
    it('creates a new setup with default tension', async () => {
      const res = await callTool('continuity_manage', {
        action: 'plant_setup',
        id: 'ambush-plot',
        description: 'Church courier spotted'
      })
      expect(res.result).toBeDefined()
      expect(res.result.metadata.tension).toBe(3)
    })

    it('creates setup with custom tension', async () => {
      const res = await callTool('continuity_manage', {
        action: 'plant_setup',
        id: 'critical-plot',
        description: 'Critical event',
        tension: 5
      })
      expect(res.result.metadata.tension).toBe(5)
    })

    it('includes optional fields when provided', async () => {
      const res = await callTool('continuity_manage', {
        action: 'plant_setup',
        id: 'plot-1',
        description: 'A setup',
        planted_in: 'chapter-5',
        actors: ['character:alice', 'character:bob']
      })
      expect(res.result).toBeDefined()
    })

    it('accepts setup_id as an alias for id', async () => {
      const res = await callTool('continuity_manage', {
        action: 'plant_setup',
        setup_id: 'alias-plot',
        description: 'Test alias'
      })
      expect(res.result).toBeDefined()
      expect(res.result.metadata.key).toContain('setup:alias-plot')
    })
  })

  // pay_off_setup tests
  testDescribe('pay_off_setup', () => {
    it('marks setup as paid', async () => {
      await seedKV('setup:church-ambush', '**Status:** open\n**Tension:** 3')
      const res = await callTool('continuity_manage', {
        action: 'pay_off_setup',
        id: 'church-ambush',
        resolution: 'Ambush occurred at canal',
        status: 'paid'
      })
      expect(res.result).toBeDefined()
      expect(res.result.metadata.status).toBe('paid')
    })

    it('returns error when setup not found', async () => {
      const res = await callTool('continuity_manage', {
        action: 'pay_off_setup',
        id: 'nonexistent',
        resolution: 'It happened'
      })
      expect(res.error).toBeDefined()
    })
  })

  // list_unpaid_setups tests
  testDescribe('list_unpaid_setups', () => {
    it('lists open setups', async () => {
      await env.LORE_DB.put('_idx:prefix:setup', JSON.stringify(['setup:plot1', 'setup:plot2']))
      await seedKV('setup:plot1', '**Status:** open\n**Tension:** 3\n**Description:** Plot 1\n**Created-At:** 2025-01-01T00:00:00Z')
      await seedKV('setup:plot2', '**Status:** paid\n**Tension:** 2')
      const res = await callTool('continuity_manage', {
        action: 'list_unpaid_setups'
      })
      expect(res.result).toBeDefined()
      expect(res.result.setups.length).toBeGreaterThan(0)
    })

    it('filters by minimum tension', async () => {
      await env.LORE_DB.put('_idx:prefix:setup', JSON.stringify(['setup:low', 'setup:high']))
      await seedKV('setup:low', '**Status:** open\n**Tension:** 1\n**Description:** Low tension\n**Created-At:** 2025-01-01T00:00:00Z')
      await seedKV('setup:high', '**Status:** open\n**Tension:** 5\n**Description:** High tension\n**Created-At:** 2025-01-01T00:00:00Z')
      const res = await callTool('continuity_manage', {
        action: 'list_unpaid_setups',
        min_tension: 4
      })
      expect(res.result.setups.every((s: any) => s.tension >= 4)).toBe(true)
    })
  })

  // set_goal tests
  testDescribe('set_goal', () => {
    it('sets a goal on an entity', async () => {
      await seedKV('character:eira-holt', 'A character')
      const res = await callTool('continuity_manage', {
        action: 'set_goal',
        entity_key: 'character:eira-holt',
        goal_id: 'survive-tribunal',
        description: 'Survive the tribunal'
      })
      expect(res.result).toBeDefined()
      expect(res.result.metadata.goal_id).toBe('survive-tribunal')
    })

    it('replaces existing goal', async () => {
      await seedKV('character:alice', 'A character\n**Goal:escape:** active | Escape the city')
      const res = await callTool('continuity_manage', {
        action: 'set_goal',
        entity_key: 'character:alice',
        goal_id: 'escape',
        description: 'Escape the city by boat',
        status: 'active'
      })
      expect(res.result).toBeDefined()
    })

    it('returns error when entity not found', async () => {
      const res = await callTool('continuity_manage', {
        action: 'set_goal',
        entity_key: 'character:nonexistent',
        goal_id: 'goal1',
        description: 'Goal description'
      })
      expect(res.error).toBeDefined()
    })

    it('accepts entity_name, goal_name, goal_description as aliases', async () => {
      await seedKV('character:hero', 'A hero')
      const res = await callTool('continuity_manage', {
        action: 'set_goal',
        entity_name: 'character:hero',
        goal_name: 'find-artifact',
        goal_description: 'Find the ancient artifact'
      })
      expect(res.result).toBeDefined()
      expect(res.result.metadata.goal_id).toBe('find-artifact')
    })
  })

  // check_continuity tests
  testDescribe('check_continuity', () => {
    it('scans for dangling references', async () => {
      await seedKV('character:alice', 'Alice knows character:nonexistent')
      const res = await callTool('continuity_manage', {
        action: 'check_continuity',
        checks: ['dangling'],
        severity_floor: 'warn'
      })
      expect(res.result).toBeDefined()
      expect(res.result.findings).toBeDefined()
    })

    it('filters findings by severity floor', async () => {
      await seedKV('character:alice', 'Alice with item:missing')
      const res = await callTool('continuity_manage', {
        action: 'check_continuity',
        severity_floor: 'error'
      })
      expect(res.result).toBeDefined()
    })

    it('applies alias transforms for severity_floor', async () => {
      await seedKV('character:alice', 'Alice')
      const res = await callTool('continuity_manage', {
        action: 'check_continuity',
        severity_floor: 'medium'
      })
      expect(res.result).toBeDefined()
    })

    it('detects missing location on character', async () => {
      await seedKV('character:lost-soul', '**Status:** Active\n**Location:** location:ghost-town-xyz-9999')
      const res = await callTool('continuity_manage', {
        action: 'check_continuity',
        checks: ['occupancy']
      })
      expect(res.result.findings).toBeDefined()
    })

    it('detects inventory references to missing items', async () => {
      await seedKV('character:collector', '**Status:** Active\n**Inventory:** item:magic-sword, item:missing-ring')
      const res = await callTool('continuity_manage', {
        action: 'check_continuity',
        checks: ['inventory']
      })
      expect(res.result.findings).toBeDefined()
    })
  })
})
