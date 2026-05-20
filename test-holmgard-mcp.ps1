# test-holmgard-mcp.ps1
# PowerShell script to exercise Holmgard MCP endpoints: tools/list, tools/call (ping_tool, get_lore, list_topics), optional admin/set-lore.
# Usage: .\test-holmgard-mcp.ps1

# === Configuration ===
$WorkerHost = "holmgard-lore-mcp.frozenregister.workers.dev"   # <-- replace with your host (no https://)
$Endpoint = "https://$WorkerHost/mcp"
$AdminEndpoint = "https://$WorkerHost/admin/set-lore"
$ADMIN_SECRET = ""   # <-- set if you want to test admin/set-lore (leave empty to skip)

$Headers = @{
  "Content-Type" = "application/json"
  "Accept" = "application/json"
}

function PostJson($bodyJson) {
  try {
    return Invoke-RestMethod -Uri $Endpoint -Method POST -Headers $Headers -Body $bodyJson -ContentType 'application/json'
  } catch {
    Write-Host "Request failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    return $null
  }
}

function Pretty($obj) {
  if ($null -eq $obj) { return }
  $obj | ConvertTo-Json -Depth 6
}

# === 1) Discovery: tools/list ===
Write-Host "`n=== Discovery: tools/list ===" -ForegroundColor Cyan
$body = '{"jsonrpc":"2.0","id":"check","method":"tools/list","params":{}}'
$resp = PostJson $body
Pretty $resp

# === 2) Ping tool ===
Write-Host "`n=== Ping tool ===" -ForegroundColor Cyan
$body = '{"jsonrpc":"2.0","id":"ping1","method":"tools/call","params":{"name":"ping_tool","arguments":{}}}'
$resp = PostJson $body
Pretty $resp

# === 3) List topics ===
Write-Host "`n=== List topics ===" -ForegroundColor Cyan
$body = '{"jsonrpc":"2.0","id":"list1","method":"tools/call","params":{"name":"list_topics","arguments":{}}}'
$resp = PostJson $body
Pretty $resp

# === 4) Get lore (example: holmgard) ===
Write-Host "`n=== Get lore: holmgard ===" -ForegroundColor Cyan
$body = '{"jsonrpc":"2.0","id":"call1","method":"tools/call","params":{"name":"get_lore","arguments":{"query":"holmgard"}}}'
$resp = PostJson $body
Pretty $resp

# === 5) Get lore: non-existent topic (should return No lore found.) ===
Write-Host "`n=== Get lore: unknown-topic ===" -ForegroundColor Cyan
$body = '{"jsonrpc":"2.0","id":"call2","method":"tools/call","params":{"name":"get_lore","arguments":{"query":"unknown-topic"}}}'
$resp = PostJson $body
Pretty $resp

# === 6) Optional: Admin set-lore (only if $ADMIN_SECRET is set) ===
if ($ADMIN_SECRET -and $ADMIN_SECRET.Trim() -ne "") {
  Write-Host "`n=== Admin: set-lore (testing) ===" -ForegroundColor Yellow
  $payload = @{ key = "test_topic"; text = "This is a test lore entry from admin script."; secret = $ADMIN_SECRET } | ConvertTo-Json
  try {
    $adminResp = Invoke-RestMethod -Uri $AdminEndpoint -Method POST -Headers $Headers -Body $payload -ContentType 'application/json'
    Write-Host "Admin response:" -ForegroundColor Green
    $adminResp | ConvertTo-Json -Depth 4
  } catch {
    Write-Host "Admin request failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
  }

  # Verify the new topic via get_lore
  Write-Host "`n=== Verify: get_lore test_topic ===" -ForegroundColor Cyan
  $body = '{"jsonrpc":"2.0","id":"call3","method":"tools/call","params":{"name":"get_lore","arguments":{"query":"test_topic"}}}'
  $resp = PostJson $body
  Pretty $resp
} else {
  Write-Host "`nSkipping admin/set-lore test (ADMIN_SECRET not set)." -ForegroundColor DarkYellow
}

Write-Host "`nAll tests complete." -ForegroundColor Green
