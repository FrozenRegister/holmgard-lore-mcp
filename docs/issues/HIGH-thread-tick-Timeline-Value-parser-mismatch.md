# Issue: `thread_tick` — No Entities Found Despite Valid `**Timeline-Value:**` Fields

**Severity:** HIGH
**Reported:** 2026-06-11
**Status:** Open

## Symptom

```
thread_tick({ thread_id: "thornwood-journey" })
→ "No entities with **Timeline-Value:** found for thread "thornwood-journey"."
```

This occurs even when `character:kavissa-crowmark` explicitly has:

```
**Timeline-Value:** 5
**Thread:** thornwood-journey
```

## Impact

**Blocks automatic timeline advancement.** The `thread_tick` tool is the primary mechanism for advancing world state between scenes or sessions. Without it:
- Timelines cannot progress
- Conditional events keyed to timeline values never fire
- The `list_consumption_timelines` tool likely returns incorrect results
- Narrators must manually update Timeline-Value fields instead of relying on `thread_tick`

## Root Cause Hypothesis

The `thread_tick` parser scans lore entries looking for `**Timeline-Value:** N` fields but fails to match them. Possible causes:

1. **Field format mismatch** — The parser expects raw **YAML frontmatter** (e.g. `timeline_value: 5` or `Timeline-Value: 5` in a `---` delimited block at the top of the entry) but the lore entries store values as markdown `**Key:** Value` notation within the body text.

2. **Regex pattern doesn't match markdown bold syntax** — If the parser uses `Timeline-Value:\s*(\d+)` it would work, but if it uses a stricter YAML-only parser like `front-matter` or `js-yaml`, it would silently skip the markdown fields.

3. **Thread field mismatch** — The parser may look for `**Thread:** <id>` in a specific section (e.g. only in a frontmatter block) and not find it.

## Evidence

- `character:kavissa-crowmark` has `**Timeline-Value:** 5` and `**Thread:** thornwood-journey` in the body of the lore entry (not in YAML frontmatter).
- `get_lore("character:kavissa-crowmark")` returns the entry correctly.
- `thread_tick("thornwood-journey")` returns zero entities.

## Reproduction

```js
// Verify entity has fields:
get_lore({ query: "character:kavissa-crowmark" })
// Look for **Timeline-Value:** N in the response

// Attempt tick:
thread_tick({ thread_id: "thornwood-journey" })
// → "No entities with **Timeline-Value:** found"
```

## Suggested Fix

1. Locate the `thread_tick` handler code in the MCP server (likely in `src/tools/` or `src/rpg/` directories).
2. Determine how it parses lore entry bodies for Timeline-Value fields.
3. If it uses a YAML frontmatter parser:
   - **Option A:** Add Timeline-Value and Thread to the YAML frontmatter of all character entries (requires bulk update).
   - **Option B:** Change the parser to scan the full body text with a regex like `/\\*\\*Timeline-Value:\\*\\*\s*(\d+)/i` instead of relying on YAML.
4. If the regex doesn't match:
   - Check for whitespace/non-printable characters between the colon and the value.
   - Check if `**Thread:**` matching uses a different regex that also fails.

## Workaround

Manually decrement `**Timeline-Value:**` on entities using `patch_lore` with the `replace` operation, or use `increment_topic_field`. Not automated but keeps timelines moving.