/**
 * Tests for tick hooks - conflict resolution integration
 *
 * Implements #444 (Cross-tick claims + conflict resolution)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runTickDriver, type HookResult } from './tick-hooks'
import type { AppBindings } from '../../types'

// Mock environment and database
const mockEnv: AppBindings = {
  LORE_DB: {} as KVNamespace,
  RPG_DB: {} as D1Database,
  MCP_API_KEY: 'test-key',
  ADMIN_SECRET: 'test-secret'
}

const mockDb = {
  prepare: vi.fn(),
  dump: vi.fn(),
  batch: vi.fn(),
  exec: vi.fn()
} as unknown as D1Database

// Mock character data
const testCharacter = {
  id: 'char-1',
  name: 'Test Character',
  stats: '{}',
  hp: 10,
  max_hp: 10,
  ac: 10,
  level: 1,
  character_type: 'npc',
  claimed_by: null as string | null,
  claimed_until: null as string | null,
  claimed_at: null as string | null
}

beforeEach(() => {
  vi.resetAllMocks()

  // Mock getCharacter
  vi.spyOn(characterManage, 'getCharacter').mockImplementation(async (_env, _db, key) => {
    if (key === 'char-1') return testCharacter
    return null
  })

  // Mock world state query with full D1PreparedStatement interface
  vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
    const mockStmt: any = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      raw: vi.fn().mockResolvedValue([])
    }

    if (query.includes('world_state')) {
      mockStmt.first.mockResolvedValue({
        current_date: '2187-01-10',
        weather: null
      })
    } else {
      mockStmt.first.mockResolvedValue(null)
    }

    return mockStmt
  })
})

describe('Tick Hooks - Conflict Resolution', () => {
  it('should return empty conflict_resolutions when no flagged events', async () => {
    const result = await runTickDriver(
      mockEnv,
      mockDb,
      'world-1',
      '2187-01-10',
      '2187-01-11',
      { hooks: ['weather_update'] }
    )

    expect(result.success).toBe(true)
    expect(result.conflict_resolutions).toBeUndefined()
  })

  it('should process flagged events and return conflict resolutions', async () => {
    // Create a hook that returns flagged events
    const testHook = {
      name: 'test_hook',
      config: { enabled: true, batch_mode: false },
      dependsOn: [],
      batchMode: false,
      execute: async (): Promise<HookResult> => ({
        category: 'flagged',
        data: {
          events: [
            {
              id: 'event-1',
              eventType: 'hunt',
              priority: 'HIGH' as const,
              targetKey: 'char-1',
              sourceEntityKey: 'creature:shaper-alpha',
              payload: {},
              resourceLocks: ['char-1']
            },
            {
              id: 'event-2',
              eventType: 'track',
              priority: 'MEDIUM' as const,
              targetKey: 'char-1',
              sourceEntityKey: 'party:adventurers',
              payload: {},
              resourceLocks: ['char-1']
            }
          ]
        },
        narrator_summary: 'Test hook executed'
      })
    }

    // Temporarily add the test hook to the registry
    const originalRegistry = new Map([...(await import('./tick-hooks')).HOOK_REGISTRY])
    const { HOOK_REGISTRY } = await import('./tick-hooks')
    HOOK_REGISTRY.set('test_hook', testHook)

    try {
      const result = await runTickDriver(
        mockEnv,
        mockDb,
        'world-1',
        '2187-01-10',
        '2187-01-11',
        { hooks: ['test_hook'] }
      )

      expect(result.success).toBe(true)
      expect(result.conflict_resolutions).toBeDefined()
      expect(result.conflict_resolutions).toHaveLength(2)

      // HIGH priority should resolve
      const resolved = result.conflict_resolutions?.find(cr => cr.status === 'resolved')
      expect(resolved).toBeDefined()
      expect(resolved?.eventType).toBe('hunt')
      expect(resolved?.sourceEntityKey).toBe('creature:shaper-alpha')

      // MEDIUM priority should be deferred
      const deferred = result.conflict_resolutions?.find(cr => cr.status === 'deferred')
      expect(deferred).toBeDefined()
      expect(deferred?.eventType).toBe('track')
      expect(deferred?.sourceEntityKey).toBe('party:adventurers')
    } finally {
      // Restore original registry
      HOOK_REGISTRY.clear()
      originalRegistry.forEach((value, key) => HOOK_REGISTRY.set(key, value))
    }
  })

  it('should handle active claims in conflict resolution', async () => {
    // Set up an active claim
    testCharacter.claimed_by = 'creature:shaper-alpha'
    testCharacter.claimed_until = '2187-01-15T00:00:00Z'
    testCharacter.claimed_at = '2187-01-10T00:00:00Z'

    // Create a hook that returns flagged events
    const testHook = {
      name: 'test_hook',
      config: { enabled: true, batch_mode: false },
      dependsOn: [],
      batchMode: false,
      execute: async (): Promise<HookResult> => ({
        category: 'flagged',
        data: {
          events: [
            // Event from the claimer (locked by me)
            {
              id: 'event-1',
              eventType: 'tenderize',
              priority: 'HIGH' as const,
              targetKey: 'char-1',
              sourceEntityKey: 'creature:shaper-alpha',
              payload: {},
              resourceLocks: ['char-1']
            },
            // Event from another entity (locked by others)
            {
              id: 'event-2',
              eventType: 'hunt',
              priority: 'HIGH' as const,
              targetKey: 'char-1',
              sourceEntityKey: 'party:adventurers',
              payload: {},
              resourceLocks: ['char-1']
            }
          ]
        },
        narrator_summary: 'Test hook executed'
      })
    }

    // Temporarily add the test hook to the registry
    const originalRegistry = new Map([...(await import('./tick-hooks')).HOOK_REGISTRY])
    const { HOOK_REGISTRY } = await import('./tick-hooks')
    HOOK_REGISTRY.set('test_hook', testHook)

    try {
      const result = await runTickDriver(
        mockEnv,
        mockDb,
        'world-1',
        '2187-01-10',
        '2187-01-11',
        { hooks: ['test_hook'] }
      )

      expect(result.success).toBe(true)
      expect(result.conflict_resolutions).toBeDefined()
      expect(result.conflict_resolutions).toHaveLength(2)

      // Event from claimer should resolve
      const resolved = result.conflict_resolutions?.find(cr => cr.status === 'resolved')
      expect(resolved).toBeDefined()
      expect(resolved?.eventType).toBe('tenderize')
      expect(resolved?.sourceEntityKey).toBe('creature:shaper-alpha')

      // Event from other should be modified
      const modified = result.conflict_resolutions?.find(cr => cr.status === 'modified')
      expect(modified).toBeDefined()
      expect(modified?.eventType).toBe('hunt')
      expect(modified?.sourceEntityKey).toBe('party:adventurers')
      expect(modified?.narrativeContext).toContain('already claimed by creature:shaper-alpha')
    } finally {
      // Restore original registry
      HOOK_REGISTRY.clear()
      originalRegistry.forEach((value, key) => HOOK_REGISTRY.set(key, value))
    }
  })
})