### Documentation quality check re-enabled

- Re-added `check-docs` job to PR quality workflow
- Validates that PRs modifying code include either updated `docs/` files or a `## Documentation` section in PR body
- Automatically exempts dependencies-only PRs (package.json, lock files)
- Respects `skip-quality-checks` label for emergency hotfixes and internal refactoring
- Updated CLAUDE.md with clear guidance on documentation requirements and when to skip them
