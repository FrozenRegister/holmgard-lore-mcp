# Resolve Issue Helper — Fetches Issue and loads protocol template
# Usage: .\resolve-issue.ps1 -IssueNumber 42

param(
    [Parameter(Mandatory = $true)]
    [int]$IssueNumber,

    [Parameter(Mandatory = $false)]
    [string]$Repo = "FrozenRegister/holmgard-lore-mcp"
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Resolving Issue #$IssueNumber" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Fetch issue details
$issue = gh issue view $IssueNumber --repo $Repo --json "number,title,body,state,labels,assignees,milestone" 2>$null

if (-not $issue) {
    Write-Host "Error: Could not fetch Issue #$IssueNumber from $Repo" -ForegroundColor Red
    Write-Host "Make sure:" -ForegroundColor Yellow
    Write-Host "  1. You're logged into GitHub CLI: gh auth status" -ForegroundColor Yellow
    Write-Host "  2. The issue number is correct" -ForegroundColor Yellow
    exit 1
}

$issueData = $issue | ConvertFrom-Json
$title = $issueData.title
$body = $issueData.body
$state = $issueData.state
$labels = $issueData.labels | ForEach-Object { $_.name } | Join-String -Separator ", "

# Display issue details
Write-Host "Title: " -NoNewline -ForegroundColor Green
Write-Host "$title`n" -ForegroundColor White

Write-Host "State: " -NoNewline -ForegroundColor Green
Write-Host "$state" -ForegroundColor White

if ($labels) {
    Write-Host "Labels: " -NoNewline -ForegroundColor Green
    Write-Host "$labels`n" -ForegroundColor White
}

Write-Host "Description:" -ForegroundColor Green
Write-Host ("─" * 60)
Write-Host $body
Write-Host ("─" * 60)

# Build protocol invocation
$protocolPrompt = @"

======== COPY BELOW & PASTE INTO CLAUDE CODE ========

You are an autonomous development agent for the holmgard-lore-mcp repository.

Follow the Issue Resolution Protocol: see \`ISSUE_RESOLUTION_PROTOCOL.md\` in the project root.

--- ISSUE TO RESOLVE ---

**#${IssueNumber}: $title**

$body

--- END ISSUE ---

**Next steps:**
1. Read and understand the Issue above
2. Summarize it in 3–5 bullet points
3. Wait for my confirmation (unless the Issue is straightforward)
4. Then proceed with the implementation workflow

Start by summarizing your understanding now.

======== END COPY ========
"@

Write-Host $protocolPrompt -ForegroundColor Yellow

Write-Host "`nTo use this:
1. Copy the section between 'COPY BELOW' and 'END COPY'
2. Paste it into Claude Code
3. Claude will follow the Issue Resolution Protocol automatically

See PROTOCOL_INVOCATION.md for details." -ForegroundColor Cyan
