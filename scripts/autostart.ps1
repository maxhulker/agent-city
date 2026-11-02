# Starts Agent City's server when you sign in to Windows, out of sight, so the
# city keeps its records and its update notifications reach you with no
# window open. A shortcut in your Startup folder runs launch.ps1 -Background.
#   npm run autostart          adds it
#   npm run autostart -- -Remove   takes it away
param([switch]$Remove)
$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$path = Join-Path $startup 'Agent City.lnk'
if ($Remove) {
  if (Test-Path $path) { Remove-Item $path; Write-Output "Removed $path" } else { Write-Output 'Agent City does not start at login.' }
  exit 0
}
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($path)
$link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\launch.ps1`" -Background"
$link.WorkingDirectory = $root
$link.IconLocation = "$root\assets\agent-city.ico,0"
$link.Description = 'Start Agent City at login'
$link.WindowStyle = 7
$link.Save()
Write-Output "Agent City now starts at login ($path). Remove it with: npm run autostart -- -Remove"
