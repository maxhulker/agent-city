// Spotting local servers in a session's work, for the city's billboards.
// Pure: the server probes what this finds (src/server.ts) and the city keeps
// the billboards (src/world.ts).

// Whether a billboard glows, its bulbs chase and a sign hangs over it: until
// the person first opens it ('new'), and again whenever it is updated after
// they last did ('updated'); otherwise it is plainly lit ('').
export function litFor(b: { openedAt?: number; updatedAt?: number }): '' | 'new' | 'updated' {
  if (b.openedAt === undefined) return 'new'
  return (b.updatedAt ?? 0) > b.openedAt ? 'updated' : ''
}

// A local address: localhost, 127.0.0.1, 0.0.0.0 or [::1], with a port and a
// path if it has them. Trailing punctuation is not part of it.
// A path stops at a template placeholder (${id}, {{x}}): that is code, not an address.
const LOCAL = /\b(https?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::(\d{2,5}))?(\/[^\s'"`<>)\]\\,|${}]*)?/gi

// Tools whose input or output may show a server's address: the shells and
// their output, and anything that opens or drives a page. Not the file tools:
// a README that mentions localhost is not a server.
const WATCHED = /^(Bash|PowerShell|BashOutput|TaskOutput|Monitor)$|preview|browser|navigate|playwright|puppeteer|chrome|open_?url|WebFetch/i

// Commands that start a dev server: package scripts, the common servers and frameworks.
const DEV =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview|storybook)\b|vite\b|next\s+(?:dev|start)\b|astro\s+(?:dev|preview)\b|nuxt\s+dev\b|ng\s+serve\b|webpack(?:-dev-server|\s+serve)\b|http\.server\b|http-server\b|live-server\b|serve\s+-|flask\s+run\b|manage\.py\s+runserver\b|uvicorn\b|gunicorn\b|rails\s+s(?:erver)?\b|hugo\s+server\b|jekyll\s+serve\b|streamlit\s+run\b|gradio\b|php\s+-S\b)/i

// A port named in a dev command: --port 3000, --port=3000, -p 3000, PORT=3000,
// http.server 8000, runserver 8001, php -S localhost:8080.
const PORT_IN_COMMAND = [/--port[=\s]+(\d{2,5})\b/i, /(?:^|\s)-p\s+(\d{2,5})\b/, /\bPORT=(\d{2,5})\b/, /http\.server\s+(\d{2,5})\b/, /runserver\s+(?:[\w.]+:)?(\d{2,5})\b/, /:(\d{4,5})\b/]

const validPort = (p: number) => Number.isInteger(p) && p > 0 && p < 65536

// The local addresses in some text, as the URL a click should open (the
// host as localhost), first seen first, one per port.
export function localUrls(text: string): { url: string; port: number }[] {
  const out: { url: string; port: number }[] = []
  const seen = new Set<number>()
  for (const m of text.matchAll(LOCAL)) {
    const scheme = m[1]!.toLowerCase()
    const port = m[2] ? Number(m[2]) : scheme === 'https' ? 443 : 80
    if (!validPort(port) || seen.has(port)) continue
    seen.add(port)
    const path = (m[3] ?? '/').replace(/[.;:!?]+$/, '') || '/'
    out.push({ url: `${scheme}://localhost:${port}${path}`, port })
  }
  return out
}

// Whether a tool's work can show a server's address.
export function watchedTool(tool: string): boolean {
  return WATCHED.test(tool)
}

// A shell command that starts a dev server, and its port when the command
// names one; nothing for any other command.
// Installing or removing packages names them (vite, serve…) but starts nothing.
const PACKAGES = /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|rm|uninstall|ci|update|upgrade)\b|\bpip3?\s+install\b/i

export function devCommand(command: string): { port?: number } | undefined {
  if (!DEV.test(command) || PACKAGES.test(command)) return undefined
  for (const re of PORT_IN_COMMAND) {
    const m = re.exec(command)
    if (m && validPort(Number(m[1]))) return { port: Number(m[1]) }
  }
  return {}
}

// The ports dev servers usually take, which the server watches for a while
// after a dev command with no address in sight.
export const DEV_PORTS = [1234, 3000, 3001, 3002, 3003, 3333, 4000, 4173, 4200, 4321, 5000, 5001, 5173, 5174, 5175, 5176, 5500, 6006, 7860, 8000, 8001, 8080, 8081, 8501, 8787, 8888, 9000]

// localhost:5173, for the board and the news.
export function hostOf(url: string): string {
  const m = /^\w+:\/\/([^/]+)/.exec(url)
  return m ? m[1]! : url
}

export function portOf(url: string): number {
  const m = /^(\w+):\/\/[^/:]+(?::(\d+))?/.exec(url)
  if (!m) return 0
  return m[2] ? Number(m[2]) : m[1] === 'https' ? 443 : 80
}

// A page's <title>, from the start of its HTML.
export function titleOf(html: string): string {
  const m = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html)
  if (!m) return ''
  return m[1]!
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}
