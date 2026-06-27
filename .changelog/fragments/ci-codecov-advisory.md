## Changed

- Make Codecov advisory: `fail_ci_if_error: false` in ci.yml; `codecov/*` checks excluded from auto-merge failure gate
- Update CLAUDE.md to reflect Istanbul CI job is the enforced coverage gate, Codecov is visibility-only
- Add `renovate.json` for automated weekly dependency updates (dev dep minor/patch auto-merge, majors require review)
