. $PSScriptRoot\common.ps1

Describe "Inventory Transfer Operations" {
    BeforeEach {
        $xferFromKey = "test:xfer-from-$(Get-Random)"
        $xferToKey = "test:xfer-to-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $xferFromKey; text = "**Inventory:** sword:2, gold:50" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $xferToKey; text = "**Inventory:** gold:10" } | Out-Null
    }

    AfterEach {
        foreach ($key in @($xferFromKey, $xferToKey)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "transfer_item moves item and updates both entities" {
        $result = Invoke-MCPTool -ToolName "transfer_item" -Arguments @{
            from_entity = $xferFromKey
            to_entity   = $xferToKey
            item_key    = "sword"
            quantity    = 1
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Transferred 1"
    }

    It "transfer_item rejects missing item" {
        $result = Invoke-MCPTool -ToolName "transfer_item" -Arguments @{
            from_entity = $xferToKey
            to_entity   = $xferFromKey
            item_key    = "magic-staff"
        }
        $result.result.content[0].text | Should -Match "not found"
    }
}

