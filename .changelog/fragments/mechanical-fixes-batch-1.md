fix: mechanical fixes batch — combat token auto-gen, error message hints, param docs (#343, #345, #346, #338)

- #343: combat.add_combatant auto-generates token from characterId when omitted (looks up character name from D1)
- #345: quest.add_objective error now surfaces the objective object schema (description, completed, order fields)
- #346: aura.get, secret.get, narrative.get error messages now explain what "id" refers to (aura instance UUID, secret UUID, note UUID) and suggest alternative lookup methods
- #338: corpse.get_state, decompose, loot_corpse, recover, psychological_impact error messages now document required params and optional fields with examples