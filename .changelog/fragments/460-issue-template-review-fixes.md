## Fixed remaining red-team findings on the issue/PR template overhaul (#459, #460)

### Fixed
- `setup-labels.yml` now provisions the `security` label referenced by the new `security_vuln.yml` template (it was previously missing, mirroring the earlier `agent:*` label gap).
- `security_vuln.yml` and `SECURITY.md` (new) now steer Critical/High severity reports to GitHub's private vulnerability reporting instead of inviting exploit reproduction steps into a public issue.
- Title prefixes normalized across all templates (`Bug: `, `Agent: `, `Security: ` — dropped the leftover `[X]: ` bracket style so all 8 templates match).
- `refactor.yml`'s `skip-quality-checks` note corrected: the label bypasses all three `pr-quality.yml` gates (issue-link, changelog, docs) at once, not just changelog.
- `bug_report.yml`'s CI dropdown now uses the actual `pr-quality.yml` job ids (`check-changelog`, `check-issue-link`, `check-docs`) instead of ad hoc names that matched neither the job ids nor their display names.
- `meta.yml`'s CI-considerations field no longer mixes prose and checkboxes in the same block.
- `PULL_REQUEST_TEMPLATE.md`'s `Closes #N` placeholder replaced with an HTML-comment placeholder so a forgotten literal `N` can't produce an unmatchable `Closes #N` in the PR body; also notes that the checklist is a human self-check, not machine-enforced.
- `PROTOCOL_INVOCATION.md`'s Document step no longer silently drops the "post an Issue comment" step that the full protocol still requires.
- `config.yml`'s `contact_links` entry pointed at a `CONTRIBUTING.md` that didn't exist — added it, along with a template-selection guide.
- `agent:calder` recolored to avoid visual collision with `agent:cline`.
- `migration.yml`'s CI-checklist field no longer sets `required: false` explicitly, matching the other templates' CI-checklist fields.

### Added
- `SECURITY.md` — private vulnerability reporting policy.
- `CONTRIBUTING.md` — issue-template selection guide.
