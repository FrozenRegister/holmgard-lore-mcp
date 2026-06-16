// Bulk migration test: migrate first 5 characters from KV to D1
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { reset } from 'cloudflare:test'
import { migrateCharacterKvToD1, migrateCharactersKvToD1 } from '../rpg/utils/migrate-kv-to-d1-bulk'
import { setupRpgDb } from './setup-d1'

const ELOWEN_LORE = [
  '# Character:Elowen "Lo" Thorne',
  '**Alias:** Lo (Zira\'s nickname for her), The Sky-Princess (circus moniker)',
  '**Age:** 25',
  '**Gender:** Female',
  '**Orientation:** Homosexual',
  '**Status:** Scavenger (Alive, Wounded, Determined)',
  '**Motivation:** Everything is secondary to Zira.',
  '**Faction:** celestial-vagabonds',
  '**Alignment:** Chaotic Good',
  '',
  '## Background & History',
  'Elowen was born in the sprawling city of Hecate, the daughter of a seamstress and a dockworker.',
  '',
  '## Mechanical Scaffolding',
  '**Weight-1:** 0.65',
  '**Weight-2:** 0.45',
  '**Perception:** 0.50',
  '**Thread:** thread:elowen:start-state',
  '**Location:** location:vermi-nest-surface',
  '',
  '### State Machine',
  '**State-Stage:** 1',
  '**Stage-Timer:** 1',
].join('\n')

const ALICE_LORE = [
  '# Character:Alice the Wanderer',
  '**Alias:** Scout',
  '**Age:** 30',
  '**Gender:** Female',
  '**Status:** Explorer (Curious, Alert)',
  '**Motivation:** Seeking truth in forgotten places.',
  '**Faction:** independent-seekers',
  '',
  '## Mechanical Scaffolding',
  '**Weight-1:** 0.55',
  '**Weight-2:** 0.60',
  '**Perception:** 0.75',
  '**Thread:** thread:alice:discovery',
  '',
  '## Background & History',
  'Alice grew up in a small village and left to explore the wider world.',
].join('\n')

const BOB_LORE = [
  '# Character:Bob the Blacksmith',
  '**Age:** 45',
  '**Gender:** Male',
  '**Status:** Crafted (Busy, Determined)',
  '**Motivation:** Creating the finest equipment.',
  '',
  '## Mechanical Scaffolding',
  '**Weight-1:** 0.40',
  '**Weight-2:** 0.50',
  '**Thread:** thread:bob:forge',
].join('\n')

const CAROL_LORE = [
  '# Character:Carol the Mage',
  '**Alias:** The Archmage',
  '**Age:** 120',
  '**Gender:** Female',
  '**Orientation:** Asexual',
  '**Status:** Mystical (Ancient, Powerful)',
  '**Faction:** arcanist-circle',
  '**Alignment:** Lawful Neutral',
  '',
  '## Background & History',
  'Carol has studied magic for over a century and serves as mentor to younger mages.',
  '',
  '## Mechanical Scaffolding',
  '**Weight-1:** 0.85',
  '**Weight-2:** 0.70',
  '**Perception:** 0.95',
  '**Thread:** thread:carol:mentorship',
  '',
  '## Interaction Weights',
  '```json',
  '{"Wisdom-Pool": 150, "Mana": 500}',
  '```',
].join('\n')

const DAVE_LORE = [
  '# Character:Dave the Rogue',
  '**Alias:** Shadow',
  '**Age:** 28',
  '**Gender:** Male',
  '**Orientation:** Gay',
  '**Status:** Sneaky (Quiet, Watchful)',
  '**Motivation:** Survival and freedom.',
  '**Alignment:** Chaotic Neutral',
  '',
  '## Mechanical Scaffolding',
  '**Weight-1:** 0.70',
  '**Weight-2:** 0.65',
  '**Perception:** 0.80',
  '**Thread:** thread:dave:shadows',
  '**Location:** location:city-alley',
].join('\n')

describe('Bulk KV-to-D1 Migration', () => {
  beforeEach(async () => {
    await reset()
    await setupRpgDb(env.RPG_DB)
  })

  it('migrates first 5 characters from KV to D1', async () => {
    // Seed KV with 5 test characters
    const characters = [
      { key: 'character:elowen-thorne', text: ELOWEN_LORE },
      { key: 'character:alice-wanderer', text: ALICE_LORE },
      { key: 'character:bob-blacksmith', text: BOB_LORE },
      { key: 'character:carol-mage', text: CAROL_LORE },
      { key: 'character:dave-rogue', text: DAVE_LORE },
    ]

    for (const { key, text } of characters) {
      await env.LORE_DB.put(
        key,
        JSON.stringify({
          text,
          meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        }),
      )
    }

    // Debug: check what kvList returns
    const allKeys = await (async () => {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const listed: any = await env.LORE_DB.list(cursor ? { cursor } : undefined)
        for (const k of listed.keys) {
          keys.push(k.name)
        }
        cursor = listed.list_complete ? undefined : listed.cursor
      } while (cursor)
      return keys
    })()
    console.log('[TEST] All KV keys:', allKeys)
    console.log('[TEST] Character keys:', allKeys.filter(k => k.startsWith('character:')))

    // Execute migration
    const results = await migrateCharactersKvToD1({ env }, 5)
    console.log('[TEST] Migration results:', results.map(r => ({ key: r.key, status: r.status, error: r.error })))

    // Verify all 5 migrated
    expect(results).toHaveLength(5)
    expect(results.every(r => r.status === 'migrated')).toBe(true)

    // Verify D1 inserts
    for (const result of results) {
      expect(result.d1Id).toBeDefined()
      const d1Row = await env.RPG_DB
        .prepare('SELECT * FROM characters WHERE id = ?')
        .bind(result.d1Id)
        .first()
      expect(d1Row).toBeDefined()
      expect(d1Row?.name).toBeTruthy()
    }

    // Verify KV markers added
    for (const { key } of characters) {
      const kvRaw = await env.LORE_DB.get(key)
      expect(kvRaw).toContain('## D1-Migrated: true')
      expect(kvRaw).toContain('## D1-Character-ID:')
    }
  })

  it('skips already-migrated characters', async () => {
    // Manually clear all character keys from KV to ensure test isolation
    let cursor: string | undefined
    do {
      const listed: any = await env.LORE_DB.list(cursor ? { cursor } : undefined)
      for (const k of listed.keys) {
        if (k.name.startsWith('character:')) {
          await env.LORE_DB.delete(k.name)
        }
      }
      cursor = listed.list_complete ? undefined : listed.cursor
    } while (cursor)

    // Seed KV with one migrated and one unmigrated character
    const migratedKey = 'character:already-done'
    const unmigratedKey = 'character:fresh-new'

    const migratedText = '# Character:Old Guard\n**Age:** 50\n## Mechanical Scaffolding\n**Weight-1:** 0.3'
    const unmigratedText = '# Character:Fresh Face\n**Age:** 20\n## Mechanical Scaffolding\n**Weight-1:** 0.7'

    await env.LORE_DB.put(
      migratedKey,
      JSON.stringify({
        text: `## D1-Migrated: true\n## D1-Character-ID: old-uuid-1234\n${migratedText}`,
        meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      }),
    )

    await env.LORE_DB.put(
      unmigratedKey,
      JSON.stringify({
        text: unmigratedText,
        meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      }),
    )

    // Debug: list KV keys
    const allKeys = await (async () => {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const listed: any = await env.LORE_DB.list(cursor ? { cursor } : undefined)
        for (const k of listed.keys) {
          keys.push(k.name)
        }
        cursor = listed.list_complete ? undefined : listed.cursor
      } while (cursor)
      return keys
    })()
    console.log('[TEST2] All KV keys:', allKeys)

    // Run migration
    const results = await migrateCharactersKvToD1({ env }, 2)
    console.log('[TEST2] Results:', results.map(r => ({ key: r.key, status: r.status, error: r.error })))

    // Expect one skipped, one migrated
    const statuses = results.map(r => r.status).sort()
    expect(statuses).toContain('skipped')
    expect(statuses).toContain('migrated')
  })

  it('auto-redirect works after migration', async () => {
    // Manually clear all character keys from KV to ensure test isolation
    let cursor: string | undefined
    do {
      const listed: any = await env.LORE_DB.list(cursor ? { cursor } : undefined)
      for (const k of listed.keys) {
        if (k.name.startsWith('character:')) {
          await env.LORE_DB.delete(k.name)
        }
      }
      cursor = listed.list_complete ? undefined : listed.cursor
    } while (cursor)

    // Seed KV with a unique test character
    const kvKey = 'character:redirect-test'
    const testText = '# Character:Redirect Test\n**Age:** 35\n**Faction:** test-faction\n## Mechanical Scaffolding\n**Weight-1:** 0.5\n**Thread:** thread:test'
    await env.LORE_DB.put(
      kvKey,
      JSON.stringify({
        text: testText,
        meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      }),
    )

    // Migrate
    const results = await migrateCharactersKvToD1({ env }, 1)
    expect(results[0].status).toBe('migrated')
    expect(results[0].d1Id).toBeDefined()

    const d1Id = results[0].d1Id!

    // Simulate get_lore auto-redirect: fetch KV, check marker, query D1
    const kvRaw = await env.LORE_DB.get(kvKey)
    expect(kvRaw).toContain('## D1-Migrated: true')

    const idMatch = kvRaw?.match(/## D1-Character-ID:\s*([a-f0-9-]+)/)
    expect(idMatch?.[1]).toBe(d1Id)

    // Verify D1 entry exists
    const d1Row = await env.RPG_DB
      .prepare('SELECT * FROM characters WHERE id = ?')
      .bind(d1Id)
      .first()
    expect(d1Row).toBeDefined()
    expect(d1Row?.name).toContain('Redirect Test')
    expect(d1Row?.faction_id).toBe('test-faction')
  })

  it('returns error when KV key does not exist', async () => {
    const result = await migrateCharacterKvToD1({ env }, 'character:nonexistent-key')
    expect(result.status).toBe('error')
    expect(result.error).toBe('KV entry not found')
  })

  it('returns error when RPG_DB binding is unavailable (catch block)', async () => {
    await env.LORE_DB.put(
      'character:catch-test',
      JSON.stringify({
        text: '# Character:Catch Test\n**Age:** 20\n## Mechanical Scaffolding\n**Weight-1:** 0.5',
        meta: { version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      }),
    )
    // Pass a context without RPG_DB to trigger the catch block
    const result = await migrateCharacterKvToD1({ env: { LORE_DB: env.LORE_DB } }, 'character:catch-test')
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/TypeError|Cannot read|undefined/)
  })

  it('returns error when no character keys exist in KV', async () => {
    // KV is empty (reset runs afterEach), so no character:* keys
    const results = await migrateCharactersKvToD1({ env })
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('error')
    expect(results[0].error).toBe('No character keys found in KV')
  })

  it('uses default limit of 5 when not specified', async () => {
    // Seed 3 characters — fewer than the default limit of 5
    await env.LORE_DB.put('character:def-a', JSON.stringify({ text: '# Character:Def A\n**Weight-1:** 0.5', meta: {} }))
    await env.LORE_DB.put('character:def-b', JSON.stringify({ text: '# Character:Def B\n**Weight-1:** 0.5', meta: {} }))
    await env.LORE_DB.put('character:def-c', JSON.stringify({ text: '# Character:Def C\n**Weight-1:** 0.5', meta: {} }))
    // Call without explicit limit — uses default of 5
    const results = await migrateCharactersKvToD1({ env })
    expect(results).toHaveLength(3)
    expect(results.every(r => r.status === 'migrated')).toBe(true)
  })
})
