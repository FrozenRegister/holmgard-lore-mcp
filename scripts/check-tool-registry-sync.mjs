#!/usr/bin/env node
// Guards toolRegistry (src/tools/registry.ts + src/rpg/registry.ts) and
// toolDefinitions (src/tools/definitions.ts + src/rpg/definitions.ts +
// src/rpg/meta-definitions.ts) against name drift: both lists must contain
// the same set of tool names. Without this, a tool added to one list but not
// the other silently breaks either tools/list or tools/call. See #541.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Exempt math_manage — it intentionally exists only in the schema doc
// (mathManageSchemaDoc in src/rpg/definitions.ts) as a load_tool_schema
// reference for rpg({sub:'math',...})'s dice-notation grammar, and is
// deliberately never added to toolRegistry. See src/index.ts.
const EXEMPTIONS = new Set(['math_manage'])

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

export function extractRegistryNames(code) {
  const names = new Set()
  // Match keys in toolRegistry/rpgToolRegistry object literals:
  //   lore_manage: handle_lore_manage,
  //   agent_manage: wrap(handleAgentManage),
  const re = /^\s{2}(\w+):\s+(?:wrap\()?handle\w*\)?/gm
  let m
  while ((m = re.exec(code)) !== null) names.add(m[1])
  return names
}

export function extractDefinitionNames(code) {
  const names = new Set()
  // Match top-level definition name fields. Definition entries use
  // either compact (`  { name: 'tool' }`) or expanded form:
  //     {
  //       name: 'tool',
  //     }
  // Both sit at exactly 2–4 spaces of indent. Nested schema property
  // names sit at 6+ spaces and are excluded. Mid-line name references
  // inside description strings have no leading whitespace and are
  // excluded by the ^ anchor.
  const re = /^ {2,4}(?:\{ )?name:\s*'(\w+)'/gm
  let m
  while ((m = re.exec(code)) !== null) names.add(m[1])
  return names
}

export function checkToolRegistrySync(overrides = {}) {
  const toolsRegistryCode =
    overrides.toolsRegistryCode ?? read('src/tools/registry.ts')
  const rpgRegistryCode =
    overrides.rpgRegistryCode ?? read('src/rpg/registry.ts')
  const toolsDefinitionsCode =
    overrides.toolsDefinitionsCode ?? read('src/tools/definitions.ts')
  const rpgDefinitionsCode =
    overrides.rpgDefinitionsCode ?? read('src/rpg/definitions.ts')
  const rpgMetaDefinitionsCode =
    overrides.rpgMetaDefinitionsCode ?? read('src/rpg/meta-definitions.ts')

  const registryNames = new Set([
    ...extractRegistryNames(toolsRegistryCode),
    ...extractRegistryNames(rpgRegistryCode),
  ])

  const definitionNames = new Set([
    ...extractDefinitionNames(toolsDefinitionsCode),
    ...extractDefinitionNames(rpgDefinitionsCode),
    ...extractDefinitionNames(rpgMetaDefinitionsCode),
  ])

  for (const ex of EXEMPTIONS) {
    registryNames.delete(ex)
    definitionNames.delete(ex)
  }

  const missingFromDefinitions = [...registryNames]
    .filter((n) => !definitionNames.has(n))
    .sort()
  const missingFromRegistry = [...definitionNames]
    .filter((n) => !registryNames.has(n))
    .sort()

  return {
    ok: missingFromDefinitions.length === 0 && missingFromRegistry.length === 0,
    missingFromDefinitions,
    missingFromRegistry,
    registryNames: [...registryNames].sort(),
    definitionNames: [...definitionNames].sort(),
  }
}

function main() {
  const result = checkToolRegistrySync()

  if (result.ok) {
    console.log(
      `check-tool-registry-sync: all ${result.registryNames.length} tools match between registry and definitions.`,
    )
    return
  }

  console.error('\n✗ toolRegistry and toolDefinitions are out of sync:\n')
  if (result.missingFromDefinitions.length > 0) {
    console.error('In toolRegistry but missing from toolDefinitions:')
    for (const n of result.missingFromDefinitions) console.error(`  ${n}`)
  }
  if (result.missingFromRegistry.length > 0) {
    console.error('\nIn toolDefinitions but missing from toolRegistry:')
    for (const n of result.missingFromRegistry) console.error(`  ${n}`)
  }
  console.error('')
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
