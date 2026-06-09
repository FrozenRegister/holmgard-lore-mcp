# Protocol Invocation

## Quick Start: Resolve an Issue Autonomously

To resolve a GitHub Issue, use the helper script:

```powershell
.\resolve-issue.ps1 -IssueNumber 42
```

This will:
1. Fetch Issue #42 from GitHub
2. Display the Issue details
3. Generate a copy-paste prompt for Claude Code

Then:
1. **Copy** the section marked "COPY BELOW & PASTE INTO CLAUDE CODE"
2. **Paste** it into Claude Code
3. **Claude** will follow the [Issue Resolution Protocol](./ISSUE_RESOLUTION_PROTOCOL.md) automatically

---

## Manual Invocation (if script not available)

If the script isn't accessible, you can invoke the protocol manually in Claude Code:

```
You are an autonomous development agent for the holmgard-lore-mcp repository.

Follow the Issue Resolution Protocol: see `ISSUE_RESOLUTION_PROTOCOL.md` in the project root.

--- ISSUE TO RESOLVE ---

[PASTE GITHUB ISSUE DETAILS HERE]

--- END ISSUE ---

**Next steps:**
1. Read and understand the Issue above
2. Summarize it in 3–5 bullet points
3. Wait for my confirmation (unless the Issue is straightforward)
4. Then proceed with the implementation workflow

Start by summarizing your understanding now.
```

---

## How the Protocol Works

1. **Triage** — Understand the Issue, summarize, await confirmation
2. **Plan** — Identify files, outline the fix
3. **Implement** — Write code, add tests
4. **Test** — Run `pnpm test`, `pnpm lint`, `pnpm type-check`
5. **Document** — Update CLAUDE.md, CHANGELOG.md, Issue comment
6. **PR** — Open a review-ready Pull Request

**Full protocol:** See [ISSUE_RESOLUTION_PROTOCOL.md](./ISSUE_RESOLUTION_PROTOCOL.md)

---

## Script Usage

### Basic
```powershell
.\resolve-issue.ps1 -IssueNumber 42
```

### Specify a different repo (if needed)
```powershell
.\resolve-issue.ps1 -IssueNumber 42 -Repo "OtherUser/other-repo"
```

### Requirements
- PowerShell 7+ (or 5.1+)
- GitHub CLI installed (`gh`)
- Authenticated: `gh auth status`

---

## Troubleshooting

**"Could not fetch Issue #42"**
- Run `gh auth status` to confirm you're logged in
- Run `gh auth login` if needed
- Check the Issue number is correct

**"Permission denied"**
- Run as admin: right-click PowerShell → "Run as administrator"
- Or add execute permissions: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

---

## Example Output

```
========================================
Resolving Issue #42
========================================

Title: Fix interaction utility score calculation

State: open
Labels: bug, backend

Description:
─────────────────────────────────────────
The interaction utility score is not accounting for
discovered items. This causes incorrect prioritization...
─────────────────────────────────────────

======== COPY BELOW & PASTE INTO CLAUDE CODE ========

You are an autonomous development agent...

[Protocol invocation prompt]

======== END COPY ========

To use this:
1. Copy the section between 'COPY BELOW' and 'END COPY'
2. Paste it into Claude Code
3. Claude will follow the Issue Resolution Protocol automatically
```

---

## See Also

- [ISSUE_RESOLUTION_PROTOCOL.md](./ISSUE_RESOLUTION_PROTOCOL.md) — Full protocol details
- [CLAUDE.md](./CLAUDE.md) — Project architecture and patterns
- [GitHub Issues](https://github.com/FrozenRegister/holmgard-lore-mcp/issues) — Open Issues
