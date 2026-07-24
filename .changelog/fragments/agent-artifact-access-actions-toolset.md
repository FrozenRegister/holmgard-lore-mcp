# Document the `actions` toolset prerequisite for CI-artifact access

- Documented the root cause behind "agents can't access CI artifacts": the GitHub remote MCP server (`api.githubcopilot.com`) does not enable the `actions` toolset by default, so `pull_request_read` is available but `actions_list` / `actions_get` are not.
- Added a "Prerequisite: the `actions` toolset must be enabled" section to `docs/agent-ci-artifacts-guide.md` with the exact MCP config (URL, `Authorization: Bearer`, `X-MCP-Toolsets` header including `actions`, optional `X-MCP-Readonly`), PAT scope requirements (Actions: Read + Contents: Read), and the URL-path scoping alternative.
- Added a matching callout to `CLAUDE.md`'s "CI Artifacts for Agents" section so the fix is discoverable from the short version.
