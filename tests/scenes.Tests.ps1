. $PSScriptRoot\common.ps1

Describe "Scene Operations" {
    BeforeEach {
        $sceneLocKey = "test:scene-loc-$(Get-Random)"
        $sceneEntity = "test:scene-entity-$(Get-Random)"
        $sceneKey = "test:scene-$(Get-Random)"
        $choiceKey = "test:choice-$(Get-Random)"
        $historyEntity = "test:history-entity-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $sceneLocKey; text = "A dim tavern." } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $sceneEntity; text = "The innkeeper polishes a glass." } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $sceneKey
            text = "**Description:** Dark tavern.`n**Entities:** $sceneEntity`n**Location:** $sceneLocKey`n**Choices:** greet,leave"
        } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $choiceKey
            text = "**Outcome-Seed:** The hero accepts.`n**State-Change:** Questing`n**Next-Choices:** $choiceKey-b"
        } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $historyEntity; text = "**Status:** Idle`n**Choice-History:** prev-choice@2024-01-01T00:00:00.000Z" } | Out-Null
    }

    AfterEach {
        foreach ($key in @($sceneLocKey, $sceneEntity, $sceneKey, $choiceKey, $historyEntity)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "activate_scene activates and hydrates entities" {
        $result = Invoke-MCPTool -ToolName "activate_scene" -Arguments @{ scene_key = $sceneKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "activated"
    }

    It "activate_scene returns error for missing scene" {
        $result = Invoke-MCPTool -ToolName "activate_scene" -Arguments @{ scene_key = "scene:ghost" }
        $result.error | Should -Not -BeNullOrEmpty
    }

    It "commit_choice applies state change and records history" {
        $result = Invoke-MCPTool -ToolName "commit_choice" -Arguments @{ choice_id = $choiceKey; entity_key = $historyEntity }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "committed"
    }

    It "commit_choice state change persists" {
        Invoke-MCPTool -ToolName "commit_choice" -Arguments @{ choice_id = $choiceKey; entity_key = $historyEntity } | Out-Null

        $result = Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $historyEntity }
        $result.result.content[0].text | Should -Match "Questing"
    }

    It "get_choice_history parses committed entries" {
        $result = Invoke-MCPTool -ToolName "get_choice_history" -Arguments @{ entity_key = $historyEntity }
        $result.error | Should -BeNullOrEmpty
    }
}

Describe "State Stage Operations" {
    BeforeEach {
        $stageEntity = "test:stage-entity-$(Get-Random)"
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $stageEntity
            text = "**State-Stage:** 2`n**State-Total:** 5`n**Stage-Timer:** 4"
        } | Out-Null
    }

    AfterEach {
        if ($stageEntity) {
            Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $stageEntity } | Out-Null
        }
    }

    It "advance_state_stage increments stage and decrements timer" {
        $result = Invoke-MCPTool -ToolName "advance_state_stage" -Arguments @{ entity_key = $stageEntity }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "stage 3"
    }

    It "advance_state_stage writes back to entity" {
        Invoke-MCPTool -ToolName "advance_state_stage" -Arguments @{ entity_key = $stageEntity } | Out-Null

        $result = Invoke-MCPTool -ToolName "get_lore" -Arguments @{ query = $stageEntity }
        $result.result.content[0].text | Should -Match "State-Stage.*3"
    }
}

