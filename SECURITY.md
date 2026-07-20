# Security Policy

## Reporting a Vulnerability

**Critical or High severity vulnerabilities (RCE, auth bypass, data exfiltration, significant privilege escalation) — do not open a public GitHub issue.** This repository's issue tracker is public; posting exploit details or reproduction steps there before a fix ships is full public disclosure and puts production data at risk.

Instead, use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab → **Report a vulnerability** (or open `.../security/advisories/new` directly).
2. Describe the vulnerability, affected component, and reproduction steps privately.
3. A maintainer will acknowledge the report and coordinate a fix and disclosure timeline with you.

**Medium or Low severity issues**, or vulnerabilities that are already public/patched, can be filed using the [Security Vulnerability issue template](.github/ISSUE_TEMPLATE/security_vuln.yml).

## Scope

This applies to the `holmgard-lore-mcp` Cloudflare Worker (MCP server, `/mcp` and `/admin/*` routes) and its D1/KV-backed storage.

## Disclosure

We prefer coordinated disclosure: details are made public only after a fix has merged, unless the reporter and maintainers agree otherwise.
