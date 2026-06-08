import { describe, rpc, callTool, callToolWithApiKey, seedKV, ADMIN_SECRET, parseEncounterTable } from './helpers'
import { SELF, env } from 'cloudflare:test'
import { expect, it, beforeEach } from 'vitest'

describe('get_relationship', () => {
  it('finds affinity field and cross-references', async () => {
    await seedKV('character:alice', '**Affinity:** 0.8\n**Faction:** guild\nBob is a trusted ally.')
    await seedKV('character:bob', '**Faction:** guild\nAlice mentored me.')
    const res = await callTool('get_relationship', { entity_a: 'character:alice', entity_b: 'character:bob' })
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
    const res = await callTool('get_relationship', { entity_a: 'character:stranger-a', entity_b: 'character:stranger-b' })
    expect(res.result.relationship).toBeNull()
    expect(res.result.suggestion).toContain('relationship:')
  })

  it('returns error for missing entity', async () => {
    await seedKV('character:exists', 'text')
    const res = await callTool('get_relationship', { entity_a: 'character:exists', entity_b: 'character:no-such' })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})

describe('get_faction_standing', () => {
  it('detects membership when entity name appears in faction text', async () => {
    await seedKV('character:knight', '**Rank:** Captain\n**Reputation:** 0.9\n**Faction:** order')
    await seedKV('faction:order', 'Members: knight, paladin, squire.')
    const res = await callTool('get_faction_standing', { entity_key: 'character:knight', faction_key: 'faction:order' })
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.rank).toBe('Captain')
    expect(res.result.standing.reputation).toBe(0.9)
  })

  it('returns non-member when entity not in faction text', async () => {
    await seedKV('character:outsider', '**Faction:** rival-guild')
    await seedKV('faction:order', 'Members: knight only.')
    const res = await callTool('get_faction_standing', { entity_key: 'character:outsider', faction_key: 'faction:order' })
    expect(res.result.standing.is_member).toBe(false)
  })

  it('returns error for missing faction', async () => {
    await seedKV('character:x', 'text')
    const res = await callTool('get_faction_standing', { entity_key: 'character:x', faction_key: 'faction:missing' })
    expect(res.error).toBeDefined()
  })
})

describe('get_entity_knowledge', () => {
  it('returns known=true and excerpts when topic appears in text', async () => {
    await seedKV('character:spy', '**Knows:** secret-vault, patrol-routes\nI discovered the secret-vault last week.')
    const res = await callTool('get_entity_knowledge', { entity_key: 'character:spy', topic: 'secret-vault' })
    expect(res.result.known).toBe(true)
    expect(res.result.known_via_field).toBe(true)
    expect(res.result.excerpts.length).toBeGreaterThan(0)
  })

  it('returns known=false when topic is absent', async () => {
    await seedKV('character:naive', 'No special knowledge here.')
    const res = await callTool('get_entity_knowledge', { entity_key: 'character:naive', topic: 'hidden-base' })
    expect(res.result.known).toBe(false)
    expect(res.result.excerpts).toHaveLength(0)
  })
})

describe('get_location_occupants', () => {
  it('returns entities whose Location field matches', async () => {
    await seedKV('character:guard-1', '**Location:** location:barracks\n**Status:** Active')
    await seedKV('character:guard-2', '**Location:** location:barracks\n**Status:** Sleeping')
    await seedKV('character:merchant', '**Location:** location:market')
    const res = await callTool('get_location_occupants', { location_key: 'location:barracks' })
    expect(res.result.occupants).toHaveLength(2)
    const keys = res.result.occupants.map((o: { key: string }) => o.key)
    expect(keys).toContain('character:guard-1')
    expect(keys).toContain('character:guard-2')
  })

  it('returns empty array when no matches', async () => {
    const res = await callTool('get_location_occupants', { location_key: 'location:empty-room' })
    expect(res.result.occupants).toHaveLength(0)
    expect(res.result.content[0].text).toContain('No occupants')
  })

  it('finds entities with loose plain-colon Location field', async () => {
    // AI may write "Location: chamber-x" without **bold:** — loose pass should find them
    await seedKV('character:loose-loc-1', 'Location: location:loose-chamber\nStatus: Active')
    await seedKV('character:loose-loc-2', 'Location: location:loose-chamber\nStatus: Dormant')
    const res = await callTool('get_location_occupants', { location_key: 'location:loose-chamber' })
    expect(res.result.occupants).toHaveLength(2)
  })
})

describe('get_reachable_locations', () => {
  it('parses Exits field and checks each destination', async () => {
    await seedKV('location:hub', '**Exits:** location:north-road, location:cave')
    await seedKV('location:north-road', '**Danger-Level:** 0.2\n**Travel-Cost:** 30')
    const res = await callTool('get_reachable_locations', { origin_key: 'location:hub' })
    expect(res.result.locations).toHaveLength(2)
    const northRoad = res.result.locations.find((l: { key: string }) => l.key === 'location:north-road')
    expect(northRoad.exists).toBe(true)
    expect(northRoad.danger_level).toBe(0.2)
    expect(northRoad.travel_cost).toBe(30)
    const cave = res.result.locations.find((l: { key: string }) => l.key === 'location:cave')
    expect(cave.exists).toBe(false)
  })

  it('returns empty locations when no Exits field', async () => {
    await seedKV('location:dead-end', 'No way out.')
    const res = await callTool('get_reachable_locations', { origin_key: 'location:dead-end' })
    expect(res.result.locations).toHaveLength(0)
  })

  it('returns error for missing origin', async () => {
    const res = await callTool('get_reachable_locations', { origin_key: 'location:nonexistent' })
    expect(res.error).toBeDefined()
  })
})

describe('get_compatibility', () => {
  it('returns compatible=true for well-matched entities', async () => {
    await seedKV('character:predator-c', '**Weight-1:** 0.8\n**Size:** 3.0\n**Environment:** forest')
    await seedKV('character:prey-c', '**Weight-2:** 0.4\n**Size:** 1.0\n**Environment:** forest')
    const res = await callTool('get_compatibility', { entity_a: 'character:predator-c', entity_b: 'character:prey-c', interaction_type: 'hunt' })
    expect(res.result.compatible).toBe(true)
    expect(res.result.risk_level).toBe('low')
    expect(res.result.size_ratio).toBe(3)
  })

  it('flags incompatibility when Weight-1 is too low', async () => {
    await seedKV('character:weak-actor', '**Weight-1:** 0.1')
    await seedKV('character:target', '**Weight-2:** 0.5')
    const res = await callTool('get_compatibility', { entity_a: 'character:weak-actor', entity_b: 'character:target', interaction_type: 'consume' })
    expect(res.result.compatible).toBe(false)
    expect(res.result.constraints.some((c: string) => c.includes('Weight-1'))).toBe(true)
  })

  it('returns error for missing entity', async () => {
    await seedKV('character:exists-only', 'text')
    const res = await callTool('get_compatibility', { entity_a: 'character:exists-only', entity_b: 'character:ghost', interaction_type: 'test' })
    expect(res.error).toBeDefined()
  })
})

