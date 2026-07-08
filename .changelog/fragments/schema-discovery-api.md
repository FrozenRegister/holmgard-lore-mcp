### API Schema Discovery & Error Handling Enhancement

- Implemented comprehensive fuzzy matching for tool name resolution using Levenshtein distance
- Enhanced `load_tool_schema` handler with intelligent `did_you_mean` suggestions when tool names are misspelled
- Added `fuzzy-match.ts` utility with scoring algorithm for tool discovery
- Tool name typos now suggest close matches with confidence scores (e.g., `list_topicss` → `list_topics` at 87%)
- Improved error messages guide users to `search_tools` for discovering available tools
- Case-insensitive and underscore/hyphen-agnostic matching (e.g., `list-topics` matches `list_topics`)
- 100% test coverage for fuzzy matching logic and schema discovery integration
