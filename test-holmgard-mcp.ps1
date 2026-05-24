# Holmgard MCP Test Script
# Tests the MCP JSON-RPC endpoint, all tools, and admin endpoints when configured.
#
# Note: admin endpoint tests require ADMIN_SECRET to be configured in the PowerShell environment.
# Set it with: $env:ADMIN_SECRET = "your-secret-value"

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

# Like Invoke-MCPTool but also asserts that result.content[0].text contains $ExpectContains.
# Fails the test if the text is absent, even when there is no JSON-RPC error.
function Invoke-MCPToolAssert {
    param(
        [string]$ToolName,
        [hashtable]$Arguments = @{},
        [string]$ExpectContains = "",
        [int]$RequestId = 1
    )

    $params = @{
        name      = $ToolName
        arguments = $Arguments
    }
    $body = @{
        jsonrpc = "2.0"
        id      = $RequestId
        method  = "tools/call"
        params  = $params
    } | ConvertTo-Json -Depth 10

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "Testing tool: $ToolName" -ForegroundColor Yellow
    Write-Host "Args: $($Arguments | ConvertTo-Json -Compress)" -ForegroundColor Gray
    if ($ExpectContains) { Write-Host "Expected to contain: $ExpectContains" -ForegroundColor DarkGray }
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

    $success = $false
    try {
        $response = Invoke-WebRequest -Uri $MCP_URL -Method POST -Headers $HEADERS -Body $body -UseBasicParsing
        $result = $response.Content | ConvertFrom-Json

        if ($result.error) {
            Write-Host "❌ JSON-RPC ERROR: $($result.error.message)" -ForegroundColor Red
        } else {
            $contentText = $result.result.content[0].text
            Write-Host "Content: $contentText" -ForegroundColor White
            if ($ExpectContains -and $contentText -notlike "*$ExpectContains*") {
                Write-Host "❌ ASSERT FAILED: '$ExpectContains' not found in content" -ForegroundColor Red
            } else {
                Write-Host "✅ SUCCESS" -ForegroundColor Green
                $success = $true
            }
        }
    } catch {
        Write-Host "❌ EXCEPTION: $_" -ForegroundColor Red
    }

    Record-TestResult -Success:$success
    Write-Host ""
}

$testKey = "test:timeline-entry"
$testContent = @"
**Status:** Test
**days_remaining:** 10
**character:** test-subject
"@

$searchKey         = "test:search-key"
$searchText        = @"
Lore search test content.
Prey is contained here.
"@
$timelineTestKey   = "character:test-consumption-timeline-entry"
$timelineText      = @"
**Status:** Imminent
**Consumption-Timeline:** 1 day
**Processor:** Alpha
"@
$patchReplaceKey   = "test:patch-replace"
$patchAmbigKey     = "test:patch-ambig"
$patchAppendKey    = "test:patch-append"
$patchAppendTKey   = "test:patch-append-target"
$patchDeleteKey    = "test:patch-delete"

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

Write-Section "TEST 16A: search_lore setup — write temp key"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $searchKey; text = $searchText } -RequestId 100

Write-Section "TEST 16B: search_lore — verify tool returns results for known live content"
# Assert on 'prey' in excerpt text (from existing live data) — not the freshly-written key.
# KV list() is eventually consistent so a just-written key may not appear; unit tests cover that path.
Invoke-MCPToolAssert -ToolName "search_lore" -Arguments @{ query = "prey"; max_results = 5 } -ExpectContains "prey" -RequestId 101

Write-Section "TEST 16C: search_lore cleanup"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $searchKey } -RequestId 102

Write-Section "TEST 16D: list_consumption_timelines parser — write temp character key"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $timelineTestKey; text = $timelineText } -RequestId 103
# Verify the write landed via direct key read (immediately consistent).
Invoke-MCPToolAssert -ToolName "get_lore" -Arguments @{ query = $timelineTestKey } -ExpectContains "Consumption-Timeline" -RequestId 104
# list_consumption_timelines scans via kvList() which is eventually consistent — just verify the call succeeds.
Invoke-MCPTool -ToolName "list_consumption_timelines" -Arguments @{ status_filter = "imminent" } -RequestId 105
Write-Section "TEST 16E: list_consumption_timelines cleanup"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $timelineTestKey } -RequestId 106

Write-Section "TEST 19: set_lore (tool)"
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

Write-Section "TEST 23: patch_lore - setup replace key"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $patchReplaceKey; text = "Status: Alive`nDays: 14" } -RequestId 23

Write-Section "TEST 24: patch_lore - replace success"
Invoke-MCPToolAssert -ToolName "patch_lore" -Arguments @{ key = $patchReplaceKey; operation = "replace"; target = "Status: Alive"; value = "Status: Sedated" } -ExpectContains "Replaced 1 occurrence" -RequestId 24

Write-Section "TEST 25: patch_lore - verify replace via get_lore"
Invoke-MCPToolAssert -ToolName "get_lore" -Arguments @{ query = $patchReplaceKey } -ExpectContains "Status: Sedated" -RequestId 25

Write-Section "TEST 26: patch_lore - replace target not found"
Invoke-MCPToolAssert -ToolName "patch_lore" -Arguments @{ key = $patchReplaceKey; operation = "replace"; target = "Nonexistent"; value = "X" } -ExpectContains "not found in" -RequestId 26

Write-Section "TEST 27: patch_lore - setup ambiguous key"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $patchAmbigKey; text = "the cat chased the cat" } -RequestId 27

Write-Section "TEST 28: patch_lore - replace ambiguous target"
Invoke-MCPToolAssert -ToolName "patch_lore" -Arguments @{ key = $patchAmbigKey; operation = "replace"; target = "the cat"; value = "a dog" } -ExpectContains "Ambiguous" -RequestId 28

Write-Section "TEST 29: patch_lore - setup append key"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $patchAppendKey; text = "Line 1" } -RequestId 29

Write-Section "TEST 30: patch_lore - append to end"
Invoke-MCPToolAssert -ToolName "patch_lore" -Arguments @{ key = $patchAppendKey; operation = "append"; value = "`nLine 2" } -ExpectContains "Appended to end" -RequestId 30

Write-Section "TEST 31: patch_lore - setup append-after-target key"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $patchAppendTKey; text = "Header`nBody" } -RequestId 31

Write-Section "TEST 32: patch_lore - append after target"
Invoke-MCPToolAssert -ToolName "patch_lore" -Arguments @{ key = $patchAppendTKey; operation = "append"; target = "Header"; value = "`nSubheader" } -ExpectContains "Appended after" -RequestId 32

Write-Section "TEST 33: patch_lore - setup delete key"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $patchDeleteKey; text = "Keep this.`nDelete this.`nKeep that." } -RequestId 33

Write-Section "TEST 34: patch_lore - delete_field"
Invoke-MCPToolAssert -ToolName "patch_lore" -Arguments @{ key = $patchDeleteKey; operation = "delete_field"; target = "Delete this.`n" } -ExpectContains "Deleted 1 occurrence" -RequestId 34

Write-Section "TEST 35: patch_lore - key not found"
Invoke-MCPToolAssert -ToolName "patch_lore" -Arguments @{ key = "nonexistent:key-99999"; operation = "replace"; target = "X"; value = "Y" } -ExpectContains "not found" -RequestId 35

Write-Section "TEST 36: patch_lore - cleanup test keys"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $patchReplaceKey } -RequestId 36
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $patchAmbigKey } -RequestId 37
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $patchAppendKey } -RequestId 38
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $patchAppendTKey } -RequestId 39
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $patchDeleteKey } -RequestId 40

$batchAlphaKey = "test:batch-alpha"
$batchBetaKey  = "test:batch-beta"

Write-Section "TEST 37: batch_set_lore - write two new entries"
$batchSetArgs = @{
    entries = @(
        [ordered]@{ key = $batchAlphaKey; text = "Alpha batch content." },
        [ordered]@{ key = $batchBetaKey;  text = "Beta batch content." }
    )
}
Invoke-MCPToolAssert -ToolName "batch_set_lore" -Arguments $batchSetArgs -ExpectContains "Saved 2" -RequestId 41

Write-Section "TEST 38: batch_set_lore - verify entries via get_lore"
Invoke-MCPToolAssert -ToolName "get_lore" -Arguments @{ query = $batchAlphaKey } -ExpectContains "Alpha batch content" -RequestId 42

Write-Section "TEST 39: batch_mutate - patch replace + append on batch keys"
$batchMutArgs = @{
    mutations = @(
        [ordered]@{ key = $batchAlphaKey; action = "patch"; operation = "replace"; target = "Alpha batch content."; value = "Alpha mutated." },
        [ordered]@{ key = $batchBetaKey;  action = "patch"; operation = "append"; value = "`nAppended line." }
    )
}
Invoke-MCPToolAssert -ToolName "batch_mutate" -Arguments $batchMutArgs -ExpectContains "Applied 2" -RequestId 43

Write-Section "TEST 40: batch_mutate - verify mutations via get_lore"
Invoke-MCPToolAssert -ToolName "get_lore" -Arguments @{ query = $batchAlphaKey } -ExpectContains "Alpha mutated" -RequestId 44

Write-Section "TEST 41: batch_set_lore + batch_mutate - cleanup"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $batchAlphaKey } -RequestId 45
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $batchBetaKey } -RequestId 46

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
