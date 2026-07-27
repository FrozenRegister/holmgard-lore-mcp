import { describe, it, expect } from 'vitest'
import { dispatchToolCall } from '../../src/tools/dispatch'

describe('dispatchToolCall', () => {
  it('short-circuits ping with pong content and internal metadata', () => {
    const result = dispatchToolCall({
      name: 'lore_manage',
      args: { action: 'ping' },
      authenticated: false,
    })
    expect(result.kind).toBe('short-circuit')
    if (result.kind === 'short-circuit') {
      expect(result.content).toEqual({ type: 'text', text: 'pong' })
      expect(result.metadata).toEqual({ source: 'internal' })
    }
  })

  it('short-circuits auth_check with authenticated=true', () => {
    const result = dispatchToolCall({
      name: 'lore_manage',
      args: { action: 'auth_check' },
      authenticated: true,
    })
    expect(result.kind).toBe('short-circuit')
    if (result.kind === 'short-circuit') {
      expect(result.content.text).toContain('Authenticated')
      expect(result.metadata?.authenticated).toBe(true)
    }
  })

  it('short-circuits auth_check with authenticated=false', () => {
    const result = dispatchToolCall({
      name: 'lore_manage',
      args: { action: 'auth_check' },
      authenticated: false,
    })
    expect(result.kind).toBe('short-circuit')
    if (result.kind === 'short-circuit') {
      expect(result.content.text).toContain('Not authenticated')
      expect(result.metadata?.authenticated).toBe(false)
    }
  })

  it('returns handler for known tool (entity_manage)', () => {
    const result = dispatchToolCall({
      name: 'entity_manage',
      args: { action: 'get' },
      authenticated: true,
    })
    expect(result.kind).toBe('handler')
    if (result.kind === 'handler') {
      expect(typeof result.handler).toBe('function')
    }
  })

  it('returns not-found for unknown tool', () => {
    const result = dispatchToolCall({
      name: 'nonexistent_tool',
      args: {},
      authenticated: true,
    })
    expect(result.kind).toBe('not-found')
    if (result.kind === 'not-found') {
      expect(result.toolName).toBe('nonexistent_tool')
    }
  })
})
