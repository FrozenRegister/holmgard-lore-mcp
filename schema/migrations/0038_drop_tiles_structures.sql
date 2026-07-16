-- #322: drop the legacy square-grid tiles/structures tables, retired by
-- #320's world_map.ts rewrite to hexes/landmarks (axial q,r coordinates).
--
-- Precondition per the issue: every active world confirmed migrated into
-- hexes/landmarks before this merges. Verified directly against production
-- (2026-07-16): tiles, structures, hexes, and landmarks are all empty (0
-- rows) — no world has ever had square-grid or hex-grid geography rows, so
-- there is no data to lose and nothing to migrate. No code in src/ has read
-- or written these tables since #320 (confirmed via full-repo search); the
-- two "hidden coupling" reads #320 flagged (encounter-manage.ts,
-- biome-manage.ts) were already repointed at hexes.

DROP TABLE IF EXISTS structures;
DROP TABLE IF EXISTS tiles;
