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

})
