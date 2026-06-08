. $PSScriptRoot\common.ps1

Describe "Consumption Timelines" {
    It "list_consumption_timelines - all statuses" {
        $result = Invoke-MCPTool -ToolName "list_consumption_timelines" -Arguments @{ status_filter = "all" }
        $result.error | Should -BeNullOrEmpty
    }

    It "list_consumption_timelines - imminent only" {
        $result = Invoke-MCPTool -ToolName "list_consumption_timelines" -Arguments @{ status_filter = "imminent" }
        $result.error | Should -BeNullOrEmpty
    }
}

Describe "Thread Operations" {
    It "list_active_threads" {
        $result = Invoke-MCPTool -ToolName "list_active_threads" -Arguments @{}
        $result.error | Should -BeNullOrEmpty
    }
}

