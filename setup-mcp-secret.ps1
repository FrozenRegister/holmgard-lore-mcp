param(
  [string]$SecretName = "MCP_API_KEY",
  [int]$WordCount = 5
)

$WordList = @(
  "arcane","astral","aether","ember","spirit","phantom","wyrm","goblin","titan",
  "oracle","rune","mythic","fable","legend","specter","shadow","griffin","harpy",
  "nymph","dryad","faerie","sylvan","eldritch","runic","lore","mystic","serpent",
  "chimera","golem","wyrd","omen","sigil","vortex","crystal","storm","thunder",
  "whisper","hollow","ashen","iron","marble","onyx","opal","silver","golden",
  "scarlet","crimson","violet","azure","frost","glimmer","shimmer","echo","dusk",
  "dawn","twilight","midnight","horizon","spire","citadel","sanctum","temple",
  "altar","relic","talisman","ward","binding","summon","invoke","ritual","coven",
  "circle","glyph","scroll","codex","archive","vault","cinder","flame"
)

$SecretValue = (1..$WordCount | ForEach-Object {
  $WordList | Get-Random
}) -join "-"

Write-Host "Generated secret: $SecretValue"

${env:$SecretName} = $SecretValue
Write-Host "Exported to ENV:$SecretName"

if (Get-Command Set-Clipboard -ErrorAction SilentlyContinue) {
  $SecretValue | Set-Clipboard
  Write-Host "Secret copied to clipboard for Shapes."
}

Write-Host "Setting Cloudflare Worker secret via Wrangler..."
$SecretValue | wrangler secret put $SecretName

Write-Host "Done."
