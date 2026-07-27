import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
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
      expect(def!.inputSchema).toBeDefined()
    })
  })

  describe('schema serialization', () => {
    it('produces a valid JSON Schema with anyOf (top-level union)', () => {
      const def = getToolDefinition('world_manage')
      const schema = def!.inputSchema as Record<string, unknown>
      expect(schema).toHaveProperty('anyOf')
    })

    it('includes thread_tick as a simple branch', () => {
      const def = getToolDefinition('world_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const ttBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'thread_tick'
      })
      expect(ttBranch).toBeDefined()
      const required = (ttBranch!.required as string[]) || []
      expect(required).toContain('thread_id')
    })

    it('includes get_relationship branch', () => {
      const def = getToolDefinition('world_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const grBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'get_relationship'
      })
      expect(grBranch).toBeDefined()
    })

    it('includes get_reachable_locations branch', () => {
      const def = getToolDefinition('world_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const grlBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'get_reachable_locations'
      })
      expect(grlBranch).toBeDefined()
    })

    it('includes check_convergence branch', () => {
      const def = getToolDefinition('world_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const ccBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'check_convergence'
      })
      expect(ccBranch).toBeDefined()
    })

    it('get_faction_standing is represented as a nested anyOf (4-way OR)', () => {
      const def = getToolDefinition('world_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      // Find the branch that contains a nested anyOf for get_faction_standing
      const nestedBranch = anyOf.find((b: Record<string, unknown>) => {
        return b.anyOf !== undefined
      })
      expect(nestedBranch).toBeDefined()
      const nested = nestedBranch!.anyOf as Array<Record<string, unknown>>
      // Should be a 4-way union
      expect(nested.length).toBe(4)
      // First variant should have entity_key and faction_key
      const firstVarProps = nested[0].properties as Record<string, unknown>
      const firstAction = firstVarProps?.action as Record<string, unknown>
      expect(firstAction?.const).toBe('get_faction_standing')
    })

    it('get_entity_knowledge is represented as nested anyOf (2-way OR)', () => {
      const def = getToolDefinition('world_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      // Find a 2-element nested anyOf for get_entity_knowledge
      const nestedBranches = anyOf.filter((b: Record<string, unknown>) => {
        if (!b.anyOf || !Array.isArray(b.anyOf)) return false
        const nested = b.anyOf as Array<Record<string, unknown>>
        if (nested.length !== 2) return false
        const firstProps = nested[0]?.properties as Record<string, unknown> | undefined
        return firstProps?.action?.const === 'get_entity_knowledge'
      })
      expect(nestedBranches.length).toBeGreaterThanOrEqual(1)
    })

    it('sense_environment is represented as nested anyOf with location_key', () => {
      const def = getToolDefinition('world_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const nestedBranches = anyOf.filter((b: Record<string, unknown>) => {
        if (!b.anyOf || !Array.isArray(b.anyOf)) return false
        const nested = b.anyOf as Array<Record<string, unknown>>
        const firstProps = nested[0]?.properties as Record<string, unknown> | undefined
        return firstProps?.action?.const === 'sense_environment'
      })
      expect(nestedBranches.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('getTools', () => {
    it('includes world_manage in the registered tool list', () => {
      const tools = getTools()
      const worldManage = tools.find((t) => t.name === 'world_manage')
      expect(worldManage).toBeDefined()
      expect(worldManage!.category).toBe('lore')
    })
  })
})
