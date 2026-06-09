. $PSScriptRoot\common.ps1

Describe "Admin Endpoints" {
    It "admin/set-lore endpoint" {
        if (-not $ADMIN_SECRET) {
            Set-ItResult -Skipped -Because "ADMIN_SECRET is not configured"
            return
        }

        $testKey = "test:admin-set-$(Get-Random)"
        $testContent = "Admin test content."
        $result = Invoke-AdminEndpoint -Url $ADMIN_SET_URL -Body @{ key = $testKey; text = $testContent }
        $result.ok | Should -Be $true

        Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $testKey } | Out-Null
    }

    It "admin/delete-lore endpoint" {
        if (-not $ADMIN_SECRET) {
            Set-ItResult -Skipped -Because "ADMIN_SECRET is not configured"
            return
        }

        $testKey = "test:admin-delete-$(Get-Random)"
        $testContent = "Admin test content."

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $testKey; text = $testContent } | Out-Null

        $result = Invoke-AdminEndpoint -Url $ADMIN_DELETE_URL -Body @{ key = $testKey }
        $result.ok | Should -Be $true
    }
}

