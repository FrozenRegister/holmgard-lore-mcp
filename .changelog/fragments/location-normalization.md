feat(lore): location normalization for D1-to-KV key bridging (#371)

Added normalizeLocationKey() to src/lib/lore.ts (lowercase, strip commas, spaces to hyphens). Applied in handle_move_entity to normalize location keys before writing. Imported in src/tools/world.ts for future use in get_location_occupants.