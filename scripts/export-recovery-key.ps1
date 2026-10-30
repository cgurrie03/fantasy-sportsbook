param(
  [string]$RecoveryFolder = (Join-Path $PSScriptRoot '..\work\financial-recovery-20261028'),
  [ValidateSet('export','verify-portable')][string]$Mode = 'export',
  [string]$PortableKey = '',
  [string]$ExpectedCipherSha256 = ''
)
$ErrorActionPreference = 'Stop'
# Owner runs this directly, outside agent tools. No password is placed in command
# arguments, environment variables, logs or files. Existing DPAPI key stays intact.
$custodyScript = Join-Path $PSScriptRoot 'recovery-custody.mjs'
$firstSecret = Read-Host 'New recovery password (20+ characters; save it in your password manager)' -AsSecureString
$secondSecret = Read-Host 'Confirm recovery password' -AsSecureString
$firstPointer = [IntPtr]::Zero
$secondPointer = [IntPtr]::Zero
try {
  $firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($firstSecret)
  $secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secondSecret)
  $firstPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
  $secondPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPointer)
  if ($firstPlain -cne $secondPlain -or $firstPlain.Length -lt 20) { throw 'Passwords must match and contain at least 20 characters.' }
  $secretInput = @{ passphrase = $firstPlain; confirmation = $secondPlain } | ConvertTo-Json -Compress
  # ASCII transport preserves Unicode passwords even under Windows PowerShell
  # 5.1's default pipe encoding. Base64 is only transport, not password storage.
  if ($Mode -eq 'verify-portable' -and -not (Test-Path -LiteralPath $PortableKey -PathType Leaf)) { throw 'Select the encrypted key attachment recovered independently from your password manager.' }
  if ($Mode -eq 'verify-portable' -and $ExpectedCipherSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Supply the ciphertext digest held independently in your password manager.' }
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($secretInput)) | & node $custodyScript $Mode $RecoveryFolder $PortableKey $ExpectedCipherSha256
  if ($LASTEXITCODE -ne 0) { throw 'Portable recovery key export failed.' }
} finally {
  if ($firstPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer) }
  if ($secondPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer) }
  $firstSecret.Dispose()
  $secondSecret.Dispose()
  Remove-Variable firstPlain,secondPlain,secretInput -ErrorAction SilentlyContinue
}
