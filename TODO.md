# Holmgard MCP — Backlog

## ~~Narrative Event Log (deferred)~~ — Done

The dedicated tool this item deferred building has since been implemented: `continuity_manage`'s
`append_event`/`get_event_log` actions (`handle_append_event`/`handle_get_event_log` in
`src/tools/meta.ts`) write and read per-entity `events:<entityKey>` KV logs — the same convention
this item proposed, just as a first-class tool rather than a `patch_lore`-append convention. Covered
by `tests/worker/thread-tracking.test.ts` and `tests/worker/narrative.test.ts`. `events:*` keys are
also already excluded from `kvList()` (see `src/lib/kv.ts` and CLAUDE.md's "Exclude Indexes from
kvList" section).

## Toolset scoping via URL path/header (precedent: GitHub's remote MCP server)

Not urgent — revisit when this repo is next actively worked, not before. Noted here so the idea
isn't lost between sessions.

GitHub's remote MCP server (`api.githubcopilot.com/mcp`) scopes which of its ~90 tools a connection
sees via the URL path plus an optional header, rather than exposing everything to every caller:

- `/mcp` — the curated "default" toolset (~30 tools)
- `/mcp/x/all` — every tool across every toolset
- `/mcp/x/{toolset}` — exactly one named toolset (path form is single-toolset only)
- `X-MCP-Toolsets: repos,issues` header — combine several named toolsets in one connection, when
  the path's single-toolset limit isn't enough

All of this is served by one implementation that filters `tools/list`/gates `tools/call` based on
the parsed path/header — not separate deployments per toolset.

If this repo ever wants finer-grained exposure — e.g. a caller that only wants `lore_manage` /
`entity_manage` reads without the RPG combat/party/quest surface, or vice versa — this is a cheap,
well-precedented pattern to reach for: group the existing 10 top-level tools into named toolsets
(e.g. `lore`, `rpg`, `meta`) and route `/x/{toolset}` / `X-MCP-Toolsets` through the same kind of
allow-list filter already used for `tools_allowlist` on a room's registered MCP server config
(see the FrozenRegister/infra `talk-shapes-inc-http-api.md` doc — shapes.inc rooms already support
per-server `tools_allowlist`/`resources_allowlist` on the platform side, independent of anything
the MCP server itself does).

This came up while scoping a separate, unrelated capability (generic per-shape Knowledge-base sync
for non-Holmgard story/roleplay agents) that was deliberately kept out of this repo — it's a
different domain (freeform narrative/RPG vs. generic shape-definition sync) and toolset scoping
wouldn't have changed that call. It's recorded here purely as a mechanism worth knowing about for
this repo's *own* future toolset design, not as a reason to import that other capability.
