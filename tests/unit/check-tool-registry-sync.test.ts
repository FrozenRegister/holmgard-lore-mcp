import { describe, it, expect } from 'vitest'
import {
  checkToolRegistrySync,
} from '../../scripts/check-tool-registry-sync.mjs'

describe('check-tool-registry-sync', () => {
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

    it('extracts registry keys from object literal notation', () => {
      const result = checkToolRegistrySync({
        toolsRegistryCode: `export const toolRegistry = {
  lore_manage: handle_lore_manage,
  entity_manage: handle_entity_manage,
  character_manage: wrap(handleCharacterManage),
}`,
        rpgRegistryCode: `export const rpgToolRegistry = {
  math_manage: wrap(handleMathManage),
}`,
        toolsDefinitionsCode: `export const toolDefinitions = [
  { name: 'lore_manage' },
  { name: 'entity_manage' },
  { name: 'character_manage' },
]`,
        rpgDefinitionsCode: `export const rpgToolDefinitions = []`,
        rpgMetaDefinitionsCode: `export const rpgMetaToolDefinitions = []`,
      })
      expect(result.ok).toBe(true)
      expect(result.registryNames).toContain('lore_manage')
      expect(result.registryNames).toContain('entity_manage')
      expect(result.registryNames).toContain('character_manage')
    })

    it('extracts definition names from ToolDefinition arrays', () => {
      const result = checkToolRegistrySync({
        toolsRegistryCode: `export const toolRegistry = {
  alpha_tool: handle_alpha,
  beta_tool: handle_beta,
}`,
        rpgRegistryCode: `export const rpgToolRegistry = {}`,
        toolsDefinitionsCode: `export const toolDefinitions = [
  { name: 'alpha_tool', title: 'Alpha' },
  { name: 'beta_tool', title: 'Beta' },
]`,
        rpgDefinitionsCode: `export const rpgToolDefinitions = []`,
        rpgMetaDefinitionsCode: `export const rpgMetaToolDefinitions = []`,
      })
      expect(result.ok).toBe(true)
      expect(result.definitionNames).toContain('alpha_tool')
      expect(result.definitionNames).toContain('beta_tool')
    })
  })
})
