### CI — fix auto-merge blocking on stale, since-superseded check-run failures
- `auto-merge.yml`'s merge check queried `checks.listForRef`, which returns every check-run object ever recorded for a SHA — including stale ones from an earlier run of the same named check (e.g. editing a PR body re-triggers `pr-quality.yml`, creating a *new* check-run rather than replacing the old one). A since-fixed failure kept blocking merge indefinitely because the old failing check-run was still in the list.
- Now dedupes to the most recently started check-run per name before evaluating pending/failed state.
