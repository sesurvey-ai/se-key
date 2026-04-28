#requires -Version 5.1
# Build a Chrome Web Store submission zip for eclaim3-extension/.
# manifest.json must be at the ROOT of the zip (CWS requirement).
# Output: eclaim3-extension-vX.Y.Z.zip in repo root.

$ErrorActionPreference = 'Stop'

function Log    { param([string]$m) Write-Host "[ext-zip] $m" -ForegroundColor Cyan }
function Fail   { param([string]$m) Write-Host "[fail   ] $m" -ForegroundColor Red; exit 1 }

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src  = Join-Path $Root 'eclaim3-extension'

if (-not (Test-Path $Src -PathType Container))         { Fail "missing folder: $Src" }
if (-not (Test-Path "$Src\manifest.json" -PathType Leaf)) { Fail "missing $Src\manifest.json" }

$manifest = Get-Content "$Src\manifest.json" -Raw | ConvertFrom-Json
$version  = $manifest.version
if ([string]::IsNullOrWhiteSpace($version)) { Fail "could not read version from manifest.json" }

$Out = Join-Path $Root "eclaim3-extension-v$version.zip"
if (Test-Path $Out) { Remove-Item -Force $Out }

Log "version: $version"
Log "creating $Out..."

# Files to exclude from the package (repo-only docs, OS junk, backups).
$excludeNames = @('README.md', 'PRIVACY.md', 'STORE_LISTING.md', '.DS_Store')

# Build the zip entry-by-entry so we control path separators. PS 5.1's
# Compress-Archive AND ZipFile.CreateFromDirectory both write Windows-style
# backslash paths into entries, which violates the ZIP spec. Chrome Web Store
# may reject. Forward slash only.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$files = Get-ChildItem -Path $Src -Recurse -Force -File | Where-Object {
  -not ($excludeNames -contains $_.Name) -and
  -not ($_.Name -like '*.bak') -and
  -not ($_.Name -like '*.bak.*')
}

$fs = [System.IO.File]::Open($Out, [System.IO.FileMode]::Create)
try {
  $archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files) {
      $rel = $file.FullName.Substring($Src.Length).TrimStart('\','/').Replace('\','/')
      $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
      $stream = $entry.Open()
      try {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $stream.Write($bytes, 0, $bytes.Length)
      } finally { $stream.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally { $fs.Dispose() }

# Sanity check: manifest.json must be at zip root.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($Out)
$rootEntries = $zip.Entries | Select-Object -ExpandProperty FullName
$zip.Dispose()
if ($rootEntries -notcontains 'manifest.json') {
  Fail "manifest.json not at zip root - Chrome Web Store will reject"
}

$size = (Get-Item $Out).Length
Log ("done: {0} ({1:N0} bytes)" -f $Out, $size)
Log ""
Log "contents:"
$rootEntries | Sort-Object | ForEach-Object { Write-Host "  $_" }
Log ""
Log "next: upload at https://chrome.google.com/webstore/devconsole"
