@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
set "GTT_DEPLOY_BATCH=%~f0"
set "GTT_DEPLOY_ROOT=%~dp0"
set "GTT_DEPLOY_MODE="
set "GTT_DEPLOY_NO_PAUSE=0"
set "GTT_DEPLOY_ARG_ERROR=0"

:parse_args
if "%~1"=="" goto launch
if /i "%~1"=="--no-pause" goto no_pause
if /i "%~1"=="--deploy" goto set_mode
if /i "%~1"=="--check" goto set_mode
if /i "%~1"=="--dry-run" goto set_mode
set "GTT_DEPLOY_ARG_ERROR=1"
shift
goto parse_args

:no_pause
set "GTT_DEPLOY_NO_PAUSE=1"
shift
goto parse_args

:set_mode
if defined GTT_DEPLOY_MODE set "GTT_DEPLOY_ARG_ERROR=1"
set "GTT_DEPLOY_MODE=%~1"
shift
goto parse_args

:launch
if not defined GTT_DEPLOY_MODE set "GTT_DEPLOY_MODE=--deploy"
where powershell.exe >nul 2>&1
if errorlevel 1 goto missing_powershell
powershell.exe -NoLogo -NoProfile -Command "$parts = [IO.File]::ReadAllText($env:GTT_DEPLOY_BATCH) -split '(?m)^# GTT_DEPLOY_POWERSHELL\r?$', 2; if ($parts.Length -ne 2) { throw 'Deploy launcher is incomplete.' }; & ([scriptblock]::Create($parts[1]))"
set "GTT_DEPLOY_EXIT=%ERRORLEVEL%"
goto finish

:missing_powershell
echo ERROR: Windows PowerShell is required.
if not exist "%GTT_DEPLOY_ROOT%logs\deploy" mkdir "%GTT_DEPLOY_ROOT%logs\deploy"
echo ERROR: Windows PowerShell is required.>>"%GTT_DEPLOY_ROOT%logs\deploy\launcher-error.log"
echo Log: "%GTT_DEPLOY_ROOT%logs\deploy\launcher-error.log"
set "GTT_DEPLOY_EXIT=1"

:finish
if "%GTT_DEPLOY_NO_PAUSE%"=="0" pause
exit /b %GTT_DEPLOY_EXIT%

# GTT_DEPLOY_POWERSHELL
$ErrorActionPreference = 'Stop'
$script:gttLogWriter = $null
$script:gttExitCode = 1
$gttStage = 'Initialize log'
$gttUtf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $gttUtf8
$OutputEncoding = $gttUtf8

function Write-DeployLog([string]$Message) {
    $gttClean = $Message -replace '\x1B\[[0-?]*[ -/]*[@-~]', ''
    $gttLine = '[' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ') + '] ' + $gttClean
    [Console]::WriteLine($gttLine)
    if ($null -ne $script:gttLogWriter) {
        $script:gttLogWriter.WriteLine($gttLine)
    }
}

function Invoke-DeployCommand([string]$Executable, [string[]]$CommandArgs) {
    # Native stderr is data here; preserve every line and the original exit code.
    $gttPreviousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $Executable @CommandArgs 2>&1 | ForEach-Object { Write-DeployLog ([string]$_) }
        $script:gttExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $gttPreviousPreference
    }
    if ($script:gttExitCode -ne 0) {
        throw ('Command failed with exit code ' + $script:gttExitCode + '.')
    }
}

try {
    Set-Location -LiteralPath $env:GTT_DEPLOY_ROOT
    $gttLogDir = Join-Path $env:GTT_DEPLOY_ROOT 'logs\deploy'
    [void][IO.Directory]::CreateDirectory($gttLogDir)
    $gttLogName = 'deploy-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + $PID + '.log'
    $gttLogPath = Join-Path $gttLogDir $gttLogName
    $script:gttLogWriter = New-Object IO.StreamWriter($gttLogPath, $false, $gttUtf8)
    $script:gttLogWriter.AutoFlush = $true
    $env:GTT_DEPLOY_MODE = $env:GTT_DEPLOY_MODE.ToLowerInvariant()
    Write-DeployLog ('Game Tuoi Tho - ' + $env:GTT_DEPLOY_MODE)
    Write-DeployLog ('Log: ' + $gttLogPath)

    $gttStage = '[1/3] Check prerequisites'
    Write-DeployLog $gttStage
    if ($env:GTT_DEPLOY_ARG_ERROR -ne '0') {
        throw 'Usage: deploy.bat [--deploy | --check | --dry-run] [--no-pause]'
    }
    if (-not (Test-Path -LiteralPath '.env.deploy.local' -PathType Leaf)) {
        throw 'Missing .env.deploy.local. Copy .env.deploy.local.example and fill in your token/key locally.'
    }
    if (-not (Test-Path -LiteralPath 'scripts\cf-deploy-token.mjs' -PathType Leaf)) {
        throw 'Missing scripts/cf-deploy-token.mjs. Run deploy.bat inside the complete project.'
    }
    $gttNode = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
    $gttPnpm = Get-Command pnpm.cmd,pnpm.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $gttNode -or $null -eq $gttPnpm) {
        throw 'Install Node.js 22+ and pnpm 10+, then run deploy.bat again.'
    }
    $gttNodeVersion = (& $gttNode.Source --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $gttNodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
        throw 'Node.js 22 or newer is required.'
    }
    Write-DeployLog ('Node.js ' + $gttNodeVersion)
    $gttPnpmVersion = (& $gttPnpm.Source --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $gttPnpmVersion -notmatch '^(\d+)\.' -or [int]$Matches[1] -lt 10) {
        throw 'pnpm 10 or newer is required.'
    }
    Write-DeployLog ('pnpm ' + $gttPnpmVersion)

    # No credential file is sourced into the shell or dependency installer.
    foreach ($gttName in @('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID',
        'CF_API_TOKEN', 'CF_API_KEY', 'CF_ACCOUNT_ID', 'JWT_SECRET', 'TIGRIS_ACCESS_KEY_ID', 'TIGRIS_SECRET_ACCESS_KEY')) {
        [Environment]::SetEnvironmentVariable($gttName, $null, 'Process')
    }
    $env:CI = 'true'
    $env:NO_COLOR = '1'
    $env:FORCE_COLOR = $null
    $env:WRANGLER_SEND_METRICS = 'false'

    $gttStage = '[2/3] Install dependencies (frozen lockfile)'
    Write-DeployLog $gttStage
    Invoke-DeployCommand $gttPnpm.Source @('install', '--frozen-lockfile')

    $gttStage = '[3/3] Run deployment helper'
    Write-DeployLog ($gttStage + ' ' + $env:GTT_DEPLOY_MODE)
    # The helper redacts token/key values before either stdout or stderr reaches this log.
    Invoke-DeployCommand $gttNode.Source @('scripts/cf-deploy-token.mjs', $env:GTT_DEPLOY_MODE)
    Write-DeployLog ('SUCCESS: ' + $env:GTT_DEPLOY_MODE + ' completed. Exit code: 0.')
    if ($env:GTT_DEPLOY_MODE -eq '--deploy') {
        Write-DeployLog 'Next: open your website and test login, upload and private download.'
    }
}
catch {
    if ($script:gttExitCode -eq 0) { $script:gttExitCode = 1 }
    Write-DeployLog ('FAILED at ' + $gttStage + ': ' + $_.Exception.Message)
    Write-DeployLog ('Exit code: ' + $script:gttExitCode)
}
finally {
    if ($null -ne $script:gttLogWriter) {
        Write-DeployLog ('Saved log: ' + $gttLogPath)
        $script:gttLogWriter.Dispose()
    }
}
exit $script:gttExitCode
