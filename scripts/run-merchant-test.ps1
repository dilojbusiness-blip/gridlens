$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'D:\VSCodeData\Temp\node-runtime\node-v22.23.3-win-x64\node.exe'
$env:TEMP = 'D:\VSCodeData\Temp'
$env:TMP = $env:TEMP
Push-Location $root
$secure = $null
$pointer = [IntPtr]::Zero
try {
    & $node esbuild.js
    if ($LASTEXITCODE -ne 0) { throw 'Test build failed.' }
    & $node --use-system-ca scripts/test-license-connection.cjs
    if ($LASTEXITCODE -ne 0) { throw 'License service connection failed. No license key was requested or sent.' }
    Write-Host 'Internal TEST license only. Do not enter a merchant API token or a live customer license.'
    $secure = Read-Host 'Paste your test-order license key here (masked)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:GRIDLENS_TEST_LICENSE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    & $node --use-system-ca scripts/test-merchant-license.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Internal license test did not pass. See the sanitized stage above.' }
} finally {
    Remove-Item Env:GRIDLENS_TEST_LICENSE -ErrorAction SilentlyContinue
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($secure) { $secure.Dispose() }
    Pop-Location
}