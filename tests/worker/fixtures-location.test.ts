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

describe('canonical fixture — location:transit-hub-north (YAML exits + encounter table)', () => {
  const TRANSIT_HUB_LORE = [
    '# Location: Northern Transit Hub',
    'Type: threshold-zone',
    'Danger-Level: moderate',
    'Status: active',
    '',
    '## Exits',
    'Exits:',
    '- target: location:processing-chamber-primary',
    '  travel-cost: 2-hours',
    '  danger: high',
    '  requirement: tracking-skill-0.3',
    '- target: location:settlement-fringe',
    '  travel-cost: 30-minutes',
    '  danger: low',
    '  requirement: none',
    '- target: location:deep-forest',
    '  travel-cost: 4-hours',
    '  danger: very-high',
    '  requirement: tracking-skill-0.5',
    '',
    '## Environmental Properties',
    'Temperature: 22-28°C',
    'Humidity: high',
    'Light-Level: low',
    'Ambient-Scent: decay, damp-earth, fungal-spore',
    'Ambient-Sound: distant-movement, settling-earth, water-drip',
    '',
    '## Encounter Table',
    'Encounter-Table:',
    '- entity-type: scout-entity',
    '  weight: 40',
    '  threat-level: moderate',
    '  behavior: patrolling',
    '- entity-type: minor-entity',
    '  weight: 30',
    '  threat-level: low',
    '  behavior: fleeing',
    '- entity-type: rival-actor',
    '  weight: 20',
    '  threat-level: high',
    '  behavior: territorial',
    '- entity-type: neutral-traveler',
    '  weight: 10',
    '  threat-level: none',
    '  behavior: passing-through',
  ].join('\n')

  beforeEach(() => seedKV('location:transit-hub-north', TRANSIT_HUB_LORE))

  it('stores and retrieves full canonical lore verbatim', async () => {
    const res = await callTool('lore_manage', {
      action: 'get',
      query: 'location:transit-hub-north',
    })
    expect(res.result.content[0].text).toBe(TRANSIT_HUB_LORE)
  })

  it('get_reachable_locations parses YAML-style Exits list and returns all three destinations', async () => {
    const res = await callTool('world_manage', {
      action: 'get_reachable_locations',
      origin_key: 'location:transit-hub-north',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.locations).toHaveLength(3)
    const keys = res.result.locations.map((l: { key: string }) => l.key)
    expect(keys).toContain('location:processing-chamber-primary')
    expect(keys).toContain('location:settlement-fringe')
    expect(keys).toContain('location:deep-forest')
  })

  it('search_lore finds location by encounter type keyword', async () => {
    const res = await callTool('lore_manage', { action: 'search', query: 'scout-entity' })
    expect(res.result.metadata.match_count).toBeGreaterThan(0)
    const keys = res.result.results.map((r: { key: string }) => r.key)
    expect(keys).toContain('location:transit-hub-north')
  })
})
