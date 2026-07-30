import { describe, it, expect } from 'vitest'
import {
  dispatchToolCall,
  type DispatchResult,
  type DispatchShortCircuit,
  type DispatchHandler,
  type DispatchNotFound,
} from '../../src/tools/dispatch'
import { toolRegistry } from '../../src/tools/registry'

describe('dispatchToolCall', () => {
  describe('ping special-case', () => {
    it('short-circuits lore_manage ping when authenticated', () => {
      const result = dispatchToolCall(
        'lore_manage',
        { action: 'ping' },
        { authenticated: true },
      )

      expect(result.kind).toBe('short-circuit')
      const shortCircuit = result as DispatchShortCircuit
      expect(shortCircuit.content).toEqual([{ type: 'text', text: 'pong' }])
      expect(shortCircuit.metadata.source).toBe('internal')
    })

    it('short-circuits lore_manage ping when not authenticated', () => {
      const result = dispatchToolCall(
        'lore_manage',
        { action: 'ping' },
        { authenticated: false },
      )

      expect(result.kind).toBe('short-circuit')
      const shortCircuit = result as DispatchShortCircuit
      expect(shortCircuit.content).toEqual([{ type: 'text', text: 'pong' }])
      expect(shortCircuit.metadata.source).toBe('internal')
    })
  })

  describe('auth_check special-case', () => {
    it('short-circuits auth_check with success message when authenticated', () => {
      const result = dispatchToolCall(
        'lore_manage',
        { action: 'auth_check' },
        { authenticated: true },
      )

      expect(result.kind).toBe('short-circuit')
      const shortCircuit = result as DispatchShortCircuit
      expect(shortCircuit.content).toEqual([
        { type: 'text', text: 'Authenticated.' },
      ])
      expect(shortCircuit.metadata.authenticated).toBe(true)
    })

    it('short-circuits auth_check with failure message when not authenticated', () => {
      const result = dispatchToolCall(
        'lore_manage',
        { action: 'auth_check' },
        { authenticated: false },
      )

      expect(result.kind).toBe('short-circuit')
      const shortCircuit = result as DispatchShortCircuit
      expect(shortCircuit.content).toEqual([
        {
          type: 'text',
          text: 'Not authenticated — request was made without a valid API key.',
        },
      ])
      expect(shortCircuit.metadata.authenticated).toBe(false)
    })
  })

  describe('registry fallthrough for lore_manage', () => {
    it('falls through to registry when lore_manage action is not ping or auth_check', () => {
      const result = dispatchToolCall(
        'lore_manage',
        { action: 'get' },
        { authenticated: true },
      )

      expect(result.kind).toBe('handler')
      const handler = result as DispatchHandler
      expect(typeof handler.handler).toBe('function')
      expect(handler.handler).toBe(toolRegistry['lore_manage'])
    })

    it('falls through to registry when lore_manage action is missing', () => {
      const result = dispatchToolCall('lore_manage', {}, { authenticated: true })

      expect(result.kind).toBe('handler')
      const handler = result as DispatchHandler
      expect(handler.handler).toBe(toolRegistry['lore_manage'])
    })

    it('falls through to registry when lore_manage action is not a string', () => {
      const result = dispatchToolCall(
        'lore_manage',
        { action: 123 },
        { authenticated: false },
      )

      expect(result.kind).toBe('handler')
      const handler = result as DispatchHandler
      expect(handler.handler).toBe(toolRegistry['lore_manage'])
    })
  })

  describe('handler lookup in registry', () => {
    it('returns handler for known tool in registry', () => {
      const result = dispatchToolCall(
        'entity_manage',
        { action: 'list' },
        { authenticated: true },
      )

      expect(result.kind).toBe('handler')
      const handler = result as DispatchHandler
      expect(typeof handler.handler).toBe('function')
      expect(handler.handler).toBe(toolRegistry['entity_manage'])
    })

    it('returns handler for another known tool in registry', () => {
      const result = dispatchToolCall(
        'world_manage',
        {},
        { authenticated: false },
      )

      expect(result.kind).toBe('handler')
      const handler = result as DispatchHandler
      expect(handler.handler).toBe(toolRegistry['world_manage'])
    })
  })

  describe('not-found case', () => {
    it('returns not-found for unknown tool', () => {
      const result = dispatchToolCall(
        'totally_not_a_real_tool',
        {},
        { authenticated: true },
      )

      expect(result.kind).toBe('not-found')
      const notFound = result as DispatchNotFound
      expect(notFound.toolName).toBe('totally_not_a_real_tool')
    })

    it('returns not-found for unknown tool even with valid args', () => {
      const result = dispatchToolCall(
        'nonexistent_tool_xyz',
        { action: 'get', some: 'arg' },
        { authenticated: false },
      )

      expect(result.kind).toBe('not-found')
      const notFound = result as DispatchNotFound
      expect(notFound.toolName).toBe('nonexistent_tool_xyz')
    })
  })
})
