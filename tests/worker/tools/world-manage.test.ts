import { describe, expect, it } from 'vitest'
import { handle_world_manage } from '@/tools/world-manage'

const anyCtx = (body: unknown) => body as any

describe('handle_world_manage', () => {
  it('rejects missing action', async () => {
    const res = (await handle_world_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: {},
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Missing required param: action')
  })

  it('rejects unknown action', async () => {
    const res = (await handle_world_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 'nope' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toBe('Unknown action "nope"')
  })

  it('rejects non-string action', async () => {
    const res = (await handle_world_manage({
      c: { json: anyCtx } as any,
      id: '1',
      args: { action: 7 },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
  })

  it('accepts valid action and forwards args', async () => {
    const res = (await handle_world_manage({
      c: { json: anyCtx } as any,
      id: 'x',
      args: { action: 'get_world_state' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeUndefined()
  })
})
