import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CityConf } from './cities.ts'
import { planCity } from './plan.ts'
import type { World } from './types.ts'
import { City, emptyWorld } from './world.ts'
import type { HookEvent } from './world.ts'

// The demo city: Crosswalk without Claude Code. A city of its own (a tab
// like any other) whose sessions are a script: a lead raises every landmark
// with its first day's work, then projects arrive and get boroughs, a
// worktree branches off one, a pull request goes from permit to ribbon, a
// deploy ships; after that, ambient work forever. Its projects are small
// real folders under ~/.agent-city/demo (git repositories when git is
// installed, so their houses follow their folders), and edits and commits
// in the script happen in them for real. Nothing is saved: every start of
// the server plays it from the beginning.
//
// On with `npm run demo` (or AGENT_CITY_DEMO=1), or from the welcome card's
// "Watch a demo city".

export const DEMO = 'demo'

export function demoConf(stateDir: string): CityConf {
  // A config folder of its own (never created): no real session posts here.
  return { id: DEMO, name: 'Demo', config: join(stateDir, 'demo', '.claude'), ownFolder: true, accounts: [], color: '#94a3b8' }
}

// A fresh demo world: the whole city planned, nothing built yet.
export function demoWorld(seed = 7): World {
  return { ...emptyWorld(), layout: planCity(seed) }
}

// ---- its projects -----------------------------------------------------------

export type DemoFolders = { home: string; shop: string; checkout?: string; api: string; git: boolean }

const FILES: Record<string, Record<string, string>> = {
  studio: {
    'README.md': '# Studio\n\nNotes and plans for the week.\n',
    'notes/week.md': '# This week\n\n- ship the checkout\n- weather API v2\n',
    'notes/ideas.md': '# Ideas\n',
    'scripts/backup.sh': '#!/bin/sh\necho backing up\n',
  },
  webshop: {
    'README.md': '# Webshop\n',
    'package.json': '{ "name": "webshop", "scripts": { "test": "node --test" } }\n',
    'src/app.ts': 'export const app = () => "shop"\n',
    'src/cart.ts': 'export const cart: string[] = []\n',
    'src/products.ts': 'export const products = ["lamp", "chair"]\n',
    'src/ui/header.tsx': 'export const Header = () => null\n',
    'src/ui/footer.tsx': 'export const Footer = () => null\n',
    'test/cart.test.ts': '// cart tests\n',
    'docs/setup.md': '# Setup\n',
    'public/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  },
  'weather-api': {
    'README.md': '# Weather API\n',
    'package.json': '{ "name": "weather-api" }\n',
    'src/server.ts': 'export const port = 8080\n',
    'src/forecast.ts': 'export const forecast = () => "sunny"\n',
    'src/cache.ts': 'export const cache = new Map()\n',
    'test/forecast.test.ts': '// forecast tests\n',
    'docs/api.md': '# API\n',
  },
}

const fwd = (p: string) => p.replace(/\\/g, '/')

function git(cwd: string, ...args: string[]): boolean {
  try {
    execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { stdio: 'ignore', windowsHide: true, timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

// The demo's folders, made once: a home folder for the lead, two projects,
// and (with git) a worktree of the shop for a section.
export function demoFolders(dir: string): DemoFolders {
  const write = (root: string, files: Record<string, string>) => {
    for (const [rel, text] of Object.entries(files)) {
      const p = join(root, rel)
      if (existsSync(p)) continue
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, text)
    }
  }
  const home = join(dir, 'studio')
  const shop = join(dir, 'webshop')
  const api = join(dir, 'weather-api')
  write(home, FILES.studio!)
  write(shop, FILES.webshop!)
  write(api, FILES['weather-api']!)
  let hasGit = true
  for (const root of [shop, api]) {
    if (existsSync(join(root, '.git'))) continue
    hasGit = git(root, 'init', '-q', '-b', 'main') && git(root, 'add', '-A') && git(root, 'commit', '-q', '-m', 'First commit') && hasGit
  }
  const checkout = join(dir, 'webshop-checkout')
  if (hasGit && !existsSync(checkout)) git(shop, 'worktree', 'add', '-q', '-b', 'checkout', checkout)
  return { home: fwd(home), shop: fwd(shop), api: fwd(api), git: hasGit, ...(existsSync(checkout) ? { checkout: fwd(checkout) } : {}) }
}

// ---- the script -------------------------------------------------------------

type Cue = { at: number; run: () => void }

// A small seeded random, so every run of the demo is the same.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

export class DemoPlayer {
  private cues: Cue[] = []
  private t0: number
  private n = 0
  private random = rng(20261106)
  private ambientFrom = 0

  private city: City
  private f: DemoFolders
  private clock: () => number

  constructor(city: City, f: DemoFolders, now: number, clock: () => number = Date.now) {
    this.city = city
    this.f = f
    this.clock = clock
    this.t0 = now
    this.script()
  }

  // Runs every cue that is due; then, past the script, ambient work.
  step(now: number) {
    const t = now - this.t0
    while (this.cues.length && this.cues[0]!.at <= t) {
      const cue = this.cues.shift()!
      try {
        cue.run()
      } catch (err) {
        console.error('agent-city: demo cue failed:', err)
      }
    }
    if (!this.cues.length && t >= this.ambientFrom) this.ambient(t)
  }

  // ---- building blocks

  private at(sec: number, run: () => void) {
    this.cues.push({ at: Math.round(sec * 1000), run })
    this.cues.sort((a, b) => a.at - b.at)
  }

  private ev(name: string, sid: string, cwd: string, extra: Record<string, unknown> = {}) {
    const e: HookEvent = { hook_event_name: name, session_id: sid, cwd, ...extra }
    this.city.apply(e, this.clock())
  }

  // A session's start, and its folder's project named straight away (the
  // server asks git in time, but the demo knows): the shop's worktree is the
  // shop's project, so it builds onto the shop's borough.
  private start(sec: number, sid: string, cwd: string) {
    this.at(sec, () => {
      this.ev('SessionStart', sid, cwd)
      const { shop, api, checkout } = this.f
      const project = cwd === shop || cwd === checkout ? `${shop}/.git` : cwd === api ? `${api}/.git` : ''
      if (project || cwd !== this.f.home) this.city.setProject(cwd, project.toLowerCase(), () => ({ files: 12, folders: 5 }), this.clock())
    })
  }

  // A tool call from `sec` lasting `dur` seconds, its result `out`.
  private tool(sec: number, sid: string, cwd: string, name: string, input: Record<string, unknown>, opts: { dur?: number; out?: string; agent?: string; fail?: boolean; then?: () => void } = {}) {
    const id = `demo-${++this.n}`
    const extra = { tool_name: name, tool_use_id: id, tool_input: input, ...(opts.agent ? { agent_id: opts.agent } : {}) }
    this.at(sec, () => this.ev('PreToolUse', sid, cwd, extra))
    this.at(sec + (opts.dur ?? 2.5), () => {
      opts.then?.()
      if (opts.fail) this.ev('PostToolUseFailure', sid, cwd, { ...extra, error: opts.out ?? 'failed' })
      else this.ev('PostToolUse', sid, cwd, { ...extra, tool_response: name === 'Bash' ? { stdout: opts.out ?? '', stderr: '' } : (opts.out ?? 'ok') })
    })
  }

  private prompt(sec: number, sid: string, cwd: string, text: string) {
    this.at(sec, () => this.ev('UserPromptSubmit', sid, cwd, { prompt: text }))
  }

  // An edit made for real (a line appended), so the house shows it.
  private edit(sec: number, sid: string, cwd: string, rel: string, agent?: string) {
    this.tool(sec, sid, cwd, 'Edit', { file_path: `${cwd}/${rel}`, old_string: '', new_string: '' }, {
      ...(agent ? { agent } : {}),
      then: () => {
        try {
          appendFileSync(join(cwd, rel), rel.endsWith('.md') ? `\n- ${new Date().toLocaleTimeString()}\n` : `// ${new Date().toLocaleTimeString()}\n`)
        } catch {
          // A file that is gone stays gone.
        }
      },
    })
  }

  // A commit made for real when git is here.
  private commit(sec: number, sid: string, cwd: string, msg: string) {
    this.tool(sec, sid, cwd, 'Bash', { command: `git commit -am "${msg}"` }, {
      out: `[main 1a2b3c4] ${msg}\n 1 file changed, 1 insertion(+)`,
      then: () => {
        if (this.f.git) git(cwd, 'commit', '-qam', msg)
      },
    })
  }

  // "Build it for me", as the person would click it for a new arrival.
  private borough(sec: number, root: string) {
    this.at(sec, () => {
      const repo = this.city.world.repos.find(r => fwd(r.root).toLowerCase() === root.toLowerCase())
      if (!repo || !repo.burb.startsWith('@')) return
      this.city.build({ op: 'autoborough', root: repo.root, files: 40, folders: 6 }, this.clock())
    })
  }

  private script() {
    const { home, shop, api, checkout } = this.f
    // Day one: the lead arrives by train and every kind of work raises its landmark.
    this.at(0.5, () => this.ev('SessionStart', 'demo-lead', home))
    this.prompt(5, 'demo-lead', home, 'Plan the week and get the shop ready to ship')
    this.tool(8, 'demo-lead', home, 'Read', { file_path: `${home}/notes/week.md` })
    this.tool(12, 'demo-lead', home, 'Grep', { pattern: 'TODO' })
    this.edit(16, 'demo-lead', home, 'notes/week.md')
    this.tool(21, 'demo-lead', home, 'Bash', { command: 'sh scripts/backup.sh' }, { out: 'backing up' })
    this.tool(26, 'demo-lead', home, 'WebFetch', { url: 'https://example.com/release-notes' }, { dur: 3 })
    // A subagent, dispatched from the station's towers, resting in the park when done.
    this.tool(31, 'demo-lead', home, 'Agent', { description: 'Survey the notes', prompt: 'Find open questions', subagent_type: 'Explore' }, { dur: 11 })
    this.at(31.5, () => this.ev('SubagentStart', 'demo-lead', home, { agent_id: 'demo-scout', agent_type: 'Explore' }))
    this.tool(33, 'demo-lead', home, 'Read', { file_path: `${home}/notes/ideas.md` }, { agent: 'demo-scout' })
    this.tool(36.5, 'demo-lead', home, 'Glob', { pattern: 'notes/*.md' }, { agent: 'demo-scout' })
    this.at(41, () => this.ev('SubagentStop', 'demo-lead', home, { agent_id: 'demo-scout' }))
    this.commit(45, 'demo-lead', home, 'Plan the week')
    this.tool(50, 'demo-lead', home, 'Bash', { command: 'git push origin main' }, { out: 'To example.invalid:studio.git\n   1a2b3c4..5d6e7f8  main -> main' })
    this.at(55, () => this.ev('Stop', 'demo-lead', home))

    // The shop arrives at the station and gets a borough.
    this.start(58, 'demo-shop', shop)
    this.prompt(60, 'demo-shop', shop, 'Add a cart badge to the header')
    this.borough(64, shop)
    this.tool(67, 'demo-shop', shop, 'Read', { file_path: `${shop}/src/ui/header.tsx` })
    this.edit(71, 'demo-shop', shop, 'src/ui/header.tsx')
    this.edit(75, 'demo-shop', shop, 'src/cart.ts')
    this.tool(79, 'demo-shop', shop, 'Bash', { command: 'npm test' }, { dur: 4, out: 'ℹ tests 12\nℹ pass 12\nℹ fail 0' })
    this.commit(85, 'demo-shop', shop, 'Cart badge in the header')

    // The weather API arrives too.
    this.start(88, 'demo-api', api)
    this.prompt(90, 'demo-api', api, 'Cache forecasts for ten minutes')
    this.borough(93, api)
    this.tool(96, 'demo-api', api, 'Read', { file_path: `${api}/src/forecast.ts` })
    this.edit(100, 'demo-api', api, 'src/cache.ts')
    // A question for you at City Hall, answered a little later.
    this.tool(104, 'demo-api', api, 'AskUserQuestion', { questions: [{ question: 'Ten minutes or an hour?' }] }, { dur: 8, out: 'Ten minutes' })
    this.edit(114, 'demo-api', api, 'src/forecast.ts')

    // A worktree of the shop branches off its borough as a section.
    if (checkout) {
      this.start(118, 'demo-checkout', checkout)
      this.prompt(120, 'demo-checkout', checkout, 'Build the checkout page')
      this.edit(124, 'demo-checkout', checkout, 'src/cart.ts')
      this.edit(128, 'demo-checkout', checkout, 'src/app.ts')
    }

    // A pull request: a permit, an inspection, and the ribbon cut on merge.
    this.tool(132, 'demo-shop', shop, 'Bash', { command: 'gh pr create --fill' }, { out: 'https://github.com/demo/webshop/pull/7' })
    this.tool(137, 'demo-shop', shop, 'Bash', { command: 'gh pr checks 7 --watch' }, { dur: 4, out: 'All checks were successful' })
    this.tool(142, 'demo-shop', shop, 'Bash', { command: 'gh pr merge 7 --merge' }, { out: '✓ Merged pull request demo/webshop#7' })
    // And the API ships.
    this.tool(147, 'demo-api', api, 'Bash', { command: 'vercel --prod' }, { dur: 5, out: 'Production: https://weather-demo.vercel.app [3s]' })
    this.at(154, () => this.ev('Stop', 'demo-api', api))
    this.at(156, () => this.ev('Stop', 'demo-shop', shop))
    this.ambientFrom = 160_000
  }

  // After the script: every few seconds someone does something, somewhere.
  private nextAmbient = 0
  private ambient(t: number) {
    if (t < this.nextAmbient) return
    this.nextAmbient = t + 3000 + this.random() * 4000
    const { home, shop, api, checkout } = this.f
    const people: [string, string, string[]][] = [
      ['demo-lead', home, ['notes/week.md', 'notes/ideas.md', 'README.md']],
      ['demo-shop', shop, ['src/app.ts', 'src/cart.ts', 'src/products.ts', 'src/ui/header.tsx', 'src/ui/footer.tsx', 'docs/setup.md']],
      ['demo-api', api, ['src/server.ts', 'src/forecast.ts', 'src/cache.ts', 'docs/api.md']],
      ...(checkout ? [['demo-checkout', checkout, ['src/cart.ts', 'src/app.ts']] as [string, string, string[]]] : []),
    ]
    const [sid, cwd, files] = people[Math.floor(this.random() * people.length)]!
    const file = files[Math.floor(this.random() * files.length)]!
    const sec = t / 1000 + 0.1
    const roll = this.random()
    if (roll < 0.12) this.prompt(sec, sid, cwd, 'Next thing on the list')
    else if (roll < 0.4) this.tool(sec, sid, cwd, 'Read', { file_path: `${cwd}/${file}` })
    else if (roll < 0.62) this.edit(sec, sid, cwd, file)
    else if (roll < 0.72) this.tool(sec, sid, cwd, 'Bash', { command: 'npm test' }, { dur: 3, out: 'ℹ pass 12\nℹ fail 0' })
    else if (roll < 0.8) this.tool(sec, sid, cwd, 'WebSearch', { query: 'best practices' })
    else if (roll < 0.88) this.commit(sec, sid, cwd, 'Small improvements')
    else this.at(sec, () => this.ev('Stop', sid, cwd))
  }
}
