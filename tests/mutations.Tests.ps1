. $PSScriptRoot\common.ps1

Describe "Field Increment Operations" {
    BeforeEach {
        $testKey = "test:increment-$(Get-Random)"
        $testContent = @"
**Status:** Test
**days_remaining:** 10
**character:** test-subject
"@
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $testKey; text = $testContent } | Out-Null
    }

    AfterEach {
        if ($testKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $testKey } | Out-Null
        }
    }

    It "increment_topic_field decrements numeric fields" {
        $result = Invoke-MCPTool -ToolName "increment_topic_field" -Arguments @{
            key        = $testKey
            field_path = "days_remaining"
            increment  = -1
            reason     = "daily-decrement"
        }
        $result.error | Should -BeNullOrEmpty
    }

    It "increment_topic_field handles negative increments" {
        $result = Invoke-MCPTool -ToolName "increment_topic_field" -Arguments @{
            key        = $testKey
            field_path = "days_remaining"
            increment  = -2
            reason     = "accelerated-decay"
        }
        $result.error | Should -BeNullOrEmpty
    }
}

Describe "Patch Operations" {
    BeforeEach {
        $patchKey = "test:patch-$(Get-Random)"
        $patchContent = "Status: Alive`nDays: 14"
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $patchKey; text = $patchContent } | Out-Null
    }

    AfterEach {
        if ($patchKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $patchKey } | Out-Null
        }
    }

    It "patch_lore replace operation" {
        $result = Invoke-MCPTool -ToolName "patch_lore" -Arguments @{
            key       = $patchKey
            operation = "replace"
            target    = "Status: Alive"
            value     = "Status: Sedated"
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Replaced 1 occurrence"
    }

    It "patch_lore replace detects missing target" {
        $result = Invoke-MCPTool -ToolName "patch_lore" -Arguments @{
            key       = $patchKey
            operation = "replace"
            target    = "Nonexistent"
            value     = "X"
        }
        $result.result.content[0].text | Should -Match "not found"
    }

    It "patch_lore append operation" {
        $result = Invoke-MCPTool -ToolName "patch_lore" -Arguments @{
            key       = $patchKey
            operation = "append"
            value     = "`nAppended line"
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Appended to end"
    }

    It "patch_lore detects ambiguous targets" {
        $ambigKey = "test:patch-ambig-$(Get-Random)"
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $ambigKey; text = "the cat chased the cat" } | Out-Null

        $result = Invoke-MCPTool -ToolName "patch_lore" -Arguments @{
            key       = $ambigKey
            operation = "replace"
            target    = "the cat"
            value     = "a dog"
        }
        $result.result.content[0].text | Should -Match "Ambiguous"

        Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $ambigKey } | Out-Null
    }

    It "patch_lore returns error for missing key" {
        $result = Invoke-MCPTool -ToolName "patch_lore" -Arguments @{
            key       = "nonexistent:key-99999"
            operation = "replace"
            target    = "X"
            value     = "Y"
        }
        $result.result.content[0].text | Should -Match "not found"
    }
}

Describe "Batch Operations" {
    BeforeEach {
        $batchAlphaKey = "test:batch-alpha-$(Get-Random)"
        $batchBetaKey = "test:batch-beta-$(Get-Random)"
    }

    AfterEach {
        if ($batchAlphaKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $batchAlphaKey } | Out-Null
        }
        if ($batchBetaKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $batchBetaKey } | Out-Null
        }
    }

    It "batch_set_lore writes multiple entries" {
        $batchSetArgs = @{
            entries = @(
                [ordered]@{ key = $batchAlphaKey; text = "Alpha batch content." }
                [ordered]@{ key = $batchBetaKey; text = "Beta batch content." }
            )
        }
        $result = Invoke-MCPTool -ToolName "batch_set_lore" -Arguments $batchSetArgs
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Saved 2"
    }

    It "batch_set_lore written entries are retrievable" {
        $batchSetArgs = @{
            entries = @(
                [ordered]@{ key = $batchAlphaKey; text = "Alpha batch content." }
                [ordered]@{ key = $batchBetaKey; text = "Beta batch content." }
            )
        }
        Invoke-MCPTool -ToolName "batch_set_lore" -Arguments $batchSetArgs | Out-Null
        $result = Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $batchAlphaKey }
        $result.result.content[0].text | Should -Match "Alpha batch content"
    }

    It "batch_mutate applies mutations sequentially" {
        $batchSetArgs = @{
            entries = @(
                [ordered]@{ key = $batchAlphaKey; text = "Alpha batch content." }
                [ordered]@{ key = $batchBetaKey; text = "Beta batch content." }
            )
        }
        Invoke-MCPTool -ToolName "batch_set_lore" -Arguments $batchSetArgs | Out-Null

        $batchMutArgs = @{
            mutations = @(
                [ordered]@{ key = $batchAlphaKey; action = "patch"; operation = "replace"; target = "Alpha batch content."; value = "Alpha mutated." }
                [ordered]@{ key = $batchBetaKey; action = "patch"; operation = "append"; value = "`nAppended line." }
            )
        }
        $result = Invoke-MCPTool -ToolName "batch_mutate" -Arguments $batchMutArgs
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Applied 2"
    }

    It "batch_mutate mutations persist" {
        $batchSetArgs = @{
            entries = @(
                [ordered]@{ key = $batchAlphaKey; text = "Alpha batch content." }
                [ordered]@{ key = $batchBetaKey; text = "Beta batch content." }
            )
        }
        Invoke-MCPTool -ToolName "batch_set_lore" -Arguments $batchSetArgs | Out-Null

        $batchMutArgs = @{
            mutations = @(
                [ordered]@{ key = $batchAlphaKey; action = "patch"; operation = "replace"; target = "Alpha batch content."; value = "Alpha mutated." }
                [ordered]@{ key = $batchBetaKey; action = "patch"; operation = "append"; value = "`nAppended line." }
            )
        }
        Invoke-MCPTool -ToolName "batch_mutate" -Arguments $batchMutArgs | Out-Null

        $result = Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $batchAlphaKey }
        $result.result.content[0].text | Should -Match "Alpha mutated"
    }
}

