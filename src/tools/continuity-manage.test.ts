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

  it('validates tag_topic accepts valid params', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'tag_topic', key: 'topic:x', add: ['tag1'] },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates find_by_tag accepts tags', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'find_by_tag', tags: ['tag1'], mode: 'any' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates find_by_tag rejects empty tags', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'find_by_tag', tags: [] },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates list_tags accepts no params', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'list_tags' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates bookmark_state requires name', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'bookmark_state' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates bookmark_state accepts name', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'bookmark_state', name: 'state-1' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates world_diff requires from', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'world_diff', to: 'state-2' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates world_diff accepts from', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'world_diff', from: 'state-1' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates plant_setup requires description', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'plant_setup', id: 'setup-1' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates plant_setup accepts setup_id alias for id', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'plant_setup', setup_id: 'setup-1', description: 'Test setup' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates plant_setup rejects invalid tension', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'plant_setup', id: 'setup-1', description: 'Test', tension: 10 },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates pay_off_setup requires resolution', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'pay_off_setup', id: 'setup-1' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates pay_off_setup accepts valid params', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'pay_off_setup', id: 'setup-1', resolution: 'Resolved' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates list_unpaid_setups accepts no params', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'list_unpaid_setups' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates list_unpaid_setups rejects invalid scope', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'list_unpaid_setups', scope: 'invalid' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates set_goal rejects missing goal_id', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'set_goal', entity_key: 'char:x', description: 'Goal' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates set_goal accepts entity_name alias for entity_key', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'set_goal', entity_name: 'char:x', goal_name: 'goal-1', goal_description: 'Goal' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates set_goal rejects invalid status', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'set_goal', entity_key: 'char:x', goal_id: 'goal-1', description: 'Goal', status: 'invalid' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates check_continuity accepts severity_floor low', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'check_continuity', severity_floor: 'low' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates check_continuity accepts severity_floor medium (alias)', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'check_continuity', severity_floor: 'medium' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates check_continuity accepts severity_floor critical (alias)', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'check_continuity', severity_floor: 'critical' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })

  it('validates check_continuity rejects invalid severity_floor', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'check_continuity', severity_floor: 'catastrophic' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates check_continuity rejects invalid checks', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'check_continuity', checks: ['invalid-check'] },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.code).toBe(-32602)
  })

  it('validates append_event accepts date as alias for at', async () => {
    const res = (await handle_continuity_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'append_event', entity_key: 'char:x', verb: 'left', date: '2025-01-01', description: 'Departed' },
      isAuthenticated: false,
    })) as any
    expect(res).toBeDefined()
  })
})
