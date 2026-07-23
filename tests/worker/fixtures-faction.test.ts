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

describe('canonical fixture — faction:processing-guild (hierarchy + standing system)', () => {
  const GUILD_LORE = [
    '# Faction: Processing Guild',
    'Type: operational-hierarchy',
    'Status: active',
    'Location: processing-chamber-primary',
    '',
    '## Hierarchy',
    'Ranks:',
    '- title: director',
    '  members: [entity:actor-primary]',
    '  authority: supreme',
    '- title: senior-operator',
    '  members: [entity:actor-secondary]',
    '  authority: high',
    '',
    '## Standing System',
    'Reputation-Tiers: [hostile, suspicious, neutral, accepted, favored, exalted]',
    'Default-Reputation: neutral',
    '',
    '## Member Records',
    'Member-Records:',
    '- entity: entity:actor-primary',
    '  rank: director',
    '  specialization: multi-stage-processing',
    '  yield-history: exemplary',
  ].join('\n')

  const ACTOR_STUB = [
    '# Entity: Actor Primary',
    'Faction: processing-guild',
    'Rank: director',
    'Weight-1 (Drive): 85',
  ].join('\n')

  beforeEach(async () => {
    await seedKV('faction:processing-guild', GUILD_LORE)
    await seedKV('entity:actor-primary', ACTOR_STUB)
  })

  it('stores and retrieves faction lore verbatim', async () => {
    const res = await callTool('lore_manage', { action: 'get', query: 'faction:processing-guild' })
    expect(res.result.content[0].text).toBe(GUILD_LORE)
  })

  it('get_faction_standing detects actor-primary as member (slug appears in faction text)', async () => {
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'entity:actor-primary',
      faction_key: 'faction:processing-guild',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.rank).toBe('director')
  })

  it('get_faction_standing returns non-member for entity not in guild text', async () => {
    await seedKV('entity:outsider', 'Faction: rival-guild')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'entity:outsider',
      faction_key: 'faction:processing-guild',
    })
    expect(res.result.standing.is_member).toBe(false)
  })
})

describe('faction standing implicit membership via Tags (#46)', () => {
  it('get_faction_standing detects membership via Tags field', async () => {
    await seedKV('faction:house-crowmark', '# House Crowmark\nStatus: active\n')
    await seedKV(
      'entity:kavissa-crowmark',
      'Tags: faction:house-crowmark, theme:nobility\n# Kavissa Crowmark\nAlias: disguised-merchant\n',
    )
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'entity:kavissa-crowmark',
      faction_key: 'faction:house-crowmark',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.membership_source).toBe('tag')
  })

  it('get_faction_standing returns explicit source when Faction field matches', async () => {
    await seedKV('faction:house-crowmark', '# House Crowmark\n')
    await seedKV('entity:crowmark-lord', 'Faction: house-crowmark\n# A Crowmark\n')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'entity:crowmark-lord',
      faction_key: 'faction:house-crowmark',
    })
    expect(res.result.standing.is_member).toBe(true)
    expect(res.result.standing.membership_source).toBe('explicit')
  })

  it('get_faction_standing returns null source for non-members', async () => {
    await seedKV('faction:house-crowmark', '# House Crowmark\n')
    await seedKV('entity:outsider', 'Tags: theme:nobility\n# An outsider\n')
    const res = await callTool('world_manage', {
      action: 'get_faction_standing',
      entity_key: 'entity:outsider',
      faction_key: 'faction:house-crowmark',
    })
    expect(res.result.standing.is_member).toBe(false)
    expect(res.result.standing.membership_source).toBeNull()
  })
})
