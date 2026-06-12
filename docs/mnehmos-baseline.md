# Mnehmos Upstream Baseline

This document records the baseline snapshot of the Mnehmos source repository from which our
RPG engine handlers were ported, and the intentional adaptations made during the port.

## Baseline

- **Repository:** Mnehmos (owner: external collaborator — URL stored in `MNEHMOS_REPO_URL` GitHub Actions secret)
- **Pinned commit:** `2feba24bcd45b4f7024caa5621f3476151a6bc3b`
- **Port date:** 2025 (Phase 3 of holmgard-lore-mcp, PR #67)
- **Files ported:** All handlers under `src/rpg/handlers/` and `src/rpg/utils/`

Each ported file carries a comment header recording its source path:

```
// Ported from Mnehmos v1.0.3 (2feba24bcd45b4f7024caa5621f3476151a6bc3b)
// Source: src/server/consolidated/<handler-name>.ts
```

## Intentional Adaptations

These changes were made deliberately during the port and should **not** be treated as
drift to reconcile when her upstream changes are reviewed.

1. **Node.js crypto → Web Crypto API**
   All `crypto.randomUUID()` calls were already compatible; `crypto.subtle` usages were
   adapted for the Workers runtime. (See PR #73 — "Replace Node.js crypto imports".)

2. **Express/Node.js bindings → Hono/Cloudflare Workers**
   - `req`, `res` params replaced by Hono `Context` (`c.env`, `c.req`)
   - Database passed as `env.RPG_DB` (D1 binding) rather than as a function argument
   - Middleware patterns use Hono's `app.use()` rather than Express middleware chains

3. **Module imports**
   Internal `.js` extensions removed from import paths (Workers ESM doesn't require them).
   `@anthropic-ai/sdk` replaced with Cloudflare Workers AI (`env.AI`) in `agent-manage`.

4. **Tool registration surface**
   Her handlers are individual functions; we wrap them in an action-router pattern
   (`lore_manage`, `entity_manage`, etc.) to reduce the MCP tool surface from 27+ to 9.

5. **D1 schema additions (migration 0003)**
   We added KV-native character columns (`alias`, `age`, `gender`, `weight_1`, `weight_2`,
   `kv_origin`, etc.) that do not exist in her schema. These are holmgard-specific.

## Change Detection

A GitHub Actions workflow (`.github/workflows/mnehmos-upstream.yml`) checks weekly for
changes in her repository since the baseline commit. When differences are found it opens
a GitHub Issue tagged `upstream-update` with a per-file diff summary.

**No automatic merging occurs.** Changes must be reviewed manually and ported deliberately,
respecting the adaptations listed above.

To trigger a manual check:

```
Actions → "Mnehmos Upstream Change Detection" → Run workflow
```

## How to Review an Upstream Update

1. Open the GitHub Issue created by the workflow.
2. For each changed file, compare the delta (what she changed) against our ported version.
3. Ignore any diff in the adaptation areas listed above — those are intentional.
4. Port genuinely new logic into the relevant `src/rpg/handlers/` file.
5. Update the `## Baseline` commit SHA in this file when a deliberate sync is complete.
