import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition } from '../../src/tools/register'
import { registerContinuityManageTool } from '../../src/tools/register-continuity-manage'

describe('continuity_manage registration (Phase 4 #545)', () => {
  beforeAll(() => {
    try {
      registerContinuityManageTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves continuity_manage to a ToolHandler function', () => {
      const handler = getToolHandler('continuity_manage')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })
  })

  describe('getToolDefinition', () => {
    it('serializes continuity_manage to a valid tool definition', () => {
      const def = getToolDefinition('continuity_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('continuity_manage')
      expect(def!.title).toBe('Continuity Manage')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('Continuity tracking')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
    })

    it('includes action field in the schema', () => {
      const def = getToolDefinition('continuity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('action')
    })

    it('marks action as required', () => {
      const def = getToolDefinition('continuity_manage')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('action')
    })

    it('includes entity_key field for append_event', () => {
      const def = getToolDefinition('continuity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('entity_key')
    })

    it('includes verb field for append_event', () => {
      const def = getToolDefinition('continuity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('verb')
    })

    it('includes id and setup_id fields for plant_setup', () => {
      const def = getToolDefinition('continuity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('id')
      expect(props).toHaveProperty('setup_id')
    })

    it('includes tags array for find_by_tag', () => {
      const def = getToolDefinition('continuity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('tags')
    })

    it('includes goal_id and goal_name fields for set_goal', () => {
      const def = getToolDefinition('continuity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('goal_id')
      expect(props).toHaveProperty('goal_name')
    })

    it('includes description and goal_description fields for set_goal', () => {
      const def = getToolDefinition('continuity_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('description')
      expect(props).toHaveProperty('goal_description')
    })
  })
})
