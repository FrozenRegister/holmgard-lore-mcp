### Fix — `time.get_age` handles year-only `born` dates; `character.list` returns `born` (#303, #302)
- `rpg{sub:'time', action:'get_age'}` previously returned `next_birthday: "2184-undefined-undefined"` when a character's `born` was a year-only string (e.g. `"2155"`). It now returns `next_birthday: null` and an explicit `is_partial_date: true` flag, with `age.months`/`age.days` set to `null` (previously an accidental side effect of `JSON.stringify(NaN)` serializing to `null`, now explicit).
- `time.advance`'s birthday-trigger scan (`birthdayInRange`) now also skips year-only `born` characters, instead of silently comparing against an `"undefined-undefined"`-shaped date string.
- `character_manage`'s `list` action now includes `born` in each returned character object, matching `get`.
