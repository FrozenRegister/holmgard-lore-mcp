---
type: docs
scope: process
summary: Add red-team comment template file at `.github/RED_TEAM_TEMPLATE/red-team-comment.md` so hourly automated red-team runs post consistent structure without each run reinventing the format. Methodology doc now references the template instead of duplicating the output format inline.
issue: 569
related: [563, 564]
---

## Added
- `.github/RED_TEAM_TEMPLATE/red-team-comment.md` — canonical comment template with finding block format, confidence tag guidance, and "no significant attack surface" fallback

## Changed
- `docs/issue-red-team-methodology.md` — "Output format" section now references the template file instead of duplicating inline
