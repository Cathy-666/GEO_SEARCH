$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Write-Host '第一步：设置本次实际采集的品牌' -ForegroundColor Cyan
node setup_brand.js
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '第二步：检查采集依赖' -ForegroundColor Cyan
node -e "try { require('playwright-core'); require('iconv-lite'); require('xlsx'); } catch { process.exit(1); }"
if ($LASTEXITCODE -ne 0) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络后重试。' }
}

Write-Host '第三步：准备浏览器与平台登录' -ForegroundColor Cyan
$connected = $false
try {
    $response = Invoke-WebRequest 'http://localhost:9223/json/version' -UseBasicParsing -TimeoutSec 3
    $connected = ($response.StatusCode -eq 200)
} catch { }
if (-not $connected) {
    & "$PSScriptRoot\start_chrome.bat"
}
Write-Host '请在调试 Chrome 中登录豆包、DeepSeek、文心、元宝、千问，并保持浏览器打开。'
Read-Host '登录完成后按回车开始下一步' | Out-Null
$questionRange = Read-Host '输入要采集的题号（例如 1-3；直接回车采集全部）'
if ($questionRange -and $questionRange -notmatch '^\d+(\s*-\s*\d+)?(\s*,\s*\d+(\s*-\s*\d+)?)*$') {
    throw '题号格式不正确，请使用 1-3 或 1,3,5。'
}
$date = (Get-Date).ToString('yyyyMMdd')
$collectArgs = @('--brand-configured', '--date', $date)
if ($questionRange) { $collectArgs += @('--questions', $questionRange) }
Write-Host '第四步：正在实际采集五个平台，完成后生成看板' -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\run_all.ps1" @collectArgs
$collectionExit = $LASTEXITCODE
if ($collectionExit -eq 1) { throw '采集或看板生成失败，请检查上方错误信息。' }
if ($collectionExit -eq 2) { Write-Warning '部分平台或题目未完成；看板保留异常状态，请勿当作全部成功。' }
$brandRoot = node -e "process.stdout.write(require('./brand_config').DATA_ROOT)"
$dashboard = Join-Path $brandRoot "$($date.Substring(0,4))-$($date.Substring(4,2))-$($date.Substring(6,2))\dashboards\brand-dashboard-$date.html"
if (Test-Path -LiteralPath $dashboard) { Start-Process -FilePath $dashboard }
