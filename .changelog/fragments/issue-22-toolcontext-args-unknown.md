### Changed

- `ToolContext.args` is now typed `Record<string, unknown>` instead of `Record<string, any>`, closing off implicit-any leakage at the one place every one of the 59+ tool handlers reads its arguments from. This is a partial step towards #22 — it does not add compile-time binding between a tool's declared JSON `inputSchema` and its handler's expected shape (that would require the larger generic-schema-registration refactor the issue describes); each handler still validates its own args with Zod at runtime.
