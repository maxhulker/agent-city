import type { World } from './types.ts'

// What each project has cost to build: the City Treasury's ledger (each
// session's account, kept after it leaves) summed by the repository the
// session started in. Claude Code's own estimate at list price, as the
// Treasury's is. A session that started in one project and worked in another
// is counted in the first.

export type Cost = { usd: number; sessions: number }

export function costsByRoot(world: World): Map<string, Cost> {
  const out = new Map<string, Cost>()
  for (const e of Object.values(world.treasury?.ledger ?? {})) {
    if (!e.root || !(e.usd > 0)) continue
    const key = e.root.replace(/\\/g, '/').toLowerCase()
    const c = out.get(key) ?? { usd: 0, sessions: 0 }
    c.usd += e.usd
    c.sessions++
    out.set(key, c)
  }
  return out
}

export function costOf(costs: Map<string, Cost>, root: string | undefined): Cost | undefined {
  return root ? costs.get(root.replace(/\\/g, '/').toLowerCase()) : undefined
}

// A cost for a sign: cents under ten dollars, whole dollars over.
export function signCost(usd: number): string {
  return usd < 10 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString('en-US')}`
}
