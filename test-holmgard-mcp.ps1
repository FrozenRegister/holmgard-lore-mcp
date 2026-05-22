# Holmgard MCP Test Script
# Tests all 10 tools (5 original + 5 new)

$MCP_URL = "https://holmgard-lore-mcp.frozenregister.workers.dev/mcp"
$HEADERS = @{
    "Content-Type" = "application/json"
}

function Invoke-MCPTool {
    param(
        [string]$ToolName,
        [hashtable]$Arguments,
        [int]$RequestId = 1
    )
    
    $body = @{
        jsonrpc = "2.0"
        id = $RequestId
        method = "tools/call"
        params = @{
            name = $ToolName
            arguments = $Arguments
        }
    } | ConvertTo-Json -Depth 10
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "Testing: $ToolName" -ForegroundColor Yellow
    Write-Host "Arguments: $($Arguments | ConvertTo-Json -Compress)" -ForegroundColor Gray
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    
    try {
        $response = Invoke-WebRequest -Uri $MCP_URL -Method POST -Headers $HEADERS -Body $body
        $result = $response.Content | ConvertFrom-Json
        
        if ($result.error) {
            Write-Host "❌ ERROR: $($result.error.message)" -ForegroundColor Red
            Write-Host "Data: $($result.error.data | ConvertTo-Json -Compress)" -ForegroundColor Red
        } else {
            Write-Host "✅ SUCCESS" -ForegroundColor Green
            Write-Host "Result: $($result.result | ConvertTo-Json -Depth 3)" -ForegroundColor Green
        }
    } catch {
        Write-Host "❌ EXCEPTION: $_" -ForegroundColor Red
    }
    
    Write-Host ""
}

# Test 1: ping_tool (baseline)
Write-Host "TEST 1: ping_tool" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "ping_tool" -Arguments @{}

# Test 2: list_topics
Write-Host "TEST 2: list_topics" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "list_topics" -Arguments @{}

# Test 3: get_lore (existing tool)
Write-Host "TEST 3: get_lore" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = "character:sarah-weaver" }

# Test 4: get_lore_batch (NEW)
Write-Host "TEST 4: get_lore_batch (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "get_lore_batch" -Arguments @{
    keys = @("character:sarah-weaver", "location:fernveil:outpost:deep-forest-cafe", "system:active-narratives")
}

# Test 5: list_consumption_timelines (NEW)
Write-Host "TEST 5: list_consumption_timelines (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "list_consumption_timelines" -Arguments @{ status_filter = "all" }

# Test 6: list_consumption_timelines with filter (NEW)
Write-Host "TEST 6: list_consumption_timelines with status filter (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "list_consumption_timelines" -Arguments @{ status_filter = "imminent" }

# Test 7: list_prophecy_vectors (NEW)
Write-Host "TEST 7: list_prophecy_vectors (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "list_prophecy_vectors" -Arguments @{}

# Test 8: validate_topic_exists - exact match (NEW)
Write-Host "TEST 8: validate_topic_exists - exact match (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "character:sarah-weaver" }

# Test 9: validate_topic_exists - partial match (NEW)
Write-Host "TEST 9: validate_topic_exists - partial match (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "molly" }

# Test 10: validate_topic_exists - no match (NEW)
Write-Host "TEST 10: validate_topic_exists - no match (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "nonexistent-thing-12345" }

# Test 11: set_lore (setup for increment test)
Write-Host "TEST 11: set_lore - create test entry" -ForegroundColor Magenta
$testKey = "test:timeline-entry"
$testContent = @"
**Status:** Test
**days_remaining:** 10
**character:** test-subject
"@
Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $testKey; text = $testContent }

# Test 12: increment_topic_field (NEW)
Write-Host "TEST 12: increment_topic_field (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "increment_topic_field" -Arguments @{
    key = $testKey
    field_path = "days_remaining"
    increment = -1
    reason = "daily-decrement"
}

# Test 13: verify increment worked
Write-Host "TEST 13: verify increment - get_lore" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $testKey }

# Test 14: increment again (negative increment)
Write-Host "TEST 14: increment_topic_field - negative increment (NEW)" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "increment_topic_field" -Arguments @{
    key = $testKey
    field_path = "days_remaining"
    increment = -2
    reason = "accelerated-decay"
}

# Test 15: delete_lore cleanup
Write-Host "TEST 15: delete_lore - cleanup test entry" -ForegroundColor Magenta
Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $testKey }

Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "All tests complete!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan