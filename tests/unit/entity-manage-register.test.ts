import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
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

    it('returns undefined for unknown tools', () => {
      expect(getToolHandler('nonexistent_tool_xyz')).toBeUndefined()
    })
  })

  describe('getToolDefinition', () => {
    it('serializes entity_manage to a valid tool definition', () => {
      const def = getToolDefinition('entity_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('entity_manage')
      expect(def!.title).toBe('Entity Manage')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('entity')
      expect(def!.inputSchema).toBeDefined()
    })

    it('returns undefined for unknown tool', () => {
      expect(getToolDefinition('nonexistent_xyz')).toBeUndefined()
    })
  })

  describe('schema serialization', () => {
    it('produces a valid JSON Schema with anyOf branches', () => {
      const def = getToolDefinition('entity_manage')
      const schema = def!.inputSchema as Record<string, unknown>
      expect(schema).toHaveProperty('anyOf')
      const anyOf = schema.anyOf as Array<Record<string, unknown>>
      expect(anyOf.length).toBeGreaterThanOrEqual(19) // all 19 actions
    })

    it('includes all action branches', () => {
      const def = getToolDefinition('entity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const actions = anyOf
        .map((branch: Record<string, unknown>) => {
          const props = branch.properties as Record<string, unknown> | undefined
          const action = props?.action as Record<string, unknown> | undefined
          return action?.const as string | undefined
        })
        .filter(Boolean)
        .sort()
      expect(actions).toEqual([
        'advance_stage',
        'analyze_utility',
        'batch_stage',
        'create_consumption_timeline',
        'destroy',
        'generate',
        'get_attributes',
        'get_compatibility',
        'get_inventory',
        'get_sensory_profile',
        'list_active_threads',
        'list_consumption_timelines',
        'move',
        'resolve_interaction',
        'roll_encounter',
        'set_attributes',
        'set_consumption_timeline',
        'set_sensory_profile',
        'transfer_item',
      ])
    })

    it('includes enum for utility_vector', () => {
      const def = getToolDefinition('entity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const auBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'analyze_utility'
      })
      const props = auBranch!.properties as Record<string, unknown>
      const uv = props.utility_vector as Record<string, unknown>
      expect(uv).toHaveProperty('enum')
      expect(uv.enum).toEqual([
        'GASTRIC',
        'BUTCHERY',
        'INCUBATION',
        'SCULPTURE',
        'PARASITISM',
        'THRALL',
        'DISTRIBUTED',
      ])
    })

    it('list_active_threads has no required fields beyond action', () => {
      const def = getToolDefinition('entity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const latBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'list_active_threads'
      })
      const required = (latBranch!.required as string[]) || []
      expect(required).toEqual(['action'])
    })

    it('transfer_item has optional quantity', () => {
      const def = getToolDefinition('entity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const tiBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'transfer_item'
      })
      const required = (tiBranch!.required as string[]) || []
      expect(required).toContain('from_entity')
      expect(required).toContain('to_entity')
      expect(required).toContain('item_key')
      expect(required.includes('quantity')).toBe(false)
    })
  })

  describe('getTools', () => {
    it('includes entity_manage in the registered tool list', () => {
      const tools = getTools()
      const entityManage = tools.find((t) => t.name === 'entity_manage')
      expect(entityManage).toBeDefined()
      expect(entityManage!.category).toBe('lore')
    })
  })
})
