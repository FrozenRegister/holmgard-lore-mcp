## Summary
<!-- One to three sentences: what changed and why. Link the design issue if one exists. -->

## CI checklist
<!-- Every gate from ci.yml and pr-quality.yml. Check each one. If N/A, say why. -->
<!-- These boxes are a self-check for the author/reviewer — they are not machine-enforced. -->
<!-- The actual gates are: ci.yml (unit-tests, test, type-check, lint, build, coverage) and -->
<!-- pr-quality.yml (check-issue-link, check-changelog, check-docs), which run independently of this checklist. -->

- [ ] `unit-tests` pass
- [ ] `test` (sharded) pass
- [ ] `type-check` passes
- [ ] `lint` passes
- [ ] `build` passes
- [ ] `coverage` — patch coverage reported (100% target)
- [ ] Changelog fragment added (`.changelog/fragments/<slug>.md`)
- [ ] Issue link in PR body (`Closes #N` or `Part of #N`)
- [ ] Documentation updated (modify `docs/` files OR explain why not needed below)
- [ ] Branch naming convention followed (`feat/<slug>`, `fix/<slug>`, `chore/<slug>`)

## What changed
<!-- List files touched with a one-line description of what changed in each. Group by concern. -->

| File | Change |
|------|--------|
| `src/tools/example.ts` | Added `new_action` handler |
| `src/tools/definitions.ts` | Registered `new_action` schema |
| `docs/new-action.md` | Documented `new_action` usage |

## Migration
<!-- If this PR includes a D1 migration, paste the forward SQL and any rollback notes. If not, write "None." -->

```sql
-- Forward migration (copy from your migration PR or inline)
```

## Test plan
<!-- What did you test? Include manual smoke tests if applicable. -->

- [ ] Unit: <describe>
- [ ] Integration: <describe>
- [ ] Live smoke: <describe or N/A>

## Documentation
<!-- If docs were updated, link the files. If not, explain why this PR doesn't need docs. -->

## Screenshots / logs
<!-- If visual or log output helps review, paste it here. Otherwise delete. -->

Closes #<!-- replace with your issue number, e.g. Closes #123 -->
