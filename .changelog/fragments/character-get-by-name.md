### Feature — `character_manage.get` accepts a `name` (#309)
- `get` previously required `id`/`characterId` (a UUID). It now also accepts `name` for an exact-match lookup, so a caller who only knows a character's name doesn't need a prior `list`/`search` round-trip.
- No match → `Character not found: <name>`.
- More than one match (duplicate names) → an error response with a `characters` array containing all matches and a warning message, so the caller can disambiguate by ID.
- Recovered from an abandoned branch (`claude/custom-character-fields-pr-yhjg67`) that implemented this but was never opened as a PR.
