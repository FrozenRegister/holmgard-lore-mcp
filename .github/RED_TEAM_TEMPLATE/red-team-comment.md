# Red-Team Comment Template

This is the canonical comment template for automated red-team issue reviews.
Every hourly red-team run reads this file and fills in issue-specific findings.

## Structure

```markdown
## 🔴 Red Team: #{{ISSUE_NUMBER}} — {{ISSUE_TITLE}}

### Finding 1: {{ATTACK_VECTOR_NAME}} (confidence: {{HIGH|MEDIUM|LOW}})
{{WHAT_BREAKS_HOW_IMPACT}}

**Recommendation:** {{FIX}}

### Finding N: ...
```

## Finding block format

Each finding MUST include:

1. **Title** — short attack vector name
2. **Confidence tag** — `high` / `medium` / `low`
3. **Body** — what breaks, how, and the impact
4. **Recommendation** — concrete fix

## No significant attack surface

If an issue has no meaningful attack surface, use this fallback instead of inventing findings:

```markdown
## 🔴 Red Team: #{{ISSUE_NUMBER}} — {{ISSUE_TITLE}}

No significant attack surface identified for this issue's current scope.
```

## Confidence tag guidance

| Tag | Meaning |
|-----|---------|
| `high` | Finding is grounded in specific mechanics the issue proposes; reproducible failure mode |
| `medium` | Finding is plausible but depends on implementation details not yet specified |
| `low` | Finding is hypothetical; included for completeness but may not manifest |

## Rules

- **One comment per issue, posted on that issue directly.** Never batch multiple issues' findings
  into a single cross-issue digest comment — a GitHub comment lives on one issue thread, so a
  digest either buries findings for issues it isn't posted on, or posts somewhere their watchers
  don't look. The per-run throttle (at most 3–5 issues, oldest-first) already caps notification
  volume; this rule is not solving the same problem again.
- Every finding MUST be grounded in the specific mechanics the issue actually proposes.
- Do not produce a finding just to satisfy a quota.
- Do not reflexively cite "race condition" on every issue that mentions D1.
- If an issue genuinely has no significant attack surface, say so explicitly and briefly.
