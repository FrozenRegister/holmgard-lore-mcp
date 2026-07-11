# Issue: Published `inputSchema`s Drift From Zod Handler Schemas — Two Confirmed Occurrences

**Severity:** HIGH
**Reported:** 2026-07-11
**Status:** Fixed (both known occurrences); underlying systemic risk not fixed

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

## Second occurrence: `append_event` missing `world_id`/`entity_id` (#267)

The same root cause — **the published `inputSchema` in `src/tools/definitions.ts` and the Zod schema actually enforced server-side (`appendEventSchema` in `src/tools/meta.ts`) are two independently-maintained sources of truth that can silently drift** — produced a second, differently-shaped bug: `continuity_manage`'s `append_event` branch never listed `world_id`/`entity_id` in its `properties`, and had `additionalProperties: false`. The D1 dual-write logic behind those two fields was fully implemented and passing tests since #223; the only thing broken was that no caller following the documented schema could ever discover or supply them. `#267` reported this as "D1 write paths still not wired," but the write path was fine — the API surface just never told anyone it existed.

This confirms the risk described above is systemic, not a one-off: **`src/index.ts`'s `tools/call` handler does not validate `args` against the published `inputSchema` at all** — it passes `args` straight to the Zod-validated handler (see `src/index.ts` around the `tools/call` branch). So the published schema is *purely advisory* to callers and has no server-side enforcement keeping it honest. Anything server-side (this repo's own tests, `tests/live/*`) that calls tools directly with extra fields will keep working even if those fields quietly fall out of the advertised schema — the drift is invisible until a real schema-validating client (or a human reading the docs) hits it.

### Suggested follow-up (not done here — scoped fix only, twice now)

- Add a comprehensive drift-detection test: for every `oneOf` branch across all five action-dispatch tools, assert its advertised `properties` keys are a superset of what the corresponding Zod schema's `.shape` accepts. This would catch future occurrences at PR time instead of one field at a time after a live client hits it.
- Alternatively, derive `inputSchema` from the Zod schema directly (e.g. `zod-to-json-schema`) so there is only one source of truth instead of two hand-maintained ones. This is a larger refactor (`ToolDefinition.inputSchema` is currently a hand-written `Record<string, any>` for every tool) and out of scope for a bug-fix PR.
