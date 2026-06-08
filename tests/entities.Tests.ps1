. $PSScriptRoot\common.ps1

Describe "Direct-Read Tools" {
    BeforeEach {
        $relA = "test:rel-a-$(Get-Random)"
        $relB = "test:rel-b-$(Get-Random)"
        $factionEntity = "test:faction-entity-$(Get-Random)"
        $factionKey = "test:faction-$(Get-Random)"
        $knowledgeKey = "test:knowledge-$(Get-Random)"
        $envLocKey = "test:env-loc-$(Get-Random)"
        $envEntityKey = "test:env-entity-$(Get-Random)"
        $invEntityKey = "test:inv-entity-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $relA; text = "**Affinity:** 0.7`n**Faction:** order`nBob is a trusted ally." } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $relB; text = "**Faction:** order`nAlice mentored me." } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $factionEntity; text = "**Rank:** Captain`n**Reputation:** 0.9`n**Faction:** order" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $factionKey; text = "Members: captain, paladin, squire." } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $knowledgeKey; text = "**Knows:** hidden-vault, patrol-routes`nI found the hidden-vault last night." } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $envLocKey; text = "Stone walls surround you.`nA gem gleams [hidden] in the rock." } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $envEntityKey; text = "**Perception:** 0.9" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $invEntityKey; text = "**Inventory:** sword:3, shield:1, potion:10" } | Out-Null
    }

    AfterEach {
        foreach ($key in @($relA, $relB, $factionEntity, $factionKey, $knowledgeKey, $envLocKey, $envEntityKey, $invEntityKey)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "get_relationship detects affinity and faction overlap" {
        $result = Invoke-MCPTool -ToolName "get_relationship" -Arguments @{ entity_a = $relA; entity_b = $relB }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Relationship data found"
    }

    It "get_relationship returns not-found for unrelated entities" {
        $result = Invoke-MCPTool -ToolName "get_relationship" -Arguments @{ entity_a = $envLocKey; entity_b = $knowledgeKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "No relationship data found"
    }

    It "get_relationship returns error for missing entity" {
        $result = Invoke-MCPTool -ToolName "get_relationship" -Arguments @{ entity_a = $relA; entity_b = "nonexistent:nobody" }
        $result.error | Should -Not -BeNullOrEmpty
    }

    It "get_faction_standing detects member" {
        $result = Invoke-MCPTool -ToolName "get_faction_standing" -Arguments @{ entity_key = $factionEntity; faction_key = $factionKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "member"
    }

    It "get_faction_standing returns error for missing faction" {
        $result = Invoke-MCPTool -ToolName "get_faction_standing" -Arguments @{ entity_key = $factionEntity; faction_key = "faction:no-such" }
        $result.error | Should -Not -BeNullOrEmpty
    }

    It "get_entity_knowledge returns excerpts for known topic" {
        $result = Invoke-MCPTool -ToolName "get_entity_knowledge" -Arguments @{ entity_key = $knowledgeKey; topic = "hidden-vault" }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "has knowledge of"
    }

    It "get_entity_knowledge returns not-known for unknown topic" {
        $result = Invoke-MCPTool -ToolName "get_entity_knowledge" -Arguments @{ entity_key = $knowledgeKey; topic = "secret-dragon" }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "no knowledge of"
    }

    It "sense_environment returns all details for high perception" {
        $result = Invoke-MCPTool -ToolName "sense_environment" -Arguments @{ location_key = $envLocKey; entity_key = $envEntityKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "perception"
    }

    It "sense_environment returns error for missing entity" {
        $result = Invoke-MCPTool -ToolName "sense_environment" -Arguments @{ location_key = $envLocKey; entity_key = "character:ghost" }
        $result.error | Should -Not -BeNullOrEmpty
    }

    It "get_inventory parses structured items" {
        $result = Invoke-MCPTool -ToolName "get_inventory" -Arguments @{ entity_key = $invEntityKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "sword"
    }

    It "get_inventory returns empty for entity without inventory" {
        $result = Invoke-MCPTool -ToolName "get_inventory" -Arguments @{ entity_key = $knowledgeKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "No inventory"
    }
}

Describe "Entity Generation and Encounters" {
    BeforeEach {
        $archetypeKey = "test:archetype-$(Get-Random)"
        $encounterLoc = "test:encounter-loc-$(Get-Random)"
        $archetypeEntityKey = "archetype:test-arch-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $archetypeKey
            text = "**Weight-1:** 0.6`n**Weight-2:** 0.3`n**Status:** Patrol"
        } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $archetypeEntityKey
            text = "**Weight-1:** 0.6`n**Status:** Roaming"
        } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $encounterLoc
            text = "**Encounter-Table:** archetype:test-arch-*:80, archetype:deer:20"
        } | Out-Null
    }

    AfterEach {
        foreach ($key in @($archetypeKey, $encounterLoc)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "generate_entity creates from archetype" {
        $result = Invoke-MCPTool -ToolName "generate_entity" -Arguments @{ archetype_key = $archetypeEntityKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "Generated entity"
    }

    It "roll_encounter succeeds with encounter table" {
        $result = Invoke-MCPTool -ToolName "roll_encounter" -Arguments @{ location_key = $encounterLoc; threat_level = 5 }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "rolled"
    }

    It "roll_encounter returns message for missing table" {
        $result = Invoke-MCPTool -ToolName "roll_encounter" -Arguments @{ location_key = $archetypeKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "No Encounter-Table"
    }
}

Describe "Compatibility Operations" {
    BeforeEach {
        $compatA = "test:compat-a-$(Get-Random)"
        $compatB = "test:compat-b-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $compatA
            text = "**Weight-1:** 0.8`n**Size:** 3.0`n**Environment:** forest"
        } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{
            key  = $compatB
            text = "**Weight-2:** 0.4`n**Size:** 1.0`n**Environment:** forest"
        } | Out-Null
    }

    AfterEach {
        foreach ($key in @($compatA, $compatB)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "get_compatibility returns COMPATIBLE for matching entities" {
        $result = Invoke-MCPTool -ToolName "get_compatibility" -Arguments @{
            entity_a        = $compatA
            entity_b        = $compatB
            interaction_type = "hunt"
        }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "COMPATIBLE"
    }
}

Describe "Location and Exit Operations" {
    BeforeEach {
        $reachDestKey = "test:reach-dest-$(Get-Random)"
        $reachLocKey = "test:reach-loc-$(Get-Random)"

        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $reachDestKey; text = "**Danger-Level:** 0.3`n**Travel-Cost:** 20" } | Out-Null
        Invoke-MCPTool -ToolName "set_lore" -Arguments @{ key = $reachLocKey; text = "**Exits:** $reachDestKey" } | Out-Null
    }

    AfterEach {
        foreach ($key in @($reachDestKey, $reachLocKey)) {
            if ($key) {
                Invoke-MCPTool -ToolName "delete_lore" -Arguments @{ key = $key } | Out-Null
            }
        }
    }

    It "get_reachable_locations parses exits and checks destinations" {
        $result = Invoke-MCPTool -ToolName "get_reachable_locations" -Arguments @{ origin_key = $reachLocKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "reachable"
    }

    It "get_reachable_locations returns empty for missing Exits field" {
        $result = Invoke-MCPTool -ToolName "get_reachable_locations" -Arguments @{ origin_key = $reachDestKey }
        $result.error | Should -BeNullOrEmpty
        $result.result.content[0].text | Should -Match "No exits defined"
    }
}

