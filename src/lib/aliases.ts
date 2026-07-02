// src/lib/aliases.ts
// Normalizes commonly-guessed alternate parameter names to the canonical field name
// before Zod validation. MCP clients (e.g. Cline) validate `arguments` against the
// tool's declared JSON Schema (src/tools/definitions.ts) before ever sending a
// tools/call request — so an alias only helps if it is declared as an accepted
// property there too (via an `anyOf: [{required:[canonical]},{required:[alias]}]`
// clause). Keep the alias maps here and the schema's alias properties in sync.
export function applyAliases(args: Record<string, unknown>, aliasMap: Record<string, string>): Record<string, unknown> {
  const result = { ...args }
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    if (result[canonical] === undefined && result[alias] !== undefined) {
      result[canonical] = result[alias]
    }
  }
  return result
}
