# Opens Agent City in its own window, starting the server first when it isn't
# running. The server runs in a minimized window titled "Agent City": close
# that window to stop it.

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
    [System.Windows.MessageBox]::Show('Agent City needs Node.js 22.18 or newer: https://nodejs.org', 'Agent City') | Out-Null
    exit 1
  }
  $server = Join-Path $root 'src\server.ts'
  Start-Process -FilePath $env:ComSpec -ArgumentList '/c', "title Agent City & node `"$server`"" -WorkingDirectory $root -WindowStyle Minimized
  for ($i = 0; $i -lt 40 -and -not (Test-City); $i++) { Start-Sleep -Milliseconds 250 }
}

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
