import { spawn } from 'node:child_process'

// Starting a process that outlives whoever started this one. On Windows a
// child, even a detached one, stays in its parent's job: when a Claude Code
// session that started the server ends, Windows can take down everything in
// its job, a server restarted from the city included. A process created by
// WMI (Win32_Process.Create) is started by the WMI service instead, in no
// job of ours, and lives on. Elsewhere a detached child is enough.

// Windows' ShowWindow values: minimized without taking focus, or hidden.
export const SHOW_MINIMIZED = 7
export const SHOW_HIDDEN = 0

// The PowerShell that creates the process through WMI, after a pause (so a
// server on its way out can let go of its port first).
export function launchScript(commandLine: string, cwd: string, delaySec = 0, show = SHOW_MINIMIZED): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  return [
    delaySec > 0 ? `Start-Sleep -Seconds ${delaySec}` : '',
    `$s = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]${show} }`,
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${q(commandLine)}; CurrentDirectory = ${q(cwd)}; ProcessStartupInformation = $s } | Out-Null`,
  ]
    .filter(Boolean)
    .join('\n')
}

// Starts commandLine in cwd, on its own; returns at once.
export function launchDetached(commandLine: string, cwd: string, delaySec = 0, show = SHOW_MINIMIZED) {
  if (process.platform === 'win32') {
    // Encoded, so no quoting reaches a shell. Not `detached`: PowerShell
    // started with no console at all exits without making the call. It needn't
    // be, either: a child on Windows lives on when its parent exits, and the
    // process it creates belongs to WMI, not to us.
    const encoded = Buffer.from(launchScript(commandLine, cwd, delaySec, show), 'utf16le').toString('base64')
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
    }).unref()
  } else {
    spawn('sh', ['-c', `${delaySec > 0 ? `sleep ${delaySec}; ` : ''}exec ${commandLine}`], { cwd, detached: true, stdio: 'ignore' }).unref()
  }
}
