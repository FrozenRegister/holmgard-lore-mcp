### CI/CD — automated D1 migration deploy
- Adds `.github/workflows/d1-migrate.yml`: runs `wrangler d1 migrations apply holmgard-rpg --remote` automatically on every push to `main` that touches `schema/migrations/**`.
- Closes the gap where Cloudflare Workers Builds deploys the *code* on every push but never ran D1 migrations — migrations 0007/0008 sat unapplied in production for days after merging as a result, silently breaking `character_snapshots` and the `host_body_id`/`active` co-habitation columns. Both were applied directly to production and backfilled into `d1_migrations` as part of this fix.
- Requires `CLOUDFLARE_API_TOKEN` (D1:Edit scope) and `CLOUDFLARE_ACCOUNT_ID` repo secrets.
