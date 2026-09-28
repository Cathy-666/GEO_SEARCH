# Exit codes: 0 success, 2 partial failure, 1 all failed or build failed.
Set-Location -LiteralPath $PSScriptRoot
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if (($args -notcontains '--brand-configured') -and ($args -notcontains '--noretry')) {
    node setup_brand.js
    if ($LASTEXITCODE -ne 0) { exit 1 }
}
$collectArgs = @()
for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -in @('--date', '--questions')) {
        $collectArgs += $args[$i]
        $i++
        if ($i -ge $args.Count) { throw 'Missing argument value' }
        $collectArgs += $args[$i]
    }
}
$failed = @()
$complete = 0
foreach ($platform in @('doubao','deepseek','yiyan','yuanbao','qianwen')) {
    Write-Host "Collecting: $platform"
    & node run_v3_fixed.js $platform @collectArgs
    $result = $LASTEXITCODE
    if (($result -ne 0) -and ($args -notcontains '--noretry')) {
        Write-Host "Retrying selected questions once: $platform"
        Start-Sleep -Seconds 10
        & node run_v3_fixed.js $platform @collectArgs
        $result = $LASTEXITCODE
    }
    if ($result -eq 0) { $complete++ }
    else { $failed += $platform }
    Write-Host "Platform exit code: $result (0=success, 2=partial, 1=failed)"
}
$buildArgs = @()
$dateIndex = [Array]::IndexOf($args, '--date')
if ($dateIndex -ge 0) { $buildArgs = @('--date', $args[$dateIndex + 1]) }
& node build_dashboard.js @buildArgs
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "Fully successful platforms: $complete/5"
if ($failed.Count -gt 0) {
    Write-Host "Incomplete platforms: $($failed -join ', '). See dashboard for per-question results."
    exit 2
}
exit 0
