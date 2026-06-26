import { describe, expect, it } from 'vitest'
import { handle_continuity_manage } from './continuity-manage'

describe('handle_continuity_manage', () => {
  it('returns error when action is missing', async () => {
    const res = (await handle_continuity_manage({
      c: { json: (body: unknown) => body } as any,
      id: '1',
      args: {},
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Missing required param: action')
  })

  it('returns error when action is not a string', async () => {
    const res = (await handle_continuity_manage({
      c: { json: (body: unknown) => body } as any,
      id: '1',
      args: { action: 42 },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toContain('Missing required param: action')
  })

  it('returns error when action is unknown', async () => {
    const res = (await handle_continuity_manage({
      c: { json: (body: unknown) => body } as any,
      id: '1',
      args: { action: 'nope' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeDefined()
    expect(res.error.message).toBe('Unknown action "nope"')
  })

  it('delegates to mapped handler on valid action', async () => {
    const res = (await handle_continuity_manage({
      c: { json: (body: unknown) => body } as any,
      id: 'req-1',
      args: { action: 'list_unpaid_setups' },
      isAuthenticated: false,
    })) as any
    expect(res.error).toBeUndefined()
    expect(res.result).toBeDefined()
  })

  it('strips action from args before delegating', async () => {
    const res = (await handle_continuity_manage({
      c: { json: (body: unknown) => body } as any,
      id: 'x',
      args: { action: 'list_unpaid_setups' },
      isAuthenticated: true,
    })) as any
    expect(res.error).toBeUndefined()
  })

  it('returns JSON with correct status code', async () => {
    const jsonCalls: any[] = []
    const ctx = {
      json: (body: unknown) => {
        jsonCalls.push(body)
        return body
      },
    } as any

    const res = (await handle_continuity_manage({
      c: ctx,
      id: 'err-id',
      args: { action: '' },
      isAuthenticated: false,
    })) as any

    expect(res).toBe(jsonCalls[0])
    expect(jsonCalls.length).toBe(1)
  })
})
