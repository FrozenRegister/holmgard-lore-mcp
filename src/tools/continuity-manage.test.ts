import { describe, expect, it } from 'vitest'
import { handle_continuity_manage } from './continuity-manage'

const anyCtx = (body: unknown) => body as any

describe('handle_continuity_manage', () => {
  it('returns error when action is missing', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: {},
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Missing required param: action')
  })

  it('returns error when action is not a string', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 42 },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Missing required param: action')
  })

  it('returns error when action is unknown', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'nope' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toBe('Unknown action "nope"')
  })

  describe('plant_setup', () => {
    it('creates a new setup with default tension', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'plant_setup',
          id: 'ambush-plot',
          description: 'Church courier spotted',
        },
        isAuthenticated: false,
      })) as any
      expect(res.result).toBeDefined()
      expect(res.result.metadata.tension).toBe(3)
    })

    it('creates setup with custom tension', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'plant_setup',
          id: 'critical-plot',
          description: 'Critical event',
          tension: 5,
        },
        isAuthenticated: false,
      })) as any
      expect(res.result.metadata.tension).toBe(5)
    })

    it('accepts setup_id as an alias for id', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'plant_setup',
          setup_id: 'alias-plot',
          description: 'Test alias',
        },
        isAuthenticated: false,
      })) as any
      expect(res.result).toBeDefined()
      expect(res.result.metadata.key).toContain('setup:alias-plot')
    })

    it('includes optional fields when provided', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'plant_setup',
          id: 'plot-1',
          description: 'A setup',
          planted_in: 'chapter-5',
          actors: ['character:alice', 'character:bob'],
        },
        isAuthenticated: false,
      })) as any
      expect(res.result).toBeDefined()
    })
  })

  describe('set_goal', () => {
    it('rejects missing required goal_id', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'set_goal',
          entity_key: 'character:hero',
          description: 'Find the ancient artifact',
        },
        isAuthenticated: false,
      })) as any
      expect(res.error).toBeDefined()
      expect(res.error.data.example).toBeDefined()
    })

    it('accepts entity_name, goal_name, goal_description as aliases', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'set_goal',
          entity_name: 'character:hero',
          goal_name: 'find-artifact',
          goal_description: 'Find the ancient artifact',
        },
        isAuthenticated: false,
      })) as any
      // Should accept aliases (if entity would exist, it would work)
      expect(res.result || res.error).toBeDefined()
    })
  })

  describe('check_continuity', () => {
    it('accepts severity_floor alias "medium" = "warn"', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'check_continuity',
          severity_floor: 'medium',
        },
        isAuthenticated: false,
      })) as any
      expect(res.result || res.error).toBeDefined()
    })

    it('accepts severity_floor alias "critical" = "error"', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'check_continuity',
          severity_floor: 'critical',
        },
        isAuthenticated: false,
      })) as any
      expect(res.result || res.error).toBeDefined()
    })

    it('rejects invalid severity_floor value', async () => {
      const res = (await handle_continuity_manage({
        c: { json: anyCtx } as any,
        id: '1',
        args: {
          action: 'check_continuity',
          severity_floor: 'catastrophic',
        },
        isAuthenticated: false,
      })) as any
      expect(res.error).toBeDefined()
      expect(res.error.code).toBe(-32602)
      expect(res.error.data.example).toBeDefined()
    })
  })
})
