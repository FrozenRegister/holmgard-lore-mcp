for (const s of SUB_SCHEMAS) {
  if ('aliasOf' in s) {
    // Trusted by construction — every aliasOf target above names a real
    // canonical entry in this same static array (see the comment on
    // SubSchemaEntry). Not a defensive check: an invalid aliasOf would be a
    // typo caught by any test exercising load_tool_schema for that alias,
    // not a runtime condition to guard against.
    const canonical = SUB_SCHEMAS.find(
      (c): c is Extract<SubSchemaEntry, { schema: unknown }> =>
        'schema' in c && c.sub === s.aliasOf,
    )!
    registerRpgSubSchema(s.sub, canonical.description, canonical.schema)
    registerRpgAlias(s.sub, s.aliasOf)
  } else {
    registerRpgSubSchema(s.sub, s.description, s.schema)
  }
}
