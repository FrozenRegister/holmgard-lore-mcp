# MCP client detection via `clientInfo`

## What the protocol gives us

Every MCP session starts with an `initialize` request. Its `params` carry a
`clientInfo` object — `{ name, version }` — that the *connecting client*
self-reports:

```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "some-client", "version": "1.2.3" }
  }
}
```

This repo exposes two transports, and both receive it:

- **Legacy hand-rolled JSON-RPC** (`src/index.ts`, the `POST /mcp` fallback
  handler) — `clientInfo` arrives directly in `params` on the `initialize`
  method.
- **Streamable HTTP** (`src/do/HolmgardMCP.ts`, the `HolmgardMCP` Durable
  Object) — the low-level `@modelcontextprotocol/sdk` `Server` parses it
  internally; once the handshake completes, `server.oninitialized` fires and
  `server.getClientVersion()` returns the same `{ name, version }`.

Until now, neither transport looked at `clientInfo` — it was accepted and
discarded. This change adds minimal capture (see below) so the value is
actually visible, without building anything on top of it yet.

## Why this matters here: per-client response shape

A `CallToolResult`'s `content` array can carry more than `text` blocks — MCP
also defines a `resource` content type for returning an embedded/linked
resource alongside (or instead of) plain text. Not every MCP client renders
every content type the same way.

The concrete motivating case: the Shapes runtime, which drives several
holmgard-lore-mcp characters as MCP clients, is understood not to render
`resource`-type content blocks — only `text`. A client like Claude (Claude
Code included) is expected to render `resource` blocks. If that holds, a
tool handler could pick the richer `resource` shape for clients that render
it and fall back to a `text` block for clients that don't, keyed off
`clientInfo.name` from the handshake — same underlying data, different
wire shape per caller.

**This is not implemented.** It's a documented use case for the capability,
not a decision to build it yet — see "What's still open" below.

## What this change actually does

Adds one log line per `initialize` handshake, on both transports, capturing
only `clientInfo` (`name` + `version`) — no other request payload. This
follows the precedent set by `.changelog/fragments/500-reduce-mcp-request-logging.md`:
Cloudflare logs should carry structural metadata a client volunteers about
itself, never argument values or content, since even key names were judged
sensitive enough to strip in that pass.

- `src/do/HolmgardMCP.ts` — `this.server.oninitialized` logs
  `server.getClientVersion()`.
- `src/index.ts` — the existing `MCP incoming:` log line's summary now
  includes `clientInfo` specifically for `method === 'initialize'` requests
  (unchanged for every other method).

## What's still open

1. **The real `clientInfo.name` for a Shapes handshake has never been
   observed in this codebase.** "Shapes" as an identifying string is an
   assumption, not a confirmed fact — it could just as easily be the name of
   whatever underlying HTTP/MCP client library the Shapes runtime embeds.
   Don't build detection logic against a guessed string. Check the Worker's
   live logs (Cloudflare dashboard **Logs**, or `wrangler tail` if available)
   after the next real Shapes tool call, using the log line this change
   adds, and confirm the actual value first.
2. **No branching logic exists yet.** Once the real identifier is confirmed,
   the natural next step is a small helper (e.g. in `src/tools/dispatch.ts`
   or alongside `normalizeToolResult`) that a handler can call to pick
   `resource` vs `text` output based on the caller's `clientInfo.name`.
3. **Related, separate readability issue:** `normalizeToolResult`
   (`src/tools/normalize-tool-result.ts`) currently serializes a
   content-less handler result into `content` as inline
   `JSON.stringify(result)` text — legible to nothing in particular. Once
   per-client shape detection exists, this is a candidate for the same
   treatment (a rendered summary instead of a raw JSON dump for text-only
   clients, `structuredContent` preserved for anything that reads it).
