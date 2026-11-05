# Opens Crosswalk in its own window, starting the server first when it isn't
# running. The server runs in a minimized window titled "Crosswalk": close
# that window to stop it. With -Background (how it starts at login, see
# autostart.ps1) it only starts the server, out of sight, and opens nothing:
# the city keeps its records and its notifications come through.
param([switch]$Background)

$port = if ($env:AGENT_CITY_PORT) { $env:AGENT_CITY_PORT } else { 4777 }
$url = "http://localhost:$port"
$root = Split-Path -Parent $PSScriptRoot

function Test-City {
  try {
    # The server listens on IPv4 only; "localhost" can try IPv6 first and stall.
    Invoke-WebRequest "http://127.0.0.1:$port/state.json" -UseBasicParsing -TimeoutSec 1 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-City)) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Crosswalk needs Node.js 22.18 or newer: https://nodejs.org', 'Crosswalk') | Out-Null
    exit 1
  }
  $server = Join-Path $root 'src\server.ts'
  # Created through WMI rather than as a child of this script, so it lives on
  # whatever started this (a Claude Code session ending can take down its
  # children; see src/detached.ts). 0 hides the window, 7 minimizes it.
  $show = if ($Background) { [uint16]0 } else { [uint16]7 }
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = $show }
  $node = (Get-Command node).Source
  # A WMI process inherits none of this one's environment: the port goes along.
  Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "`"$env:ComSpec`" /c set `"AGENT_CITY_PORT=$port`" & title Crosswalk & `"$node`" `"$server`""
    CurrentDirectory = $root
    ProcessStartupInformation = $startup
  } | Out-Null
  for ($i = 0; $i -lt 40 -and -not (Test-City); $i++) { Start-Sleep -Milliseconds 250 }
}
if ($Background) { exit 0 }

# Its own window where Edge is installed, else the default browser.
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) {
  Start-Process -FilePath $edge -ArgumentList "--app=$url"
} else {
  Start-Process $url
}
