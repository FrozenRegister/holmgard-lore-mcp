import { describe, expect, it } from 'vitest'
import { makeError, makeResult, validateRequest } from '@/lib/rpc'

describe('makeResult', () => {
  it('builds a successful JSON-RPC response', () => {
    const res = makeResult('req-1', { ok: true })
    expect(res).toEqual({ jsonrpc: '2.0', id: 'req-1', result: { ok: true } })
  })
})

describe('makeError', () => {
  it('builds an error JSON-RPC response', () => {
    const res = makeError('req-1', -32600, 'bad request')
    expect(res).toEqual({ jsonrpc: '2.0', id: 'req-1', error: { code: -32600, message: 'bad request', data: undefined } })
  })

  it('includes optional data', () => {
    const res = makeError(null, -32601, 'not found', { hint: 'try /ping' })
    expect(res.error!.data).toEqual({ hint: 'try /ping' })
  })

  it('defaults id to passed value', () => {
    const res = makeError(42, 0, 'ok')
    expect(res.id).toBe(42)
  })
})

describe('validateRequest', () => {
  const errorBody = (r: { ok: false; error: ReturnType<typeof makeError> }) =>
    (r.error as { error: { message: string } }).error.message

  it('rejects null body', () => {
    const r = validateRequest(null)
    expect(r.ok).toBe(false)
    expect(errorBody(r as any)).toContain('empty body')
  })

  it('rejects undefined body', () => {
    const r = validateRequest(undefined)
    expect(r.ok).toBe(false)
  })

  it('rejects arrays (batch requests)', () => {
    const r = validateRequest([{ jsonrpc: '2.0', method: 'ping' }])
    expect(r.ok).toBe(false)
    expect(errorBody(r as any)).toContain('Batch')
  })

  it('rejects missing jsonrpc version', () => {
    const r = validateRequest({ method: 'ping' })
    expect(r.ok).toBe(false)
    expect(errorBody(r as any)).toContain('jsonrpc must be')
  })

  it('rejects wrong jsonrpc version', () => {
    const r = validateRequest({ jsonrpc: '1.0', method: 'ping' })
    expect(r.ok).toBe(false)
  })

  it('rejects missing method', () => {
    const r = validateRequest({ jsonrpc: '2.0' })
    expect(r.ok).toBe(false)
    expect(errorBody(r as any)).toContain('method missing')
  })

  it('rejects non-string method', () => {
    const r = validateRequest({ jsonrpc: '2.0', method: 7 })
    expect(r.ok).toBe(false)
  })

  it('accepts valid request', () => {
    const r = validateRequest({ jsonrpc: '2.0', method: 'ping', id: '1' })
    expect(r.ok).toBe(true)
    expect((r as any).req.method).toBe('ping')
  })

  it('falls back id to null when missing', () => {
    const r = validateRequest({ jsonrpc: '2.0', method: 'ping' })
    expect((r as any).req.id).toBeUndefined()
  })
})
