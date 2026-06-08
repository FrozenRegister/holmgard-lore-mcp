. $PSScriptRoot\common.ps1

Describe "Append to Section Operations" {
    BeforeEach {
        $atsKey = "ats:smoke-test-$(Get-Random)"
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $atsKey
            text = "## Personality`nBrave and curious.`n## Goals`nFind the truth."
        } | Out-Null
    }

    AfterEach {
        if ($atsKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $atsKey } | Out-Null
        }
    }

    It "append_to_section appends to end of section" {
        $result = Get-MCPToolResult -ToolName "append_to_section" -Arguments @{
            key  = $atsKey
            section = "Personality"
            text = " Loyal to companions."
        }
        $result.result.action | Should -Be "appended"
        $result.result.new_version | Should -Be 2
    }

    It "append_to_section section not found with auto_create=false returns error" {
        $result = Get-MCPToolResult -ToolName "append_to_section" -Arguments @{
            key        = $atsKey
            section    = "NonExistentSection"
            text       = "Some text."
            auto_create = $false
        }
        $result.result.error | Should -Be "section_not_found"
    }

    It "append_to_section auto_create=true creates new section" {
        $result = Get-MCPToolResult -ToolName "append_to_section" -Arguments @{
            key  = $atsKey
            section = "Notes"
            text = "First note."
        }
        $result.result.action | Should -Be "created"
        $result.result.warnings | Should -Contain "section_created"
    }

    It "append_to_section empty text returns empty_text error" {
        $result = Get-MCPToolResult -ToolName "append_to_section" -Arguments @{
            key     = $atsKey
            section = "Personality"
            text    = ""
        }
        $result.result.error | Should -Be "empty_text"
    }

    It "append_to_section non-existent key returns key_not_found" {
        $result = Get-MCPToolResult -ToolName "append_to_section" -Arguments @{
            key     = "character:ats-does-not-exist-$(Get-Random)"
            section = "Personality"
            text    = "Text."
        }
        $result.result.error | Should -Be "key_not_found"
    }
}

