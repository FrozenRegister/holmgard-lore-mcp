import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
import { registerAgentManageTool } from '../../src/rpg/register-agent-manage'

describe('agent_manage registration (Phase 3 #544)', () => {
  beforeAll(() => {
    try {
      registerAgentManageTool()
    } catch (e: any) {
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves agent_manage to a ToolHandler function', () => {
      const handler = getToolHandler('agent_manage')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('returns undefined for unknown tools', () => {
      expect(getToolHandler('nonexistent_tool_xyz')).toBeUndefined()
    })
  })

  describe('getToolDefinition', () => {
    it('serializes agent_manage to a valid tool definition', () => {
      const def = getToolDefinition('agent_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('agent_manage')
      expect(def!.title).toBe('Agent Management')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('NPC AI agent')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
      expect(def!.inputSchema).toHaveProperty('properties')
    })

    it('includes action field in the schema', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('action')
    })

    it('includes agent identity fields in the schema', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('id')
      expect(props).toHaveProperty('agentId')
      expect(props).toHaveProperty('characterId')
    })

    it('includes lifecycle fields in the schema', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('model')
      expect(props).toHaveProperty('status')
      expect(props).toHaveProperty('autoOnTurn')
      expect(props).toHaveProperty('temperature')
      expect(props).toHaveProperty('maxTokens')
      expect(props).toHaveProperty('budgetTokens')
    })

    it('includes prompt slice fields in the schema', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('sliceId')
      expect(props).toHaveProperty('kind')
      expect(props).toHaveProperty('label')
      expect(props).toHaveProperty('content')
      expect(props).toHaveProperty('orderIndex')
      expect(props).toHaveProperty('enabled')
    })

    it('includes invoke fields in the schema', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('situation')
      expect(props).toHaveProperty('encounterId')
      expect(props).toHaveProperty('requestId')
      expect(props).toHaveProperty('agentIds')
      expect(props).toHaveProperty('observation')
      expect(props).toHaveProperty('callId')
    })

    it('includes journal/secret fields in the schema', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('importance')
      expect(props).toHaveProperty('secretId')
      expect(props).toHaveProperty('journalKind')
      expect(props).toHaveProperty('round')
    })

    it('includes filter fields in the schema', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('limit')
      expect(props).toHaveProperty('filter')
    })

    it('returns undefined for unknown tool', () => {
      expect(getToolDefinition('nonexistent_xyz')).toBeUndefined()
    })
  })

  describe('schema serialization', () => {
    it('produces a valid JSON Schema from InputSchema', () => {
      const def = getToolDefinition('agent_manage')
      expect(def).toBeDefined()
      expect(def!.inputSchema).toHaveProperty('type', 'object')
      expect(def!.inputSchema).toHaveProperty('properties')
    })

    it('marks action as required', () => {
      const def = getToolDefinition('agent_manage')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('action')
    })

    it('treats optional fields as not required', () => {
      const def = getToolDefinition('agent_manage')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required.includes('id')).toBe(false)
      expect(required.includes('agentId')).toBe(false)
      expect(required.includes('characterId')).toBe(false)
      expect(required.includes('model')).toBe(false)
    })

    it('includes enum field (status)', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      const status = props.status as Record<string, unknown>
      expect(status).toHaveProperty('enum')
      expect(status.enum).toEqual(['active', 'paused', 'retired'])
    })

    it('includes enum field (importance)', () => {
      const def = getToolDefinition('agent_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      const importance = props.importance as Record<string, unknown>
      expect(importance).toHaveProperty('enum')
      expect(importance.enum).toEqual(['low', 'medium', 'high', 'critical'])
    })
  })

  describe('getTools', () => {
    it('includes agent_manage in the registered tools list', () => {
      const tools = getTools()
      const names = tools.map((t) => t.name)
      expect(names).toContain('agent_manage')
    })
  })
})
