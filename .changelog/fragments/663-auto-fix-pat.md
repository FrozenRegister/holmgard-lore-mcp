## Use a PAT for auto-fix bot commits (#663)

### Changed
- `prettier-fix.yml` and `markdownlint-fix.yml` now checkout with `secrets.AUTO_FIX_PAT` (falling back to the default token if unset) so their auto-fix commits are attributed to a real account instead of `github-actions[bot]`, avoiding bot-identity-based approval gates (see #659). No functional change until the `AUTO_FIX_PAT` repository secret is configured by a repo admin.
