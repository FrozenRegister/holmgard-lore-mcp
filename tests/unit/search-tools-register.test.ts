import { describe, it, expect, beforeAll } from 'vitest'
import {
  getToolHandler,
  getToolDefinition,
  toJsonSchema,
} from '../../src/tools/register'
import { registerSearchToolsTool } from '../../src/rpg/register-search-tools'

describe('search_tools registration (Phase 3 #544)', () => {
  beforeAll(() => {
    registerSearchToolsTool()
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
    expect(def!.category).toBe('rpg')
    expect(def!.version).toBe('1.0.0')
    expect(def!.description).toBeTruthy()
  })

  it('toJsonSchema includes query and limit', () => {
    const tool = getToolHandler('search_tools')
    const schema = toJsonSchema({ inputSchema: {} as any, handler: tool! } as any)
    expect(schema.type).toBe('object')
    expect(schema.properties.query).toBeDefined()
    expect(schema.properties.limit).toBeDefined()
    expect(schema.required).toContain('query')
  })

  it('getToolDefinition.description is non-empty', () => {
    const def = getToolDefinition('search_tools')
    expect(def!.description.length).toBeGreaterThan(10)
  })
})
