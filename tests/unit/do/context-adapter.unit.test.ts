import { describe, it, expect } from 'vitest'
import { makeSyntheticContext } from '@/do/context-adapter'

describe('makeSyntheticContext (#620)', () => {
  it('reads real header values when a Headers object is provided', () => {
    const headers = new Headers({ 'X-Api-Key': 'secret-123', 'X-Trace-Id': 'trace-abc' })
    const c = makeSyntheticContext({} as never, headers)

    expect(c.req.header('X-Api-Key')).toBe('secret-123')
    expect(c.req.header('X-Trace-Id')).toBe('trace-abc')
  })

  it('is case-insensitive, matching Headers/Hono semantics', () => {
    const headers = new Headers({ 'X-Api-Key': 'secret-123' })
    const c = makeSyntheticContext({} as never, headers)

    expect(c.req.header('x-api-key')).toBe('secret-123')
  })

  it('returns null for a header absent from the provided Headers', () => {
    const headers = new Headers({ 'X-Api-Key': 'secret-123' })
    const c = makeSyntheticContext({} as never, headers)

    expect(c.req.header('X-Missing')).toBeNull()
  })

  it('returns null for every header when no Headers object is provided', () => {
    const c = makeSyntheticContext({} as never)

    expect(c.req.header('X-Api-Key')).toBeNull()
  })

  it('json() wraps data as an application/json Response', async () => {
    const c = makeSyntheticContext({} as never)
    const res = c.json({ ok: true })

    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(await res.json()).toEqual({ ok: true })
  })
})
