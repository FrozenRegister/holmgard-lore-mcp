// src/rpg/action-aliases.ts
// #404 (Tier 2) — cross-sub action aliases. Some actions live on a sub other
// than the one narrators naturally reach for (place_character lives on
// spawn, but "character.place_character" is the intuitive call; move_hex
// lives on travel, but narrators reach for character.move_hex or
// world_map.move_hex). Rather than duplicating the action on every sub a
// caller might guess, this transparently rewrites {sub, action} to the
// canonical pair before dispatch — the target handler never sees the alias.

export interface ResolvedAction {
  sub: string
  action: string
}

// caller-guessed sub -> caller-guessed action -> canonical {sub, action}.
// Every target here must be a real, already-registered SUB_MAP entry —
// resolveAlias trusts this table rather than re-validating the target sub.
export const ACTION_ALIASES: Record<string, Record<string, ResolvedAction>> = {
  character: {
    place_character: { sub: 'spawn', action: 'place_character' },
    move_hex: { sub: 'travel', action: 'move_hex' },
  },
  world_map: {
    move_hex: { sub: 'travel', action: 'move_hex' },
  },
  party: {
    place_character: { sub: 'spawn', action: 'place_character' },
  },
}

// Resolves a caller-supplied {sub, action} to its canonical pair. Returns
// the input unchanged when no alias applies (the overwhelmingly common
// case), so callers can always dispatch on the result without a fallback.
export function resolveAlias(sub: string, action: string): ResolvedAction {
  const subAliases = ACTION_ALIASES[sub]
  const target = subAliases?.[action]
  return target ?? { sub, action }
}
