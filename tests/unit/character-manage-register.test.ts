import { describe, it, expect, beforeAll } from 'vitest'
import { getToolHandler, getToolDefinition, getTools } from '../../src/tools/register'
import { registerCharacterManageTool } from '../../src/rpg/register-character-manage'

describe('character_manage registration (Phase 2 #543)', () => {
  beforeAll(() => {
    // Registration happens at module load time in src/index.ts,
    // but for isolated unit tests we register here explicitly.
    try {
      registerCharacterManageTool()
    } catch (e: any) {
      // Already registered (e.g., if src/index.ts was imported)
      if (!e.message?.includes('already registered')) {
        throw e
      }
    }
  })

  describe('getToolHandler', () => {
    it('resolves character_manage to a ToolHandler function', () => {
      const handler = getToolHandler('character_manage')
      expect(handler).toBeDefined()
      expect(typeof handler).toBe('function')
    })

    it('returns undefined for unknown tools', () => {
      expect(getToolHandler('nonexistent_tool_xyz')).toBeUndefined()
    })
  })

  describe('getToolDefinition', () => {
    it('serializes character_manage to a valid tool definition', () => {
      const def = getToolDefinition('character_manage')
      expect(def).toBeDefined()
      expect(def!.name).toBe('character_manage')
      expect(def!.title).toBe('Character Management')
      expect(def!.version).toBe('1.0.0')
      expect(def!.description).toContain('character management')
      expect(def!.inputSchema).toHaveProperty('type', 'object')
      expect(def!.inputSchema).toHaveProperty('properties')
    })

    it('includes action and key fields in the schema', () => {
      const def = getToolDefinition('character_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('action')
      expect(props).toHaveProperty('id')
      expect(props).toHaveProperty('name')
      expect(props).toHaveProperty('characterId')
      expect(props).toHaveProperty('level')
      expect(props).toHaveProperty('hp')
      expect(props).toHaveProperty('maxHp')
    })

    it('includes spell-related fields in the schema', () => {
      const def = getToolDefinition('character_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('spellSlots')
      expect(props).toHaveProperty('knownSpells')
      expect(props).toHaveProperty('preparedSpells')
      expect(props).toHaveProperty('cantripsKnown')
      expect(props).toHaveProperty('spellName')
      expect(props).toHaveProperty('slotLevel')
    })

    it('includes movement-related fields in the schema', () => {
      const def = getToolDefinition('character_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      // move_to_location and move_to_tile actions
      expect(props).toHaveProperty('locationKey')
      expect(props).toHaveProperty('q')
      expect(props).toHaveProperty('r')
      expect(props).toHaveProperty('mapId')
    })

    it('includes death-related fields in the schema', () => {
      const def = getToolDefinition('character_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      expect(props).toHaveProperty('killerId')
      expect(props).toHaveProperty('causeOfDeath')
      expect(props).toHaveProperty('deathMode')
      expect(props).toHaveProperty('dissolutionStage')
    })

    it('returns undefined for unknown tool', () => {
      expect(getToolDefinition('nonexistent_xyz')).toBeUndefined()
    })
  })

  describe('schema serialization', () => {
    it('produces a valid JSON Schema from InputSchema', () => {
      const def = getToolDefinition('character_manage')
      expect(def).toBeDefined()
      expect(def!.inputSchema).toHaveProperty('type', 'object')
      expect(def!.inputSchema).toHaveProperty('properties')
    })

    it('marks action as required', () => {
      const def = getToolDefinition('character_manage')
      const required = (def!.inputSchema.required as string[]) || []
      expect(required).toContain('action')
    })

    it('treats optional fields as not required', () => {
      const def = getToolDefinition('character_manage')
      const required = (def!.inputSchema.required as string[]) || []
      // Most character fields are optional
      expect(required.includes('id')).toBe(false)
      expect(required.includes('name')).toBe(false)
      expect(required.includes('level')).toBe(false)
    })

    it('includes nested object schemas (e.g., stats)', () => {
      const def = getToolDefinition('character_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      const stats = props.stats as Record<string, unknown>
      expect(stats).toHaveProperty('properties')
      const statsProps = stats.properties as Record<string, unknown>
      expect(statsProps).toHaveProperty('str')
      expect(statsProps).toHaveProperty('dex')
      expect(statsProps).toHaveProperty('con')
      expect(statsProps).toHaveProperty('int')
      expect(statsProps).toHaveProperty('wis')
      expect(statsProps).toHaveProperty('cha')
    })

    it('includes enum fields (e.g., characterType)', () => {
      const def = getToolDefinition('character_manage')
      const props = def!.inputSchema.properties as Record<string, unknown>
      const charType = props.characterType as Record<string, unknown>
      expect(charType).toHaveProperty('enum')
      expect(charType.enum).toEqual(['pc', 'npc', 'enemy', 'neutral'])
    })
  })
})
