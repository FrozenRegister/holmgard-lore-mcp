. $PSScriptRoot\common.ps1

Describe "Core MCP Methods" {
    It "initialize" {
        $result = Invoke-JsonRpc -Method "initialize"
        $result.error | Should -BeNullOrEmpty
        $result.id | Should -Be 1
    }

    It "ping" {
        $result = Invoke-JsonRpc -Method "ping"
        $result.error | Should -BeNullOrEmpty
    }

    It "tools/list" {
        $result = Invoke-JsonRpc -Method "tools/list"
        $result.error | Should -BeNullOrEmpty
        $result.result | Should -Not -BeNullOrEmpty
    }

    It "list_topics (direct method)" {
        $result = Invoke-JsonRpc -Method "list_topics"
        $result.error | Should -BeNullOrEmpty
    }

    It "get_lore (direct method)" {
        $result = Invoke-JsonRpc -Method "get_lore" -Params @{ key = "character:sarah-weaver" }
        $result.error | Should -BeNullOrEmpty
    }
}

Describe "Basic Tool Operations" {
    It "ping_tool" {
        $result = Invoke-MCPTool -ToolName "ping_tool" -Arguments @{}
        $result.error | Should -BeNullOrEmpty
    }

    It "list_topics (tool)" {
        $result = Invoke-MCPTool -ToolName "list_topics" -Arguments @{}
        $result.error | Should -BeNullOrEmpty
    }

    It "list_maps (tool)" {
        $result = Invoke-MCPTool -ToolName "list_maps" -Arguments @{}
        $result.error | Should -BeNullOrEmpty
    }

    It "get_lore (tool)" {
        $result = Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = "character:sarah-weaver" }
        $result.error | Should -BeNullOrEmpty
    }

    It "get_lore_batch" {
        $result = Invoke-MCPTool -ToolName "get_lore_batch" -Arguments @{
            keys = @("character:sarah-weaver", "location:fernveil:outpost:deep-forest-cafe", "system:active-narratives")
        }
        $result.error | Should -BeNullOrEmpty
    }
}

