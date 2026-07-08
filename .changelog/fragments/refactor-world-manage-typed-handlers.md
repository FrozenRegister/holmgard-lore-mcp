### refactor: typed handlers — world (world_manage)

- Converts `world_manage` dispatch tree to typed args using the pattern from #237
- Extracts per-action Zod schemas for all 13 handlers
- Updates handler signatures to use `TypedToolHandler<Schema>` for compile-time type safety
- Applies alias normalization via schema transforms with `.pipe()` to preserve type inference
- Removes redundant per-handler schema parsing; parse-once at dispatcher boundary
- No behavior change; 100% patch coverage on newly touched code paths
