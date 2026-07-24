---
type: fix
issue: 541
summary: Fix toolRegistry/definitions sync check and add missing `character_manage` definition
---

- **`character_manage` added to `toolDefinitions`** — The `character_manage` tool was registered in `rpgToolRegistry` but missing from the `toolDefinitions` array, causing the new `check-tool-registry-sync.mjs` CI check to fail. Added the full `ToolDefinition` entry (name, title, description, and `inputSchema`) to `src/rpg/meta-definitions.ts`.
- **Fixed `extractDefinitionNames` regex in sync check** — The script's regex (`/^    name:/`) only matched expanded definition entries (`    name: 'tool'` at 4-space indent) but missed compact entries (`  { name: 'tool' }` at 2-space indent). Updated to `/^ {2,4}(?:\{ )?name:\s*'(\w+)'/gm` to match both formats while excluding nested schema properties at 6+ spaces.
- **Updated test expectations** — `tests/worker/protocol-basics.test.ts` and `tests/worker/do-transport.test.ts` now expect 10 tools (was 9), reflecting the addition of `character_manage`.
