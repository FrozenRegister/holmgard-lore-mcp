# Issue: 5 Tool `inputSchema`s Missing Root `type: 'object'` — Broke Strict MCP Clients

**Severity:** HIGH
**Reported:** 2026-07-11
**Status:** Fixed

## Symptom

Connecting the deployed worker as a real MCP server (`claude mcp add --transport http`) succeeded at `initialize`, but `claude mcp list`/`claude mcp get` reported `Connected · tools fetch failed` with:

```text
Issue: Invalid input: expected "object" (at tools.0.inputSchema.type) (+4 more)
```

The tool never surfaced to the client — `tools/list` returned valid JSON over raw `curl`, but a strict MCP SDK client rejected the payload before any tools were usable.

## Root Cause

`src/tools/definitions.ts` defines five action-dispatch tools (`lore_manage`, `entity_manage`, `world_manage`, `scene_manage`, `continuity_manage`) whose `inputSchema` root was:

```ts
{
  $schema: 'http://json-schema.org/draft-07/schema#',
  oneOf: [ { type: 'object', ... }, { type: 'object', ... }, ... ],
}
```

Every *branch* of `oneOf` correctly declares `type: 'object'`, but the schema *root itself* never does. That's valid JSON Schema on its own, but the MCP spec requires a tool's `inputSchema` to itself be `{ type: "object", ... }` at the top level — `oneOf` alone at the root isn't sufficient for spec-compliant clients, even though it's semantically equivalent (every branch is already object-typed).

This went undetected for as long as it did because **this repo's own test suite never exercises a real MCP SDK client** — `tools/list` assertions (`protocol-basics.test.ts`) checked tool *names* only, and `tests/live/*` call the JSON-RPC endpoint directly via `fetch`, which has no schema-conformance layer. A bare `curl`/`fetch` client doesn't care whether `type: 'object'` is present; the Claude Code CLI's MCP client does.

The other tools (`rpg`, `agent_manage`, `search_tools`, `load_tool_schema`) were unaffected — they declare `type: 'object'` with `properties`/`required` directly, no root-level `oneOf`.

## Fix

Added `type: 'object'` alongside `$schema`/`oneOf` at the root of all five schemas (`LORE_MANAGE_SCHEMA`, `ENTITY_MANAGE_SCHEMA`, `WORLD_MANAGE_SCHEMA`, `SCENE_MANAGE_SCHEMA`, `CONTINUITY_MANAGE_SCHEMA` in `src/tools/definitions.ts`). Purely additive — every existing `oneOf` branch already satisfied `type: 'object'`, so no request that validated before is rejected now.

Added a regression test (`protocol-basics.test.ts`): `tools/list` response is asserted to have `inputSchema.type === 'object'` for every tool, which would have caught this on the first PR that introduced a root-level `oneOf`.

## Lesson

When adding a new tool whose `inputSchema` uses `oneOf`/`anyOf`/`allOf` at the root (the action-dispatch pattern used throughout this repo), the root object must **also** declare `type: 'object'` even though every branch already does. This repo's own fetch-based test harness cannot catch a violation of this rule — only a real MCP client (or a dedicated assertion like the one added here) will.
