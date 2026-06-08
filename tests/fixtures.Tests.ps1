. $PSScriptRoot\common.ps1

Describe "Canonical Fixture Tests" {
    BeforeEach {
        $canonAlphaKey = "entity:canonical-subject-alpha-$(Get-Random)"
        $canonActorKey = "entity:canonical-actor-primary-$(Get-Random)"
        $canonBetaKey = "entity:canonical-subject-beta-$(Get-Random)"
        $canonLocKey = "location:canonical-transit-hub-$(Get-Random)"
        $canonSceneKey = "scene:canonical-threshold-$(Get-Random)"

        $canonAlphaLore = "# Entity: Subject Alpha`nAlias: Alpha`nAge: 24`nStatus: Active, Stage-2-of-4`nCurrent-Stage: 2`nTotal-Stages: 4`nTimeline-Value: 12`nTimeline-Unit: hours`nThread: canonical-primary-cycle`nWeight-1 (Drive): 30`nWeight-2 (Vulnerability): 55"
        $canonActorLore = "# Entity: Actor Primary`nAlias: The Director`nStatus: Active, Processing`nWeight-1 (Drive): 85`nWeight-2 (Vulnerability): 10`nState-Level: 0`nTimeline-Value: 8`nTimeline-Unit: hours`nThread: canonical-primary-cycle"
        $canonBetaLore = "# Entity: Subject Beta`nStatus: Stage-3-of-4, Modified-Consciousness`nWeight-1 (Drive): 10`nWeight-2 (Vulnerability): 75`nTimeline-Value: 48`nTimeline-Unit: hours`nThread: canonical-secondary-cycle"
        $canonLocLore = "# Location: Transit Hub`nType: threshold-zone`nDanger-Level: moderate`nExits:`n- target: location:canonical-dest-a`n  travel-cost: 2-hours`n- target: location:canonical-dest-b`n  travel-cost: 30-minutes"
        $canonSceneLore = "# Scene: Canonical Threshold`nThread: canonical-primary-cycle`nChoices:`n- id: investigate`n- id: search`n- id: retreat"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $canonAlphaKey; text = $canonAlphaLore } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $canonActorKey; text = $canonActorLore } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $canonBetaKey; text = $canonBetaLore } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $canonLocKey; text = $canonLocLore } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $canonSceneKey; text = $canonSceneLore } | Out-Null
    }

    AfterEach {
        foreach ($key in @($canonAlphaKey, $canonActorKey, $canonBetaKey, $canonLocKey, $canonSceneKey)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "advance_state_stage reads Stage-2-of-4 from Status field" {
        $result = Invoke-MCPTool -ToolName "advance_state_stage" -Arguments @{ entity_key = $canonAlphaKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Stage-3-of-4"
    }

    It "advance_state_stage handles Stage-3-of-4 terminal state" {
        $result = Invoke-MCPTool -ToolName "advance_state_stage" -Arguments @{ entity_key = $canonBetaKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Stage-4-of-4"
    }

    It "resolve_interaction normalizes integer weights" {
        $result = Get-MCPToolResult -ToolName "resolve_interaction" -Arguments @{
            entity_a_id = $canonActorKey
            entity_b_id = $canonAlphaKey
            action_type = "process"
        }
        $result.error | Should -BeNullOrEmpty

        [double]$w1 = $result.result.metadata.weight_1
        [double]$w2 = $result.result.metadata.weight_2

        $w1 | Should -BeGreaterThan 0.84
        $w1 | Should -BeLessThan 0.86
        $w2 | Should -BeGreaterThan 0.54
        $w2 | Should -BeLessThan 0.56
    }

    It "get_reachable_locations parses YAML-style Exits" {
        $result = Get-MCPToolResult -ToolName "get_reachable_locations" -Arguments @{ origin_key = $canonLocKey }
        $result.result.locations.Count | Should -Be 2
    }

    It "activate_scene extracts YAML choice IDs" {
        $result = Get-MCPToolResult -ToolName "activate_scene" -Arguments @{ scene_key = $canonSceneKey }
        $choices = $result.result.available_choices
        $choices | Should -Contain "investigate"
        $choices | Should -Contain "retreat"
    }
}

Describe "Weight Integer Boundaries" {
    BeforeEach {
        $canonMinKey = "entity:canonical-min-drive-$(Get-Random)"
        $canonMaxKey = "entity:canonical-max-drive-$(Get-Random)"
        $canonTargetKey = "entity:canonical-passive-target-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $canonMinKey; text = "Weight-1 (Drive): 5`nState-Level: 0" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $canonMaxKey; text = "Weight-1 (Drive): 95`nState-Level: 0" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $canonTargetKey; text = "Weight-2: 0" } | Out-Null
    }

    AfterEach {
        foreach ($key in @($canonMinKey, $canonMaxKey, $canonTargetKey)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "Weight-1:5 normalizes to ~0.05" {
        $result = Get-MCPToolResult -ToolName "resolve_interaction" -Arguments @{
            entity_a_id = $canonMinKey
            entity_b_id = $canonTargetKey
            action_type = "test"
        }
        [double]$w1 = $result.result.metadata.weight_1
        $w1 | Should -BeGreaterThan 0.049
        $w1 | Should -BeLessThan 0.051
    }

    It "Weight-1:95 normalizes to ~0.95" {
        $result = Get-MCPToolResult -ToolName "resolve_interaction" -Arguments @{
            entity_a_id = $canonMaxKey
            entity_b_id = $canonTargetKey
            action_type = "test"
        }
        [double]$w1 = $result.result.metadata.weight_1
        $w1 | Should -BeGreaterThan 0.949
        $w1 | Should -BeLessThan 0.951
    }
}

