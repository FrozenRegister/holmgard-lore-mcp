import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition } from '../../src/tools/register'
import { registerSearchToolsTool } from '../../src/rpg/register-search-tools'

describe('search_tools registration (Phase 3 #544)', () => {
  beforeAll(() => {
    try {
      registerSearchToolsTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  it('getToolHandler resolves search_tools', () => {
    const handler = getToolHandler('search_tools')
    expect(handler).toBeDefined()
    expect(typeof handler).toBe('function')
  })

  it('getToolDefinition returns correct shape', () => {
    const def = getToolDefinition('search_tools')
    expect(def).toBeDefined()
    expect(def!.name).toBe('search_tools')
    expect(def!.title).toBe('Search Tools')
    expect(def!.version).toBe('1.0.0')
    expect(def!.description).toBeTruthy()
  })

  it('toJsonSchema includes query and limit', () => {
    const def = getToolDefinition('search_tools')
    const schema = def!.inputSchema
    expect(schema.type).toBe('object')
    const props = schema.properties as Record<string, unknown>
    expect(props.query).toBeDefined()
    expect(props.limit).toBeDefined()
    expect(schema.required).toContain('query')
  })

  it('getToolDefinition.description is non-empty', () => {
    const def = getToolDefinition('search_tools')
    expect(def!.description.length).toBeGreaterThan(10)
  })
})
