# Starts Crosswalk's server when you sign in to Windows, out of sight, so the
# city keeps its records and its update notifications reach you with no
# window open. A shortcut in your Startup folder runs launch.ps1 -Background.
#   npm run autostart          adds it
#   npm run autostart -- -Remove   takes it away
param([switch]$Remove)
$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$path = Join-Path $startup 'Crosswalk.lnk'
# The shortcut from before the app was called Crosswalk: replaced either way.
$old = Join-Path $startup 'Agent City.lnk'
if (Test-Path $old) { Remove-Item $old; Write-Output "Removed $old" }
if ($Remove) {
  if (Test-Path $path) { Remove-Item $path; Write-Output "Removed $path" } else { Write-Output 'Crosswalk does not start at login.' }
  exit 0
}
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($path)
$link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\launch.ps1`" -Background"
$link.WorkingDirectory = $root
$link.IconLocation = "$root\assets\agent-city.ico,0"
$link.Description = 'Start Crosswalk at login'
$link.WindowStyle = 7
$link.Save()
Write-Output "Crosswalk now starts at login ($path). Remove it with: npm run autostart -- -Remove"
