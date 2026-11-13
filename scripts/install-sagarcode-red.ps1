#requires -Version 5.1
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string]$PackagePath,
	[string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'Programs\Red Code')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$executableName = 'Red Code.exe'
$sourceExecutable = Join-Path $package $executableName
if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
	throw "The package does not contain ${executableName}: $package"
}

function Get-PackageProductVersion([string]$Root) {
	$candidates = @(Join-Path $Root 'resources\app\product.json')
	$candidates += Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue |
		ForEach-Object { Join-Path $_.FullName 'resources\app\product.json' }
	foreach ($candidate in $candidates) {
		if (Test-Path -LiteralPath $candidate -PathType Leaf) {
			return (Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json).version
		}
	}
	return $null
}

# A package whose reported version disagrees with the checkout it came from is how a stale
# build folder ends up installed as if it were the newer release. Fail before copying files.
$packageVersion = Get-PackageProductVersion $package
if (-not $packageVersion) {
	throw "Could not read a product version from the package: $package"
}
$sourceVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($packageVersion -ne $sourceVersion) {
	throw "The package reports version $packageVersion but package.json says $sourceVersion. Rebuild before installing."
}

$markerName = '.red-code-install'
$markerPath = Join-Path $InstallPath $markerName
if (Test-Path -LiteralPath $InstallPath) {
	if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
		throw "Refusing to overwrite an unmarked directory: $InstallPath"
	}
	Remove-Item -LiteralPath $InstallPath -Recurse -Force
}

New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
Get-ChildItem -LiteralPath $package -Force | ForEach-Object {
	Copy-Item -LiteralPath $_.FullName -Destination $InstallPath -Recurse -Force
}
Set-Content -LiteralPath $markerPath -Value 'Red Code user-local package' -Encoding UTF8

$installedVersion = Get-PackageProductVersion $InstallPath
if ($installedVersion -ne $packageVersion) {
	throw "The installation reports version $installedVersion but the package contains $packageVersion."
}

$executable = Join-Path $InstallPath $executableName
$shell = New-Object -ComObject WScript.Shell

# Every launch entry point has to resolve to the installed copy, because an earlier version of
# this script could leave a pinned icon pointing at a build folder that later builds no longer
# update. Shortcuts carry no arguments so that they all open the same profile instead of
# silently opening a second, empty one.
function Set-RedCodeShortcut([string]$ShortcutPath) {
	if (Test-Path -LiteralPath $ShortcutPath) {
		$existingTarget = $shell.CreateShortcut($ShortcutPath).TargetPath
		if ($existingTarget -and (Split-Path -Leaf $existingTarget) -ne $executableName) {
			throw "Refusing to replace a shortcut that points to another program: $ShortcutPath"
		}
	}

	$shortcut = $shell.CreateShortcut($ShortcutPath)
	$shortcut.TargetPath = $executable
	$shortcut.Arguments = ''
	$shortcut.WorkingDirectory = $InstallPath
	$shortcut.IconLocation = "$executable,0"
	$shortcut.Description = 'Red Code'
	$shortcut.Save()
}

$appShortcuts = @(
	(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Red Code\Red Code.lnk'),
	(Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Red Code.lnk')
)
New-Item -ItemType Directory -Path (Split-Path -Parent $appShortcuts[0]) -Force | Out-Null
foreach ($shortcutPath in $appShortcuts) {
	Set-RedCodeShortcut $shortcutPath
}

$pinnedShortcut = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Red Code.lnk'
if (Test-Path -LiteralPath $pinnedShortcut) {
	try {
		Set-RedCodeShortcut $pinnedShortcut
	} catch {
		Write-Warning "Could not update $pinnedShortcut : $($_.Exception.Message)"
	}
}

Write-Host "Installed Red Code $installedVersion to $InstallPath"
Write-Host "User data: $(Join-Path $env:APPDATA 'Red Code')"
Write-Host "Extensions: $(Join-Path $env:USERPROFILE '.red-code\extensions')"
Write-Host 'A pinned taskbar icon can keep an old target cached; unpin and re-pin it if it still opens an older build.'
