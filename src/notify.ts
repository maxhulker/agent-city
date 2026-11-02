import { spawn } from 'node:child_process'

// A desktop notification from the server itself, so it reaches the person
// with no Agent City window open. On Windows it is a toast through
// PowerShell's own notifier (nothing to install); clicking it opens `url`.
// Elsewhere, and with AGENT_CITY_NO_TOAST set (tests, sandboxed servers),
// it does nothing.

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

// The toast's XML: a title, a line of text, and the URL a click opens.
export function toastXml(title: string, body: string, url: string): string {
  return (
    `<toast activationType="protocol" launch="${xmlEsc(url)}">` +
    `<visual><binding template="ToastGeneric"><text>${xmlEsc(title)}</text><text>${xmlEsc(body)}</text></binding></visual>` +
    `</toast>`
  )
}

// PowerShell's app id: Windows shows a toast only for an app it knows.
const NOTIFIER = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

export function toast(title: string, body: string, url: string) {
  if (process.platform !== 'win32' || process.env.AGENT_CITY_NO_TOAST) return
  // The XML goes in through the environment, so nothing in it needs quoting.
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$x.LoadXml($env:AGENT_CITY_TOAST)',
    '$t = New-Object Windows.UI.Notifications.ToastNotification $x',
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${NOTIFIER}').Show($t)`,
  ].join('; ')
  try {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, AGENT_CITY_TOAST: toastXml(title, body, url) },
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    }).unref()
  } catch {
    // No PowerShell: the Empire State still lights up.
  }
}
