. $PSScriptRoot\common.ps1

param(
    [switch]$Parallel,
    [string]$Filter,
    [switch]$CI
)

$testsDir = $PSScriptRoot
$testFiles = Get-ChildItem -Path $testsDir -Filter '*.Tests.ps1' | Sort-Object Name

if ($Filter) {
    $testFiles = $testFiles | Where-Object { $_.Name -like "*$Filter*" }
}

Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' Holmgard Lore MCP - Pester Test Runner' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "Test files: $($testFiles.Count)" -ForegroundColor Gray
if ($Filter) { Write-Host "Filter: $Filter" -ForegroundColor Yellow }
Write-Host ''

$allPassed = $true
$totalTests = 0
$totalPassed = 0
$totalFailed = 0
$totalSkipped = 0
$failedFiles = @()
$startTime = Get-Date

foreach ($file in $testFiles) {
    Write-Host "--- Running $($file.Name) ---" -ForegroundColor Green
    $result = Invoke-Pester -Path $file.FullName -PassThru -Show Minimal
    $totalTests += $result.TotalCount
    $totalPassed += $result.PassedCount
    $totalFailed += $result.FailedCount
    $totalSkipped += $result.SkippedCount
    if ($result.FailedCount -gt 0) { $allPassed = $false; $failedFiles += $file.Name }
    Write-Host ''
}

$duration = (Get-Date) - $startTime
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ' Test Run Summary' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "Duration: $($duration.ToString('mm\:ss'))" -ForegroundColor Gray
Write-Host "Total:    $totalTests" -ForegroundColor White
Write-Host "Passed:   $totalPassed" -ForegroundColor Green
Write-Host "Failed:   $totalFailed" -ForegroundColor Red
Write-Host "Skipped:  $totalSkipped" -ForegroundColor Yellow
if ($failedFiles.Count -gt 0) {
    Write-Host 'Failed files:' -ForegroundColor Red
    foreach ($f in $failedFiles) { Write-Host "  - $f" -ForegroundColor Red }
}
if ($CI -and -not $allPassed) { exit 1 }
