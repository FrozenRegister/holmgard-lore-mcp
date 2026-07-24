import { describe, it, expect } from 'vitest'
import {
  checkToolRegistrySync,
  extractRegistryNames,
  extractDefinitionNames,
} from '../../scripts/check-tool-registry-sync.mjs'

describe('check-tool-registry-sync', () => {
  describe('extractRegistryNames', () => {
    it('extracts keys from a registry object literal', () => {
      const code = `export const toolRegistry = {
  lore_manage: handle_lore_manage,
  entity_manage: handle_entity_manage,
  character_manage: wrap(handleCharacterManage),
}`
      const names = extractRegistryNames(code)
      expect(names.has('lore_manage')).toBe(true)
      expect(names.has('entity_manage')).toBe(true)
      expect(names.has('character_manage')).toBe(true)
    })
  })

  describe('extractDefinitionNames', () => {
    it('extracts name fields from a ToolDefinition array', () => {
      const code = `export const toolDefinitions = [
  { name: 'lore_manage', title: 'Lore Manage', version: '1.0.0' },
  { name: 'entity_manage', title: 'Entity Manage', version: '1.0.0' },
]`
      const names = extractDefinitionNames(code)
      expect(names.has('lore_manage')).toBe(true)
      expect(names.has('entity_manage')).toBe(true)
    })
  })

  describe('checkToolRegistrySync', () => {
    it('catches a tool in registry but not in definitions', () => {
      const result = checkToolRegistrySync({
        toolsRegistryCode: `export const toolRegistry = {
  phantom_tool: handle_phantom,
}`,
        rpgRegistryCode: `export const rpgToolRegistry = {}`,
        toolsDefinitionsCode: `export const toolDefinitions = []`,
        rpgDefinitionsCode: `export const rpgToolDefinitions = []`,
        rpgMetaDefinitionsCode: `export const rpgMetaToolDefinitions = []`,
      })
      expect(result.ok).toBe(false)
      expect(result.missingFromDefinitions).toContain('phantom_tool')
    })

    it('catches a tool in definitions but not in registry', () => {
      const result = checkToolRegistrySync({
        toolsRegistryCode: `export const toolRegistry = {}`,
        rpgRegistryCode: `export const rpgToolRegistry = {}`,
        toolsDefinitionsCode: `export const toolDefinitions = [{ name: 'ghost_tool' }]`,
        rpgDefinitionsCode: `export const rpgToolDefinitions = []`,
        rpgMetaDefinitionsCode: `export const rpgMetaToolDefinitions = []`,
      })
      expect(result.ok).toBe(false)
      expect(result.missingFromRegistry).toContain('ghost_tool')
    })

    it('passes when registry and definitions match', () => {
      const result = checkToolRegistrySync({
        toolsRegistryCode: `export const toolRegistry = {
  my_tool: handle_my_tool,
}`,
        rpgRegistryCode: `export const rpgToolRegistry = {}`,
        toolsDefinitionsCode: `export const toolDefinitions = [{ name: 'my_tool' }]`,
        rpgDefinitionsCode: `export const rpgToolDefinitions = []`,
        rpgMetaDefinitionsCode: `export const rpgMetaToolDefinitions = []`,
      })
      expect(result.ok).toBe(true)
      expect(result.missingFromDefinitions).toEqual([])
      expect(result.missingFromRegistry).toEqual([])
    })

    it('exempts math_manage from the comparison', () => {
      const result = checkToolRegistrySync({
        toolsRegistryCode: `export const toolRegistry = {}`,
        rpgRegistryCode: `export const rpgToolRegistry = {}`,
        toolsDefinitionsCode: `export const toolDefinitions = [{ name: 'math_manage' }]`,
        rpgDefinitionsCode: `export const rpgToolDefinitions = []`,
        rpgMetaDefinitionsCode: `export const rpgMetaToolDefinitions = []`,
      })
      expect(result.ok).toBe(true)
    })

    it('exempts math_manage even when it appears in both sets', () => {
      const result = checkToolRegistrySync({
        toolsRegistryCode: `export const toolRegistry = {
  math_manage: handle_math,
}`,
        rpgRegistryCode: `export const rpgToolRegistry = {}`,
        toolsDefinitionsCode: `export const toolDefinitions = [{ name: 'math_manage' }]`,
        rpgDefinitionsCode: `export const rpgToolDefinitions = []`,
        rpgMetaDefinitionsCode: `export const rpgMetaToolDefinitions = []`,
      })
      expect(result.ok).toBe(true)
    })
  })
})
