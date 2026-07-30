issue: 614
summary: Add a narrower skip-naming-check label separate from skip-quality-checks
---

- **`pr-quality.yml`'s `check-naming` job** now also accepts a dedicated `skip-naming-check` label, in addition to the existing `skip-quality-checks` label. Previously the only way to bypass a failing branch-name/PR-title check was `skip-quality-checks`, which also silences `check-issue-link`, `check-changelog`, and `check-docs` — too broad for the common case (e.g. an externally-assigned branch name) where only naming needs an exception.
- `CLAUDE.md`'s "Branch naming" section updated to document the narrower label.
