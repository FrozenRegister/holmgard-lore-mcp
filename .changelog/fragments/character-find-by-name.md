feat(character): find_by_name with found/ambiguous/suggestions envelope (#367)

find_by_name returns `found: true` with character data on exact match, `ambiguous: true` with suggestions when confidence is low, or `found: false` with suggestions when no match found. Uses D1 exact match (1.0), LIKE prefix (0.9), KV substring (0.7), and Levenshtein fuzzy (0.5) scoring.