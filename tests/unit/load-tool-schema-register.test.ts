import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
import { registerLoadToolSchemaTool } from '../../src/rpg/register-load-tool-schema'
import { setSchemaIndex, registerRpgSubSchema } from '../../src/rpg/handlers/load-tool-schema'
import { handleLoadToolSchema } from '../../src/rpg/handlers/load-tool-schema'

describe('load_tool_schema registration (Phase 3 #544)', () => {
  beforeAll(() => {
    try {
      registerLoadToolSchemaTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves load_tool_schema to a ToolHandler function', () => {
      const handler = getToolHandler('load_tool_schema')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('returns undefined for unknown tools', () => {
      expect(getToolHandler('nonexistent_tool_xyz')).toBeUndefined()
    })
  })

  describe('getToolDefinition', () => {
    it('serializes load_tool_schema to a valid tool definition', () => {
      const def = getToolDefinition('load_tool_schema')
      expect(def).toBeDefined()
      expect(def!.name).toBe('load_tool_schema')
      expect(def!.title).toBe('Load Tool Schema')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('JSON schema')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
      expect(def!.inputSchema).toHaveProperty('properties')
    })

    it('includes toolName and sub fields in the schema', () => {
      const def = getToolDefinition('load_tool_schema')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('toolName')
      expect(props).toHaveProperty('sub')
    })

    it('returns undefined for unknown tool', () => {
      expect(getToolDefinition('nonexistent_xyz')).toBeUndefined()
    })
  })

  describe('schema serialization', () => {
    it('produces a valid JSON Schema from InputSchema', () => {
      const def = getToolDefinition('load_tool_schema')
      expect(def).toBeDefined()
      expect(def!.inputSchema).toHaveProperty('type', 'object')
      expect(def!.inputSchema).toHaveProperty('properties')
    })

    it('marks toolName as required', () => {
      const def = getToolDefinition('load_tool_schema')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('toolName')
    })

    it('treats sub as optional', () => {
      const def = getToolDefinition('load_tool_schema')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required.includes('sub')).toBe(false)
    })
  })

  describe('getTools', () => {
    it('includes load_tool_schema in the registered tools list', () => {
      const tools = getTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('load_tool_schema')
    })
  })

  describe('invoke handler (no D1 — in-memory index)', () => {
    beforeEach(() => {
      setSchemaIndex([
        {
          name: 'character_manage',
          description: 'Character CRUD and management',
          inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
        },
        {
          name: 'agent_manage',
          description: 'NPC AI agent management',
          inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
        },
      ])
    })

    it('returns the schema for a known tool', async () => {
      const result = await handleLoadToolSchema({} as any, { toolName: 'character_manage' })
      const body = JSON.parse(result.content[0].text)
      expect(body.success).toBe(true)
      expect(body.toolName).toBe('character_manage')
      expect(body.schema).toBeDefined()
      expect(body.schema.description).toBe('Character CRUD and management')
    })

    it('returns did_you_mean suggestions for an unknown tool', async () => {
      const result = await handleLoadToolSchema({} as any, { toolName: 'charactr' })
      const body = JSON.parse(result.content[0].text)
      expect(body.error).toBeDefined()
      expect(body.didYouMean).toBeDefined()
      expect(Array.isArray(body.didYouMean)).toBe(true)
    })

    it('returns an error when schema index is not initialized', async () => {
      setSchemaIndex(null as any)
      const result = await handleLoadToolSchema({} as any, { toolName: 'character_manage' })
      const body = JSON.parse(result.content[0].text)
      expect(body.error).toBeDefined()
    })

    it('returns rpg sub-level schema when sub is specified', async () => {
      registerRpgSubSchema('corpse', 'Corpse management', { type: 'object' })
      const result = await handleLoadToolSchema({} as any, { toolName: 'rpg', sub: 'corpse' })
      const body = JSON.parse(result.content[0].text)
      expect(body.success).toBe(true)
      expect(body.sub).toBe('corpse')
      expect(body.schema).toBeDefined()
    })

    it('returns did_you_mean for unknown rpg sub', async () => {
      registerRpgSubSchema('corpse', 'Corpse management', { type: 'object' })
      const result = await handleLoadToolSchema({} as any, { toolName: 'rpg', sub: 'corp' })
      const body = JSON.parse(result.content[0].text)
      expect(body.error).toBeDefined()
      expect(body.didYouMean).toBeDefined()
    })
  })
})
