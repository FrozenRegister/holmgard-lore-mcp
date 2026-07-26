import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition, toJsonSchema } from '../../src/tools/register'
import { registerLoadToolSchemaTool } from '../../src/rpg/register-load-tool-schema'

describe('load_tool_schema registration (Phase 3 #544)', () => {
  beforeAll(() => {
    registerLoadToolSchemaTool()
  })

  it('getToolHandler resolves load_tool_schema', () => {
    const handler = getToolHandler('load_tool_schema')
    expect(handler).toBeDefined()
    expect(typeof handler).toBe('function')
  })

  it('getToolDefinition returns correct shape', () => {
    const def = getToolDefinition('load_tool_schema')
    expect(def).toBeDefined()
    expect(def!.name).toBe('load_tool_schema')
    expect(def!.title).toBe('Load Tool Schema')
    expect(def!.category).toBe('rpg')
    expect(def!.version).toBe('1.0.0')
    expect(def!.description).toBeTruthy()
  })

  it('toJsonSchema includes toolName and optional sub', () => {
    const tool = getToolHandler('load_tool_schema')
    const schema = toJsonSchema({ inputSchema: {} as any, handler: tool! } as any)
    expect(schema.type).toBe('object')
    expect(schema.properties.toolName).toBeDefined()
    expect(schema.properties.sub).toBeDefined()
    expect(schema.required).toContain('toolName')
  })

  it('getToolDefinition.description is non-empty', () => {
    const def = getToolDefinition('load_tool_schema')
    expect(def!.description.length).toBeGreaterThan(10)
  })
})
