import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
import { registerSceneManageTool } from '../../src/tools/register-scene-manage'

describe('scene_manage registration (Phase 4 #545)', () => {
  beforeAll(() => {
    try {
      registerSceneManageTool()
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message?.includes('already registered')) {
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
      expect(def!.inputSchema).toBeDefined()
    })
  })

  describe('schema serialization', () => {
    it('includes all 6 action branches', () => {
      const def = getToolDefinition('scene_manage')
      const anyOf = def!.inputSchema.oneOf as Array<Record<string, unknown>>
      const actions = anyOf
        .map((branch: Record<string, unknown>) => {
          const props = branch.properties as Record<string, unknown> | undefined
          const action = props?.action as Record<string, unknown> | undefined
          return action?.const as string | undefined
        })
        .filter(Boolean)
        .sort()
      expect(actions).toEqual([
        'activate',
        'brief',
        'commit_choice',
        'get_history',
        'present_choices',
        'render_pov',
      ])
    })

    it('activate requires scene_key', () => {
      const def = getToolDefinition('scene_manage')
      const anyOf = def!.inputSchema.oneOf as Array<Record<string, unknown>>
      const actBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'activate'
      })
      const required = (actBranch!.required as string[]) || []
      expect(required).toContain('scene_key')
    })

    it('render_pov has optional scene_key and location_key', () => {
      const def = getToolDefinition('scene_manage')
      const anyOf = def!.inputSchema.oneOf as Array<Record<string, unknown>>
      const rpBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'render_pov'
      })
      const required = (rpBranch!.required as string[]) || []
      expect(required).toContain('pov_entity_key')
      expect(required.includes('scene_key')).toBe(false)
      expect(required.includes('location_key')).toBe(false)
    })

    it('brief has nested include object', () => {
      const def = getToolDefinition('scene_manage')
      const anyOf = def!.inputSchema.oneOf as Array<Record<string, unknown>>
      const briefBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'brief'
      })
      const props = briefBranch!.properties as Record<string, unknown>
      expect(props).toHaveProperty('include')
      const include = props.include as Record<string, unknown>
      expect(include).toHaveProperty('properties')
    })

    it('render_pov includes reveal_threshold with min/max', () => {
      const def = getToolDefinition('scene_manage')
      const anyOf = def!.inputSchema.oneOf as Array<Record<string, unknown>>
      const rpBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'render_pov'
      })
      const props = rpBranch!.properties as Record<string, unknown>
      expect(props).toHaveProperty('reveal_threshold')
      const rt = props.reveal_threshold as Record<string, unknown>
      expect(rt).toHaveProperty('minimum', 0)
      expect(rt).toHaveProperty('maximum', 1)
    })
  })

  describe('getTools', () => {
    it('includes scene_manage in the registered tool list', () => {
      const tools = getTools()
      const sceneManage = tools.find((t) => t.name === 'scene_manage')
      expect(sceneManage).toBeDefined()
      expect(sceneManage!.category).toBe('lore')
    })
  })
})
