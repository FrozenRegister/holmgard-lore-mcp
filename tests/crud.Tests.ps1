. $PSScriptRoot\common.ps1

Describe "Topic Validation" {
    It "validate_topic_exists - exact match" {
        $result = Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "character:sarah-weaver" }
        $result.error | Should -BeNullOrEmpty
    }

    It "validate_topic_exists - partial match" {
        $result = Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "molly" }
        $result.error | Should -BeNullOrEmpty
    }

    It "validate_topic_exists - no match" {
        $result = Invoke-MCPTool -ToolName "validate_topic_exists" -Arguments @{ query_string = "nonexistent-thing-12345" }
        $result.error | Should -BeNullOrEmpty
    }
}

Describe "Search Operations" {
    BeforeEach {
        $searchKey = "test:search-key-$(Get-Random)"
        $searchText = @"
Lore search test content.
Prey is contained here.
"@
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $searchKey; text = $searchText } | Out-Null
    }

    AfterEach {
        if ($searchKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $searchKey } | Out-Null
        }
    }

    It "search_lore returns results containing query term" {
        $result = Invoke-MCPTool -ToolName "search_lore" -Arguments @{ query = "prey"; max_results = 5 }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "prey"
    }
}

Describe "Lore CRUD Operations" {
    BeforeEach {
        $testKey = "test:crud-$(Get-Random)"
        $testContent = @"
**Status:** Test
**days_remaining:** 10
**character:** test-subject
"@
    }

    AfterEach {
        if ($testKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $testKey } | Out-Null
        }
    }

    It "set_lore creates new entry" {
        $result = Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $testKey; text = $testContent }
        $result.error | Should -BeNullOrEmpty
    }

    It "get_lore retrieves written content" {
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $testKey; text = $testContent } | Out-Null
        $result = Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $testKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "days_remaining"
    }

    It "delete_lore removes entry" {
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $testKey; text = $testContent } | Out-Null
        $result = Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $testKey }
        $result.error | Should -BeNullOrEmpty
    }
}

