import { existsSync } from 'node:fs'
import { join } from 'node:path'

// A browser with an app mode (Chromium's --app): Edge where Windows keeps
// it; on a Mac, Chrome, Edge, Brave or Chromium, in /Applications or the
// person's own Applications folder.
export function appBrowser(platform = process.platform, env = process.env, exists = existsSync): string | undefined {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => !!r)
    return roots.map(r => join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(p => exists(p))
  }
  if (platform === 'darwin') {
    const apps = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium']
    const dirs = ['/Applications', ...(env.HOME ? [`${env.HOME}/Applications`] : [])]
    for (const dir of dirs) for (const app of apps) {
      const p = `${dir}/${app}.app/Contents/MacOS/${app}`
      if (exists(p)) return p
    }
  }
  return undefined
}
