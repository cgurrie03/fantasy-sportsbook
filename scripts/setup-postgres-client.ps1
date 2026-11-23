$ErrorActionPreference = 'Stop'
# Avoid Get-FileHash: Windows PowerShell launched from a newer PowerShell host
# can lack that module's script functions. Keep the same streaming SHA-256 check.
function Get-ClientSha256([string]$LiteralPath) {
  $stream = [IO.File]::OpenRead($LiteralPath)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $stream.Dispose() }
}
$root = Split-Path $PSScriptRoot -Parent
$spec = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config/postgresql-client-17.11.json') -Raw | ConvertFrom-Json
$target = Join-Path $root 'work/postgres-client-17.11/bin'
$missing = $false
foreach ($p in $spec.files.PSObject.Properties) {
  $file = Join-Path $target $p.Name
  if (!(Test-Path -LiteralPath $file)) { $missing = $true; break }
  if ((Get-ClientSha256 $file) -ne $p.Value) { throw 'Existing client differs from the pinned receipt. Nothing replaced.' }
}
if ($missing) {
  if (Test-Path -LiteralPath $target) { throw 'Partial client directory exists. Review it before preparing a separate installation.' }
  $download = Join-Path $root 'work/postgres-client-download/postgresql-17.11-windows-x64.zip'
  New-Item -ItemType Directory -Force -Path (Split-Path $download -Parent) | Out-Null
  if (!(Test-Path -LiteralPath $download)) {
    Invoke-WebRequest -UseBasicParsing -Uri $spec.source -OutFile $download
  }
  if ((Get-ClientSha256 $download) -ne $spec.archive_sha256) { throw 'Archive differs from the pinned HTTPS download receipt. Nothing executed.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($download)
  try {
    New-Item -ItemType Directory -Path $target | Out-Null
    foreach ($p in $spec.files.PSObject.Properties) {
      $entry = $zip.GetEntry('pgsql/bin/' + $p.Name)
      if ($null -eq $entry) { throw 'Pinned client file is missing from the archive.' }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $target $p.Name), $false)
      if ((Get-ClientSha256 (Join-Path $target $p.Name)) -ne $p.Value) { throw 'Extracted client hash mismatch.' }
    }
  } finally { $zip.Dispose() }
}
foreach ($name in @('pg_dump', 'pg_dumpall', 'pg_restore', 'psql')) {
  & (Join-Path $target ($name + '.exe')) --version
  if ($LASTEXITCODE -ne 0) { throw 'Client verification failed.' }
}
Write-Host 'Portable clients ready. No server, service, PATH or system configuration changed.'
