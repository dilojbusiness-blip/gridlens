$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'D:\VSCodeData\Temp\node-runtime\node-v22.23.3-win-x64\node.exe'
$env:TEMP = 'D:\VSCodeData\Temp'
$env:TMP = $env:TEMP
Remove-Item Env:ELECTRON_RUN_AS_NODE,Env:VSCODE_IPC_HOOK_CLI -ErrorAction SilentlyContinue
Push-Location $root
try {
    & $node esbuild.js --host-tests
    if ($LASTEXITCODE -ne 0) { throw 'Host-test build failed.' }
    & $node --use-system-ca scripts/test-license-connection.cjs
    if ($LASTEXITCODE -ne 0) { throw 'HTTPS service not reachable; no key requested.' }
    Write-Host 'A separate VS Code test window will ask for the INTERNAL TEST license in a masked input box.'
    $arguments = @(
        '--new-window', '--disable-gpu', '--disable-extensions', '--skip-welcome', '--skip-release-notes',
        '--user-data-dir="D:\VSCodeData\Temp\gridlens-real-license-profile"',
        '--extensions-dir="D:\VSCodeData\Temp\gridlens-test-extensions"',
        "--extensionDevelopmentPath=`"$root`"",
        "--extensionDevelopmentPath=`"$root\tests\fixture`"",
        "--extensionTestsPath=`"$root\tests\host\real-license.cjs`""
    )
    $process = Start-Process 'D:\Microsoft VS Code\Code.exe' -ArgumentList $arguments -Wait -PassThru `
        -RedirectStandardOutput 'D:\VSCodeData\Temp\gridlens-real-license-out.txt' `
        -RedirectStandardError 'D:\VSCodeData\Temp\gridlens-real-license-stderr.txt'
    if ($process.ExitCode -ne 0) { throw 'Real test-license editor check did not pass; sanitized result contains the stage.' }
    $result = Get-Content 'D:\VSCodeData\Temp\gridlens-real-licensed-host\result.json' -Raw | ConvertFrom-Json
    if (-not $result.passed) { throw 'Real test-license editor check did not pass.' }
    $result | ConvertTo-Json -Depth 5
} finally { Pop-Location }