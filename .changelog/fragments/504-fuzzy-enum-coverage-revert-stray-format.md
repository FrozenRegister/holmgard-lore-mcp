## No functional change

- Reverted an unintended Prettier reformat of `src/rpg/handlers/world-map.ts` that was a side effect of running the formatter across the repo while adding test coverage for `src/rpg/utils/fuzzy-enum.ts` (#504) — no logic change, net diff against `main` is zero.
