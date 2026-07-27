import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition } from '../../src/tools/register'
import { registerEntityManageTool } from '../../src/tools/register-entity-manage'

describe('entity_manage registration (Phase 4 #545)', () => {
  beforeAll(() => {
    try {
      registerEntityManageTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves entity_manage to a ToolHandler function', () => {
      const handler = getToolHandler('entity_manage')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })
  })

  describe('getToolDefinition', () => {
    it('serializes entity_manage to a valid tool definition', () => {
      const def = getToolDefinition('entity_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('entity_manage')
      expect(def!.title).toBe('Entity Manage')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('Entity lifecycle')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
    })

    it('includes action field in the schema', () => {
      const def = getToolDefinition('entity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('action')
    })

    it('marks action as required', () => {
      const def = getToolDefinition('entity_manage')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('action')
    })

    it('includes entity_key field', () => {
      const def = getToolDefinition('entity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('entity_key')
    })

    it('includes archetype_key field for generate', () => {
      const def = getToolDefinition('entity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('archetype_key')
    })

    it('includes utility_vector enum field for analyze_utility', () => {
      const def = getToolDefinition('entity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('utility_vector')
    })

    it('includes attributes record field for set_attributes', () => {
      const def = getToolDefinition('entity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('attributes')
    })
  })
})
