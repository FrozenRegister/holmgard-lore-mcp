## docs: document MCP clientInfo client-detection and capture Shapes handshake info

Adds `docs/mcp-client-detection.md` describing how the MCP `initialize`
handshake's `clientInfo` field could be used to serve different content-block
shapes per calling client (e.g. `resource` blocks for clients that render
them, `text` for ones that don't — motivated by Shapes not rendering
`resource` blocks). No detection logic is added yet. Both transports
(`src/do/HolmgardMCP.ts`, `src/index.ts`) now log the handshake's `clientInfo`
(name + version only, no payload, per the #500 logging precedent) so the next
real Shapes-agent handshake confirms its actual self-reported identity before
anything gets built on an assumption.
