import { describe, it, beforeEach, expect } from 'vitest'
import { callTool, seedKV } from './support/helpers'

describe('Thread tracking', () => {
  beforeEach(async () => {
    // Seed test entities with thread metadata
    await seedKV('entity:alpha', 'Name: Alpha\nLocation: room-a\n**Thread:** investigation')
    await seedKV('entity:beta', 'Name: Beta\nLocation: room-b\n**Thread:** containment')
  })

  describe('append_event with thread', () => {
    it('writes thread field into event metadata', async () => {
      const res = await callTool('continuity_manage', {
        action: 'append_event',
        entity_key: 'entity:alpha',
        verb: 'moved',
        object: 'to the north corridor',
        location: 'north-corridor',
        thread: 'investigation',
        detail: 'Subject proceeded northward',
        world_id: 'test-world-1',
      })
      expect(res.error).toBeUndefined()
      expect(res.result.metadata.thread).toBe('investigation')
    })

    it('works without thread (backward compatible)', async () => {
      const res = await callTool('continuity_manage', {
        action: 'append_event',
        entity_key: 'entity:alpha',
        verb: 'rested',
        object: 'at camp',
        location: 'base-camp',
        detail: 'Subject rested for the night',
        world_id: 'test-world-1',
      })
      expect(res.error).toBeUndefined()
    })
  })

  describe('plant_setup with thread', () => {
    it('stores thread in setup lore text', async () => {
      const res = await callTool('continuity_manage', {
        action: 'plant_setup',
        id: 'setup-test-001',
        description: 'The investigation reveals a hidden connection',
        planted_in: 'scene:interrogation-room',
        tension: 3,
        expected_in: 'chapter:7',
        actors: ['entity:alpha', 'entity:beta'],
        thread: 'investigation',
      })
      expect(res.error).toBeUndefined()
      // Metadata doesn't include thread, but the stored lore should
      expect(res.result.metadata.key).toBe('setup:setup-test-001')

      // Verify the setup was stored with thread info
      const setup = await callTool('lore_manage', {
        action: 'get',
        query: 'setup:setup-test-001',
      })
      expect(setup.error).toBeUndefined()
      expect(setup.result.text).toContain('**Thread:** investigation')
    })

    it('works without thread (backward compatible)', async () => {
      const res = await callTool('continuity_manage', {
        action: 'plant_setup',
        id: 'setup-test-002',
        description: 'A loose thread in the narrative',
        planted_in: 'scene:marketplace',
        tension: 2,
        expected_in: 'chapter:12',
        actors: ['entity:beta'],
      })
      expect(res.error).toBeUndefined()
    })
  })

  describe('check_convergence', () => {
    it('returns result structure without error', async () => {
      const res = await callTool('world_manage', {
        action: 'check_convergence',
        thread_a: 'investigation',
        thread_b: 'containment',
      })
      expect(res.error).toBeUndefined()
      expect(res.result.can_converge).toBeDefined()
      expect(typeof res.result.can_converge).toBe('boolean')
      expect(res.result.thread_a).toBe('investigation')
      expect(res.result.thread_b).toBe('containment')
    })

    it('reports no convergence for empty threads', async () => {
      const res = await callTool('world_manage', {
        action: 'check_convergence',
        thread_a: 'nonexistent-thread-a',
        thread_b: 'nonexistent-thread-b',
      })
      expect(res.error).toBeUndefined()
      expect(res.result.can_converge).toBe(false)
      expect(res.result.shared_dates).toEqual([])
      expect(res.result.shared_locations).toEqual([])
    })
  })
})
