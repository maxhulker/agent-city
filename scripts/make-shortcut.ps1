# Puts a "Crosswalk" shortcut on the desktop that runs launch.ps1: it starts
# the server when needed and opens the city in its own window.

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop 'Crosswalk.lnk'
# The shortcut from before the app was called Crosswalk.
$old = Join-Path $desktop 'Agent City.lnk'
if (Test-Path $old) { Remove-Item $old; Write-Output "Removed $old" }

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($path)
$link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\launch.ps1`""
$link.WorkingDirectory = $root
$link.IconLocation = "$root\assets\agent-city.ico,0"
$link.Description = 'Open Crosswalk'
$link.WindowStyle = 7
$link.Save()

Write-Output "Created $path"
