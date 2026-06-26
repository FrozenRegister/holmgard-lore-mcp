### CI & Developer Workflow Overhaul

- **Changelog fragments** replace direct `CHANGELOG.md` edits — add a `.md` file under `.changelog/fragments/` per PR; fragments are assembled at release time, eliminating merge conflicts on parallel PRs
- **Issue-link enforcement** added to `pr-quality.yml` — `Closes #N`/`Fixes #N` must appear in the PR body (not the PR title) for GitHub's auto-close to work
- **pnpm unified to 11.5.1** across both repos (was 10.15.0 in MCP)
- **Concurrency groups** added to CI — stale in-progress runs on the same branch are cancelled automatically
- **MCP CI hardened**: `--frozen-lockfile` on all installs; `workflow_dispatch` and `develop` branch trigger added; coverage artifact upload added; failure notification job added (creates a GitHub Issue when `main`/`develop` breaks)
- **Editor CI**: ESLint `pnpm lint` step added to the `Lint & Typecheck` job (was previously running only `svelte-check`)
