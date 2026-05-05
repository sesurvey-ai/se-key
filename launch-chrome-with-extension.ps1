#requires -Version 5.1
# Launch a fresh Chrome instance with se-key-extension/ pre-loaded.
# Uses a separate user-data-dir so it does not touch your normal Chrome profile.

$ErrorActionPreference = 'Stop'

$Root      = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExtPath   = Join-Path $Root 'se-key-extension'
$ProfDir   = Join-Path $env:TEMP 'eclaim3-test-profile'
$ChromeExe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $ChromeExe)) {
  $ChromeExe = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
}
if (-not (Test-Path $ChromeExe))           { Write-Error "Chrome not found"; exit 1 }
if (-not (Test-Path $ExtPath -PathType Container)) { Write-Error "missing $ExtPath"; exit 1 }

if (-not (Test-Path $ProfDir)) { New-Item -ItemType Directory -Path $ProfDir | Out-Null }

Write-Host "[chrome] launching with extension..." -ForegroundColor Cyan
Write-Host "  exe   : $ChromeExe"
Write-Host "  ext   : $ExtPath"
Write-Host "  prof  : $ProfDir  (test profile, separate from your main one)"
Write-Host ""
Write-Host "ขั้นตอนทดสอบ:" -ForegroundColor Yellow
Write-Host "  1. กดไอคอน extension มุมขวาบน -> popup เปิด"
Write-Host "  2. กรอก LAN URL (เช่น http://192.168.4.122:3100) + API key"
Write-Host "  3. กด 'บันทึก' -> Chrome ต้องถามขอ permission สำหรับ URL นั้น -> Allow"
Write-Host "  4. กด 'ทดสอบ' -> วงสถานะต้องเป็นสีเขียว"
Write-Host "  5. เปิด https://eclaim3.blueventuregroup.co.th/esurvey/... -> floating panel ต้องโผล่"
Write-Host ""

& $ChromeExe `
  "--user-data-dir=$ProfDir" `
  "--load-extension=$ExtPath" `
  "--no-first-run" `
  "--no-default-browser-check" `
  "chrome://extensions"
