#requires -Version 5.1
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string]$PackagePath,
	[string]$InstallPath = (Join-Path $env:LOCALAPPDATA 'Programs\SagarCode Red')
)

$ErrorActionPreference = 'Stop'
$package = (Resolve-Path -LiteralPath $PackagePath).Path
$executableName = 'SagarCode Red.exe'
$sourceExecutable = Join-Path $package $executableName
if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
	throw "The package does not contain ${executableName}: $package"
}

$markerName = '.sagarcode-red-install'
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
Set-Content -LiteralPath (Join-Path $InstallPath $markerName) -Value 'SagarCode Red user-local package' -Encoding UTF8

$stateRoot = Join-Path $env:LOCALAPPDATA 'SagarCode Red'
$userData = Join-Path $stateRoot 'User Data'
$extensions = Join-Path $stateRoot 'Extensions'
$sharedData = Join-Path $stateRoot 'Shared Data'
foreach ($directory in @($userData, $extensions, $sharedData)) {
	New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

$executable = Join-Path $InstallPath $executableName
$arguments = '--user-data-dir "{0}" --extensions-dir "{1}" --shared-data-dir "{2}" --new-window' -f $userData, $extensions, $sharedData
$shell = New-Object -ComObject WScript.Shell

function Set-SagarCodeRedShortcut([string]$ShortcutPath) {
	if (Test-Path -LiteralPath $ShortcutPath) {
		$existing = $shell.CreateShortcut($ShortcutPath)
		if ($existing.TargetPath -ne $executable) {
			throw "Refusing to replace a shortcut that points elsewhere: $ShortcutPath"
		}
	}

	$shortcut = $shell.CreateShortcut($ShortcutPath)
	$shortcut.TargetPath = $executable
	$shortcut.Arguments = $arguments
	$shortcut.WorkingDirectory = $InstallPath
	$shortcut.IconLocation = "$executable,0"
	$shortcut.Description = 'SagarCode Red - isolated Code OSS editor'
	$shortcut.Save()
}

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\SagarCode Red'
New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
Set-SagarCodeRedShortcut (Join-Path $startMenu 'SagarCode Red.lnk')
Set-SagarCodeRedShortcut (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'SagarCode Red.lnk')

Write-Host "Installed SagarCode Red to $InstallPath"
Write-Host "User data: $userData"
Write-Host "Extensions: $extensions"
Write-Host "Shared data: $sharedData"