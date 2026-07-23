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

describe('canonical fixture — get_location_occupants with entity: prefix keys', () => {
  it('finds entity:subject-alpha and entity:actor-primary at processing-chamber-primary', async () => {
    await seedKV(
      'entity:subject-alpha',
      [
        'Status: Active, Stage-2-of-4',
        'Location: processing-chamber-primary',
        'Weight-1 (Drive): 30',
      ].join('\n'),
    )
    await seedKV(
      'entity:actor-primary',
      [
        'Status: Active, Processing',
        'Location: processing-chamber-primary',
        'Weight-1 (Drive): 85',
      ].join('\n'),
    )
    await seedKV(
      'entity:subject-beta',
      ['Status: Stage-3-of-4', 'Location: processing-chamber-secondary'].join('\n'),
    )
    const res = await callTool('world_manage', {
      action: 'get_location_occupants',
      location_key: 'processing-chamber-primary',
    })
    expect(res.error).toBeUndefined()
    const keys = res.result.occupants.map((o: { key: string }) => o.key)
    expect(keys).toContain('entity:subject-alpha')
    expect(keys).toContain('entity:actor-primary')
    expect(keys).not.toContain('entity:subject-beta')
  })
})
