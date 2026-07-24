// Type declarations for scripts/check-tool-registry-sync.mjs
// See #541 — CI guard that asserts toolRegistry and toolDefinitions stay in sync.

export interface ToolRegistrySyncResult {
  ok: boolean
  missingFromDefinitions: string[]
  missingFromRegistry: string[]
  registryNames: string[]
  definitionNames: string[]
}

export interface ToolRegistrySyncOverrides {
  toolsRegistryCode?: string
  rpgRegistryCode?: string
  toolsDefinitionsCode?: string
  rpgDefinitionsCode?: string
  rpgMetaDefinitionsCode?: string
}

export function extractRegistryNames(code: string): Set<string>
export function extractDefinitionNames(code: string): Set<string>
export function checkToolRegistrySync(
  overrides?: ToolRegistrySyncOverrides,
): ToolRegistrySyncResult
