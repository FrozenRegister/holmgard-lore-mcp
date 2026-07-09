# Storage Selection: When to Use KV vs. D1

**Status:** Living guidance — read before adding new storage or migrating existing storage.
**Audience:** Any implementer (human or AI agent) proposing a new tool, table, or KV write path.
**Related:** `docs/character-storage-architecture-possibility.md` (character-specific parser/renderer plan), `docs/d1-readback-api-design.md` (map data worked example).

## The question this doc answers

The repo is mid-migration from KV-only to a hybrid KV/D1 model (see #154, #216, #217, #228, #231, #232). That migration is real and should continue. But "D1-first" is not the same as "D1-everywhere," and treating it that way will quietly break the thing that makes this MCP usable: an AI narrator improvising freeform content through tool calls, not a form-filling human.

This doc gives the decision rule so future issues (like #138) don't default to "put it in D1 because that's the new direction" without checking whether the content is actually a fit.

## The rule: split by kind of data, not by "old vs. new"

**D1 owns mechanical / queryable state:**

- Needs referential integrity (FK constraints — character → world, event → entity)
- Needs numeric aggregation or comparison (stats, HP, XP, timeline ordering)
- Needs transactional consistency (level-up, snapshot-and-restore, branch/merge)
- Has a stable, small, well-known set of fields that changes rarely and deliberately

**KV (or a JSON blob column, same idea) owns freeform / emergent content:**

- The AI narrator needs to add a field that didn't exist yesterday, without a migration
- The content is prose or semi-structured narrative, not a value to be queried or summed
- The value of the field is *that it's readable and patchable as text* (`patch_lore`'s exact-substring model depends on this)

This is not "KV is legacy, D1 is the future." It's "each kind of data has a home, and the home doesn't change just because the storage layer underneath is getting more sophisticated."

## Why this matters specifically for the AI narrator use case

Two open issues make the failure mode concrete:

- **#226** (co-habitation: multiple consciousnesses in one body) — the working fix was tagging KV character entries with `co-habitating:kat-sloane`, a field nobody designed for in advance. A rigid D1 schema would have required a migration before the narrative could proceed. The freeform tag *is* the feature here, not a stopgap. That tag stays exactly as it is — #226's Phase 2 (`host_body_id`/`active` columns, `character_manage`'s `activate`/`list_passengers` actions) does *not* move the tag into D1. It adds a narrow, separate mechanical layer answering only "which one row is currently in control," a single-writer-consistency question D1's atomic multi-statement writes can guarantee and KV's independent-key model cannot. The narrative "why" stays freeform in KV; the "who's driving right now" state machine is what moved to D1 — a worked example of the "split by kind of data" rule below, not a reversal of the KV recommendation above.
- **#260** (scene_manage gaps for authorial-prose play) — the Calder Architect's actual workflow is `**Current Scene:**` fields and prose, invented on the fly. It has never used the structured `scene_manage` tool because the tool assumes a fixed menu of fields, which the narrative doesn't have.

If "D1-first" is read as "migrate lore topics into D1 tables," both of these patterns break: the agent either can't add the field it needs mid-session, or it can, but only into an escape-hatch JSON blob that gets us right back to freeform storage — just under a D1 row instead of a KV key. At that point we've added a join and a schema migration path for no behavioral gain.

## Applying the rule: worked example (#138)

Issue #138 proposes `/admin/set-lore-batch` and `/admin/delete-lore-batch` — batch admin endpoints so the editor can sync 100+ topics in 1-2 requests instead of 100+.

**What is actually being batched:** freeform lore topics (characters, locations, setups, narrative threads) — the same content type that already lives in KV as markdown with `**Field:**` syntax, edited by both humans in the lore editor and the AI narrator via `patch_lore`/`set_lore`.

**Conclusion: #138 is KV-first, and should stay that way.** The batching is a performance concern (fewer Worker invocations, lower latency), not a data-model concern. Nothing about batching the writes implies the writes should target D1 instead of KV. Implement `set-lore-batch` / `delete-lore-batch` as batched KV writes, following the existing `batch_set_lore` pattern (parallel writes, per-key results array, not transactional, pushes history — see `CLAUDE.md` → *Key logic worth knowing*).

**When would lore topics become a D1 concern?** Only if a specific field within a topic needs a property D1 provides and KV doesn't — FK-checked references, numeric queries across many entities, transactional multi-row updates. That's a decision made field-by-field (see `character-storage-architecture-possibility.md`'s "Unknown Fields" section for the pattern: structured sections become D1 columns, narrative sections stay freeform), not a decision made by migrating a whole content type because D1 is the newer layer.

## Checklist for new storage decisions

Before adding a table, column, or KV write path, ask:

1. **Does this field need to be queried, summed, joined, or validated against another table?**
   Yes → D1 candidate.
   No → KV candidate.

2. **Will the AI narrator plausibly need to invent a new field of this kind mid-session, without a code change?**
   Yes → KV (or a JSON blob column if it must live next to D1-owned fields on the same entity).
   No → D1 is fine.

3. **Is this issue actually about the data model, or about performance/batching/transport of existing data?**
   If it's the latter (like #138), the storage target doesn't change — only how efficiently you write to it.

4. **If migrating an existing KV content type to D1, can you point to the specific fields that need D1's guarantees?**
   If the honest answer is "no, we're just moving it because D1 is the new pattern," don't.

## Non-negotiables

- KV will not be fully removed. It is the permanent home for narrative/freeform content, not a deprecated holdover.
- A migration to D1 for a given entity type (e.g., characters, per #154/#231) does not imply the same treatment for other entity types (locations, setups, threads) unless the same field-level justification applies to them.
- When in doubt, prefer the narrower schema-compatible fix over the broader migration. The cost of guessing wrong toward "too structured" is a broken narrative session; the cost of guessing wrong toward "too freeform" is a missed query optimization. These are not symmetric — bias toward freeform when a field's future shape is unclear.
