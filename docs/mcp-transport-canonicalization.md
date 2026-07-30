# MCP Transport Canonicalization: the shared core is canonical, not either transport

**Status:** Accepted (2026-07-30) — decision record, and living guidance for anyone touching `/mcp`.
**Audience:** Any implementer (human or AI agent) adding a tool, changing dispatch, or wondering which `/mcp` code path to edit.
**Decides:** #548 (Phase 7 of the #540 gameplan), and #539's Q7 ("should we just use the official SDK?").
**Related:** `ARCHITECTURE.md` → *Why two `/mcp` code paths*, `src/tools/dispatch.ts`, `src/do/HolmgardMCP.ts`, `docs/storage-selection-kv-vs-d1.md` (the precedent for this kind of doc).

## The question this doc answers

`/mcp` has two independent implementations of the MCP protocol surface:

- **`src/index.ts`'s hand-rolled JSON-RPC handler** (`app.post('/mcp')`). Built first. Carries all current traffic and every one of the repo's live smoke tests.
- **`src/do/HolmgardMCP.ts`**, the `HolmgardMCP` Durable Object — an `McpAgent` on top of `@modelcontextprotocol/sdk`'s low-level `Server`, added later for spec-compliant Streamable HTTP. Mounted on the same path via `HolmgardMCP.serve('/mcp', …)`.

Phases 0–6 of #540 removed the *duplicated registration and dispatch logic* between them but deliberately did not pick a winner. #548 asked which one is authoritative going forward.

**The premise of that question turns out to be slightly wrong, and that's the decision.**

## The decision

### 1. Neither transport is canonical. The shared core is.

`dispatchToolCall()` (`src/tools/dispatch.ts`) plus `toolRegistry` (`src/tools/registry.ts`) is the authoritative implementation of what a tool *is* and what a `tools/call` means. Both transports are adapters over it.

**The operative rule: no logic lives in a transport.** A transport's only job is to translate its wire format into a call on the shared core and translate the result back. Anything else — a new tool, a new action, a special case, a lock, an auth nuance, a validation step — goes into a shared module under `src/tools/` or `src/lib/`, never into `src/index.ts`'s `/mcp` handler or into `HolmgardMCP.ts`.

This is not a stylistic preference. It is the rule whose absence caused the `WORLD_LOCKS` incident (#512/#519): an in-memory lock written into the DO path protected only the DO path, and the JSON-RPC handler — the one every test and most real callers actually hit — silently got nothing. Any logic placed in one transport is, by construction, a bug in the other.

`tests/worker/two-transport-parity.test.ts` (#547) is the enforcement mechanism. It is not an optional nicety; it is what makes this rule checkable.

### 2. The Durable Object is the *public* MCP surface.

Canonicality of implementation and canonicality of *surface* are separate questions, and conflating them is what made #548 hard.

The DO speaks the actual MCP spec transport (Streamable HTTP, 2025-03-26). It is what a spec-compliant client — Claude.ai custom connectors, Claude Desktop remote MCP, MCP Inspector, the official SDK's client — will use. So:

- **The DO is what we document and advertise** as "the Holmgard MCP server." External integration instructions point at Streamable HTTP.
- **The DO is what future live smoke tests should cover.** Today zero of the 36 files in `tests/live/` exercise it; every one uses `rpc()` against the JSON-RPC path. That's a real gap in coverage of the surface we tell outsiders to use, and it should be closed.
- **The hand-rolled JSON-RPC handler is a private/legacy surface**, not the public one. Its `tools/call` and `tools/list` are supported compatibility, not the recommended entry point.

### 3. The hand-rolled handler stays — its real job is the bare-method aliases.

The JSON-RPC handler is not going away, and not because of inertia. It has a permanent job the DO **structurally cannot do**.

`list_topics`, `get_lore`, `get_lore_batch`, `get_topic_histories`, and `get_world_biomes` are bare JSON-RPC methods that return structured payloads directly in `result` — not MCP content blocks. They are deliberately non-spec. `CLAUDE.md`'s API-surface convention documents them as the repo's read surface ("register a bare-method alias that returns the structured payload directly in `result`"), and `holmgard-lore-editor`'s `rpc()` transport depends on them.

The MCP SDK's `Server` has no concept of a non-spec bare method. There is no way to serve these through the DO without putting a non-SDK pre-router in front of it — at which point you have re-created the hand-rolled handler.

**So the two paths are not two implementations of one product.** They are two products sharing a core: an MCP server (the DO) and a private JSON API for the editor (the hand-rolled handler). Read that way, "which is canonical?" is a category error, and the answer in §1 is the only coherent one.

### 4. Registration: finish the homegrown `register.ts` cutover. Do not adopt `McpServer.registerTool()`.

This settles #539's Q7. Phases 1–4 registered all ten tools into `src/tools/register.ts` via `registerTool()`, but nothing reads from it yet — the "parallel path, no cutover" rule held four times running. Finish it: make `tools/list` read from `getTools()`/`getToolDefinition()` and retire the hand-written `toolDefinitions` array in `src/tools/definitions.ts`.

Why not the SDK's `McpServer.registerTool()`, given §2 makes the DO the public surface:

- **It would reverse a considered choice, not fill a gap.** `HolmgardMCP.ts` deliberately uses the low-level `Server` and returns `toolDefinitions` verbatim, with an explicit comment: *"no round-trip through `McpServer.tool()`."* `McpServer` re-derives JSON Schema from Zod on its own terms; the current code keeps exact control over the schema shipped to clients. `tests/live/protocol.test.ts` asserts on specific schema structure (`continuity_manage`'s `oneOf` branches, per #267) — that control is load-bearing.
- **It only serves one of the two consumers.** `McpServer` can back the DO's `tools/list`. It cannot back the bare-method aliases (§3). Adopting it means the registry has an SDK-shaped half and a hand-rolled half — exactly the split #539 exists to eliminate.
- **`register.ts` already works and is already paid for.** It holds all ten tools, has its own unit-test tier, and needs a cutover, not a replacement.

The `rpg` tool's `SUB_MAP` mega-dispatcher stays excluded, per #544.

### 5. Two latent divergences are bugs and get their own issues.

Post-Phase-5/6, four things still differ between the transports. Two are intentional; two are not.

**Intentional — documented here, not to be "fixed":**

- **Auth asymmetry.** JSON-RPC computes a real per-request `isAuthenticated` via `getIsAuthenticated()` and passes it to the handler. The DO hardcodes `authenticated: true`, because the Hono middleware gates the request (`unauthorizedIfNeeded(c, null, 401)`, `src/index.ts:1919`) before it ever reaches the DO. #546 preserved this deliberately; `dispatchToolCall`'s `authenticated` is an input the caller computes, not something it derives.
- **Bare-method gap.** Per §3, structural and permanent.

**Not intentional — filed as follow-ups:**

- **The synthetic context stubs every header to `null`.** `src/do/context-adapter.ts` returns `req: { header: () => null }`. Any handler that reads a request header behaves differently under the DO, silently. Today's handlers reportedly only touch `c.env`, `c.req.header()`, and `c.json()`, which makes this survivable — but it is a trap with no guardrail, and the next handler to read a header will hit it without warning.
- **The DO's result unwrap assumes a shape it never checks.** `HolmgardMCP.ts:69` does `return json.result ?? { content: [{ type: 'text', text: 'ok' }] }` — assuming every handler's JSON-RPC `result` is already MCP-content-block shaped. Nothing verifies that. A handler returning a structured non-content-block `result` (which is exactly what the bare-method convention encourages elsewhere in the codebase) would be handed to a spec client as a malformed `CallToolResult`.

## What this means in practice

When you touch `/mcp`, ask in this order:

1. **Am I adding logic?** Then it goes in `src/tools/` or `src/lib/`, reachable via `dispatchToolCall()`. Not in either transport. If you find yourself editing both `src/index.ts` and `HolmgardMCP.ts` to make one change, stop — the change belongs in the core.
2. **Am I adding a tool?** Register it once via `registerTool()` (`src/tools/register.ts`). Both `tools/list` paths must see it without further edits.
3. **Am I adding a read for a programmatic client (the editor)?** Bare-method alias on the JSON-RPC path, per `CLAUDE.md`'s API-surface convention. This is the one case where "JSON-RPC only" is the correct answer.
4. **Am I changing a response envelope?** That is transport-local by design (`DispatchResult` → Hono `c.json(...)` vs. MCP `{ content, isError }`). Change it in one transport only if the difference is genuinely a wire-format concern; add a parity-test case either way.
5. **Am I about to put a lock, cache, or any cross-request state in a transport?** Re-read `WORLD_LOCKS` in `CLAUDE.md`'s simulation-layer section first. The answer is no.

## Alternatives considered and rejected

**Make the DO fully canonical; turn the JSON-RPC handler into a thin shim into the SDK `Server`.** The purest reading of "one implementation, two transports," and the standards-compliant answer in the abstract. Rejected on cost-versus-benefit: it routes all current traffic through a Durable Object (extra hop, per-session state, added cost) and requires rewriting the transport of every test in the repo — to eliminate roughly 20 lines of envelope formatting per side, since Phase 5 already extracted the substantive duplication. And it does not even reach its own goal: the bare-method aliases still need a non-SDK pre-router (§3), so the shim can never own the whole surface. Revisit only if Streamable HTTP becomes the dominant traffic path in practice.

**Declare the JSON-RPC handler canonical and the DO a conformance shim.** Zero work, and an accurate description of today's traffic and tests. Rejected because it enshrines the non-spec path as authoritative. It would make the standards-compliant surface permanently second-class and give the wrong answer to "where does new logic go?" — the question that actually causes bugs here.

**Remove the DO entirely.** Genuinely simpler: ~84 lines plus the context adapter, the `MCP_OBJECT` binding, and a `deleted_classes` migration. Rejected because it permanently forecloses Claude.ai custom connectors and any official-SDK client, for a server whose whole purpose is being talked to by AI narrators. The DO's cost while idle is negligible; the cost of not having it the day a spec client matters is a migration.

**Defer again with revisit criteria.** Rejected: #540 Phase 7 exists precisely because the decision was already deferred once, and Phases 5/6 delivered the concrete shared core needed to decide it non-abstractly. Deferring twice makes the placeholder permanent.

## Follow-up work this decision implies

None of it is done here — this doc is the decision, not the implementation.

| What | Scope |
| --- | --- |
| Cut `tools/list` over to `register.ts`; retire `toolDefinitions` | §4 — the last unrealized phase of #539/#540's registration work |
| Fix the synthetic-context header stub (#620) | §5 — latent correctness bug |
| Fix (or validate) the DO's `json.result` unwrap (#621) | §5 — latent correctness bug |
| Add live smoke coverage for the Streamable HTTP path | §2 — the advertised surface currently has zero live tests |
