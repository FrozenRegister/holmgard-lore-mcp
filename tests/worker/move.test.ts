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

describe('move_entity', () => {
  it('updates Location field and returns success', async () => {
    await seedKV('character:traveler', '**Location:** location:old-town\n**Status:** Active')
    const res = await callTool('entity_manage', {
      action: 'move',
      entity_key: 'character:traveler',
      new_location_key: 'location:new-city',
    })
    expect(res.error).toBeUndefined()
    expect(res.result.metadata.new_location).toBe('location:new-city')
    const lore = await callTool('lore_manage', { action: 'get', query: 'character:traveler' })
    expect(lore.result.text).toContain('location:new-city')
    expect(lore.result.text).not.toContain('location:old-town')
  })

  it('updates location indexes so get_location_occupants reflects the move', async () => {
    await seedKV('character:mover', '**Location:** location:room-a\n**Status:** Active')
    await callTool('entity_manage', {
      action: 'move',
      entity_key: 'character:mover',
      new_location_key: 'location:room-b',
    })
    const oldLoc = await callTool('world_manage', {
      action: 'get_location_occupants',
      location_key: 'location:room-a',
    })
    expect(oldLoc.result.occupants).toHaveLength(0)
    const newLoc = await callTool('world_manage', {
      action: 'get_location_occupants',
      location_key: 'location:room-b',
    })
    expect(newLoc.result.occupants.map((o: { key: string }) => o.key)).toContain('character:mover')
  })

  it('pushes history before writing', async () => {
    await seedKV('character:hist-mover', '**Location:** location:start\n**Status:** Active')
    await callTool('entity_manage', {
      action: 'move',
      entity_key: 'character:hist-mover',
      new_location_key: 'location:end',
    })
    const restore = await callTool('lore_manage', {
      action: 'restore',
      key: 'character:hist-mover',
    })
    expect(restore.result.metadata.restored).toBe(true)
    const lore = await callTool('lore_manage', { action: 'get', query: 'character:hist-mover' })
    expect(lore.result.text).toContain('location:start')
  })

  it('returns error for nonexistent entity', async () => {
    const res = await callTool('entity_manage', {
      action: 'move',
      entity_key: 'character:ghost-9999',
      new_location_key: 'location:void',
    })
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })
})
