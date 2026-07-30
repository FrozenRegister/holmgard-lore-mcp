issue: 546
summary: Extract shared dispatchToolCall() across the JSON-RPC and DO transports
---

- **New `src/tools/dispatch.ts`** — Pure function `dispatchToolCall()` that encapsulates the previously-duplicated `ping`/`auth_check` special-casing and `toolRegistry` lookup logic. Eliminates hand-copied decision trees from both `src/index.ts` (legacy JSON-RPC transport) and `src/do/HolmgardMCP.ts` (Streamable HTTP via Durable Object). Both transports maintain their own response formatting and auth strategies; `dispatchToolCall()` owns only the tool resolution decision itself.
- **New tests: `tests/unit/dispatch.test.ts`** — 100% coverage on all dispatch branches: `ping` short-circuit (both authenticated states), `auth_check` short-circuit (authenticated/not-authenticated responses), fallthrough for non-special lore_manage actions, registry lookup for other tools, and not-found case.
- **No behavior change** on either transport — this is pure refactoring. Existing `ping`/`auth_check` responses, response shapes, and auth gating remain identical.
