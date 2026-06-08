. $PSScriptRoot\common.ps1

Describe "Thread Tick Operations" {
    BeforeEach {
        $threadEntityKey = "character:thread-entity-alpha-$(Get-Random)"
        $threadOtherKey = "character:thread-entity-other-$(Get-Random)"
        $threadEntityText = @"
**Thread:** test-thread-alpha-$(Get-Random)
**Timeline-Value:** 5
**Current-Date:** 2099-12-31
"@
        $threadOtherText = @"
**Thread:** test-thread-beta-$(Get-Random)
**Current-Date:** 2099-12-31
**Status:** Waiting
"@
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $threadEntityKey; text = $threadEntityText } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $threadOtherKey; text = $threadOtherText } | Out-Null
    }

    AfterEach {
        foreach ($key in @($threadEntityKey, $threadOtherKey)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "thread_tick with no entities returns no-entities message" {
        $result = Invoke-MCPTool -ToolName "thread_tick" -Arguments @{ thread_id = "nonexistent-thread-xyz" }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "No entities"
    }
}

