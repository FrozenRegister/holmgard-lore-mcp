[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseDeclaredVarsMoreThanAssignments', '', Justification = 'Variables used in Pester scopes')]
param()

BeforeAll {
    # Load local .env.ps1 file if it exists (for test credentials)
    $envFile = Join-Path $PSScriptRoot "..\.env.ps1"
    if (Test-Path $envFile) {
        . $envFile
    }

    # Configuration and setup
    $BaseUrl = "https://holmgard-lore-mcp.frozenregister.workers.dev"
    $MCP_URL = "$BaseUrl/mcp"
    $ADMIN_SET_URL = "$BaseUrl/admin/set-lore"
    $ADMIN_DELETE_URL = "$BaseUrl/admin/delete-lore"

    $MCP_API_KEY = $env:MCP_API_KEY
    $ADMIN_SECRET = $env:ADMIN_SECRET

    # Check for required credentials (interactive prompt only in interactive mode)
    if (-not $MCP_API_KEY) {
        if ([Environment]::UserInteractive) {
            Write-Host "⚠ Missing: MCP_API_KEY" -ForegroundColor Yellow
            Write-Host "Description: Authentication key for MCP tool endpoints" -ForegroundColor Gray
            Write-Host "To get your MCP_API_KEY from Cloudflare, run:" -ForegroundColor White
            Write-Host "  wrangler secret get MCP_API_KEY" -ForegroundColor DarkCyan
            $MCP_API_KEY = Read-Host -Prompt "MCP_API_KEY"
            if (-not $MCP_API_KEY) {
                throw "MCP_API_KEY cannot be empty. Set via `$env:MCP_API_KEY"
            }
            $env:MCP_API_KEY = $MCP_API_KEY
        } else {
            throw "MCP_API_KEY environment variable not set. Set it before running tests: `$env:MCP_API_KEY = 'your-key'"
        }
    }

    if (-not $ADMIN_SECRET) {
        if ([Environment]::UserInteractive) {
            Write-Host "⚠ Missing: ADMIN_SECRET" -ForegroundColor Yellow
            Write-Host "Description: Authentication secret for admin endpoints" -ForegroundColor Gray
            Write-Host "To get your ADMIN_SECRET from Cloudflare, run:" -ForegroundColor White
            Write-Host "  wrangler secret get ADMIN_SECRET" -ForegroundColor DarkCyan
            $ADMIN_SECRET = Read-Host -Prompt "ADMIN_SECRET"
            if (-not $ADMIN_SECRET) {
                Write-Host "ADMIN_SECRET not provided. Admin endpoint tests will be skipped." -ForegroundColor Yellow
            } else {
                $env:ADMIN_SECRET = $ADMIN_SECRET
            }
        } else {
            Write-Host "ADMIN_SECRET environment variable not set. Admin endpoint tests will be skipped." -ForegroundColor Yellow
        }
    }

    $HEADERS = @{
        "Content-Type" = "application/json"
        "X-Api-Key"    = $MCP_API_KEY
    }

    # Helper function: Invoke JSON-RPC method
    function Invoke-JsonRpc {
        param(
            [string]$Method,
            [hashtable]$Params = @{}
        )

        $body = @{
            jsonrpc = "2.0"
            id      = 1
            method  = $Method
            params  = $Params
        } | ConvertTo-Json -Depth 10

        $response = Invoke-WebRequest -Uri $MCP_URL -Method POST -Headers $HEADERS -Body $body -UseBasicParsing
        return $response.Content | ConvertFrom-Json
    }

    # Helper function: Invoke MCP tool via JSON-RPC
    function Invoke-MCPTool {
        param(
            [string]$ToolName,
            [hashtable]$Arguments = @{}
        )

        $params = @{
            name      = $ToolName
            arguments = $Arguments
        }

        return Invoke-JsonRpc -Method "tools/call" -Params $params
    }

    # Helper function: Get tool result without assertions
    function Get-MCPToolResult {
        param(
            [string]$ToolName,
            [hashtable]$Arguments = @{}
        )

        $params = @{
            name      = $ToolName
            arguments = $Arguments
        }

        $body = @{
            jsonrpc = "2.0"
            id      = 1
            method  = "tools/call"
            params  = $params
        } | ConvertTo-Json -Depth 10

        $response = Invoke-WebRequest -Uri $MCP_URL -Method POST -Headers $HEADERS -Body $body -UseBasicParsing
        return $response.Content | ConvertFrom-Json
    }

    # Helper function: Invoke admin endpoint
    function Invoke-AdminEndpoint {
        param(
            [string]$Url,
            [hashtable]$Body
        )

        $Body.secret = $ADMIN_SECRET
        $jsonBody = $Body | ConvertTo-Json -Depth 10

        $response = Invoke-WebRequest -Uri $Url -Method POST -Headers $HEADERS -Body $jsonBody -UseBasicParsing
        return $response.Content | ConvertFrom-Json
    }

    # Helper to wait for KV list consistency
    function Wait-ForKVConsistency {
        param(
            [string]$SearchKey,
            [int]$MaxWaitSeconds = 30
        )

        $pollInterval = 2
        $elapsed = 0
        $keyVisible = $false

        do {
            Start-Sleep -Seconds $pollInterval
            $elapsed += $pollInterval
            $listBody = @{ jsonrpc = "2.0"; id = 9000; method = "tools/call"; params = @{ name = "list_topics"; arguments = @{} } } | ConvertTo-Json -Depth 10
            $listResp = (Invoke-WebRequest -Uri $MCP_URL -Method POST -Headers $HEADERS -Body $listBody -UseBasicParsing).Content | ConvertFrom-Json
            $keyVisible = $listResp.result.content[0].text -like "*$SearchKey*"
        } while (-not $keyVisible -and $elapsed -lt $MaxWaitSeconds)

        return $keyVisible
    }
}