## chore: stop logging full request bodies in the /mcp handler

The `/mcp` handler no longer logs the raw incoming request body on every call, which previously dumped full lore/narrative prose into Cloudflare logs on every `set`/`patch`/`batch_set`. It now logs only the JSON-RPC `method`, and for `tools/call` also the tool `name` — no argument keys or values, per red-team feedback on #500 that even key names can leak structural intent.
