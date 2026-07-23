### Wired up the Prettier auto-fix CI workflow and documented it

- New `.github/workflows/prettier-fix.yml` ("Auto-fix Code Formatting"), mirroring the existing `markdownlint-fix.yml` pattern exactly: triggers on any PR touching `.ts`/`.mjs` files, runs `pnpm run format`, and pushes any fix directly back to the PR branch.
- New `.git-blame-ignore-revs`, listing the prior pure-reformat commit so `git blame` (and GitHub's web blame view, which reads this file automatically) skips over it.
- Documented Prettier, the new auto-fix workflow, and the general "surface best practice when a convention is missing" expectation in `CLAUDE.md` and `docs/testing-and-linting-guide.md`.
