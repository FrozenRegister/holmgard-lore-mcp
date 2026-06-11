# HIGH: KV-to-D1 Auto-Redirect for Character Lookups

**Priority:** HIGH
**Status:** Spec, ready for implementation
**Labels:** backend, kv, d1, migration, redirect

## Problem

Characters can exist in **two separate storage layers** with no synchronization:

1. **D1 database (`character_manage` tool)** — holds structured RPG mechanics (HP, stats, spells, inventory, position) in the `characters` table.
2. **Cloudflare KV (`get_lore` / `set_lore` tools)** — holds narrative prose (personality, backstory, goals, sensory profiles) as Markdown text under keys like `character:<name>`.

When a character is migrated from KV to D1, the KV entry becomes stale. An AI agent reading lore via `get_lore("character:elara")` gets old narrative text while the real data sits in D1. There's no way for the caller to know the data has moved.

## Proposed Solution: Plan B — Auto-redirect in `get_lore`

Modify the `handle_get_lore` function in `src/tools/system.ts` to:

1. Fetch the KV entry as usual.
2. Check if the KV entry contains a `## D1-Migrated: true` marker line.
3. If present, extract the `## D1-Character-ID: <uuid>` from the KV text.
4. Query D1's `characters` table for that ID.
5. Format the D1 row back into Markdown lore text (mapping columns to `##` sections).
6. Return the composed lore text to the caller — **the redirect is invisible**.

If the D1 row doesn't exist (deleted), return the original KV text as a fallback with a `## D1-Stale: true` header.

## KV Marker Format

When migrating a character from KV to D1, the KV entry should be updated to:

```
## D1-Migrated: true
## D1-Character-ID: 550e8400-e29b-41d4-a716-446655440000
## Status: Legacy entry — see D1 for current data
```

(The `##` headings are chosen because `get_lore_section` already parses them.)

## Implementation Details

### Target file: `src/tools/system.ts`

Find the `handle_get_lore` export. After the KV fetch succeeds and returns text, add logic:

```typescript
// After: const stored = await kv.get<LoreEntry>(key, 'json');
// Before: return { content: [{ type: 'text', text: ... }] };

if (isObject && typeof stored.text === 'string' && stored.text.includes('## D1-Migrated: true')) {
  // Extract D1 character ID from the KV entry
  const idMatch = stored.text.match(/## D1-Character-ID:\s*(\S+)/);
  if (idMatch) {
    const d1Id = idMatch[1];
    // Query D1
    const db = c.env.RPG_DB;  // or env.RPG_DB — confirm binding name
    const row = await db.prepare('SELECT * FROM characters WHERE id = ?').bind(d1Id).first();
    if (row) {
      // Format D1 row as Markdown lore text
      const lore = formatD1CharToLore(row as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: lore }],
        key,
        meta: { ...stored.meta, d1_redirect: true, d1_id: d1Id }
      };
    }
    // Fallback: D1 entry missing
  }
}
```

### `formatD1CharToLore` helper

Create this function (in the same file or a shared util):

```typescript
function formatD1CharToLore(row: Record<string, unknown>): string {
  const lines: string[] = [];
  
  if (row.name) lines.push(`## Name\n${row.name}`);
  if (row.character_type) lines.push(`## Type\n${row.character_type}`);
  if (row.race) lines.push(`## Race\n${row.race}`);
  if (row.character_class) lines.push(`## Class\n${row.character_class}`);
  if (row.level !== undefined) lines.push(`## Level\n${row.level}`);
  if (row.hp !== undefined && row.max_hp !== undefined)
    lines.push(`## Health\n${row.hp} / ${row.max_hp}`);
  if (row.ac !== undefined) lines.push(`## Armor Class\n${row.ac}`);
  if (row.stats) {
    const stats = typeof row.stats === 'string' ? JSON.parse(row.stats as string) : row.stats;
    lines.push(`## Stats\n${Object.entries(stats).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`);
  }
  if (row.xp !== undefined) lines.push(`## XP\n${row.xp}`);
  if (row.faction_id) lines.push(`## Faction\n${row.faction_id}`);
  if (row.background) lines.push(`## Background\n${row.background}`);
  if (row.alignment) lines.push(`## Alignment\n${row.alignment}`);
  if (row.current_room_id) lines.push(`## Location\n${row.current_room_id}`);
  
  lines.push(`\n*Source: D1 database (auto-redirected from legacy KV entry)*`);
  
  return lines.join('\n\n');
}
```

## Migration Script (for later)

Once the redirect handler is deployed, a script should:

1. Iterate all KV `character:*` keys
2. For each, check if the corresponding `character_manage get` returns a D1 entry
3. If yes, update the KV entry with the redirect marker and D1 ID

## Edge Cases

| Case | Behavior |
|------|----------|
| KV entry has `D1-Migrated: true` but D1 ID missing | Return KV text as-is (no redirect) |
| KV entry has `D1-Migrated: true` and D1 ID, but D1 row deleted | Return KV text with `## D1-Stale: true` header |
| KV entry has `D1-Migrated: true` and D1 ID, D1 row exists | Auto-redirect, return formatted D1 lore |
| KV entry has no `D1-Migrated` line | Existing behavior — return KV text unchanged |

## Files to Modify

- `src/tools/system.ts` — add redirect logic in `handle_get_lore`
- (Optional) `src/rpg/utils/formatter.ts` — extract `formatD1CharToLore` as shared utility
- `src/tools/lore.ts` — no changes needed (set_lore/delete_lore don't participate)
- `src/__tests__/crud.test.ts` — add tests for redirect path

## Testing Strategy

1. Seed a KV entry `character:redirect-test` with `## D1-Migrated: true\n## D1-Character-ID: <real-d1-uuid>`
2. Call `get_lore({ query: "character:redirect-test" })`
3. Expect returned text to contain D1 fields (name, stats, etc.), not the KV text
4. Test fallback case with a bogus D1 ID
5. Test that non-migrated entries still return KV text unchanged