import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
import { registerLoreManageTool } from '../../src/tools/register-lore-manage'

describe('lore_manage registration (Phase 4 #545)', () => {
  beforeAll(() => {
    try {
      registerLoreManageTool()
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves lore_manage to a ToolHandler function', () => {
      const handler = getToolHandler('lore_manage')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('returns undefined for unknown tools', () => {
      expect(getToolHandler('nonexistent_tool_xyz')).toBeUndefined()
    })
  })

  describe('getToolDefinition', () => {
    it('serializes lore_manage to a valid tool definition', () => {
      const def = getToolDefinition('lore_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('lore_manage')
      expect(def!.title).toBe('Lore Manage')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('lore')
      expect(def!.inputSchema).toBeDefined()
    })

    it('returns undefined for unknown tool', () => {
      expect(getToolDefinition('nonexistent_xyz')).toBeUndefined()
    })
  })

  describe('schema serialization', () => {
    it('produces a valid JSON Schema with anyOf branches', () => {
      const def = getToolDefinition('lore_manage')
      const schema = def!.inputSchema as Record<string, unknown>
      expect(schema).toHaveProperty('anyOf')
      const anyOf = schema.anyOf as Array<Record<string, unknown>>
      expect(anyOf.length).toBeGreaterThanOrEqual(17)
    })

    it('includes all action branches', () => {
      const def = getToolDefinition('lore_manage')
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
        'append_section',
        'batch_mutate',
        'batch_set',
        'delete',
        'get',
        'get_batch',
        'get_map',
        'get_section',
        'history',
        'increment',
        'list',
        'list_maps',
        'patch',
        'restore',
        'search',
        'set',
        'validate',
      ])
    })

    it('treats optional fields correctly (e.g. dry_run)', () => {
      const def = getToolDefinition('lore_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const setBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'set'
      })
      expect(setBranch).toBeDefined()
      const required = (setBranch!.required as string[]) || []
      expect(required.includes('dry_run')).toBe(false)
      expect(required).toContain('key')
      expect(required).toContain('text')
    })

    it('includes enum fields (e.g. match_mode)', () => {
      const def = getToolDefinition('lore_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const searchBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'search'
      })
      const props = searchBranch!.properties as Record<string, unknown>
      const matchMode = props.match_mode as Record<string, unknown>
      expect(matchMode).toHaveProperty('enum')
      expect(matchMode.enum).toEqual(['any', 'all', 'exact'])
    })

    it('enforces minLength on string fields', () => {
      const def = getToolDefinition('lore_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const getBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'get'
      })
      const props = getBranch!.properties as Record<string, unknown>
      const query = props.query as Record<string, unknown>
      expect(query).toHaveProperty('minLength', 1)
    })

    it('enforces minItems on array fields', () => {
      const def = getToolDefinition('lore_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const getBatchBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'get_batch'
      })
      const props = getBatchBranch!.properties as Record<string, unknown>
      const keys = props.keys as Record<string, unknown>
      expect(keys).toHaveProperty('minItems', 1)
    })
  })

  describe('getTools', () => {
    it('includes lore_manage in the registered tool list', () => {
      const tools = getTools()
      const loreManage = tools.find((t) => t.name === 'lore_manage')
      expect(loreManage).toBeDefined()
      expect(loreManage!.category).toBe('lore')
    })
  })
})
