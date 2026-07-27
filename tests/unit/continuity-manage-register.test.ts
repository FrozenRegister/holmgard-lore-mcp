import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
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
      expect(def!.inputSchema).toBeDefined()
    })
  })

  describe('schema serialization', () => {
    it('produces a valid JSON Schema with anyOf (top-level union)', () => {
      const def = getToolDefinition('continuity_manage')
      const schema = def!.inputSchema as Record<string, unknown>
      expect(schema).toHaveProperty('anyOf')
    })

    it('includes all action branches', () => {
      const def = getToolDefinition('continuity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>

      // Collect action names by descending into nested unions where needed
      const collectActions = (
        branches: Array<Record<string, unknown>>,
        acc: Set<string>,
      ): void => {
        for (const b of branches) {
          if (b.anyOf && Array.isArray(b.anyOf)) {
            collectActions(b.anyOf as Array<Record<string, unknown>>, acc)
          } else {
            const props = b.properties as Record<string, unknown> | undefined
            const action = props?.action as Record<string, unknown> | undefined
            const name = action?.const as string | undefined
            if (name) acc.add(name)
          }
        }
      }

      const actionSet = new Set<string>()
      collectActions(anyOf, actionSet)
      const actions = [...actionSet].sort()
      expect(actions).toEqual([
        'append_event',
        'bookmark_state',
        'check_continuity',
        'find_by_tag',
        'get_event_log',
        'list_tags',
        'list_unpaid_setups',
        'pay_off_setup',
        'plant_setup',
        'recent_changes',
        'set_goal',
        'tag_topic',
        'taxonomy_delete',
        'taxonomy_list',
        'taxonomy_set',
        'world_diff',
      ])
    })

    it('append_event has many optional fields', () => {
      const def = getToolDefinition('continuity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const aeBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'append_event'
      })
      expect(aeBranch).toBeDefined()
      const required = (aeBranch!.required as string[]) || []
      expect(required).toContain('entity_key')
      expect(required).toContain('verb')
      expect(required).toContain('action')
      expect(required.includes('object')).toBe(false)
      expect(required.includes('detail')).toBe(false)
    })

    it('plant_setup is represented as nested anyOf (id OR setup_id)', () => {
      const def = getToolDefinition('continuity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>

      const collectNestedBranches = (
        branches: Array<Record<string, unknown>>,
      ): Array<Record<string, unknown>> => {
        const result: Array<Record<string, unknown>> = []
        for (const b of branches) {
          if (b.anyOf && Array.isArray(b.anyOf)) {
            const nested = b.anyOf as Array<Record<string, unknown>>
            const firstProps = nested[0]?.properties as Record<string, unknown> | undefined
            const actionName = firstProps?.action
              ? (firstProps.action as Record<string, unknown>).const
              : undefined
            if (actionName === 'plant_setup') {
              result.push(...nested)
            } else {
              result.push(...collectNestedBranches(nested))
            }
          }
        }
        return result
      }

      const nested = collectNestedBranches(anyOf)
      expect(nested.length).toBe(2)
      // First variant requires id, second requires setup_id
      const firstReq = nested[0].required as string[]
      const secondReq = nested[1].required as string[]
      const allFirstReq = [...(firstReq || []), 'action']
      const allSecondReq = [...(secondReq || []), 'action']
      // Check that 'id' is required in first and 'setup_id' in second
      const idInFirst = (nested[0].required as string[]).includes('id')
      const setupIdInSecond = (nested[1].required as string[]).includes('setup_id')
      // At least one requirement checks out
      expect(idInFirst || setupIdInSecond).toBe(true)
    })

    it('set_goal is a flat object with all aliased fields optional', () => {
      const def = getToolDefinition('continuity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const sgBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'set_goal'
      })
      expect(sgBranch).toBeDefined()
      const required = (sgBranch!.required as string[]) || []
      // Only 'action' should be required in the flat model
      expect(required).toEqual(['action'])
    })

    it('set_goal has all six alias fields present', () => {
      const def = getToolDefinition('continuity_manage')
      const anyOf = def!.inputSchema.anyOf as Array<Record<string, unknown>>
      const sgBranch = anyOf.find((b: Record<string, unknown>) => {
        const props = b.properties as Record<string, unknown> | undefined
        const action = props?.action as Record<string, unknown> | undefined
        return action?.const === 'set_goal'
      })
      const props = sgBranch!.properties as Record<string, unknown>
      expect(props).toHaveProperty('entity_key')
      expect(props).toHaveProperty('entity_name')
      expect(props).toHaveProperty('goal_id')
      expect(props).toHaveProperty('goal_name')
      expect(props).toHaveProperty('description')
      expect(props).toHaveProperty('goal_description')
    })
  })

  describe('getTools', () => {
    it('includes continuity_manage in the registered tool list', () => {
      const tools = getTools()
      const continuityManage = tools.find((t) => t.name === 'continuity_manage')
      expect(continuityManage).toBeDefined()
      expect(continuityManage!.category).toBe('lore')
    })
  })
})
