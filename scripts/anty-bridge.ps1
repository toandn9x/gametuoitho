[CmdletBinding()]
param(
    [ValidatePattern('^[0-9a-f-]{36}$')]
    [string]$TargetConversationId = '51cc8bdc-59b0-4855-bb5f-e6cca0b6e184',

    [switch]$DirectConversation,

    [switch]$ExecuteFirstBatch,

    [string]$TaskFile
)

$ErrorActionPreference = 'Stop'
$antyExecutesTask = $ExecuteFirstBatch -or -not [string]::IsNullOrWhiteSpace($TaskFile)
$antyExecutable = Join-Path $env:USERPROFILE '.gemini\bin\agy.exe'
if (-not (Test-Path -LiteralPath $antyExecutable)) {
    throw 'Antigravity CLI was not found in the expected installation directory.'
}

# Default mode only coordinates. ExecuteFirstBatch explicitly assigns the
# accepted T01 task. Global CLI settings remain unchanged in either mode.
# These allowances exist only for this helper session and this recipient.
$antySettings = @{
    permissions = @{
        allow = @()
    }
}
if ($antyExecutesTask) {
    $antySettings.permissions.allow = @(
        'command(pnpm test)',
        'command(pnpm lint)',
        'command(pnpm --filter @gametuoitho/api build)',
        'command(pnpm --filter @gametuoitho/web build)',
        'command(pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/asset-review.ts)',
        'command(node tests/pm/admin-render-review.cjs)',
        'command(git status --short)',
        'command(git diff --stat)',
        'command(git diff --name-only)',
        'command(git diff --check)'
    )
}
$antySettingsPath = Join-Path ([System.IO.Path]::GetTempPath()) ('codex-anty-bridge-' + [guid]::NewGuid().ToString('N') + '.json')
$antyUtf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($antySettingsPath, ($antySettings | ConvertTo-Json -Depth 4), $antyUtf8)

function ConvertTo-AntyNativeArgument([string]$Argument) {
    # Escape quotes/backslashes for the Windows native command-line parser.
    $antyEscaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
    $antyEscaped = [regex]::Replace($antyEscaped, '(\\+)$', '$1$1')
    return '"' + $antyEscaped + '"'
}

try {
    if ($TaskFile) {
        $antyTaskPath = (Resolve-Path -LiteralPath $TaskFile).Path
        $antyDocsRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\docs')).TrimEnd('\') + '\'
        if (-not $antyTaskPath.StartsWith($antyDocsRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
            [System.IO.Path]::GetFileName($antyTaskPath) -notmatch '^review-round-\d{2}(?:-fix-\d{2})?\.md$') {
            throw 'TaskFile must be a coordinator review-round document inside this repository docs directory.'
        }
        $antyTaskBody = [System.IO.File]::ReadAllText($antyTaskPath, [System.Text.Encoding]::UTF8)
        $antyTaskPrompt = 'The user authorizes the Codex project manager to request corrections and verify Gemini work until it is sound. Pause unrelated feature expansion. Execute ONLY the finite review packet below, preserve all existing unrelated edits, and respect AGENTS.md and plan.md. No new agents, model changes, permission bypass, global settings changes, git commits/resets, application server starts or cloud actions. The coordinator and reviewers own their coordination documents/script and independent tests/pm files; do not edit those. Run each allowed check command separately: pnpm test; pnpm lint; pnpm --filter @gametuoitho/api build; pnpm --filter @gametuoitho/web build; pnpm --filter @gametuoitho/api exec tsx ../../tests/pm/asset-review.ts; node tests/pm/admin-render-review.cjs; git diff --check; git diff --stat; git diff --name-only; git status --short. For source inspection use read_file; do not run other git diff variants because headless mode cannot prompt for unlisted commands. The browser QA command uses only its isolated fixture server/profile and may be run for verification. Report real results in docs/anty-status.md and stop after this packet for independent review. Do not treat a report or a successful build as acceptance. REVIEW PACKET:' + [Environment]::NewLine + $antyTaskBody
        $antyArguments = @('--conversation', $TargetConversationId, '--mode', 'accept-edits', '--settings', $antySettingsPath, '--print-timeout', '0', '--output-format', 'json', '--print', $antyTaskPrompt)
    }
    elseif ($ExecuteFirstBatch) {
        $antyTaskPrompt = 'Execute the T01/S5 first task you accepted in the coordination handshake. User authorizes code/build work. Read latest source and preserve ongoing work. You own only package test/lint scripts, existing test entrypoints and minimal new check configuration needed for T01, plus docs/anty-status.md. Coordinator owns docs/delivery-board.md and scripts/anty-bridge.ps1. Do not edit application business logic or frontend pages in this batch. Replace failure-masking API test script and placeholder lint scripts with real checks using installed dependencies where practical; root pnpm test/lint must invoke actual checks and propagate failures. Evaluate need/license before proposing any new dependency; do not install dependencies in this batch. Avoid writing tests that merely mirror script text. Run relevant checks and record exact commands, exit codes and limitations in docs/anty-status.md, along with owned files and next proposed S1/S2 work. A check failing on an existing application error must be reported honestly, not masked or fixed outside scope. Run each verification command separately; allowances cover the literal commands pnpm test, pnpm lint, pnpm --filter @gametuoitho/api build, pnpm --filter @gametuoitho/web build, git status --short, git diff --check. Do not use broad permission bypass, alter global CLI settings, remove existing files recursively, reset git, run servers, execute JAR or touch cloud resources. Stop and report after T01 implementation and checks; S1/S2 requires coordinator review of this batch first.'
        $antyArguments = @('--conversation', $TargetConversationId, '--mode', 'accept-edits', '--settings', $antySettingsPath, '--print-timeout', '0', '--output-format', 'json', '--print', $antyTaskPrompt)
    }
    else {
        # Supported user-turn resume; preserve the target's native project and
        # lock checks. Never alter project IDs or remove a conversation lock.
        $antyDirectPrompt = 'Coordination handshake on behalf of the user, who explicitly asks Codex and this Antigravity CLI agent to communicate directly and assign work to finish plan.md. Codex owns docs/delivery-board.md and scripts/anty-bridge.ps1; you retain source/build ownership. Read plan.md, AGENTS.md and docs/delivery-board.md, then acknowledge your actual current files, checks run, blockers and accepted first task. Priorities are S5 then S1/S2 with regressions, then remaining S3/S4/S6/S7; existing fixes should be reviewed rather than duplicated. In THIS handshake turn only read and reply; do not edit source, run builds, change permissions/projects or start agents. Keep the reply concise. The native agentapi send-message attempt from bridge 8e72273f-36b2-494c-a172-da4cc0f5d09b was denied for project boundary mismatch, so do not attempt to bypass that boundary. This is the normal CLI user-turn resume of your own conversation.'
        $antyArguments = @('--conversation', $TargetConversationId, '--print-timeout', '120s', '--output-format', 'json', '--print', $antyDirectPrompt)
    }
    $antyStart = New-Object System.Diagnostics.ProcessStartInfo
    $antyStart.FileName = $antyExecutable
    $antyStart.Arguments = ($antyArguments | ForEach-Object { ConvertTo-AntyNativeArgument $_ }) -join ' '
    $antyStart.WorkingDirectory = (Get-Location).Path
    $antyStart.UseShellExecute = $false
    $antyStart.CreateNoWindow = $true
    $antyStart.RedirectStandardOutput = $true
    $antyStart.RedirectStandardError = $true
    $antyProcess = New-Object System.Diagnostics.Process
    $antyProcess.StartInfo = $antyStart
    [void]$antyProcess.Start()
    $antyStdout = $antyProcess.StandardOutput.ReadToEndAsync()
    $antyStderr = $antyProcess.StandardError.ReadToEndAsync()
    $antyDeadline = [DateTime]::UtcNow.AddSeconds(135)
    while (-not $antyProcess.WaitForExit(1000)) {
        if (-not $antyExecutesTask -and [DateTime]::UtcNow -gt $antyDeadline) {
            $antyProcess.Kill()
            throw 'Communication helper timed out; message delivery is not confirmed.'
        }
    }
    $antyOutput = @($antyStdout.GetAwaiter().GetResult() -split '\r?\n' | Where-Object { $_ })
    $antyErrorOutput = $antyStderr.GetAwaiter().GetResult()
    $antyExitCode = $antyProcess.ExitCode
    if ($antyErrorOutput) { Write-Output $antyErrorOutput }
    $antyOutput | Write-Output
    if ($antyExitCode -ne 0) {
        throw "Antigravity bridge exited with code $antyExitCode."
    }
    $antyReceivedResult = $false
    foreach ($antyLine in $antyOutput) {
        if ([string]$antyLine -match '^\s*\{') {
            $antyResult = $antyLine | ConvertFrom-Json
            if ($antyResult.conversation_id) { $antyReceivedResult = $true }
            if ($antyResult.denied_actions.Count -gt 0) {
                throw 'Antigravity denied a bridge action; delivery is not confirmed.'
            }
            if ($antyResult.conversation_id -and $antyResult.conversation_id -ne $TargetConversationId) {
                throw 'Antigravity responded from an unexpected conversation.'
            }
            if ($antyResult.status -and $antyResult.status -ne 'SUCCESS') {
                throw "Antigravity returned status $($antyResult.status). Review the report before retrying."
            }
        }
    }
    if (-not $antyReceivedResult) { throw 'No final conversation result was received from Antigravity.' }
}
finally {
    if (Test-Path -LiteralPath $antySettingsPath) {
        Remove-Item -LiteralPath $antySettingsPath
    }
}
