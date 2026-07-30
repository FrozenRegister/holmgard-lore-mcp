/**
 * Tests for tick hooks - conflict resolution integration
 *
 * Implements #444 (Cross-tick claims + conflict resolution)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runTickDriver, type HookResult } from '@/rpg/handlers/tick-hooks'
import type { AppBindings } from '@/types'
import * as characterManager from '@/rpg/handlers/character-manage'
import * as encounterManager from '@/rpg/handlers/encounter-manage'
import * as resourceManager from '@/rpg/handlers/resource-manage'

// Mock environment and database
const mockEnv: AppBindings = {
  LORE_DB: {} as KVNamespace,
  RPG_DB: {} as D1Database,
  MCP_API_KEY: 'test-key',
  ADMIN_SECRET: 'test-secret',
}

const mockDb = {
  prepare: vi.fn(),
  dump: vi.fn(),
  batch: vi.fn(),
  exec: vi.fn(),
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
  claimed_at: null as string | null,
}

beforeEach(() => {
  vi.resetAllMocks()

  // Mock getCharacter
  vi.spyOn(characterManager, 'getCharacter').mockImplementation(async (_env, _db, key) => {
    if (key === 'char-1') return testCharacter
    return null
  })

  // Mock world state query with full D1PreparedStatement interface
  vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
    const mockStmt: any = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      // world_locks: acquireWorldLock/releaseWorldLock (#512) check
      // meta.changes to detect whether the conditional UPSERT/DELETE actually
      // touched a row — the generic { success: true } default (no meta) would
      // make every acquireWorldLock call look like a failed lock acquisition.
      run: query.includes('world_locks')
        ? vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
        : vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      raw: vi.fn().mockResolvedValue([]),
    }

    if (query.includes('world_state')) {
      mockStmt.first.mockResolvedValue({
        current_date: '2187-01-10',
        weather: null,
      })
    } else {
      mockStmt.first.mockResolvedValue(null)
    }

    return mockStmt
  })
})

afterEach(() => {
  // testCharacter is shared module-level state across every test in this
  // file — without resetting it, a claim set by one test (e.g. "should
  // handle active claims in conflict resolution") leaks into whichever test
  // runs next and silently changes its conflict-resolution outcome.
  testCharacter.claimed_by = null
  testCharacter.claimed_until = null
  testCharacter.claimed_at = null
})

describe('Tick Hooks - Conflict Resolution', () => {
  it('should return empty conflict_resolutions when no flagged events', async () => {
    mockEnv.RPG_DB = mockDb

    const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['weather_update'],
    })

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
              resourceLocks: ['char-1'],
            },
            {
              id: 'event-2',
              eventType: 'track',
              priority: 'MEDIUM' as const,
              targetKey: 'char-1',
              sourceEntityKey: 'party:adventurers',
              payload: {},
              resourceLocks: ['char-1'],
            },
          ],
        },
        narrator_summary: 'Test hook executed',
      }),
    }

    // Temporarily add the test hook to the registry
    const originalRegistry = new Map([...(await import('@/rpg/handlers/tick-hooks')).HOOK_REGISTRY])
    const { HOOK_REGISTRY } = await import('@/rpg/handlers/tick-hooks')
    HOOK_REGISTRY.set('test_hook', testHook)

    try {
      const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
        hooks: ['test_hook'],
      })

      expect(result.success).toBe(true)
      expect(result.conflict_resolutions).toBeDefined()
      expect(result.conflict_resolutions).toHaveLength(2)

      // HIGH priority should resolve
      const resolved = result.conflict_resolutions?.find((cr) => cr.status === 'resolved')
      expect(resolved).toBeDefined()
      expect(resolved?.eventType).toBe('hunt')
      expect(resolved?.sourceEntityKey).toBe('creature:shaper-alpha')

      // MEDIUM priority should be deferred
      const deferred = result.conflict_resolutions?.find((cr) => cr.status === 'deferred')
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
              resourceLocks: ['char-1'],
            },
            // Event from another entity (locked by others)
            {
              id: 'event-2',
              eventType: 'hunt',
              priority: 'HIGH' as const,
              targetKey: 'char-1',
              sourceEntityKey: 'party:adventurers',
              payload: {},
              resourceLocks: ['char-1'],
            },
          ],
        },
        narrator_summary: 'Test hook executed',
      }),
    }

    // Temporarily add the test hook to the registry
    const originalRegistry = new Map([...(await import('@/rpg/handlers/tick-hooks')).HOOK_REGISTRY])
    const { HOOK_REGISTRY } = await import('@/rpg/handlers/tick-hooks')
    HOOK_REGISTRY.set('test_hook', testHook)

    try {
      const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
        hooks: ['test_hook'],
      })

      expect(result.success).toBe(true)
      expect(result.conflict_resolutions).toBeDefined()
      expect(result.conflict_resolutions).toHaveLength(2)

      // Event from claimer should resolve
      const resolved = result.conflict_resolutions?.find((cr) => cr.status === 'resolved')
      expect(resolved).toBeDefined()
      expect(resolved?.eventType).toBe('tenderize')
      expect(resolved?.sourceEntityKey).toBe('creature:shaper-alpha')

      // Event from other should be modified
      const modified = result.conflict_resolutions?.find((cr) => cr.status === 'modified')
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

  // ── Conflict Resolution Integration Tests ────────────────────────────────────

  it('should return conflict_resolutions when flagged events exist', async () => {
    // Mock a hook that returns flagged events
    const mockHook = {
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
              eventType: 'test_event',
              priority: 'HIGH',
              targetKey: 'char-1',
              sourceEntityKey: 'entity:alpha',
              payload: {},
              resourceLocks: ['char-1'],
            },
          ],
        },
        narrator_summary: 'Test event flagged',
      }),
    }

    // Mock HOOK_REGISTRY
    const { HOOK_REGISTRY } = await import('@/rpg/handlers/tick-hooks')
    HOOK_REGISTRY.set('test_hook', mockHook as any)

    const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['test_hook'],
    })

    expect(result.success).toBe(true)
    expect(result.conflict_resolutions).toBeDefined()
    expect(result.conflict_resolutions).toHaveLength(1)
    expect(result.conflict_resolutions![0].status).toBe('resolved')
    expect(result.conflict_resolutions![0].eventType).toBe('test_event')

    // Clean up
    HOOK_REGISTRY.delete('test_hook')
  })

  // ── Coverage: disabled hook skip (line 280) ──────────────────────────────────

  it('should skip disabled hooks', async () => {
    const { HOOK_REGISTRY } = await import('@/rpg/handlers/tick-hooks')

    const disabledHook = {
      name: 'disabled_hook',
      config: { enabled: false, batch_mode: false },
      dependsOn: [],
      batchMode: false,
      execute: async (): Promise<HookResult> => ({
        category: 'resolved' as const,
        data: { should: 'never appear' },
        narrator_summary: 'Should not run',
      }),
    }

    HOOK_REGISTRY.set('disabled_hook', disabledHook)

    try {
      const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
        hooks: ['disabled_hook'],
      })

      expect(result.success).toBe(true)
      expect(result.resolved).toHaveLength(0)
      expect(result.flagged).toHaveLength(0)
    } finally {
      HOOK_REGISTRY.delete('disabled_hook')
    }
  })

  // ── Coverage: log_only hook (line 286) ───────────────────────────────────────

  it('should handle log_only hooks without mutating', async () => {
    const { HOOK_REGISTRY } = await import('@/rpg/handlers/tick-hooks')

    const logOnlyHook = {
      name: 'log_only_hook',
      config: { enabled: true, batch_mode: false, log_only: true },
      dependsOn: [],
      batchMode: false,
      execute: async (): Promise<HookResult> => ({
        category: 'flagged' as const,
        data: {
          events: [
            {
              id: 'log-ev-1',
              eventType: 'log_test',
              priority: 'HIGH' as const,
              targetKey: 'char-1',
              sourceEntityKey: 'entity:log-test',
              payload: {},
              resourceLocks: ['char-1'],
            },
          ],
        },
        narrator_summary: 'Log-only test',
      }),
    }

    HOOK_REGISTRY.set('log_only_hook', logOnlyHook)

    try {
      const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
        hooks: ['log_only_hook'],
      })

      expect(result.success).toBe(true)
    } finally {
      HOOK_REGISTRY.delete('log_only_hook')
    }
  })

  // ── Coverage: hook throws → abort entire advance (lines 301-306) ──────────────

  it('should abort entire advance when a hook throws', async () => {
    const { HOOK_REGISTRY } = await import('@/rpg/handlers/tick-hooks')

    const throwingHook = {
      name: 'throwing_hook',
      config: { enabled: true, batch_mode: false },
      dependsOn: [],
      batchMode: false,
      execute: async (): Promise<HookResult> => {
        throw new Error('Catastrophic hook failure')
      },
    }

    HOOK_REGISTRY.set('throwing_hook', throwingHook)

    try {
      const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
        hooks: ['throwing_hook'],
      })

      expect(result.success).toBe(false)
      expect(result.narrator_summary).toContain('Hook throwing_hook failed')
      expect(result.narrator_summary).toContain('Catastrophic hook failure')
      expect(result.resolved).toHaveLength(0)
      expect(result.flagged).toHaveLength(0)
    } finally {
      HOOK_REGISTRY.delete('throwing_hook')
    }
  })

  // ── Coverage: encounter_check hook tests ────────────────────────────────────

  it('should check encounters for active positioned parties', async () => {
    // Set up mockEnv.RPG_DB to use mockDb
    const testEnv = { ...mockEnv, RPG_DB: mockDb }

    // Create a mock implementation that tracks queries
    vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
      const mockStmt: any = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        run: query.includes('world_locks')
          ? vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
          : vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        raw: vi.fn().mockResolvedValue([]),
      }

      if (query.includes('world_state')) {
        mockStmt.first.mockResolvedValue({
          current_date: '2187-01-10',
          weather: null,
        })
      } else if (query.includes('parties')) {
        // Mock one active positioned party
        mockStmt.all.mockResolvedValue({
          results: [{ id: 'party-1', q: 0, r: 0 }],
        })
      } else if (query.includes('hexes')) {
        mockStmt.first.mockResolvedValue({ biome: 'grassland' })
      } else if (query.includes('biome_registry')) {
        mockStmt.all.mockResolvedValue({ results: [] })
      } else if (query.includes('encounter_types')) {
        mockStmt.all.mockResolvedValue({ results: [] })
      } else if (query.includes('zones_at')) {
        mockStmt.all.mockResolvedValue({ results: [] })
      }

      return mockStmt
    })

    const result = await runTickDriver(testEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['encounter_check'],
    })

    expect(result.success).toBe(true)
    expect(result.flagged).toHaveLength(1)
    const encounterResult = result.flagged[0]
    expect(encounterResult.data).toBeDefined()
    const data = encounterResult.data as Record<string, unknown>
    expect(data.action).toBe('encounter_check')
    expect(data.parties_checked).toBe(1)
    expect(data.triggered).toBeDefined()
    expect(Array.isArray(data.triggered)).toBe(true)
  })

  it('should report no encounters when no parties are positioned', async () => {
    // Set up mockEnv.RPG_DB to use mockDb
    const testEnv = { ...mockEnv, RPG_DB: mockDb }

    // Mock database to return no parties
    vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
      const mockStmt: any = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        run: query.includes('world_locks')
          ? vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
          : vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        raw: vi.fn().mockResolvedValue([]),
      }

      if (query.includes('world_state')) {
        mockStmt.first.mockResolvedValue({
          current_date: '2187-01-10',
          weather: null,
        })
      }
      // parties query returns empty array by default

      return mockStmt
    })

    const result = await runTickDriver(testEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['encounter_check'],
    })

    expect(result.success).toBe(true)
    expect(result.flagged).toHaveLength(1)
    const encounterResult = result.flagged[0]
    const data = encounterResult.data as Record<string, unknown>
    expect(data.parties_checked).toBe(0)
    expect(data.triggered).toStrictEqual([])
    expect(encounterResult.narrator_summary).toContain('No positioned active parties')
  })

  it('should handle multiple positioned parties in parallel', async () => {
    // Set up mockEnv.RPG_DB to use mockDb
    const testEnv = { ...mockEnv, RPG_DB: mockDb }

    // Mock database to return multiple active positioned parties
    vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
      const mockStmt: any = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        run: query.includes('world_locks')
          ? vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
          : vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        raw: vi.fn().mockResolvedValue([]),
      }

      if (query.includes('world_state')) {
        mockStmt.first.mockResolvedValue({
          current_date: '2187-01-10',
          weather: null,
        })
      } else if (query.includes('parties')) {
        // Mock three active positioned parties
        mockStmt.all.mockResolvedValue({
          results: [
            { id: 'party-1', q: 0, r: 0 },
            { id: 'party-2', q: 1, r: 1 },
            { id: 'party-3', q: 2, r: 2 },
          ],
        })
      } else if (query.includes('hexes')) {
        mockStmt.first.mockResolvedValue({ biome: 'forest' })
      } else if (query.includes('biome_registry')) {
        mockStmt.all.mockResolvedValue({ results: [] })
      } else if (query.includes('encounter_types')) {
        mockStmt.all.mockResolvedValue({ results: [] })
      } else if (query.includes('zones_at')) {
        mockStmt.all.mockResolvedValue({ results: [] })
      }

      return mockStmt
    })

    const result = await runTickDriver(testEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['encounter_check'],
    })

    expect(result.success).toBe(true)
    expect(result.flagged).toHaveLength(1)
    const encounterResult = result.flagged[0]
    const data = encounterResult.data as Record<string, unknown>
    expect(data.parties_checked).toBe(3)
    expect(Array.isArray(data.triggered)).toBe(true)
  })

  it('reports a party in triggered when resolveEncounterCore signals an encounter', async () => {
    // Set up mockEnv.RPG_DB to use mockDb
    const testEnv = { ...mockEnv, RPG_DB: mockDb }

    vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
      const mockStmt: any = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        run: query.includes('world_locks')
          ? vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
          : vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        raw: vi.fn().mockResolvedValue([]),
      }

      if (query.includes('world_state')) {
        mockStmt.first.mockResolvedValue({ current_date: '2187-01-10', weather: null })
      } else if (query.includes('parties')) {
        mockStmt.all.mockResolvedValue({ results: [{ id: 'party-1', q: 0, r: 0 }] })
      }

      return mockStmt
    })

    // resolveEncounterCore does its own dice rolls/zone resolution — rather
    // than reverse-engineering a D1 mock chain that forces a random roll to
    // land past threshold, mock the function's return directly to exercise
    // the hook's `if (result.encounter)` branch deterministically.
    const spy = vi.spyOn(encounterManager, 'resolveEncounterCore').mockResolvedValue({
      worldId: 'world-1',
      q: 0,
      r: 0,
      encounter: true,
      roll: 18,
      threshold: 10,
      modifiers: {},
    })

    try {
      const result = await runTickDriver(testEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
        hooks: ['encounter_check'],
      })

      expect(result.success).toBe(true)
      const data = result.flagged[0].data as Record<string, unknown>
      expect(data.parties_checked).toBe(1)
      const triggered = data.triggered as Array<{ partyId: string; encounter: boolean }>
      expect(triggered).toHaveLength(1)
      expect(triggered[0].partyId).toBe('party-1')
      expect(triggered[0].encounter).toBe(true)
      expect(result.flagged[0].narrator_summary).toContain('1 encounter(s) eligible')
    } finally {
      spy.mockRestore()
    }
  })

  // ── Coverage: circular dependency → topological sort failure ──────────────────

  it('should handle circular dependencies gracefully', async () => {
    const { HOOK_REGISTRY } = await import('@/rpg/handlers/tick-hooks')

    const hookA = {
      name: 'circ_a',
      config: { enabled: true, batch_mode: false },
      dependsOn: ['circ_b'],
      batchMode: false,
      execute: async (): Promise<HookResult> => ({
        category: 'resolved' as const,
        data: {},
        narrator_summary: 'A',
      }),
    }
    const hookB = {
      name: 'circ_b',
      config: { enabled: true, batch_mode: false },
      dependsOn: ['circ_a'],
      batchMode: false,
      execute: async (): Promise<HookResult> => ({
        category: 'resolved' as const,
        data: {},
        narrator_summary: 'B',
      }),
    }

    HOOK_REGISTRY.set('circ_a', hookA)
    HOOK_REGISTRY.set('circ_b', hookB)

    try {
      const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
        hooks: ['circ_a', 'circ_b'],
      })

      expect(result.success).toBe(false)
      expect(result.narrator_summary).toContain('Hook sort failed')
      expect(result.narrator_summary).toContain('Circular dependency')
    } finally {
      HOOK_REGISTRY.delete('circ_a')
      HOOK_REGISTRY.delete('circ_b')
    }
  })

  // ── Dissolution Flag Hook Tests ──────────────────────────────────────────────

  it('should invoke dissolution_flag hook when requested', async () => {
    // Ensure mockEnv.RPG_DB is set to mockDb for the hook to use
    mockEnv.RPG_DB = mockDb

    const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['dissolution_flag'],
    })

    expect(result.success).toBe(true)
    expect(result.flagged).toHaveLength(1)
    expect(result.flagged[0].data).toBeDefined()
    const data = result.flagged[0].data as { action: string; staged_characters: unknown[] }
    expect(data.action).toBe('dissolution_flag')
    // Default mock returns { results: [] } for any unmatched query — covers
    // the "no staged characters" branch (empty staged_characters, and the
    // narrator_summary's "No characters..." ternary arm).
    expect(data.staged_characters).toEqual([])
    expect(result.flagged[0].narrator_summary).toBe('No characters in active dissolution stages.')
  })

  it('reports staged characters and excludes non-staged ones', async () => {
    mockEnv.RPG_DB = mockDb

    vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
      const mockStmt: any = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(
          query.includes('world_state') ? { current_date: '2187-01-10', weather: null } : null,
        ),
        run: query.includes('world_locks')
          ? vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } })
          : vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        raw: vi.fn().mockResolvedValue([]),
      }

      if (query.includes('characters') && query.includes('death_mode')) {
        mockStmt.all = vi.fn().mockResolvedValue({
          results: [
            {
              id: 'char-staged-1',
              death_mode: 'staged',
              dissolution_stage: 2,
              dissolution_stages: 5,
            },
            {
              // Present in the result set despite the SQL filter (this is a
              // mock, not a real DB) — exercises dissolutionStageCheck's own
              // client-side is_staged guard, not just the SQL WHERE clause.
              id: 'char-not-staged',
              death_mode: 'instant',
              dissolution_stage: null,
              dissolution_stages: null,
            },
          ],
        })
      }

      return mockStmt
    })

    const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['dissolution_flag'],
    })

    expect(result.success).toBe(true)
    const data = result.flagged[0].data as {
      staged_characters: Array<{ id: string; stage: number | null; total_stages: number | null }>
    }
    expect(data.staged_characters).toEqual([
      { id: 'char-staged-1', stage: 2, total_stages: 5 },
    ])
    expect(result.flagged[0].narrator_summary).toBe(
      '1 character(s) in active dissolution stage(s) flagged for review.',
    )
  })

  // ── weather_update / resource_consume hook tests (#629) ─────────────────────

  it('weather_update hook reports a cached forecast for the current world_day', async () => {
    mockEnv.RPG_DB = mockDb

    vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
      const mockStmt: any = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        raw: vi.fn().mockResolvedValue([]),
      }

      if (query.includes('world_state')) {
        mockStmt.first.mockResolvedValue({ current_date: '2187-01-10', world_day: 7 })
      } else if (query.includes('weather_log')) {
        mockStmt.first.mockResolvedValue({ conditions: 'storm', temperature_high: 4, temperature_low: -2 })
      }

      return mockStmt
    })

    const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['weather_update'],
    })

    expect(result.success).toBe(true)
    const data = result.resolved[0].data as Record<string, unknown>
    expect(data.found).toBe(true)
    expect(data.day).toBe(7)
    expect(data.conditions).toBe('storm')
    expect(result.resolved[0].narrator_summary).toContain('storm')
  })

  it('weather_update hook reports a gap when no forecast is cached for the day', async () => {
    mockEnv.RPG_DB = mockDb

    const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
      hooks: ['weather_update'],
    })

    expect(result.success).toBe(true)
    const data = result.resolved[0].data as Record<string, unknown>
    expect(data.found).toBe(false)
    expect(data.day).toBe(0)
    expect(result.resolved[0].narrator_summary).toContain('No weather recorded')
  })

  it('resource_consume hook ticks degradation for every owner at the current world_day', async () => {
    mockEnv.RPG_DB = mockDb

    vi.mocked(mockDb.prepare).mockImplementation((query: string) => {
      const mockStmt: any = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn(),
        run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        raw: vi.fn().mockResolvedValue([]),
      }

      if (query.includes('world_state')) {
        mockStmt.first.mockResolvedValue({ current_date: '2187-01-10', world_day: 12 })
      }

      return mockStmt
    })

    const spy = vi.spyOn(resourceManager, 'tickAllOwnersDegradation').mockResolvedValue([
      {
        ownerType: 'party',
        ownerId: 'party-1',
        spoiled: ['jerky'],
        daysWithoutFood: 0,
        starvation: { deathSaveRequired: false } as any,
      },
      {
        ownerType: 'character',
        ownerId: 'char-1',
        spoiled: [],
        daysWithoutFood: 1,
        starvation: { deathSaveRequired: false } as any,
      },
    ])

    try {
      const result = await runTickDriver(mockEnv, mockDb, 'world-1', '2187-01-10', '2187-01-11', {
        hooks: ['resource_consume'],
      })

      expect(result.success).toBe(true)
      expect(spy).toHaveBeenCalledWith(mockDb, 'world-1', 12)
      const data = result.resolved[0].data as Record<string, unknown>
      expect(data.day).toBe(12)
      expect(Array.isArray(data.results)).toBe(true)
      expect(result.resolved[0].narrator_summary).toBe('2 owner(s) ticked, 1 with spoilage.')
    } finally {
      spy.mockRestore()
    }
  })
})
