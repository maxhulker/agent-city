// Shipping: a project deployed, read from the commands its sessions run and
// what they print, as commits, pull requests and test runs are
// (src/sites.ts). A deploy sends a cargo ship out of the Seaport with the
// project's name on its hull, and a production one puts up a LIVE sign on its
// square that opens the deployed site (src/draw/ships.ts).

export type Shipped = { kind: 'shipped'; target: string; prod: boolean; url?: string; version?: string }

// A command's parts, split at &&, ||, ; and |.
const parts = (code: string) =>
  code
    .split(/&&|\|\||;|\||\n/)
    .map(s => s.trim())
    .filter(Boolean)

// A part's words after any VAR=value and a runner (npx, pnpm dlx, bunx, yarn).
function words(part: string): string[] {
  const w = part.split(/\s+/)
  while (w.length && /^\w+=/.test(w[0]!)) w.shift()
  if (w[0] === 'npx' || w[0] === 'bunx') w.shift()
  else if ((w[0] === 'pnpm' && w[1] === 'dlx') || (w[0] === 'yarn' && w[1] === 'dlx')) w.splice(0, 2)
  return w
}

// The first word after the tool that isn't a flag (or a flag's value we know).
const verbOf = (w: string[]) => w.slice(1).find(t => !t.startsWith('-'))

const firstUrl = (re: RegExp, text: string) => {
  const m = re.exec(text)
  return m ? (m[1] ?? m[0]).replace(/[)\].,;'"]+$/, '') : undefined
}

type Rule = { target: string; is: (w: string[]) => boolean; url?: RegExp; prod: (w: string[], out: string) => boolean }

const RULES: Rule[] = [
  // `vercel`, `vercel deploy`, `vercel --prod`: not `vercel env pull` or `vercel link`.
  { target: 'Vercel', is: w => w[0] === 'vercel' && [undefined, 'deploy', '.'].includes(verbOf(w)), url: /https:\/\/[\w.-]+\.vercel\.app[^\s]*/, prod: (w, out) => w.includes('--prod') || /\bProduction:/.test(out) },
  { target: 'Netlify', is: w => w[0] === 'netlify' && verbOf(w) === 'deploy', url: /https:\/\/[\w.-]+\.netlify\.app[^\s]*/, prod: w => w.includes('--prod') },
  { target: 'Fly.io', is: w => (w[0] === 'fly' || w[0] === 'flyctl') && verbOf(w) === 'deploy', url: /https:\/\/[\w.-]+\.fly\.dev[^\s]*/, prod: () => true },
  { target: 'Cloudflare', is: w => w[0] === 'wrangler' && (verbOf(w) === 'deploy' || verbOf(w) === 'publish' || (verbOf(w) === 'pages' && w.includes('deploy'))), url: /https:\/\/[\w.-]+\.(?:workers|pages)\.dev[^\s]*/, prod: w => !w.includes('--branch') },
  { target: 'Firebase', is: w => w[0] === 'firebase' && verbOf(w) === 'deploy', url: /Hosting URL:\s*(https:\/\/\S+)/, prod: () => true },
  { target: 'GitHub Pages', is: w => w[0] === 'gh-pages', prod: () => true },
  { target: 'Railway', is: w => w[0] === 'railway' && verbOf(w) === 'up', url: /https:\/\/[\w.-]+\.up\.railway\.app[^\s]*/, prod: () => true },
  // A project's own deploy script: the first web address it prints, if any.
  { target: 'its deploy script', is: w => (['npm', 'pnpm', 'yarn', 'bun'].includes(w[0]!) && w[1] === 'run' && /^deploy(:prod)?$/.test(w[2] ?? '')) || (w[0] === 'make' && w[1] === 'deploy'), url: /https:\/\/(?!github\.com)[\w.-]+\.[a-z]{2,}[^\s]*/, prod: w => !/preview|staging/.test(w.join(' ')) },
]

// What a finished shell command shipped, if it deployed something.
export function shippedOf(code: string, output: string, failed: boolean): Shipped | undefined {
  if (failed) return undefined
  for (const part of parts(code)) {
    const w = words(part)
    // A package published: `+ name@1.2.3`, at its npm page.
    if (['npm', 'pnpm', 'yarn'].includes(w[0]!) && w[1] === 'publish' && !w.includes('--dry-run')) {
      const m = /(?:^|\n)\+\s+(@?[\w.-]+(?:\/[\w.-]+)?)@(\d[\w.+-]*)/.exec(output)
      return { kind: 'shipped', target: 'npm', prod: true, ...(m ? { url: `https://www.npmjs.com/package/${m[1]}`, version: m[2] } : {}) }
    }
    const rule = RULES.find(r => r.is(w))
    if (!rule) continue
    if (/\b(Error|failed|aborted)\b/.test(output) && !(rule.url && rule.url.test(output))) return undefined
    const url = rule.url ? firstUrl(rule.url, output) : undefined
    return { kind: 'shipped', target: rule.target, prod: rule.prod(w, output), ...(url ? { url } : {}) }
  }
  return undefined
}
