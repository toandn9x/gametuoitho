param([string]$BaseJar = (Join-Path $PSScriptRoot '..\freej2me-web.jar'))
$ErrorActionPreference = 'Stop'
$pin = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'provenance.json') | ConvertFrom-Json
$basePath = (Resolve-Path -LiteralPath $BaseJar).Path
$baseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $basePath).Hash.ToLowerInvariant()
if ($baseHash -notin @($pin.upstreamJarSha256, $pin.patchedJarSha256)) {
    throw 'Unknown emulator JAR. Review the upstream revision before applying this patch.'
}
$buildDir = Join-Path $PSScriptRoot 'build'
[System.IO.Directory]::CreateDirectory($buildDir) | Out-Null
# Compile only our trusted emulator source. Disable annotation processors.
& javac --release 8 -g:none -proc:none -classpath $basePath -d $buildDir (Join-Path $PSScriptRoot 'List.java')
if ($LASTEXITCODE -ne 0) { throw 'Failed to compile emulator List patch.' }
$outputJar = Join-Path $buildDir 'freej2me-web.jar'
Copy-Item -LiteralPath $basePath -Destination $outputJar
# jar is an archive utility here; no Java application/game is executed.
& jar --update --file $outputJar --date=2026-11-09T00:00:00Z -C $buildDir javax/microedition/lcdui/List.class
if ($LASTEXITCODE -ne 0) { throw 'Failed to package emulator patch.' }
Get-FileHash -Algorithm SHA256 -LiteralPath $outputJar
