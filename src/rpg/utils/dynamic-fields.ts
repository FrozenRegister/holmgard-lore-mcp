// #425 — shared blacklist-based passthrough for arbitrary D1 column updates.
//
// Every `update`-style handler in src/rpg/handlers/*.ts hardcodes an explicit
// whitelist of updatable columns in its Zod schema. When a migration adds a
// new column, that column is silently unreachable through MCP until someone
// remembers to also touch the handler — a gap audited across the repo on
// #425 and found on characters (9 orphaned columns from migration 0003 alone,
// plus production_state with zero writers anywhere), worlds.universe_id,
// world_state.production_mood/era/tick_speed, five parties columns, most of
// secrets, and quests.rewards/prerequisites.
//
// This is the shared write path: an optional `fields` object on each
// affected handler's update action, forwarded to the SQL UPDATE ... SET
// clause after two checks — a blacklist (columns that must never change
// through a generic passthrough: id, created_at, updated_at, and any
// handler-specific identity/ownership columns like world_id) and a strict
// column-name shape (SQL identifiers can't be parameterized as `?` bindings
// the way values can, so this is the actual injection boundary — values
// still go through parameterized binds, only the validated key becomes part
// of the SQL text). D1 is the final type validator: a bad-typed value (e.g.
// dissolution_stage: "pizza") surfaces as a D1 error, not a schema mismatch
// caught here — this deliberately does not know column types.
//
// Precedence: an explicit, already-claimed param always wins over `fields`
// (per #425's own rule) — this is enforced by skipping any `fields` key
// whose column name already appears in `sets` from the handler's own
// explicit-param handling, which must run before calling this.

const SAFE_COLUMN_NAME = /^[a-z][a-z0-9_]*$/

export interface RejectedField {
  field: string
  reason: 'blacklisted' | 'invalid column name'
}

export interface DynamicFieldsResult {
  applied: string[]
  rejected: RejectedField[]
}

/**
 * Mutates `sets`/`vals` in place, appending one `"<col> = ?"` / value pair per
 * accepted field. Returns which fields were applied and which were rejected
 * (blacklisted, an invalid column-name shape, or already claimed by an
 * explicit param) so the caller can surface both in the response for
 * transparency.
 */
export function applyDynamicFields(
  fields: Record<string, unknown> | undefined,
  blacklist: readonly string[],
  sets: string[],
  vals: unknown[],
): DynamicFieldsResult {
  const applied: string[] = []
  const rejected: RejectedField[] = []
  if (!fields) return { applied, rejected }

  const claimed = new Set(sets.map(s => s.split('=')[0].trim()))

  for (const [key, value] of Object.entries(fields)) {
    if (claimed.has(key)) continue // explicit param already set this column — it wins, silently
    if (blacklist.includes(key)) { rejected.push({ field: key, reason: 'blacklisted' }); continue }
    if (!SAFE_COLUMN_NAME.test(key)) { rejected.push({ field: key, reason: 'invalid column name' }); continue }
    sets.push(`${key} = ?`)
    vals.push(value)
    applied.push(key)
  }

  return { applied, rejected }
}
