# install-winsw.ps1 — install/update se-key server as a Windows service
#
# Usage (PowerShell as Administrator, on the .122 server machine):
#   cd C:\se-key
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\install-winsw.ps1
#
# Idempotent — safe to re-run. Stops the existing service first if present,
# overwrites the exe + xml, reinstalls.

#Requires -RunAsAdministrator

[CmdletBinding()]
param(
  [string]$InstallRoot   = "C:\se-key",
  [string]$ServiceId     = "se-key",
  [string]$ServiceName   = "SE Survey Helper Server",
  [string]$WinSWVersion  = "v2.12.0",
  [string]$NodeExe       = "C:\Program Files\nodejs\node.exe",
  [int]   $HealthPort    = 3100
)

$ErrorActionPreference = "Stop"

function Info($msg)  { Write-Host "[install] $msg" -ForegroundColor Cyan }
function Warn($msg)  { Write-Host "[install] $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "[install] $msg" -ForegroundColor Red; exit 1 }

# ---------- 1. Validate prerequisites ----------
$ServerDir = Join-Path $InstallRoot "server"
$ServiceDir = Join-Path $InstallRoot "service"
$ServerEntry = Join-Path $ServerDir "src\server.js"
$EnvFile = Join-Path $ServerDir ".env"
$LogsDir = Join-Path $ServerDir "logs"

if (-not (Test-Path $NodeExe))     { Fail "node.exe not found at: $NodeExe  (install Node 22 LTS or pass -NodeExe <path>)" }
if (-not (Test-Path $ServerDir))   { Fail "server dir not found: $ServerDir  (deploy the project first or pass -InstallRoot <path>)" }
if (-not (Test-Path $ServerEntry)) { Fail "entry script not found: $ServerEntry" }
if (-not (Test-Path $EnvFile))     { Warn ".env not found at $EnvFile  — server will start with defaults" }

Info "node.exe      = $NodeExe"
Info "server dir    = $ServerDir"
Info "service dir   = $ServiceDir"
Info "WinSW version = $WinSWVersion"

# ---------- 2. Create dirs ----------
New-Item -ItemType Directory -Force -Path $ServiceDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogsDir    | Out-Null

# ---------- 3. Stop + uninstall existing service (if any) ----------
$WinswExe = Join-Path $ServiceDir "$ServiceId.exe"
$existing = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($existing) {
  Info "existing service found — stopping + uninstalling to replace"
  if ($existing.Status -eq 'Running') {
    if (Test-Path $WinswExe) {
      & $WinswExe stop | Out-Host
    } else {
      Stop-Service -Name $ServiceId -Force
    }
    Start-Sleep -Seconds 2
  }
  if (Test-Path $WinswExe) {
    & $WinswExe uninstall | Out-Host
  } else {
    sc.exe delete $ServiceId | Out-Host
  }
  Start-Sleep -Seconds 2
}

# ---------- 4. Download WinSW ----------
$WinswUrl = "https://github.com/winsw/winsw/releases/download/$WinSWVersion/WinSW-x64.exe"
Info "downloading WinSW from $WinswUrl"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $WinswUrl -OutFile $WinswExe -UseBasicParsing
} catch {
  Fail "download failed: $($_.Exception.Message)  —  check internet or try a different -WinSWVersion"
}

if (-not (Test-Path $WinswExe)) { Fail "download succeeded but file missing: $WinswExe" }
$size = (Get-Item $WinswExe).Length
Info "downloaded $WinswExe  ($([math]::Round($size/1MB,2)) MB)"

# ---------- 5. Write XML config ----------
$XmlPath = Join-Path $ServiceDir "$ServiceId.xml"
$NodeArgs = if (Test-Path $EnvFile) {
  "--env-file=`"$EnvFile`" `"$ServerEntry`""
} else {
  "`"$ServerEntry`""
}

$xmlContent = @"
<service>
  <id>$ServiceId</id>
  <name>$ServiceName</name>
  <description>LAN API + Admin UI for eClaim3 Survey Helper</description>

  <executable>$NodeExe</executable>
  <arguments>$NodeArgs</arguments>
  <workingdirectory>$ServerDir</workingdirectory>

  <logpath>$LogsDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>

  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="60 sec"/>

  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>

  <stoptimeout>15 sec</stoptimeout>
</service>
"@

Set-Content -Path $XmlPath -Value $xmlContent -Encoding UTF8
Info "wrote config: $XmlPath"

# ---------- 6. Install + start ----------
Info "installing service..."
& $WinswExe install
if ($LASTEXITCODE -ne 0) { Fail "winsw install failed (exit $LASTEXITCODE)" }

Info "starting service..."
& $WinswExe start
if ($LASTEXITCODE -ne 0) { Fail "winsw start failed (exit $LASTEXITCODE) — check $LogsDir\$ServiceId.err.log" }

# ---------- 7. Health check ----------
Start-Sleep -Seconds 3
Info "verifying health endpoint on port $HealthPort..."
$ok = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$HealthPort/api/health" -TimeoutSec 3 -UseBasicParsing
    if ($resp.StatusCode -eq 200 -or $resp.StatusCode -eq 401) {
      $ok = $true
      Info "health check OK (HTTP $($resp.StatusCode))"
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $ok) {
  Warn "server not responding yet — check logs:"
  Warn "  $LogsDir\$ServiceId.out.log"
  Warn "  $LogsDir\$ServiceId.err.log"
  Warn "(service is still installed; try: $WinswExe status)"
}

# ---------- 8. Summary ----------
Write-Host ""
Info "=========================================="
Info "INSTALL DONE"
Info "=========================================="
Info "service ID     : $ServiceId"
Info "config XML     : $XmlPath"
Info "logs           : $LogsDir"
Info ""
Info "common commands:"
Info "  $WinswExe status"
Info "  $WinswExe stop"
Info "  $WinswExe start"
Info "  $WinswExe restart       # use after deploying new code"
Info "  $WinswExe uninstall"
Info ""
Info "admin UI:  http://localhost:$HealthPort/admin/"
