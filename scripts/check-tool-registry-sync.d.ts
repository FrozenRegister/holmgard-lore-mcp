// Type declarations for scripts/check-tool-registry-sync.mjs
// See #541 — standalone Node script that asserts toolRegistry/toolDefinitions sync.

export interface SyncResult {
  ok: boolean
  missingFromDefinitions: string[]
  missingFromRegistry: string[]
  registryNames: string[]
  definitionNames: string[]
}

export function extractRegistryNames(code: string): Set<string>
export function extractDefinitionNames(code: string): Set<string>
export function checkToolRegistrySync(overrides?: {
  toolsRegistryCode?: string
  rpgRegistryCode?: string
  toolsDefinitionsCode?: string
  rpgDefinitionsCode?: string
  rpgMetaDefinitionsCode?: string
}): SyncResult
