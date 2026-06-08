. $PSScriptRoot\common.ps1

Describe "Sensory Profile Operations" {
    BeforeEach {
        $sensoryKey = "test:sensory-entity-$(Get-Random)"
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $sensoryKey
            text = "**Temperature:** warm`n**Scent:** earthy`n**Texture:** smooth`n**Sound-Signature:** low hum`n**Visual-Descriptors:** amber glow"
        } | Out-Null
    }

    AfterEach {
        if ($sensoryKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $sensoryKey } | Out-Null
        }
    }

    It "get_sensory_profile returns all five sensory fields" {
        $result = Invoke-MCPTool -ToolName "get_sensory_profile" -Arguments @{ entity_key = $sensoryKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "warm"
    }

    It "get_sensory_profile returns error for missing entity" {
        $result = Invoke-MCPTool -ToolName "get_sensory_profile" -Arguments @{ entity_key = "character:no-body" }
        $result.error | Should -Not -BeNullOrEmpty
    }
}

