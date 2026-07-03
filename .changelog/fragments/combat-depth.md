### Added

- `combat_manage`: `death_save`, `legendary_action`, and `lair_action` actions — D&D 5e death saving throws and legendary-creature mechanics, previously declined as out-of-scope (#74), implemented per #206.
- `combat_action`: `dash`, `dodge`, `disengage`, `help`, and `ready` reaction/action-economy actions.
- `combat_action.apply_damage` now respects a target's `resistances`/`vulnerabilities`/`immunities` and flags a concentration saving-throw DC when a concentrating character takes damage.
