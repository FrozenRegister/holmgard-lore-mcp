## Repo hygiene: remove stray tracked files + fix CLAUDE.md doc drift

### Removed
- `lore-tools.ts` — a dead "Example of a modularized tool handler" stub at repo root, predating the real modularization. Nothing imported it, but it was wired into `tsconfig.json`'s `include` and type-checked on every run. Also removed from `tsconfig.json`.
- `test-run-output.txt` — a committed 171 KB test-run log (mojibake). Now gitignored.
- `patch-mcp.py` and `holmgard-lore-editor.html` — untracked from git (`git rm --cached`) and gitignored. `patch-mcp.py` was already listed in `.gitignore` but remained tracked.

### Changed
- `CLAUDE.md` **Architecture** section no longer claims "Single file worker: all logic lives in `src/index.ts`." It now describes the modular layout accurately and points to `ARCHITECTURE.md` as the authoritative source.
- `CLAUDE.md` **Commands** block corrected: `pnpm test` is `vitest run` (not `vitest --project workers`), `pnpm run build` is `wrangler deploy --dry-run --outdir dist` (not an esbuild bundle), and `pnpm test:live` uses `--config vitest.live.config.ts`.
