import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition } from '../../src/tools/register'
import { registerLoreManageTool } from '../../src/tools/register-lore-manage'

describe('lore_manage registration (Phase 4 #545)', () => {
  beforeAll(() => {
    try {
      registerLoreManageTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
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
  })

  describe('getToolDefinition', () => {
    it('serializes lore_manage to a valid tool definition', () => {
      const def = getToolDefinition('lore_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('lore_manage')
      expect(def!.title).toBe('Lore Manage')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('KV lore store')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
    })

    it('includes action field in the schema', () => {
      const def = getToolDefinition('lore_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('action')
    })

    it('marks action as required', () => {
      const def = getToolDefinition('lore_manage')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('action')
    })

    it('includes key field for set/delete/patch actions', () => {
      const def = getToolDefinition('lore_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('key')
    })

    it('includes query field for get/search actions', () => {
      const def = getToolDefinition('lore_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('query')
    })

    it('includes dry_run boolean field', () => {
      const def = getToolDefinition('lore_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('dry_run')
    })

    it('includes entries array for batch_set', () => {
      const def = getToolDefinition('lore_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('entries')
    })

    it('includes mutations array for batch_mutate', () => {
      const def = getToolDefinition('lore_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('mutations')
    })
  })
})
