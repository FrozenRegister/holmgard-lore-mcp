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
$Script:Failures = [System.Collections.Generic.List[hashtable]]::new()
$Script:FailureLog = Join-Path $PSScriptRoot "test-failures.json"

function Update-TestResult {
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

function Write-Failure {
    param(
        [string]$TestName,
        [string]$Reason,
        [string]$ActualContent = "",
        [string]$Expected = "",
        [object]$RawResponse = $null
    )
    $Script:Failures.Add(@{
        test    = $TestName
        reason  = $Reason
        expected = $Expected
        actual  = $ActualContent
        response = if ($RawResponse) { $RawResponse | ConvertTo-Json -Depth 6 -Compress } else { "" }
    })
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
            Write-Failure -TestName $Method -Reason "JSON-RPC error: $($result.error.message)" -RawResponse $result
        } else {
            Write-Host "✅ SUCCESS" -ForegroundColor Green
            Write-Host "Result: $($result.result | ConvertTo-Json -Depth 5)" -ForegroundColor Green
            $success = $true
        }
    } catch {
        Write-Host "❌ EXCEPTION: $_" -ForegroundColor Red
        Write-Failure -TestName $Method -Reason "Exception: $_"
    }

    Update-TestResult -Success:$success
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
        Update-TestResult -Success:$false -Skipped:$true
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

    Update-TestResult -Success:$success
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
            Write-Failure -TestName $ToolName -Reason "JSON-RPC error: $($result.error.message)" -Expected $ExpectContains -RawResponse $result
        } else {
            $contentText = $result.result.content[0].text
            Write-Host "Content: $contentText" -ForegroundColor White
            if ($ExpectContains -and $contentText -notlike "*$ExpectContains*") {
                Write-Host "❌ ASSERT FAILED: '$ExpectContains' not found in content" -ForegroundColor Red
                Write-Failure -TestName $ToolName -Reason "Assert failed: '$ExpectContains' not in content" -Expected $ExpectContains -ActualContent $contentText -RawResponse $result
            } else {
                Write-Host "✅ SUCCESS" -ForegroundColor Green
                $success = $true
            }
        }
    } catch {
        Write-Host "❌ EXCEPTION: $_" -ForegroundColor Red
        Write-Failure -TestName $ToolName -Reason "Exception: $_" -Expected $ExpectContains
    }

    Update-TestResult -Success:$success
    Write-Host ""
}

# Asserts that a tool call returns a JSON-RPC error whose message contains $ExpectErrorContains.
function Invoke-MCPToolExpectError {
    param(
        [string]$ToolName,
        [hashtable]$Arguments = @{},
        [string]$ExpectErrorContains = "",
        [int]$RequestId = 1
    )

    $params = @{ name = $ToolName; arguments = $Arguments }
    $body = @{ jsonrpc = "2.0"; id = $RequestId; method = "tools/call"; params = $params } | ConvertTo-Json -Depth 10

    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "Testing tool (expect error): $ToolName" -ForegroundColor Yellow
    Write-Host "Args: $($Arguments | ConvertTo-Json -Compress)" -ForegroundColor Gray
    if ($ExpectErrorContains) { Write-Host "Expected error to contain: $ExpectErrorContains" -ForegroundColor DarkGray }
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

    $success = $false
    try {
        $response = Invoke-WebRequest -Uri $MCP_URL -Method POST -Headers $HEADERS -Body $body -UseBasicParsing
        $result = $response.Content | ConvertFrom-Json

        if ($result.error) {
            Write-Host "Error message: $($result.error.message)" -ForegroundColor White
            if ($ExpectErrorContains -and $result.error.message -notlike "*$ExpectErrorContains*") {
                Write-Host "❌ ASSERT FAILED: '$ExpectErrorContains' not in error message" -ForegroundColor Red
                Write-Failure -TestName $ToolName -Reason "Assert failed: '$ExpectErrorContains' not in error" -Expected $ExpectErrorContains -ActualContent $result.error.message -RawResponse $result
            } else {
                Write-Host "✅ SUCCESS (got expected error)" -ForegroundColor Green
                $success = $true
            }
        } else {
            Write-Host "❌ ASSERT FAILED: expected a JSON-RPC error but got success" -ForegroundColor Red
            Write-Failure -TestName $ToolName -Reason "Expected JSON-RPC error but got success" -Expected $ExpectErrorContains -RawResponse $result
        }
    } catch {
        Write-Host "❌ EXCEPTION: $_" -ForegroundColor Red
        Write-Failure -TestName $ToolName -Reason "Exception: $_" -Expected $ExpectErrorContains
    }

    Update-TestResult -Success:$success
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

# ── resolve_interaction ───────────────────────────────────────────────────────

$resolverKeyA      = "test:resolver-entity-a"
$resolverKeyB      = "test:resolver-entity-b"
$resolverKeyZeroA  = "test:resolver-entity-zero-a"
$resolverKeyHighB  = "test:resolver-entity-high-b"

Write-Section "TEST 42: resolve_interaction - setup entities"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $resolverKeyA;     text = "**Weight-1:** 10" } -RequestId 200
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $resolverKeyB;     text = "**Weight-2:** 0"  } -RequestId 201
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $resolverKeyZeroA; text = "**Weight-1:** 0"  } -RequestId 202
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $resolverKeyHighB; text = "**Weight-2:** 10" } -RequestId 203

Write-Section "TEST 43: resolve_interaction - guaranteed success (P=1)"
# W1=10, W2=0 → P = (10×0.7)-(0×0.3) = 7 → clamped to 1.0 → always success
Invoke-MCPToolAssert -ToolName "resolve_interaction" -Arguments @{ entity_a_id = $resolverKeyA; entity_b_id = $resolverKeyB; action_type = "consume" } -ExpectContains "SUCCESS" -RequestId 204

Write-Section "TEST 44: resolve_interaction - guaranteed failure (P=0)"
# W1=0, W2=10 → P = (0×0.7)-(10×0.3) = -3 → clamped to 0 → always failure
Invoke-MCPToolAssert -ToolName "resolve_interaction" -Arguments @{ entity_a_id = $resolverKeyZeroA; entity_b_id = $resolverKeyHighB; action_type = "consume" } -ExpectContains "FAILURE" -RequestId 205

Write-Section "TEST 45: resolve_interaction - missing entity returns error"
Invoke-MCPToolExpectError -ToolName "resolve_interaction" -Arguments @{ entity_a_id = "nonexistent:entity-xyz"; entity_b_id = $resolverKeyB; action_type = "test" } -ExpectErrorContains "not found" -RequestId 206

Write-Section "TEST 46: resolve_interaction - cleanup"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $resolverKeyA     } -RequestId 207
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $resolverKeyB     } -RequestId 208
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $resolverKeyZeroA } -RequestId 209
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $resolverKeyHighB } -RequestId 210

# ── analyze_utility ───────────────────────────────────────────────────────────

$utilityKey = "test:utility-subject"
$utilityText = @"
**Tenderness-Index:** 0.80
**Fat-Marbling-Index:** 0.75
**Sensory-Receptivity:** 0.70
**Weight-2 (Prey Vulnerability):** 0.65
**Compliance-Potential:** 0.85
**Cortisol-Level:** 0.20
**Caloric-Yield-Estimate:** 0.72
"@

Write-Section "TEST 47: analyze_utility - setup entity"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $utilityKey; text = $utilityText } -RequestId 211

Write-Section "TEST 48: analyze_utility - GASTRIC vector"
Invoke-MCPToolAssert -ToolName "analyze_utility" -Arguments @{ entity_id = $utilityKey; utility_vector = "GASTRIC" } -ExpectContains "Grade" -RequestId 212

Write-Section "TEST 49: analyze_utility - THRALL vector"
Invoke-MCPToolAssert -ToolName "analyze_utility" -Arguments @{ entity_id = $utilityKey; utility_vector = "THRALL" } -ExpectContains "Grade" -RequestId 213

Write-Section "TEST 50: analyze_utility - DISTRIBUTED vector"
Invoke-MCPToolAssert -ToolName "analyze_utility" -Arguments @{ entity_id = $utilityKey; utility_vector = "DISTRIBUTED" } -ExpectContains "/100" -RequestId 214

Write-Section "TEST 51: analyze_utility - missing entity returns error"
Invoke-MCPToolExpectError -ToolName "analyze_utility" -Arguments @{ entity_id = "nonexistent:entity-xyz"; utility_vector = "GASTRIC" } -ExpectErrorContains "not found" -RequestId 215

Write-Section "TEST 51B: analyze_utility - live character:seraphine-herbalist GASTRIC Grade A"
# All 6 GASTRIC fields must be present, Cortisol-Level inverted, Caloric-Yield-Estimate normalized.
# Expected: Grade A (composite 75–89). Grade B or lower = field scanning or inversion still broken.
Invoke-MCPToolAssert -ToolName "analyze_utility" -Arguments @{ entity_id = "character:seraphine-herbalist"; utility_vector = "GASTRIC"; entity_role = "subject" } -ExpectContains "Grade A" -RequestId 2150

Write-Section "TEST 52: analyze_utility - cleanup"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $utilityKey } -RequestId 216

# ── map_integration ───────────────────────────────────────────────────────────

$integrationSourceKey = "test:integration-source"
$integrationTargetKey = "test:integration-target"
$integrationSourceText = @"
Base traits of the source entity.
Trait Alpha [Transferable]
Trait Beta [Transferable]
**Transferable-Skill:** combat mastery
Non-transferable secret.
"@
$integrationTargetText = "Target entity base lore."

Write-Section "TEST 53: map_integration - setup source and target"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $integrationSourceKey; text = $integrationSourceText } -RequestId 217
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $integrationTargetKey; text = $integrationTargetText } -RequestId 218

Write-Section "TEST 54: map_integration - transfer at depth 1.0"
Invoke-MCPToolAssert -ToolName "map_integration" -Arguments @{ source_id = $integrationSourceKey; target_id = $integrationTargetKey; integration_depth = 1.0 } -ExpectContains "Integrated" -RequestId 219

Write-Section "TEST 55: map_integration - verify traits written to target"
Invoke-MCPToolAssert -ToolName "get_lore" -Arguments @{ query = $integrationTargetKey } -ExpectContains "Integrated-From" -RequestId 220

Write-Section "TEST 56: map_integration - no transferable traits returns empty"
$plainSourceKey = "test:integration-plain-source"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $plainSourceKey; text = "No transferable traits here." } -RequestId 221
Invoke-MCPToolAssert -ToolName "map_integration" -Arguments @{ source_id = $plainSourceKey; target_id = $integrationTargetKey; integration_depth = 1.0 } -ExpectContains "traits found in" -RequestId 222

Write-Section "TEST 57: map_integration - cleanup"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $integrationSourceKey } -RequestId 223
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $integrationTargetKey } -RequestId 224
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $plainSourceKey       } -RequestId 225

# ── thread_tick ───────────────────────────────────────────────────────────────

$threadEntityKey  = "character:thread-entity-alpha"
$threadEntityText = @"
**Thread:** test-thread-alpha
**Timeline-Value:** 5
**Current-Date:** 2099-12-31
"@
$threadOtherKey  = "character:thread-entity-other"
$threadOtherText = @"
**Thread:** test-thread-beta
**Current-Date:** 2099-12-31
**Status:** Waiting
"@

Write-Section "TEST 58: thread_tick - setup thread entities"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $threadEntityKey; text = $threadEntityText } -RequestId 226
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $threadOtherKey;  text = $threadOtherText  } -RequestId 227

# KV list() is eventually consistent — poll list_topics until the freshly-written key appears.
Write-Host "Waiting for KV list consistency (polling list_topics)..." -ForegroundColor DarkGray
$maxWaitSeconds = 30
$pollInterval   = 2
$elapsed        = 0
$keyVisible     = $false
do {
    Start-Sleep -Seconds $pollInterval
    $elapsed += $pollInterval
    $listBody = @{ jsonrpc = "2.0"; id = 9000; method = "tools/call"; params = @{ name = "list_topics"; arguments = @{} } } | ConvertTo-Json -Depth 10
    $listResp = (Invoke-WebRequest -Uri $MCP_URL -Method POST -Headers $HEADERS -Body $listBody -UseBasicParsing).Content | ConvertFrom-Json
    $keyVisible = $listResp.result.content[0].text -like "*$threadEntityKey*"
    if (-not $keyVisible) { Write-Host "  Key not visible yet after ${elapsed}s, retrying..." -ForegroundColor DarkGray }
} while (-not $keyVisible -and $elapsed -lt $maxWaitSeconds)

if (-not $keyVisible) {
    Write-Host "⚠ Key never appeared in list_topics after ${maxWaitSeconds}s — thread_tick tests may fail." -ForegroundColor Yellow
}

Write-Section "TEST 59: thread_tick - tick the thread"
Invoke-MCPToolAssert -ToolName "thread_tick" -Arguments @{ thread_id = "test-thread-alpha" } -ExpectContains "ticked" -RequestId 228

Write-Section "TEST 60: thread_tick - verify Timeline-Value decremented"
Invoke-MCPToolAssert -ToolName "get_lore" -Arguments @{ query = $threadEntityKey } -ExpectContains "Timeline-Value:** 4" -RequestId 229

Write-Section "TEST 61: thread_tick - global_snapshot finds other-thread entity on same date"
# The tick result above should have included test:thread-entity-other in global_snapshot.
# Re-tick and assert the summary mentions global entities (count > 0).
Invoke-MCPToolAssert -ToolName "thread_tick" -Arguments @{ thread_id = "test-thread-alpha" } -ExpectContains "global" -RequestId 230

Write-Section "TEST 62: thread_tick - no entities returns no-entities message"
Invoke-MCPToolAssert -ToolName "thread_tick" -Arguments @{ thread_id = "nonexistent-thread-xyz" } -ExpectContains "No entities" -RequestId 231

Write-Section "TEST 63: thread_tick - cleanup"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $threadEntityKey } -RequestId 232
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $threadOtherKey  } -RequestId 233

# ── field extraction: bullet + descriptor + float formats ─────────────────────

$bulletAttackerKey = "test:bullet-attacker"
$bulletDefenderKey = "test:bullet-defender"
$bulletIncrKey     = "test:bullet-increment"

Write-Section "TEST 64: increment_topic_field - bullet+descriptor float field setup"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $bulletIncrKey; text = "- **Weight-1 (Aggression/Predator-Drive):** 0.75`n**Status:** active" } -RequestId 234

Write-Section "TEST 65: increment_topic_field - read + update float from bullet+descriptor line"
Invoke-MCPToolAssert -ToolName "increment_topic_field" -Arguments @{ key = $bulletIncrKey; field_path = "Weight-1"; increment = 0.1; reason = "test" } -ExpectContains "0.85" -RequestId 235

Write-Section "TEST 66: increment_topic_field - verify bullet+descriptor format preserved in stored text"
Invoke-MCPToolAssert -ToolName "get_lore" -Arguments @{ query = $bulletIncrKey } -ExpectContains "Weight-1 (Aggression/Predator-Drive)" -RequestId 236

Write-Section "TEST 67: resolve_interaction - setup bullet+descriptor float weight entities"
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $bulletAttackerKey; text = "- **Weight-1 (Aggression/Predator-Drive):** 0.9`n**State-Level:** 0" } -RequestId 237
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $bulletDefenderKey; text = "- **Weight-2 (Resilience):** 0.1" } -RequestId 238

Write-Section "TEST 68: resolve_interaction - succeeds with bullet+descriptor float weights (P≈0.6)"
# P = (0.9×0.7) - (0.1×0.3) = 0.63 - 0.03 = 0.60 → should not return Weight-1 field error; content contains "P=0.6"
Invoke-MCPToolAssert -ToolName "resolve_interaction" -Arguments @{ entity_a_id = $bulletAttackerKey; entity_b_id = $bulletDefenderKey; action_type = "hunt" } -ExpectContains "P=0.6" -RequestId 239

Write-Section "TEST 69: field extraction tests - cleanup"
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $bulletIncrKey     } -RequestId 240
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $bulletAttackerKey } -RequestId 241
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $bulletDefenderKey } -RequestId 242

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

$Script:Failures | ConvertTo-Json -Depth 8 | Set-Content -Path $Script:FailureLog -Encoding UTF8
if ($Script:Failures.Count -gt 0) {
    Write-Host "Failure details written to: $Script:FailureLog" -ForegroundColor DarkGray
}

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
