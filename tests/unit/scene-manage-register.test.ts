import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition } from '../../src/tools/register'
import { registerSceneManageTool } from '../../src/tools/register-scene-manage'

describe('scene_manage registration (Phase 4 #545)', () => {
  beforeAll(() => {
    try {
      registerSceneManageTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves scene_manage to a ToolHandler function', () => {
      const handler = getToolHandler('scene_manage')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })
  })

  describe('getToolDefinition', () => {
    it('serializes scene_manage to a valid tool definition', () => {
      const def = getToolDefinition('scene_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('scene_manage')
      expect(def!.title).toBe('Scene Manage')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('Scene management')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
    })

    it('includes action field in the schema', () => {
      const def = getToolDefinition('scene_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('action')
    })

    it('marks action as required', () => {
      const def = getToolDefinition('scene_manage')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('action')
    })

    it('includes scene_key field', () => {
      const def = getToolDefinition('scene_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('scene_key')
    })

    it('includes entity_key field', () => {
      const def = getToolDefinition('scene_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('entity_key')
    })

    it('includes choice_id field for commit_choice', () => {
      const def = getToolDefinition('scene_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('choice_id')
    })

    it('includes reveal_threshold field for render_pov', () => {
      const def = getToolDefinition('scene_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('reveal_threshold')
    })
  })
})
