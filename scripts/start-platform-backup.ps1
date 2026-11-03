param([ValidateSet('development','production')][string]$Target = 'development')
$ErrorActionPreference = 'Stop'
$ref = if ($Target -eq 'development') { 'whlcnlacueweaqpsupqs' } else { 'bmvjcdgxwxqalaohpsnw' }
& (Join-Path $PSScriptRoot 'setup-postgres-client.ps1')
Write-Host "Read-only encrypted backup of $Target ($ref). No restore or database changes."
$confirmation = Read-Host "Type $Target to confirm the source"
if ($confirmation -cne $Target) { throw 'Source was not confirmed.' }
$hostName = Read-Host "Database host from Connect (Enter for db.$ref.supabase.co)"
if (!$hostName) { $hostName = "db.$ref.supabase.co" }
$dbUser = Read-Host 'Database user from Connect (Enter for postgres; session pooler uses postgres.PROJECT-REF)'
if (!$dbUser) { $dbUser = 'postgres' }
$certificate = (Read-Host 'Full path to the downloaded source project SSL CA certificate').Trim('"')
if (!(Test-Path -LiteralPath $certificate -PathType Leaf)) { throw 'Source CA certificate file is required.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$secret = Read-Host 'Source database password (hidden; never paste in chat)' -AsSecureString
$pointer = [IntPtr]::Zero
$child = $null
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $node
  $info.Arguments = '"' + (Join-Path $PSScriptRoot 'export-platform-backup.mjs') + '"'
  $info.UseShellExecute = $false
  $info.WorkingDirectory = Split-Path $PSScriptRoot -Parent
  $info.EnvironmentVariables.Remove('NODE_OPTIONS')
  $info.EnvironmentVariables['BOFF_BACKUP_TARGET'] = $Target
  $info.EnvironmentVariables['BOFF_BACKUP_HOST'] = $hostName
  $info.EnvironmentVariables['BOFF_BACKUP_USER'] = $dbUser
  $info.EnvironmentVariables['BOFF_BACKUP_CA'] = (Resolve-Path -LiteralPath $certificate).Path
  $info.EnvironmentVariables['BOFF_BACKUP_PASSWORD'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $child = [Diagnostics.Process]::Start($info)
  $info.EnvironmentVariables.Remove('BOFF_BACKUP_PASSWORD')
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $pointer = [IntPtr]::Zero
  $secret.Dispose()
  $child.WaitForExit()
  if ($child.ExitCode -ne 0) { throw 'Backup did not complete. Keep any partial encrypted files for review; send only a non-secret error description.' }
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if ($secret) { $secret.Dispose() }
  if ($child) { $child.Dispose() }
}
