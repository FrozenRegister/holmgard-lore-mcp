# Holmgard MCP Test Script
# Tests the MCP JSON-RPC endpoint, all tools, and admin endpoints when configured.

$BaseUrl = "https://holmgard-lore-mcp.frozenregister.workers.dev"
$MCP_URL = "$BaseUrl/mcp"
$ADMIN_SET_URL = "$BaseUrl/admin/set-lore"
$ADMIN_DELETE_URL = "$BaseUrl/admin/delete-lore"
$HEADERS = @{
    "Content-Type" = "application/json"
}
$ADMIN_SECRET = $env:ADMIN_SECRET

$Script:TotalTests = 0
$Script:PassedTests = 0
$Script:FailedTests = 0
$Script:SkippedTests = 0

function Record-TestResult {
    param(
        [bool]$Success,
        [bool]$Skipped = $false
    )

    $Script:TotalTests++
    if ($Skipped) {
        $Script:SkippedTests++
    } elseif ($Success) {
        $Script:PassedTests++
    } else {
        $Script:FailedTests++
    }
}

function Invoke-JsonRpc {
    param(
        [string]$Method,
        [hashtable]$Params = @{},
        [int]$RequestId = 1
    )

    $body = @{
        jsonrpc = "2.0"
        id = $RequestId
        method = $Method
        params = $Params
    } | ConvertTo-Json -Depth 10

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "Testing JSON-RPC method: $Method" -ForegroundColor Yellow
    Write-Host "Params: $($Params | ConvertTo-Json -Compress)" -ForegroundColor Gray
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

    $success = $false
    try {
        $response = Invoke-WebRequest -Uri $MCP_URL -Method POST -Headers $HEADERS -Body $body -UseBasicParsing
        $result = $response.Content | ConvertFrom-Json

        if ($result.error) {
            Write-Host "❌ ERROR: $($result.error.message)" -ForegroundColor Red
            if ($result.error.data) {
                Write-Host "Data: $($result.error.data | ConvertTo-Json -Compress)" -ForegroundColor Red
            }
        } else {
            Write-Host "✅ SUCCESS" -ForegroundColor Green
            Write-Host "Result: $($result.result | ConvertTo-Json -Depth 5)" -ForegroundColor Green
            $success = $true
        }
    } catch {
        Write-Host "❌ EXCEPTION: $_" -ForegroundColor Red
    }

    Record-TestResult -Success:$success
    Write-Host ""
}

function Invoke-MCPTool {
    param(
        [string]$ToolName,
        [hashtable]$Arguments = @{},
        [int]$RequestId = 1
    )

    $params = @{
        name = $ToolName
        arguments = $Arguments
    }

    Invoke-JsonRpc -Method "tools/call" -Params $params -RequestId $RequestId
}

function Invoke-AdminEndpoint {
    param(
        [string]$Url,
        [hashtable]$Body,
        [string]$TestName
    )

    if (-not $ADMIN_SECRET) {
        Write-Host "SKIP: $TestName (ADMIN_SECRET not configured)" -ForegroundColor DarkGray
        Record-TestResult -Success:$false -Skipped:$true
        Write-Host ""
        return
    }

    $Body.secret = $ADMIN_SECRET
    $jsonBody = $Body | ConvertTo-Json -Depth 10

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "Testing admin endpoint: $TestName" -ForegroundColor Yellow
    Write-Host "URL: $Url" -ForegroundColor Gray
    Write-Host "Body: $($Body | ConvertTo-Json -Compress)" -ForegroundColor Gray
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

    $success = $true
    try {
        $response = Invoke-WebRequest -Uri $Url -Method POST -Headers $HEADERS -Body $jsonBody -UseBasicParsing
        $result = $response.Content | ConvertFrom-Json

        if ($result.ok -eq $false) {
            Write-Host "❌ ERROR: $($result.error)" -ForegroundColor Red
            $success = $false
        } else {
            Write-Host "✅ SUCCESS" -ForegroundColor Green
            Write-Host "Result: $($result | ConvertTo-Json -Depth 5)" -ForegroundColor Green
        }
    } catch {
        Write-Host "❌ EXCEPTION: $_" -ForegroundColor Red
        $success = $false
    }

    Record-TestResult -Success:$success
    Write-Host ""
}

function Write-Section {
    param([string]$Text)
    Write-Host "\n════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host $Text -ForegroundColor Magenta
    Write-Host "════════════════════════════════════════════════════════\n" -ForegroundColor Cyan
}

$testKey = "test:timeline-entry"
$testContent = @"
**Status:** Test
**days_remaining:** 10
**character:** test-subject
"@

Write-Section "TEST 1: initialize"
Invoke-JsonRpc -Method "initialize" -RequestId 1

Write-Section "TEST 2: ping"
Invoke-JsonRpc -Method "ping" -RequestId 2

Write-Section "TEST 3: tools/list"
Invoke-JsonRpc -Method "tools/list" -RequestId 3

Write-Section "TEST 4: list_topics (direct method)"
Invoke-JsonRpc -Method "list_topics" -RequestId 4

Write-Section "TEST 5: get_lore (direct method)"
Invoke-JsonRpc -Method "get_lore" -Params @{ key = "character:sarah-weaver" } -RequestId 5

Write-Section "TEST 6: ping_tool"
Invoke-MCPTool -ToolName "ping_tool" -Arguments @{} -RequestId 6

Write-Section "TEST 7: list_topics (tool)"
Invoke-MCPTool -ToolName "list_topics" -Arguments @{} -RequestId 7

Write-Section "TEST 8: get_lore (tool)"
Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = "character:sarah-weaver" } -RequestId 8

Write-Section "TEST 9: get_lore_batch"
Invoke-MCPTool -ToolName "get_lore_batch" -Arguments @{ keys = @("character:sarah-weaver", "location:fernveil:outpost:deep-forest-cafe", "system:active-narratives") } -RequestId 9

Write-Section "TEST 10: list_consumption_timelines - all"
Invoke-MCPTool -ToolName "list_consumption_timelines" -Arguments @{ status_filter = "all" } -RequestId 10

Write-Section "TEST 11: list_consumption_timelines - imminent"
Invoke-MCPTool -ToolName "list_consumption_timelines" -Arguments @{ status_filter = "imminent" } -RequestId 11

Write-Section "TEST 12: list_active_threads"
Invoke-MCPTool -ToolName "list_active_threads" -Arguments @{} -RequestId 12

Write-Section "TEST 13: validate_topic_exists - exact match"
Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "character:sarah-weaver" } -RequestId 13

Write-Section "TEST 14: validate_topic_exists - partial match"
Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "molly" } -RequestId 14

Write-Section "TEST 15: validate_topic_exists - no match"
Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "nonexistent-thing-12345" } -RequestId 15

Write-Section "TEST 16: set_lore (tool)"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $testKey; text = $testContent } -RequestId 16

Write-Section "TEST 17: increment_topic_field"
Invoke-MCPTool -ToolName "increment_topic_field" -Arguments @{ key = $testKey; field_path = "days_remaining"; increment = -1; reason = "daily-decrement" } -RequestId 17

Write-Section "TEST 18: verify set_lore via get_lore"
Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $testKey } -RequestId 18

Write-Section "TEST 19: increment_topic_field - negative increment"
Invoke-MCPTool -ToolName "increment_topic_field" -Arguments @{ key = $testKey; field_path = "days_remaining"; increment = -2; reason = "accelerated-decay" } -RequestId 19

Write-Section "TEST 20: delete_lore (tool)"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $testKey } -RequestId 20

Write-Section "TEST 21: admin/set-lore endpoint"
Invoke-AdminEndpoint -Url $ADMIN_SET_URL -Body @{ key = $testKey; text = $testContent } -TestName "admin/set-lore"

Write-Section "TEST 22: admin/delete-lore endpoint"
Invoke-AdminEndpoint -Url $ADMIN_DELETE_URL -Body @{ key = $testKey } -TestName "admin/delete-lore"

Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "All tests complete!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan

Write-Host "\n════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "TEST SUMMARY" -ForegroundColor Magenta
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Total tests: $Script:TotalTests" -ForegroundColor White
Write-Host "Passed: $Script:PassedTests" -ForegroundColor Green
Write-Host "Failed: $Script:FailedTests" -ForegroundColor Red
Write-Host "Skipped: $Script:SkippedTests" -ForegroundColor Yellow

if ($Script:FailedTests -gt 0) {
    Write-Host "One or more tests failed." -ForegroundColor Red
    exit 1
} elseif ($Script:SkippedTests -gt 0) {
    Write-Host "All executed tests passed, but some tests were skipped." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "All tests passed." -ForegroundColor Green
    exit 0
}
