### CI/CD — run full suite on feature branch push, not just PR
- `.github/workflows/ci.yml` now also triggers on push to `feat/**`, `fix/**`, `refactor/**`, `test/**`, `docs/**`, `chore/**`, `perf/**`, `issue/**`, and `claude/**` branches, not only `main`/`develop` push and PR events.
- Closes #112: previously CI only ran once a PR was opened against `main`/`develop`; now pushing to a feature branch gets a green/red signal immediately, before a PR exists.
