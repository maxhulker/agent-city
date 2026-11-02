import type { Agent, District, Landmark, World } from '../types.ts'
import { ACCENT, BLUEPRINTS, ISLAND, LABELS, burbGeo, dayOf, esc, p, pts, usd } from './geo.ts'
import type { Pt, Scene } from './geo.ts'
import { boroughRect, deltaOf } from '../layout.ts'
import type { Kind } from '../layout.ts'

// Invisible hover zones over every place on the map that means something, each
// carrying what the page's tooltip shows: a title, what the place stands for,
// and who is there now. Drawn above the city and below the agents, so an agent
// keeps its own hover.

type Zone = {
  // Footprint on the grid, and how tall the zone reaches (the landmark's height).
  box: [number, number, number, number]
  height: number
  title: string
  text: string
  color?: string
  who?: Agent[]
  extra?: string
  // Clicking it updates the app (the Empire State, when an update waits).
  isUpdate?: boolean
  // The building or borough it stands for, for the page's selection card.
  building?: string
  borough?: string
}

const ABOUT: Record<keyof typeof LABELS, string> = {
  library: 'Reading and searching: Read, Grep and Glob.',
  workshop: 'Making changes: Edit and Write. Scaffolding goes up while someone edits.',
  foundry: 'Running shell commands: Bash and PowerShell. Smoke rises while they run.',
  observatory: 'On the web: WebFetch, WebSearch and the browsers. The billboards cycle while someone browses.',
  relay: 'Dispatch: starting subagents, sending messages, and other connected tools. New subagents arrive here.',
  harbor: 'git and GitHub: commits, pushes, pulls and pull requests. It catches fire when a merge conflict needs you.',
  hall: "Where each session's lead thinks and waits for your next message. A \"?\" goes up when something needs you.",
  plaza: 'Finished subagents rest on the Great Lawn before they leave.',
}

// Each kind's hover box at its preset origin, and how tall it stands.
const BOXES: Record<Kind, [[number, number, number, number], number]> = {
  plaza: [[5, 22, 9, 35], 14],
  observatory: [[3, 37, 7.35, 39], 70],
  relay: [[9, 38, 11, 39], 56],
  station: [[9, 39, 13, 40.42], 90],
  library: [[6.65, 39, 9.35, 41], 32],
  foundry: [[1, 40, 5, 42.42], 72],
  workshop: [[4.05, 41, 7, 43], 48],
  hall: [[7, 55, 10, 56.42], 36],
  harbor: [[11, 57, 15, 58.42], 42],
  empire: [[7, 42, 9, 43], 110],
  wtc: [[3, 57, 6, 58], 120],
  woolworth: [[5, 55, 7, 56], 64],
  liberty: [[1.4, 69.4, 2.8, 70.6], 34],
  treasury: [[0.1, 0.1, 1.9, 0.9], 14],
}

// The outline of a box standing on the footprint: what the eye sees of it.
function outline([x0, y0, x1, y1]: [number, number, number, number], h: number): Pt[] {
  return [p(x0, y1), p(x1, y1), p(x1, y0), p(x1, y0, h), p(x0, y0, h), p(x0, y1, h)]
}

function ago(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
}

// One line per agent there: its session's bullet, its name, what it's doing.
function whoLines(world: World, list: Agent[] | undefined): string {
  if (!list?.length) return 'Nobody here right now.'
  const lines = list.slice(0, 6).map(a => {
    const bullet = world.sessions.find(s => s.id === a.session)?.bullet
    return `${bullet ? `(${bullet}) ` : ''}${a.name}: ${a.activity || a.status}`
  })
  if (list.length > 6) lines.push(`and ${list.length - 6} more`)
  return lines.join('\n')
}

export function drawPlaces(world: World, sc: Scene): string {
  const zones: Zone[] = []
  const planned = (id: Landmark, title: string) => `${title} (blueprint): ${BLUEPRINTS[id].hint.toLowerCase()}.`
  const up = sc.update
  const launch = world.launch

  // One zone per building, over its box moved to where it stands.
  for (const b of sc.layout.buildings) {
    const [[x0, y0, x1, y1], height] = BOXES[b.kind]
    const [dx, dy] = deltaOf(b)
    const box: [number, number, number, number] = [x0 + dx, y0 + dy, x1 + dx, y1 + dy]
    const lot = b.built === undefined
    const kind = b.kind
    const tag = { building: b.id }
    if (kind in ABOUT) {
      const d = kind as District
      zones.push({
        ...tag,
        box,
        height: lot ? 4 : height,
        title: lot ? `${LABELS[d]}: blueprint` : d === 'relay' ? BLUEPRINTS.relay.name : LABELS[d],
        text: lot
          ? `${BLUEPRINTS[d].hint}. ${ABOUT[d]}`
          : d === 'relay'
            ? 'MetLife and the Chrysler, raised by the first subagent.'
            : d === 'hall' && world.zoning
              ? `${ABOUT[d]} Zoning plan on the board: "${world.zoning.title}", filed by ${world.zoning.by}.`
              : ABOUT[d],
        color: lot ? '#7dd3fc' : ACCENT[d],
        // The relay's agents stand at the station.
        ...(d === 'relay' ? {} : { who: sc.byDistrict.get(d) ?? [] }),
      })
    } else if (kind === 'station') {
      zones.push({ ...tag, box, height, title: LABELS.relay, text: ABOUT.relay, color: ACCENT.relay, who: sc.byDistrict.get('relay') ?? [] })
    } else if (kind === 'empire') {
      zones.push(
        lot
          ? { ...tag, box, height: 4, title: 'Empire State Building: blueprint', text: planned('empire', 'The capstone'), color: '#7dd3fc' }
          : up?.available
            ? {
                ...tag,
                box,
                height,
                title: 'An update is ready: click the Empire State',
                text: `${up.behind} new on main${up.latest ? `: "${up.latest}"` : ''}. Clicking updates Agent City and restarts it; your app sessions pick up where they left off.`,
                color: '#fbbf24',
                extra: up.blocked ? `It can't update cleanly yet: ${up.blocked}.` : undefined,
                isUpdate: true,
              }
            : { ...tag, box, height, title: 'Empire State Building', text: 'Its crown glows in the colour of the busiest district, and gold with fireworks when an update is ready.' },
      )
    } else if (kind === 'treasury') {
      // The city's books: what sessions have spent, and what is left of the plan's limits.
      const t = world.treasury
      const today = t?.days[dayOf(sc.now)] ?? 0
      let week = 0
      for (let i = 0; i < 7; i++) week += t?.days[dayOf(sc.now - i * 86_400_000)] ?? 0
      const lim = world.limits
      const left = (name: string, w?: { used: number; resetsAt: number }) =>
        w ? `${name}: ${Math.round(100 - (w.resetsAt <= sc.now ? 0 : w.used))}% left, resets ${new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''
      const limits = [left('5-hour limit', lim?.fiveHour), left('7-day limit', lim?.sevenDay), left('Spend limit', lim?.spend)].filter(Boolean)
      zones.push({
        ...tag,
        box,
        height,
        title: 'City Treasury',
        text: `Spent ${usd(today)} today, ${usd(week)} this week, ${usd(t?.total ?? 0)} in all (Claude Code's estimate at list price).`,
        extra: limits.length ? limits.join('. ') + '.' : 'No plan limits reported yet: they come from the status line on Pro, Max and Ultra plans.',
        color: '#fbbf24',
      })
    } else if (kind === 'wtc') {
      zones.push({ ...tag, box, height, title: 'One World Trade Center', text: 'Scenery: the tallest tower in the city.' })
    } else if (kind === 'woolworth') {
      zones.push({ ...tag, box, height, title: 'Woolworth Building', text: 'Scenery, beside City Hall.' })
    } else if (kind === 'liberty') {
      // The Statue of Liberty, and the last commit or push it marked.
      const unlit = sc.built.torch === undefined
      zones.push({
        ...tag,
        box,
        height,
        title: lot ? 'Statue of Liberty: dark' : unlit ? 'Statue of Liberty: torch unlit' : 'Statue of Liberty',
        text: lot
          ? `${BLUEPRINTS.harbor.hint}. She hops when an agent commits, and takes off like a rocket on a push.`
          : unlit
            ? `${BLUEPRINTS.torch.hint}. She hops when an agent commits, and takes off like a rocket on a push.`
            : 'Hops when an agent commits, and takes off like a rocket on a push.',
        color: lot ? '#7dd3fc' : '#5eada0',
        extra: launch
          ? `Last ${launch.kind === 'push' ? 'push' : 'commit'}: ${launch.who}${launch.repo ? ` in ${launch.repo}` : ''}, ${ago(sc.now - launch.at)}`
          : 'No commits or pushes seen yet.',
      })
    }
  }

  // A borough for each other repository, the houses one left behind when it
  // packed up, and the drawn boroughs nobody has moved into yet.
  const boxOf = (b: string): [number, number, number, number] | undefined => {
    const g = burbGeo(sc.layout, b)
    if (!g) return undefined
    if (!g.preset) return g.rect
    const [cx, cy] = g.square
    return [cx - 3, cy - 3, cx + 3, cy + 4.6]
  }
  const seen = new Set<string>()
  for (const [b, repo] of sc.repoOf) {
    const box = boxOf(b)
    if (!box) continue
    seen.add(b)
    zones.push({
      borough: b,
      box,
      height: 26,
      title: `${burbGeo(sc.layout, b)!.name}: ${repo.name}`,
      text: `Another repository, at ${repo.root}. Agents cross the bridge to work here. "Make Manhattan" in the sidebar makes it home.`,
      color: '#fde68a',
      who: sc.byBurb.get(b) ?? [],
    })
  }
  for (const [b, repo] of sc.vacantOf) {
    const box = boxOf(b)
    if (!box) continue
    seen.add(b)
    zones.push({
      borough: b,
      box,
      height: 26,
      title: `${burbGeo(sc.layout, b)!.name}: empty`,
      text: `${repo.name} moved out after an hour's quiet${repo.left ? `, ${ago(sc.now - repo.left)}` : ''}. It moves straight back in when a session works there again.`,
      color: '#94a3b8',
      who: sc.byBurb.get(b) ?? [],
    })
  }
  for (const bo of sc.layout.boroughs) {
    if (bo.preset || seen.has(bo.id)) continue
    zones.push({
      borough: bo.id,
      box: boroughRect(bo),
      height: 10,
      title: `${bo.name}: nobody yet`,
      text: 'A borough you laid out. Move a repository in from its New arrival card in the sidebar.',
      color: '#94a3b8',
      who: [],
    })
  }

  // Back to front, so the zone nearest the viewer wins the hover.
  zones.sort((a, b) => a.box[0] + a.box[1] + a.box[3] - (b.box[0] + b.box[1] + b.box[3]))

  // Manhattan itself, under everything else.
  let s = `<g class="places">`
  if ('preset' in sc.layout.map) s += `<polygon class="zone ground" points="${pts(ISLAND.map(([gx, gy]) => p(gx, gy)))}" data-tip-title="${esc(`Manhattan: ${world.home || 'home'}`)}" data-tip-text="${esc('The busiest repository, unless you picked one. Its districts stand for kinds of work: hover over one to see which.')}"/>`
  for (const z of zones) {
    const who = z.who ? whoLines(world, z.who) : ''
    const more = [z.extra, who].filter(Boolean).join('\n')
    s += `<polygon class="zone${z.isUpdate ? ' update' : ''}" points="${pts(outline(z.box, z.height))}" style="--accent:${z.color ?? '#e2e8f0'}" data-tip-title="${esc(z.title)}" data-tip-text="${esc(z.text)}"${more ? ` data-tip-more="${esc(more)}"` : ''}${z.isUpdate ? ' data-update="1"' : ''}${z.building ? ` data-building="${esc(z.building)}"` : ''}${z.borough ? ` data-borough="${esc(z.borough)}"` : ''}/>`
  }
  s += `</g>`
  return s
}

// Invisible but hoverable; a soft outline in the place's colour while hovered.
export const PLACES_CSS =
  `.zone{fill:#fff;fill-opacity:0;stroke:none}` +
  `.zone:not(.ground):hover{fill-opacity:.06;stroke:var(--accent);stroke-opacity:.8;stroke-width:calc(1.2px*var(--zt,1));stroke-dasharray:calc(4px*var(--zt,1)) calc(3px*var(--zt,1))}` +
  `.zone.update{cursor:pointer}.zone.update:hover{fill-opacity:.12}`
