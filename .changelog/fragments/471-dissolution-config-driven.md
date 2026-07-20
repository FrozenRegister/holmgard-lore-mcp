## Make dissolution system config-driven (#471)

### Changed

- `DissolutionConfig` interface added with `stages` map and `terminalStage` field
- `DEFAULT_DISSOLUTION_CONFIG` created with 5-stage data matching existing hardcoded values
- `STAGE_MUTATIONS` re-exported from config for backward compatibility
- `stageMutationFor()`, `buildSensoryProfile()`, `buildMechanicalEffects()` now accept optional `DissolutionConfig` parameter
- No breaking changes — all existing callers work without modification
