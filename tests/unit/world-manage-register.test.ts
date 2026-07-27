import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition } from '../../src/tools/register'
import { registerWorldManageTool } from '../../src/tools/register-world-manage'

describe('world_manage registration (Phase 4 #545)', () => {
  beforeAll(() => {
    try {
      registerWorldManageTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves world_manage to a ToolHandler function', () => {
      const handler = getToolHandler('world_manage')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })
  })

  describe('getToolDefinition', () => {
    it('serializes world_manage to a valid tool definition', () => {
      const def = getToolDefinition('world_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('world_manage')
      expect(def!.title).toBe('World Manage')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('World state')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
    })

    it('includes action field in the schema', () => {
      const def = getToolDefinition('world_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('action')
    })

    it('marks action as required', () => {
      const def = getToolDefinition('world_manage')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('action')
    })

    it('includes thread_id field for thread_tick', () => {
      const def = getToolDefinition('world_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('thread_id')
    })

    it('includes entity_key and entity_name fields for get_faction_standing', () => {
      const def = getToolDefinition('world_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('entity_key')
      expect(props).toHaveProperty('entity_name')
    })

    it('includes faction_key and faction_name fields', () => {
      const def = getToolDefinition('world_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('faction_key')
      expect(props).toHaveProperty('faction_name')
    })

    it('includes location_key and location_id fields for get_location_occupants', () => {
      const def = getToolDefinition('world_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('location_key')
      expect(props).toHaveProperty('location_id')
    })

    it('includes topic field for get_entity_knowledge', () => {
      const def = getToolDefinition('world_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('topic')
    })
  })
})
