$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = 'D:\VSCodeData\Temp\node-runtime\node-v22.23.3-win-x64\node.exe'
$env:TEMP = 'D:\VSCodeData\Temp'
$env:TMP = $env:TEMP
Remove-Item Env:ELECTRON_RUN_AS_NODE,Env:VSCODE_IPC_HOOK_CLI -ErrorAction SilentlyContinue
Push-Location $root
try {
    & $node esbuild.js --host-tests
    if ($LASTEXITCODE -ne 0) { throw 'Isolated test build failed.' }
    $arguments = @(
        '--new-window', '--disable-gpu', '--disable-extensions', '--skip-welcome', '--skip-release-notes',
        '--user-data-dir="D:\VSCodeData\Temp\gridlens-secure-recheck-profile"',
        '--extensions-dir="D:\VSCodeData\Temp\gridlens-test-extensions"',
        "--extensionDevelopmentPath=`"$root`"",
        "--extensionDevelopmentPath=`"$root\tests\fixture`"",
        "--extensionTestsPath=`"$root\tests\host\secure-export.cjs`""
    )
    $process = Start-Process 'D:\Microsoft VS Code\Code.exe' -ArgumentList $arguments -Wait -PassThru `
        -RedirectStandardOutput 'D:\VSCodeData\Temp\gridlens-secure-recheck-out.txt' `
        -RedirectStandardError 'D:\VSCodeData\Temp\gridlens-secure-recheck-stderr.txt'
    if ($process.ExitCode -ne 0) { throw 'Isolated secure-host process failed.' }
    $result = Get-Content 'D:\VSCodeData\Temp\gridlens-secure-host\result.json' -Raw | ConvertFrom-Json
    if (-not $result.passed) { throw 'Isolated secure-host test did not pass.' }
    $result | ConvertTo-Json -Depth 5
} finally {
    Pop-Location
}