### Changed

- `CLAUDE.md` "Required workflow" now instructs agents to check for an existing branch/PR covering an issue before creating a new one, and to ask the human which to use rather than defaulting to a fresh branch — prompted by #568, where a fix for that PR's own accidental `CLAUDE.md` truncation was initially opened as a separate PR (#571) instead of being pushed onto the existing branch.
