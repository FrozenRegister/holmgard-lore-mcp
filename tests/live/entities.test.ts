import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MCP_API_KEY, tool, uid, setLore, deleteLore } from './helpers'

describe.skipIf(!MCP_API_KEY)('Direct-Read Tools', () => {
  let relA: string, relB: string, factionEntity: string, factionKey: string
  let knowledgeKey: string, envLocKey: string, envEntityKey: string, invEntityKey: string

  beforeAll(async () => {
    relA = `test:rel-a-${uid()}`
    relB = `test:rel-b-${uid()}`
    factionEntity = `test:faction-entity-${uid()}`
    factionKey = `test:faction-${uid()}`
    knowledgeKey = `test:knowledge-${uid()}`
    envLocKey = `test:env-loc-${uid()}`
    envEntityKey = `test:env-entity-${uid()}`
    invEntityKey = `test:inv-entity-${uid()}`

    await Promise.all([
      setLore(relA, '**Affinity:** 0.7\n**Faction:** order\nBob is a trusted ally.'),
      setLore(relB, '**Faction:** order\nAlice mentored me.'),
      setLore(factionEntity, '**Rank:** Captain\n**Reputation:** 0.9\n**Faction:** order'),
      setLore(factionKey, 'Members: captain, paladin, squire.'),
      setLore(knowledgeKey, '**Knows:** hidden-vault, patrol-routes\nI found the hidden-vault last night.'),
      setLore(envLocKey, 'Stone walls surround you.\nA gem gleams [hidden] in the rock.'),
      setLore(envEntityKey, '**Perception:** 0.9'),
      setLore(invEntityKey, '**Inventory:** sword:3, shield:1, potion:10'),
    ])
  })

  afterAll(async () => {
    await deleteLore(relA, relB, factionEntity, factionKey, knowledgeKey, envLocKey, envEntityKey, invEntityKey)
  })

  it('get_relationship detects affinity and faction overlap', async () => {
    const res = await tool('get_relationship', { entity_a: relA, entity_b: relB })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Relationship data found/)
  })

  it('get_relationship returns not-found for unrelated entities', async () => {
    const res = await tool('get_relationship', { entity_a: envLocKey, entity_b: knowledgeKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/No relationship data found/)
  })

  it('get_relationship returns error for missing entity', async () => {
    const res = await tool('get_relationship', { entity_a: relA, entity_b: 'nonexistent:nobody' })
    expect(res.error).toBeTruthy()
  })

  it('get_faction_standing detects member', async () => {
    const res = await tool('get_faction_standing', { entity_key: factionEntity, faction_key: factionKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/member/)
  })

  it('get_faction_standing returns error for missing faction', async () => {
    const res = await tool('get_faction_standing', { entity_key: factionEntity, faction_key: 'faction:no-such' })
    expect(res.error).toBeTruthy()
  })

  it('get_entity_knowledge returns excerpts for known topic', async () => {
    const res = await tool('get_entity_knowledge', { entity_key: knowledgeKey, topic: 'hidden-vault' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/has knowledge of/)
  })

  it('get_entity_knowledge returns not-known for unknown topic', async () => {
    const res = await tool('get_entity_knowledge', { entity_key: knowledgeKey, topic: 'secret-dragon' })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/no knowledge of/)
  })

  it('sense_environment returns all details for high perception', async () => {
    const res = await tool('sense_environment', { location_key: envLocKey, entity_key: envEntityKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/perception/)
  })

  it('sense_environment returns error for missing entity', async () => {
    const res = await tool('sense_environment', { location_key: envLocKey, entity_key: 'character:ghost' })
    expect(res.error).toBeTruthy()
  })

  it('get_inventory parses structured items', async () => {
    const res = await tool('get_inventory', { entity_key: invEntityKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/sword/)
  })

  it('get_inventory returns empty for entity without inventory', async () => {
    const res = await tool('get_inventory', { entity_key: knowledgeKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/No inventory/)
  })
})

describe.skipIf(!MCP_API_KEY)('Entity Generation and Encounters', () => {
  let archetypeKey: string, encounterLoc: string, archetypeEntityKey: string

  beforeAll(async () => {
    archetypeKey = `test:archetype-${uid()}`
    encounterLoc = `test:encounter-loc-${uid()}`
    archetypeEntityKey = `archetype:test-arch-${uid()}`

    await Promise.all([
      setLore(archetypeKey, '**Weight-1:** 0.6\n**Weight-2:** 0.3\n**Status:** Patrol'),
      setLore(archetypeEntityKey, '**Weight-1:** 0.6\n**Status:** Roaming'),
      setLore(encounterLoc, `**Encounter-Table:** ${archetypeEntityKey}:80, archetype:deer:20`),
    ])
  })

  afterAll(async () => { await deleteLore(archetypeKey, encounterLoc) })

  it('generate_entity creates from archetype', async () => {
    const res = await tool('generate_entity', { archetype_key: archetypeEntityKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/Generated entity/)
  })

  it('roll_encounter succeeds with encounter table', async () => {
    const res = await tool('roll_encounter', { location_key: encounterLoc, threat_level: 5 })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/rolled/)
  })

  it('roll_encounter returns message for missing table', async () => {
    const res = await tool('roll_encounter', { location_key: archetypeKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/No Encounter-Table/)
  })
})

describe.skipIf(!MCP_API_KEY)('Compatibility', () => {
  let compatA: string, compatB: string

  beforeAll(async () => {
    compatA = `test:compat-a-${uid()}`
    compatB = `test:compat-b-${uid()}`
    await Promise.all([
      setLore(compatA, '**Weight-1:** 0.8\n**Size:** 3.0\n**Environment:** forest'),
      setLore(compatB, '**Weight-2:** 0.4\n**Size:** 1.0\n**Environment:** forest'),
    ])
  })

  afterAll(async () => { await deleteLore(compatA, compatB) })

  it('get_compatibility returns COMPATIBLE for matching entities', async () => {
    const res = await tool('get_compatibility', {
      entity_a: compatA, entity_b: compatB, interaction_type: 'hunt',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/COMPATIBLE/)
  })
})

describe.skipIf(!MCP_API_KEY)('Location and Exit Operations', () => {
  let destKey: string, locKey: string

  beforeAll(async () => {
    destKey = `test:reach-dest-${uid()}`
    locKey = `test:reach-loc-${uid()}`
    await Promise.all([
      setLore(destKey, '**Danger-Level:** 0.3\n**Travel-Cost:** 20'),
      setLore(locKey, `**Exits:** ${destKey}`),
    ])
  })

  afterAll(async () => { await deleteLore(destKey, locKey) })

  it('get_reachable_locations parses exits and checks destinations', async () => {
    const res = await tool('get_reachable_locations', { origin_key: locKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/reachable/)
  })

  it('get_reachable_locations returns empty for missing Exits field', async () => {
    const res = await tool('get_reachable_locations', { origin_key: destKey })
    expect(res.error).toBeUndefined()
    expect(res.result.content[0].text).toMatch(/No exits defined/)
  })
})
