#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $repoRoot
$requiredNode = [version]'24.22.1'
$nodeVersionText = (& node --version).Trim().TrimStart('v')
if (-not $nodeVersionText) {
	throw 'Node.js was not found on PATH.'
}
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion.Major -ne $requiredNode.Major -or $nodeVersion -lt $requiredNode) {
	throw "This checkout requires Node.js $requiredNode or newer in the same major version; found $nodeVersion."
}

$pnpmVersion = (& corepack pnpm@12.16.0 --version).Trim()
if ($pnpmVersion -ne '12.16.0') {
	throw "This checkout pins pnpm 12.16.0; found $pnpmVersion."
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
	throw 'Visual Studio 2022 C++ Build Tools and a Windows SDK are required. The build script will not install system-wide tools.'
}
$vcInstall = & $vswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vcInstall) {
	throw 'Visual Studio 2022 C++ Build Tools and a Windows SDK are required. The build script will not install system-wide tools.'
}

Push-Location $repoRoot
try {
	& corepack pnpm@12.16.0 install --frozen-lockfile
	if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE" }
	& node (Join-Path $PSScriptRoot 'create-red-code-icons.mjs')
	if ($LASTEXITCODE -ne 0) { throw "Red Code icon generation failed with exit code $LASTEXITCODE" }

	& corepack pnpm@12.16.0 run gulp vscode-win32-x64
	if ($LASTEXITCODE -ne 0) { throw "The Windows x64 package build failed with exit code $LASTEXITCODE" }
}
finally {
	Pop-Location
}

$packagePath = Join-Path $workspaceRoot 'VSCode-win32-x64'
$artifactPath = Join-Path $workspaceRoot 'RedCode-win32-x64'
$artifactMarker = Join-Path $artifactPath '.red-code-build'
if (-not (Test-Path -LiteralPath (Join-Path $packagePath 'Red Code.exe') -PathType Leaf)) {
	throw "The expected packaged executable was not found in $packagePath"
}

# A build that did not finish keeps the previous tree, which would otherwise be copied and
# installed as if it were this version. Check the stamped version before staging anything.
$productJsonPath = Join-Path $packagePath 'resources\app\product.json'
if (-not (Test-Path -LiteralPath $productJsonPath -PathType Leaf)) {
	throw "The packaged application has no product.json: $productJsonPath"
}
$builtVersion = (Get-Content -LiteralPath $productJsonPath -Raw | ConvertFrom-Json).version
$declaredVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($builtVersion -ne $declaredVersion) {
	throw "The packaged tree reports $builtVersion but package.json says $declaredVersion. The output is stale; rerun the build."
}
if (Test-Path -LiteralPath $artifactPath) {
	if (-not (Test-Path -LiteralPath $artifactMarker -PathType Leaf)) {
		throw "Refusing to overwrite an unmarked artifact directory: $artifactPath"
	}
	Remove-Item -LiteralPath $artifactPath -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactPath -Force | Out-Null
Get-ChildItem -LiteralPath $packagePath -Force | ForEach-Object {
	Copy-Item -LiteralPath $_.FullName -Destination $artifactPath -Recurse -Force
}
Set-Content -LiteralPath $artifactMarker -Value (git -C $repoRoot rev-parse HEAD) -Encoding UTF8

& (Join-Path $PSScriptRoot 'install-sagarcode-red.ps1') -PackagePath $artifactPath
Write-Host "Build artifact: $artifactPath"