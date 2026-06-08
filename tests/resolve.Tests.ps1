. $PSScriptRoot\common.ps1

Describe "Resolve Interaction" {
    BeforeEach {
        $resolverKeyA = "test:resolver-entity-a-$(Get-Random)"
        $resolverKeyB = "test:resolver-entity-b-$(Get-Random)"
        $resolverKeyZeroA = "test:resolver-entity-zero-a-$(Get-Random)"
        $resolverKeyHighB = "test:resolver-entity-high-b-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $resolverKeyA; text = "**Weight-1:** 1.0" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $resolverKeyB; text = "**Weight-2:** 0" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $resolverKeyZeroA; text = "**Weight-1:** 0" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $resolverKeyHighB; text = "**Weight-2:** 1.0" } | Out-Null
    }

    AfterEach {
        foreach ($key in @($resolverKeyA, $resolverKeyB, $resolverKeyZeroA, $resolverKeyHighB)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "resolve_interaction succeeds with high probability (P=1)" {
        $result = Invoke-MCPTool -ToolName "resolve_interaction" -Arguments @{
            entity_a_id = $resolverKeyA
            entity_b_id = $resolverKeyB
            action_type = "consume"
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "SUCCESS"
    }

    It "resolve_interaction fails with low probability (P=0)" {
        $result = Invoke-MCPTool -ToolName "resolve_interaction" -Arguments @{
            entity_a_id = $resolverKeyZeroA
            entity_b_id = $resolverKeyHighB
            action_type = "consume"
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "FAILURE"
    }

    It "resolve_interaction returns error for missing entity" {
        $result = Invoke-MCPTool -ToolName "resolve_interaction" -Arguments @{
            entity_a_id = "nonexistent:entity-xyz"
            entity_b_id = $resolverKeyB
            action_type = "test"
        }
        $result.error | Should -Not -BeNullOrEmpty
        $result.error.message | Should -Match "not found"
    }
}

Describe "Resolve Interaction - Bullet Format Weights" {
    BeforeEach {
        $bulletAttackerKey = "test:bullet-attacker-$(Get-Random)"
        $bulletDefenderKey = "test:bullet-defender-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $bulletAttackerKey
            text = "- **Weight-1 (Aggression/Predator-Drive):** 0.9`n**State-Level:** 0"
        } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $bulletDefenderKey
            text = "- **Weight-2 (Resilience):** 0.1"
        } | Out-Null
    }

    AfterEach {
        foreach ($key in @($bulletAttackerKey, $bulletDefenderKey)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "resolve_interaction succeeds with bullet+descriptor float weights" {
        $result = Invoke-MCPTool -ToolName "resolve_interaction" -Arguments @{
            entity_a_id = $bulletAttackerKey
            entity_b_id = $bulletDefenderKey
            action_type = "hunt"
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "P=0.870"
    }
}

