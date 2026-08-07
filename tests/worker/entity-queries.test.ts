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

describe('get_relationship', () => {
  it('finds affinity field and cross-references', async () => {
    await seedKV('character:alice', '**Affinity:** 0.8\n**Faction:** guild\nBob is a trusted ally.')
    await seedKV('character:bob', '**Faction:** guild\nAlice mentored me.')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:alice',
      entity_b: 'character:bob',
    })
    expect(res.result.relationship).not.toBeNull()
    expect(res.result.relationship.affinity).toBe(0.8)
    expect(res.result.relationship.faction_overlap).toContain('guild')
    expect(res.result.relationship.cross_references.a_mentions_b).toBe(true)
    expect(res.result.relationship.cross_references.b_mentions_a).toBe(true)
    expect(res.result.metadata.retrieved).toBe(2)
  })

  it('returns null relationship and suggestion when no data found', async () => {
    await seedKV('character:stranger-a', 'No connections here.')
    await seedKV('character:stranger-b', 'Likewise.')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:stranger-a',
      entity_b: 'character:stranger-b',
    })
    expect(res.result.relationship).toBeNull()
    expect(res.result.suggestion).toContain('relationship:')
  })

  it('returns error for missing entity', async () => {
    await seedKV('character:exists', 'text')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:exists',
      entity_b: 'character:no-such',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('rejects invalid params (missing entity_b)', async () => {
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:alice',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })

  it('resolves bare entity names via common prefixes', async () => {
    await seedKV('character:alice', '**Affinity:** 0.5')
    await seedKV('character:bob', 'text')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'alice',
      entity_b: 'bob',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.relationship.entity_a).toBe('character:alice')
    expect(res.result.relationship.entity_b).toBe('character:bob')
  })

  it('suggests a similar key when a bare/partial name is not found', async () => {
    await seedKV('character:eira-holt', 'text')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:eira-holt',
      entity_b: 'eira-hol',
    })
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Did you mean')
    expect(res.error.data.did_you_mean).toBe('character:eira-holt')
  })

  it('returns error when entity_a is not found, with no suggestion available', async () => {
    await seedKV('character:exists', 'text')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:ghost-a',
      entity_b: 'character:exists',
    })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBeNull()
  })

  it('suggests a similar key when entity_a is a bare/partial name', async () => {
    await seedKV('character:eira-holt', 'text')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'eira-hol',
      entity_b: 'character:eira-holt',
    })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBe('character:eira-holt')
  })

  it('detects cross-references when entity names appear in text', async () => {
    await seedKV('character:alice', 'Alice respects Bob greatly.')
    await seedKV('character:bob', 'Bob trained with Alice.')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:alice',
      entity_b: 'character:bob',
    })
    expect(res.result.relationship).not.toBeNull()
    expect(res.result.relationship.cross_references.a_mentions_b).toBe(true)
    expect(res.result.relationship.cross_references.b_mentions_a).toBe(true)
  })

  it('handles one-way mentions', async () => {
    await seedKV('character:mentor', 'I teach student everything.')
    await seedKV('character:student', 'I am learning.')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:mentor',
      entity_b: 'character:student',
    })
    expect(res.result.relationship).not.toBeNull()
    expect(res.result.relationship.cross_references.a_mentions_b).toBe(true)
    expect(res.result.relationship.cross_references.b_mentions_a).toBe(false)
  })

  it('extracts faction overlap correctly', async () => {
    await seedKV('character:guard1', '**Faction:** town-guard')
    await seedKV('character:guard2', '**Faction:** town-guard')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:guard1',
      entity_b: 'character:guard2',
    })
    expect(res.result.relationship.faction_overlap).toContain('town-guard')
  })

  it('ignores faction overlap when factions differ by case', async () => {
    await seedKV('character:guard-a', '**Faction:** Town-Guard')
    await seedKV('character:guard-b', '**Faction:** town-guard')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:guard-a',
      entity_b: 'character:guard-b',
    })
    // factions should match case-insensitively
    expect(res.result.relationship.faction_overlap.length).toBeGreaterThan(0)
  })

  it('extracts numeric fields correctly', async () => {
    await seedKV('character:debtor', '**Affinity:** 0.3\n**Debt:** 50\n**Threat-Level:** 8.5')
    await seedKV('character:creditor', 'text')
    const res = await callTool('world_manage', {
      action: 'get_relationship',
      entity_a: 'character:debtor',
      entity_b: 'character:creditor',
    })
    expect(res.result.relationship.affinity).toBe(0.3)
    expect(res.result.relationship.debt).toBe(50)
    expect(res.result.relationship.threat_level).toBe(8.5)
  })
})

describe('get_faction_standing', () => {
  it('detects membership when entity name appears in faction text', async () => {
    await seedKV('character:knight', '**Rank:** Captain\n**Reputation:** 0.9\n**Faction:** order')
    await seedKV('faction:order', 'Members: knight, paladin, squire.')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:knight',
      faction_key: 'faction:order',
    })
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.rank).toBe('Captain')
    expect(res.result.standing.reputation).toBe(0.9)
  })

  it('returns non-member when entity not in faction text', async () => {
    await seedKV('character:outsider', '**Faction:** rival-guild')
    await seedKV('faction:order', 'Members: knight only.')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:outsider',
      faction_key: 'faction:order',
    })
    expect(res.result.standing.is_member).toBe(false)
  })

  it('returns error for missing faction', async () => {
    await seedKV('character:x', 'text')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:x',
      faction_key: 'faction:missing',
    })
    expect(res.error).toBeDefined()
  })

  it('rejects invalid params (missing faction_key)', async () => {
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:x',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })

  it('returns error when entity_key is not found', async () => {
    await seedKV('faction:order', 'text')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:ghost',
      faction_key: 'faction:order',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('suggests a similar key when entity_key is a bare/partial name', async () => {
    await seedKV('character:eira-holt', 'text')
    await seedKV('faction:order', 'text')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'eira-hol',
      faction_key: 'faction:order',
    })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBe('character:eira-holt')
  })

  it('suggests a similar key when faction_key is a bare/partial name', async () => {
    await seedKV('character:knight', 'text')
    await seedKV('faction:order-of-flame', 'text')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:knight',
      faction_key: 'order-of-flam',
    })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBe('faction:order-of-flame')
  })

  it('accepts entity_name and faction_name as aliases', async () => {
    await seedKV('character:knight', '**Faction:** order')
    await seedKV('faction:order', 'Members: knight only.')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_name: 'character:knight',
      faction_name: 'faction:order',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.standing.is_member).toBe(true)
  })

  it('detects membership via faction:TAG syntax in Tags field', async () => {
    await seedKV('character:secret-member', '**Tags:** faction:hidden-order, veteran, scarred')
    await seedKV('faction:hidden-order', 'A secret society')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:secret-member',
      faction_key: 'faction:hidden-order',
    })
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.membership_source).toBe('tag')
  })

  it('prefers explicit faction field over tag-based detection', async () => {
    await seedKV(
      'character:dual-member',
      '**Faction:** explicit-faction\n**Tags:** faction:hidden-order',
    )
    await seedKV('faction:explicit-faction', 'Main faction')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:dual-member',
      faction_key: 'faction:explicit-faction',
    })
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.membership_source).toBe('explicit')
  })

  it('extracts numeric reputation and debt fields', async () => {
    await seedKV(
      'character:loyal-member',
      [
        '**Faction:** guild',
        '**Rank:** Master',
        '**Reputation:** 0.95',
        '**Debt:** 0',
        '**Threat-Level:** 0.1',
      ].join('\n'),
    )
    await seedKV('faction:guild', 'text')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:loyal-member',
      faction_key: 'faction:guild',
    })
    expect(res.result.standing.reputation).toBe(0.95)
    expect(res.result.standing.debt).toBe(0)
    expect(res.result.standing.threat_level).toBe(0.1)
  })

  it('returns null for missing numeric fields', async () => {
    await seedKV('character:new-recruit', '**Faction:** guild')
    await seedKV('faction:guild', 'text')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:new-recruit',
      faction_key: 'faction:guild',
    })
    expect(res.result.standing.reputation).toBeNull()
    expect(res.result.standing.debt).toBeNull()
    expect(res.result.standing.threat_level).toBeNull()
  })

  it('handles case-insensitive faction matching', async () => {
    await seedKV('character:member-case', '**Faction:** The-Guild')
    await seedKV('faction:the-guild', 'text')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'character:member-case',
      faction_key: 'faction:THE-GUILD',
    })
    expect(res.result.standing.is_member).toBe(true)
  })
})

describe('get_entity_knowledge', () => {
  it('returns known=true and excerpts when topic appears in text', async () => {
    await seedKV(
      'character:spy',
      '**Knows:** secret-vault, patrol-routes\nI discovered the secret-vault last week.',
    )
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:spy',
      topic: 'secret-vault',
    })
    expect(res.result.known).toBe(true)
    expect(res.result.known_via_field).toBe(true)
    expect(res.result.excerpts.length).toBeGreaterThan(0)
  })

  it('returns known=false when topic is absent', async () => {
    await seedKV('character:naive', 'No special knowledge here.')
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:naive',
      topic: 'hidden-base',
    })
    expect(res.result.known).toBe(false)
    expect(res.result.excerpts).toHaveLength(0)
  })

  it('rejects invalid params (missing topic)', async () => {
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:naive',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })

  it('returns error when entity is not found', async () => {
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:ghost',
      topic: 'anything',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('suggests a similar key when entity is a bare/partial name', async () => {
    await seedKV('character:eira-holt', 'text')
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'eira-hol',
      topic: 'anything',
    })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBe('character:eira-holt')
  })

  it('accepts entity_name as an alias for entity_key', async () => {
    await seedKV('character:eira-holt', '**Knows:** the-lock')
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_name: 'character:eira-holt',
      topic: 'the-lock',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.known).toBe(true)
  })

  it('extracts multiple excerpts when topic appears multiple times', async () => {
    await seedKV(
      'character:scholar',
      [
        'My research on ancient-runes began in 2184.',
        'I discovered more about ancient-runes at the library.',
        'My final thesis on ancient-runes is complete.',
      ].join('\n'),
    )
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:scholar',
      topic: 'ancient-runes',
    })
    expect(res.result.known).toBe(true)
    expect(res.result.excerpts.length).toBe(3)
  })

  it('caps excerpts at 3 even when topic appears many times', async () => {
    const manyRefs = Array(10).fill('ancient-lore').join(', ')
    await seedKV('character:obsessed', `**Knows:** ${manyRefs}`)
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:obsessed',
      topic: 'ancient-lore',
    })
    expect(res.result.known).toBe(true)
    expect(res.result.excerpts.length).toBeLessThanOrEqual(3)
  })

  it('handles case-insensitive knowledge search', async () => {
    await seedKV('character:case-tester', 'I know about ANCIENT RUINS and their secrets.')
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:case-tester',
      topic: 'ancient ruins',
    })
    expect(res.result.known).toBe(true)
    expect(res.result.excerpts.length).toBeGreaterThan(0)
  })

  it('returns excerpts with context windows', async () => {
    await seedKV(
      'character:contexted',
      'The dragon-king rules from the eastern tower. The dragon-king is feared by all.',
    )
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:contexted',
      topic: 'dragon-king',
    })
    expect(res.result.excerpts.length).toBeGreaterThan(0)
    // Excerpts should contain surrounding context, not just the topic itself
    res.result.excerpts.forEach((excerpt: string) => {
      expect(excerpt.length).toBeGreaterThan('dragon-king'.length)
    })
  })

  it('requires either entity_key or entity_id', async () => {
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      topic: 'something',
      // missing both entity_key and entity_id
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('normalizes topic to lowercase for searching', async () => {
    await seedKV('character:case-sensitive', '**Knows:** dragon-hoard')
    const res = await callTool('world_manage', {
      action: 'get_entity_knowledge',
      entity_key: 'character:case-sensitive',
      topic: 'DRAGON-HOARD',
    })
    expect(res.result.known).toBe(true)
  })
})

describe('get_location_occupants', () => {
  it('returns entities whose Location field matches', async () => {
    await seedKV('character:guard-1', '**Location:** location:barracks\n**Status:** Active')
    await seedKV('character:guard-2', '**Location:** location:barracks\n**Status:** Sleeping')
    await seedKV('character:merchant', '**Location:** location:market')
    const res = await callTool('world_manage', {
      action: 'get_location_occupants',
      location_key: 'location:barracks',
    })
    expect(res.result.occupants).toHaveLength(2)
    const keys = res.result.occupants.map((o: { key: string }) => o.key)
    expect(keys).toContain('character:guard-1')
    expect(keys).toContain('character:guard-2')
  })

  it('returns empty array when no matches', async () => {
    const res = await callTool('world_manage', {
      action: 'get_location_occupants',
      location_key: 'location:empty-room',
    })
    expect(res.result.occupants).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No occupants')
  })

  it('finds entities with loose plain-colon Location field', async () => {
    // AI may write "Location: chamber-x" without **bold:** — loose pass should find them
    await seedKV('character:loose-loc-1', 'Location: location:loose-chamber\nStatus: Active')
    await seedKV('character:loose-loc-2', 'Location: location:loose-chamber\nStatus: Dormant')
    const res = await callTool('world_manage', {
      action: 'get_location_occupants',
      location_key: 'location:loose-chamber',
    })
    expect(res.result.occupants).toHaveLength(2)
  })

  it('accepts location_id as an alias for location_key', async () => {
    await seedKV('character:guard-3', '**Location:** location:barracks')
    const res = await callTool('world_manage', {
      action: 'get_location_occupants',
      location_id: 'location:barracks',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.occupants.map((o: { key: string }) => o.key)).toContain('character:guard-3')
  })

  it('rejects invalid params (missing location_key)', async () => {
    const res = await callTool('world_manage', { action: 'get_location_occupants' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })
})

describe('get_reachable_locations', () => {
  it('parses Exits field and checks each destination', async () => {
    await seedKV('location:hub', '**Exits:** location:north-road, location:cave')
    await seedKV('location:north-road', '**Danger-Level:** 0.2\n**Travel-Cost:** 30')
    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:hub',
    })
    expect(res.result.locations).toHaveLength(2)
    const northRoad = res.result.locations.find(
      (l: { key: string }) => l.key === 'location:north-road',
    )
    expect(northRoad.exists).toBe(true)
    expect(northRoad.danger_level).toBe(0.2)
    expect(northRoad.travel_cost).toBe(30)
    const cave = res.result.locations.find((l: { key: string }) => l.key === 'location:cave')
    expect(cave.exists).toBe(false)
  })

  it('returns empty locations when no Exits field', async () => {
    await seedKV('location:dead-end', 'No way out.')
    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:dead-end',
    })
    expect(res.result.locations).toHaveLength(0)
  })

  it('returns error for missing origin', async () => {
    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:nonexistent',
    })
    expect(res.error).toBeDefined()
  })

  it('rejects invalid params (missing origin_key)', async () => {
    const res = await callTool('world_manage', { action: 'get_reachable_locations' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })

  it('resolves a bare origin name via common prefixes', async () => {
    await seedKV('location:hub', 'text')
    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'hub',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.origin_key).toBe('location:hub')
  })

  it('suggests a similar key when origin is not found', async () => {
    await seedKV('location:north-road', 'text')
    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'north-roa',
    })
    expect(res.error).toBeDefined()
    expect(res.error.data.did_you_mean).toBe('location:north-road')
  })

  it('parses YAML-style exits with - target: syntax', async () => {
    await seedKV(
      'location:yaml-hub',
      [
        'A complex location with YAML exits:',
        '- target: location:east-room',
        '- target: location:west-room',
        '- target: location:north-passage',
      ].join('\n'),
    )
    await seedKV('location:east-room', 'Text')
    await seedKV('location:west-room', 'Text')
    await seedKV('location:north-passage', 'Text')

    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:yaml-hub',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.locations).toHaveLength(3)
    const keys = res.result.locations.map((l: any) => l.key)
    expect(keys).toContain('location:east-room')
    expect(keys).toContain('location:west-room')
    expect(keys).toContain('location:north-passage')
  })

  it('prefers YAML-style exits over inline Exits field', async () => {
    await seedKV(
      'location:yaml-priority',
      ['**Exits:** location:wrong-location', '- target: location:correct-location'].join('\n'),
    )
    await seedKV('location:correct-location', 'Text')
    await seedKV('location:wrong-location', 'Text')

    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:yaml-priority',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.locations).toHaveLength(1)
    expect(res.result.locations[0].key).toBe('location:correct-location')
  })

  it('marks nonexistent locations as exists=false', async () => {
    await seedKV(
      'location:portal-hub',
      '**Exits:** location:existing, location:phantom, location:missing',
    )
    await seedKV('location:existing', 'Text')

    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:portal-hub',
    })
    expect(res.result.locations).toHaveLength(3)
    expect(res.result.locations.find((l: any) => l.key === 'location:existing').exists).toBe(true)
    expect(res.result.locations.find((l: any) => l.key === 'location:phantom').exists).toBe(false)
    expect(res.result.locations.find((l: any) => l.key === 'location:missing').exists).toBe(false)
  })

  it('handles location names with different casings', async () => {
    await seedKV(
      'location:hub',
      '**Exits:** location:North-Room, Location:SOUTH-ROOM, location:east-room',
    )
    await seedKV('location:north-room', 'Text')
    await seedKV('location:south-room', 'Text')
    await seedKV('location:east-room', 'Text')

    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:hub',
    })
    expect(res.error).toBeUndefined()
    // All should be found (normalized to lowercase)
    const keys = res.result.locations.map((l: any) => l.key)
    expect(keys.every((k: string) => k.toLowerCase().endsWith('room'))).toBe(true)
  })

  it('supports Connections as an alias for Exits', async () => {
    await seedKV('location:alt-exits', '**Connections:** location:dest-1, location:dest-2')
    await seedKV('location:dest-1', 'Text')
    await seedKV('location:dest-2', 'Text')

    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:alt-exits',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.locations).toHaveLength(2)
  })
})

describe('get_compatibility', () => {
  it('returns compatible=true for well-matched entities', async () => {
    await seedKV(
      'character:predator-c',
      '**Weight-1:** 0.8\n**Size:** 3.0\n**Environment:** forest',
    )
    await seedKV('character:prey-c', '**Weight-2:** 0.4\n**Size:** 1.0\n**Environment:** forest')
    const res = await callTool('entity_manage', {
      action: 'get_compatibility',
      entity_a: 'character:predator-c',
      entity_b: 'character:prey-c',
      interaction_type: 'hunt',
    })
    expect(res.result.compatible).toBe(true)
    expect(res.result.risk_level).toBe('low')
    expect(res.result.size_ratio).toBe(3)
  })

  it('flags incompatibility when Weight-1 is too low', async () => {
    await seedKV('character:weak-actor', '**Weight-1:** 0.1')
    await seedKV('character:target', '**Weight-2:** 0.5')
    const res = await callTool('entity_manage', {
      action: 'get_compatibility',
      entity_a: 'character:weak-actor',
      entity_b: 'character:target',
      interaction_type: 'consume',
    })
    expect(res.result.compatible).toBe(false)
    expect(res.result.constraints.some((c: string) => c.includes('Weight-1'))).toBe(true)
  })

  it('returns error for missing entity', async () => {
    await seedKV('character:exists-only', 'text')
    const res = await callTool('entity_manage', {
      action: 'get_compatibility',
      entity_a: 'character:exists-only',
      entity_b: 'character:ghost',
      interaction_type: 'test',
    })
    expect(res.error).toBeDefined()
  })
})
