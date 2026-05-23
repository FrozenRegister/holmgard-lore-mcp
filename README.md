```txt
# Holmgard Lore MCP

A Cloudflare Worker backend implementing a minimal JSON-RPC / MCP interface for storing and retrieving Holmgard lore in a KV namespace.

## Overview

This project exposes:
- `/mcp` for JSON-RPC and MCP-style tool discovery
- `/admin/set-lore` and `/admin/delete-lore` for authenticated lore management
- Cloudflare KV storage using the `LORE_DB` binding
- in-memory fallback storage when KV is unavailable

## Requirements

- Node.js
- npm
- Cloudflare Wrangler
- Cloudflare account with a KV namespace bound as `LORE_DB`
- optional `ADMIN_SECRET` environment variable for admin endpoints

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

This runs `wrangler dev dist/index.js --local` after building the Worker bundle.

## Build

```bash
npm run build
```

## Deploy

```bash
npm run deploy
```

## Type generation

For generating/synchronizing types based on your Worker configuration:

```bash
npm run cf-typegen
```

## Configuration

The Worker config is in `wrangler.jsonc`.

Important bindings:
- `LORE_DB` — Cloudflare KV namespace used for lore storage
- `ADMIN_SECRET` — environment variable used by `/admin/set-lore` and `/admin/delete-lore`

Example `wrangler.jsonc` KV binding:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "LORE_DB",
      "id": "your-kv-namespace-id"
    }
  ]
}
```

## Supported JSON-RPC methods

### RPC entrypoint

`POST /mcp`

All requests must use JSON-RPC 2.0 and include a `method` field.

### Methods

- `initialize`
  - returns server metadata and MCP tool discovery capability
- `ping`
  - returns an empty success response
- `tools/list`
  - returns available tools and their input schemas
- `tools/call`
  - invokes a named tool by passing `params.name` and `params.arguments`
- `list_topics`
  - returns a list of available topic keys
- `get_lore`
  - returns lore for a given `key` or `query`

## Supported tools via `tools/call`

Tool names and parameters:

- `ping_tool`
  - no arguments
- `get_lore`
  - `key` or `query` (string)
- `list_topics`
  - no arguments
- `set_lore`
  - `key` (string)
  - `text` (string)
- `delete_lore`
  - `key` (string)
- `get_lore_batch`
  - `keys` (array of strings)
- `list_consumption_timelines`
  - `status_filter` (enum: `all`, `imminent`, `days-to-weeks`, `weeks-to-months`, `consumed`)
- `list_active_threads`
  - no arguments
- `increment_topic_field`
  - `key` (string)
  - `field_path` (string)
  - `increment` (number, default `1`)
  - `reason` (string)
- `validate_topic_exists`
  - `query_string` (string)

## Example JSON-RPC request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_lore",
    "arguments": {
      "query": "lamia"
    }
  }
}
```

## Admin endpoints

### `POST /admin/set-lore`

Request body:

```json
{
  "key": "lamia",
  "text": "Lamia are subterranean predators...",
  "secret": "your-admin-secret"
}
```

### `POST /admin/delete-lore`

Request body:

```json
{
  "key": "lamia",
  "secret": "your-admin-secret"
}
```

Both endpoints require `ADMIN_SECRET` to be configured in the Worker environment.

## Notes

- CORS is enabled for all origins on `/mcp`
- Batch JSON-RPC requests are not supported
- The project uses `esbuild` to bundle `src/index.ts` into `dist/index.js`
- `dist/` is generated output and should not be edited directly

## Project scripts

- `npm run build` — bundle the Worker
- `npm run dev` — run local Wrangler dev
- `npm run deploy` — deploy to Cloudflare
- `npm run clean` — remove `dist`

## Local testing

Run the Worker locally with:

```bash
npm run dev
```

Example `curl` request against the `/mcp` endpoint:

```bash
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_lore","arguments":{"query":"lamia"}}}'
```

## Example responses

### `initialize`

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": { "list": true, "call": true } },
    "serverInfo": { "name": "holmgard-lore-mcp", "version": "0.2.0" }
  }
}
```

### `tools/list`

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_lore",
        "title": "Get Lore",
        "description": "Retrieve lore, anatomy, factions, and worldbuilding information.",
        "inputSchema": { ... }
      }
    ]
  }
}
```

### `tools/call` `get_lore`

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "Lamia are subterranean predators..." }],
    "key": "lamia",
    "text": "Lamia are subterranean predators...",
    "meta": { "version": 1, "updatedAt": "2026-05-23T00:00:00.000Z" }
  }
}
```

## Environment variables

Set `ADMIN_SECRET` in your Cloudflare Worker environment to protect admin endpoints.

For local development, you can use a `.env` file or pass the secret into Wrangler using the environment configuration.

