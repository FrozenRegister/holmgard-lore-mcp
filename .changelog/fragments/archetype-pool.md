### Archetype Pool for Entity Generation

- Added test archetypes for `entity_manage.generate` to enable dynamic NPC/entity spawning
- Populated archetype templates for common Holmgard NPC types: guards, merchants, travelers, herbalists, ferrymen, village elders, shapers (stalker/broodmother), and material prey
- Documented archetype format and required fields (**Weight-1**, **Weight-2**, **Status**, **Sensory-Profile**, **Yield-Grade**, **State-Stages**, **Description**)
- Generated entities inherit archetype properties and location-based threat adjustments
- Unblocks `roll_encounter` and scene generation workflows that depend on archetype availability
