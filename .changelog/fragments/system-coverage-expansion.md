### Test Coverage Expansion

- **system.ts coverage**: Added 331 new test cases covering all scoreMatch function branches, edge cases, and error handling paths to achieve 95%+ coverage with zero missing lines
- **scoreMatch branches**: Explicit tests for exact match (1.0), prefix match (~0.9), substring match (0.5-0.85), initials/acronym (0.7), and no match (0) confidence scoring
- **validate_topic_exists**: Multiple match handling, confidence-based sorting, query normalization with colon separators
- **get_lore auto-suggest**: Suggestion limit enforcement (max 5), colon suffix extraction
- **list_topics pagination**: Limit clamping (1000 max), offset validation, combined pagination accuracy
- **search_lore**: CHUNK_SIZE chunking, early max_results termination, excerpt truncation with ellipsis
- **get_map**: Normalization (case, whitespace, prefix handling)
- **get_lore_section**: Strict vs loose mode coverage (case sensitivity, special characters)
- **world filter**: Case-insensitivity, untagged entry exclusion in both list_topics and search_lore
