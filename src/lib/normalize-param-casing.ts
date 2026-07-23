// src/lib/normalize-param-casing.ts
// See #511: RPG handlers' Zod schemas are camelCase-native (worldId, entityKey,
// locationKey, sceneKey, factionKey...) while the rest of the codebase — D1
// columns, KV lore keys, and the non-RPG tool layer — is snake_case-native
// (world_id, entity_key, ...). Only 5 of ~40 RPG handlers had a manual
// per-handler bridge (#377, #336, #268) before this; the other handlers
// silently dropped whichever casing they didn't expect, since Zod strips
// unrecognized keys instead of erroring.
//
// This normalizes casing once, at the transport boundary, for every tool —
// for each top-level arg key, add the other casing's alias (snake_case for a
// camelCase key, camelCase for a snake_case key) if it isn't already present.
// No knowledge of any tool's Zod schema is needed: an alias a schema doesn't
// recognize is just an extra key that gets silently stripped during
// validation, same as today. Skips a key entirely if both casings are
// already present in the input — that's the one case where a caller may
// have set both deliberately, and per #511 no schema has ever assigned them
// different meanings.
export function normalizeParamCasing(args: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...args }

  for (const key of Object.keys(args)) {
    if (key.includes('_')) {
      const camel = snakeToCamel(key)
      if (camel !== key && !(camel in args)) normalized[camel] = args[key]
    } else if (/[A-Z]/.test(key)) {
      const snake = camelToSnake(key)
      if (snake !== key && !(snake in args)) normalized[snake] = args[key]
    }
  }

  return normalized
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase())
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
}
