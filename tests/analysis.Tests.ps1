. $PSScriptRoot\common.ps1

Describe "Analyze Utility" {
    BeforeEach {
        $utilityKey = "test:utility-subject-$(Get-Random)"
        $utilityText = @"
**Tenderness-Index:** 0.80
**Fat-Marbling-Index:** 0.75
**Sensory-Receptivity:** 0.70
**Weight-2 (Prey Vulnerability):** 0.65
**Compliance-Potential:** 0.85
**Cortisol-Level:** 0.20
**Caloric-Yield-Estimate:** 0.72
"@
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $utilityKey; text = $utilityText } | Out-Null
    }

    AfterEach {
        if ($utilityKey) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $utilityKey } | Out-Null
        }
    }

    It "analyze_utility GASTRIC vector" {
        $result = Invoke-MCPTool -ToolName "analyze_utility" -Arguments @{ entity_id = $utilityKey; utility_vector = "GASTRIC" }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Grade"
    }

    It "analyze_utility THRALL vector" {
        $result = Invoke-MCPTool -ToolName "analyze_utility" -Arguments @{ entity_id = $utilityKey; utility_vector = "THRALL" }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Grade"
    }

    It "analyze_utility DISTRIBUTED vector" {
        $result = Invoke-MCPTool -ToolName "analyze_utility" -Arguments @{ entity_id = $utilityKey; utility_vector = "DISTRIBUTED" }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "/100"
    }

    It "analyze_utility returns error for missing entity" {
        $result = Invoke-MCPTool -ToolName "analyze_utility" -Arguments @{ entity_id = "nonexistent:entity-xyz"; utility_vector = "GASTRIC" }
        $result.error | Should -Not -BeNullOrEmpty
        $result.error.message | Should -Match "not found"
    }

    It "analyze_utility live character returns Grade A" {
        $result = Invoke-MCPTool -ToolName "analyze_utility" -Arguments @{
            entity_id  = "character:seraphine-herbalist"
            utility_vector = "GASTRIC"
            entity_role    = "subject"
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Grade A"
    }
}

Describe "Map Integration" {
    BeforeEach {
        $integrationSourceKey = "test:integration-source-$(Get-Random)"
        $integrationTargetKey = "test:integration-target-$(Get-Random)"
        $integrationSourceText = @"
Base traits of the source entity.
Trait Alpha [Transferable]
Trait Beta [Transferable]
**Transferable-Skill:** combat mastery
Non-transferable secret.
"@
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $integrationSourceKey; text = $integrationSourceText } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $integrationTargetKey; text = "Target entity base lore." } | Out-Null
    }

    AfterEach {
        foreach ($key in @($integrationSourceKey, $integrationTargetKey)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "map_integration transfers traits at full depth" {
        $result = Invoke-MCPTool -ToolName "map_integration" -Arguments @{
            source_id        = $integrationSourceKey
            target_id        = $integrationTargetKey
            integration_depth = 1.0
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Integrated"
    }

    It "map_integration written traits are retrievable" {
        Invoke-MCPTool -ToolName "map_integration" -Arguments @{
            source_id        = $integrationSourceKey
            target_id        = $integrationTargetKey
            integration_depth = 1.0
        } | Out-Null

        $result = Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $integrationTargetKey }
        $result.result.content[0].text | Should -Match "Integrated-From"
    }

    It "map_integration with no transferable traits returns message" {
        $plainSourceKey = "test:integration-plain-source-$(Get-Random)"
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $plainSourceKey; text = "No transferable traits here." } | Out-Null

        $result = Invoke-MCPTool -ToolName "map_integration" -Arguments @{
            source_id        = $plainSourceKey
            target_id        = $integrationTargetKey
            integration_depth = 1.0
        }
        $result.result.content[0].text | Should -Match "traits found in"

        Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $plainSourceKey } | Out-Null
    }
}

