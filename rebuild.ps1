# rebuild.ps1
# Usage: .\rebuild.ps1              (latest date)
#        .\rebuild.ps1 20260603    (specific date)
param([string]$Date = "")

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$brandRoot = node -e "process.stdout.write(require('./brand_config').DATA_ROOT)"

# Resolve date
if ($Date -eq "") {
  $folders = Get-ChildItem $brandRoot -Directory |
    Where-Object { $_.Name -match "^\d{4}-\d{2}-\d{2}$" } |
    Sort-Object Name -Descending
  if ($folders.Count -eq 0) {
    Write-Host "[ERROR] No data folder found" -ForegroundColor Red
    pause; exit 1
  }
  $dashDate = $folders[0].Name
  $compactDate = $dashDate.Replace("-", "")
} else {
  $compactDate = $Date.Replace("-", "")
  $dashDate = $compactDate.Insert(4, "-").Insert(7, "-")
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Rejudge + Rebuild Dashboard" -ForegroundColor Cyan
Write-Host "  Date: $dashDate" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Brand mode: no rejudge needed (brand detection is in collection JSON)
Write-Host "[1/2] Building dashboard..." -ForegroundColor Yellow
node build_dashboard.js --date $compactDate --all
if ($LASTEXITCODE -ne 0) {
  Write-Host "[FAIL] build_dashboard.js returned error" -ForegroundColor Red
  pause; exit 1
}
Write-Host "[OK] Dashboard built" -ForegroundColor Green
Write-Host ""

# Step 3: open dashboard
Write-Host "[2/2] Opening dashboard..." -ForegroundColor Yellow
$dashFile = Join-Path $brandRoot "$dashDate\dashboards\brand-dashboard-$compactDate.html"
if (-not (Test-Path $dashFile)) {
  Write-Host "[ERROR] Dashboard not found: $dashFile" -ForegroundColor Red
  pause; exit 1
}
Write-Host "  Opening: dashboard-$compactDate.html" -ForegroundColor Green
Start-Process $dashFile
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  All done!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
pause
