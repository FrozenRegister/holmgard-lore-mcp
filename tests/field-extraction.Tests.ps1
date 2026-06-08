. $PSScriptRoot\common.ps1

Describe "Field Extraction - Bullet + Descriptor Format" {
    BeforeEach {
        $bulletIncrKey = "test:bullet-increment-$(Get-Random)"
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $bulletIncrKey
            text = "- **Weight-1 (Aggression/Predator-Drive):** 0.75`n**Status:** active"
        } | Out-Null
    }

    AfterEach {
        if ($bulletIncrKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $bulletIncrKey } | Out-Null
        }
    }

    It "increment_topic_field parses bullet+descriptor float field" {
        $result = Invoke-MCPTool -ToolName "increment_topic_field" -Arguments @{
            key        = $bulletIncrKey
            field_path = "Weight-1"
            increment  = 0.1
            reason     = "test"
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "0.85"
    }

    It "increment_topic_field preserves bullet+descriptor format" {
        Invoke-MCPTool -ToolName "increment_topic_field" -Arguments @{
            key        = $bulletIncrKey
            field_path = "Weight-1"
            increment  = 0.1
            reason     = "test"
        } | Out-Null

        $result = Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $bulletIncrKey }
        $result.result.content[0].text | Should -Match "Weight-1 \(Aggression/Predator-Drive\)"
    }
}

