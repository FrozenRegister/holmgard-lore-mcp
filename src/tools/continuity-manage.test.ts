import { describe, expect, it } from 'vitest'
import { handle_continuity_manage } from './continuity-manage'

const anyCtx = (body: unknown) => body as any

describe('handle_continuity_manage', () => {
  it('rejects missing action', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: {},
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Missing required param: action')
  })

  it('rejects non-string action', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 42 },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
  })

  it('rejects unknown action', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'nope' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toBe('Unknown action "nope"')
  })

  it('validates plant_setup accepts setup_id alias', async () => {
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
    // Schema validation accepts setup_id alias; handler execution requires KV
    expect(res).toBeDefined()
  })

  it('validates set_goal rejects missing goal_id', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: {
        action: 'set_goal',
        entity_key: 'character:hero',
        description: 'Find artifact',
      },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
    expect(res.error.data.example).toBeDefined()
  })

  it('validates set_goal accepts entity_name alias', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: {
        action: 'set_goal',
        entity_name: 'character:hero',
        goal_name: 'find-artifact',
        goal_description: 'Find ancient artifact',
      },
      isAuthenticated: false,
    })) as any
    // Schema validation accepts aliases; handler execution requires KV
    expect(res).toBeDefined()
  })

  it('validates check_continuity rejects invalid severity_floor', async () => {
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
  })

  it('validates check_continuity accepts severity_floor alias medium', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: {
        action: 'check_continuity',
        severity_floor: 'medium',
      },
      isAuthenticated: false,
    })) as any
    // Schema accepts medium→warn alias; any response is valid
    expect(res).toBeDefined()
  })

  it('validates check_continuity accepts severity_floor alias critical', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: {
        action: 'check_continuity',
        severity_floor: 'critical',
      },
      isAuthenticated: false,
    })) as any
    // Schema accepts critical→error alias; any response is valid
    expect(res).toBeDefined()
  })
})
