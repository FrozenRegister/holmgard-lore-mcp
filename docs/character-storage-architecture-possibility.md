# Character Storage Architecture Summary (Holmgard)

**Status:** Historical design doc — substantially implemented, not an open proposal. The
Markdown ↔ D1 pattern this doc argues for is largely built: a `characters` D1 table
(`schema/rpg-schema.sql`), a markdown→D1 parser (`src/rpg/utils/kv-to-d1.ts`), a bulk
KV→D1 migration utility with `## D1-Migrated: true` redirect markers
(`src/rpg/utils/migrate-kv-to-d1-bulk.ts`), and a D1→markdown projection sync
(`src/rpg/utils/character-sync.ts`'s `syncCharacterToKv`) all exist and are wired in
(see #154/#231). **For the current, authoritative KV-vs-D1 decision framework, see
`docs/storage-selection-kv-vs-d1.md`** — this doc is kept because that one still cites
its "Unknown Fields" section (below) as the live pattern for splitting a topic's
structured fields (→ D1 columns) from its freeform narrative fields (→ stays in KV
markdown text). Treat everything else below as historical rationale, not a live
"possibility" still being decided.

---

## Executive Summary

The editor should remain **Markdown-first**, while the backend evolves toward **structured D1-first storage**.

The goal is not to replace markdown.

The goal is:

```text
Markdown
    ↕
Parser / Renderer
    ↕
Domain Model
    ↕
D1
````

Users and AI continue editing markdown.

The system converts markdown into structured entities and stores those entities in D1.

***

# Core Design Principles

## 1. Markdown is the Editing Interface

Do not force users into forms.

The existing lore editor works because:

* humans like writing markdown
* AI writes markdown naturally
* templates already exist
* lore remains readable outside the application

Markdown should remain the primary authoring format.

***

## 2. D1 is the Source of Truth

For characters:

D1 should eventually own:

* identity
* inventory
* stats
* status
* relationships
* location
* goals
* tags
* structured metadata

The application should never need to parse lore text at runtime just to discover whether someone owns a sword or is in a city.

That information should already be structured.

***

## 3. KV Becomes a Projection Layer

KV should not compete with D1.

Instead KV acts as:

* cache
* compatibility layer
* legacy support layer
* markdown projection storage

Recommended direction:

```text
D1
 ↓
Markdown Renderer
 ↓
KV Projection
```

***

# Character Read Flow

```text
Load Character
      ↓
Read D1
      ↓
Render Markdown
      ↓
Display in Lore Editor
```

The editor still receives markdown.

Users never see raw D1 rows.

***

# Character Save Flow

```text
User edits markdown
          ↓
Parser
          ↓
Structured Character Model
          ↓
Validation
          ↓
D1
          ↓
Generate Markdown Projection
          ↓
KV
```

All writes ultimately pass through the same pipeline.

***

# Human and AI Editing Should Use the Same Path

Avoid:

```text
Human
  ↓
Markdown
  ↓
D1

AI
  ↓
Custom Tool
  ↓
D1
```

because the two paths will eventually diverge.

Instead:

```text
Human
  ↓
Markdown
  ↓

AI
  ↓
Markdown
  ↓

Shared Parse Pipeline
          ↓
          D1
```

One write path.

One validation path.

One source of truth.

***

# Parser Contract

The parser should operate on predictable markdown structures.

Example idea:

```md
# Aldric

## Stats

- Strength: 12
- Agility: 8

## Inventory

- Sword
- Cloak

## Relationships

- Friend: Elara

## Narrative

Aldric was born...
```

The parser should rely on stable sections rather than arbitrary text extraction.

Narrative sections remain freeform.

Structured sections become structured D1 fields.

***

# Unknown Fields

Future AI-generated content will create fields that do not exist today.

Example:

```md
## Reputation

- Northern Clans: Trusted
```

The system should not silently discard unknown fields.

Preferred approach:

* preserve them
* store them as extensible metadata
* allow future schema migrations to formalize them

***

# Migration Strategy

## Phase 1

No breaking changes.

* Existing markdown stays untouched
* Existing KV entries stay untouched
* Parser introduced
* D1 representation generated

## Phase 2

New characters become D1-first.

```text
Create Character
      ↓
D1
      ↓
Markdown Projection
      ↓
KV
```

## Phase 3

Character reads become D1-first.

KV remains:

* cache
* compatibility layer
* markdown projection

***

# Future Conflict Resolution

Current conflicts happen at the text level.

Long-term possibility:

```text
Local Markdown
        ↓
     Parse
        ↓
 Structured Model

Remote Markdown
        ↓
     Parse
        ↓
 Structured Model

       Merge
         ↓
 Re-render Markdown
```

This allows semantic merges instead of line-based merges.

***

# Most Important Architectural Decision

Do NOT think:

"Move markdown into D1."

Think:

```text
Markdown
    ↕
Domain Model
    ↕
D1
```

The domain model becomes the contract.

Benefits:

* Markdown editor remains unchanged
* Future form editors become possible
* Future graph editors become possible
* MCP tools can operate on structured state
* AI can reason over structured entities
* D1 remains normalized and queryable

***

# Final Recommendation

For characters:

* Markdown remains the authoring experience.
* D1 becomes the authoritative source of truth.
* KV becomes a projection/cache/compatibility layer.
* Introduce a deterministic parser + renderer between markdown and D1.
* Human edits and AI edits must use the same persistence pipeline.

```
```
