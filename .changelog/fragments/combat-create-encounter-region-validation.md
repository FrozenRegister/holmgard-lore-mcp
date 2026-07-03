### Fixed

- `combat_manage(create_encounter)` now validates `regionId` against the D1 `regions` table before insert, returning a clear error instead of an opaque `FOREIGN KEY constraint failed` D1 error.
