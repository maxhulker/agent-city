import type { Agent, Landmark, World } from '../types.ts'
import { ACCENT, BLUEPRINTS, BURBS, ISLAND, LABELS, esc, p, pts } from './geo.ts'
import type { Pt, Scene } from './geo.ts'

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

// Each district's landmark lots and plaza, and how tall its landmark stands.
const DISTRICTS: [keyof typeof LABELS, [number, number, number, number], number][] = [
  ['plaza', [5, 22, 9, 35], 14],
  ['observatory', [3, 37, 7.35, 39], 70],
  ['relay', [9, 38, 13, 40.42], 90],
  ['library', [6.65, 39, 9.35, 41], 32],
  ['foundry', [1, 40, 5, 42.42], 72],
  ['workshop', [4.05, 41, 7, 43], 48],
  ['hall', [7, 55, 10, 56.42], 36],
  ['harbor', [11, 57, 15, 58.42], 42],
]

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
  // A blueprint lot's zone says how to build it.
  const unbuilt = (id: Landmark) => sc.built[id] === undefined
  const planned = (id: Landmark, title: string) => `${title} (blueprint): ${BLUEPRINTS[id].hint.toLowerCase()}.`

  for (const [d, box, height] of DISTRICTS) {
    const blueprint = unbuilt(d)
    zones.push({
      box,
      height: blueprint ? 4 : height,
      title: blueprint ? `${LABELS[d]}: blueprint` : LABELS[d],
      text: blueprint ? `${BLUEPRINTS[d].hint}. ${ABOUT[d]}` : ABOUT[d],
      color: blueprint ? '#7dd3fc' : ACCENT[d],
      who: sc.byDistrict.get(d) ?? [],
    })
  }
  const up = sc.update
  zones.push(
    unbuilt('empire')
      ? { box: [7, 42, 9, 43], height: 4, title: 'Empire State Building: blueprint', text: planned('empire', 'The capstone'), color: '#7dd3fc' }
      : up?.available
      ? {
          box: [7, 42, 9, 43],
          height: 110,
          title: 'An update is ready: click the Empire State',
          text: `${up.behind} new on main${up.latest ? `: "${up.latest}"` : ''}. Clicking updates Agent City and restarts it; your app sessions pick up where they left off.`,
          color: '#fbbf24',
          extra: up.blocked ? `It can't update cleanly yet: ${up.blocked}.` : undefined,
          isUpdate: true,
        }
      : { box: [7, 42, 9, 43], height: 110, title: 'Empire State Building', text: 'Its crown glows in the colour of the busiest district, and gold with fireworks when an update is ready.' },
    { box: [3, 57, 6, 58], height: 120, title: 'One World Trade Center', text: 'Scenery: the tallest tower in the city.' },
    { box: [5, 55, 7, 56], height: 64, title: 'Woolworth Building', text: 'Scenery, beside City Hall.' },
  )

  // The Statue of Liberty, and the last commit or push it marked.
  const launch = world.launch
  zones.push({
    box: [1.4, 69.4, 2.8, 70.6],
    height: 34,
    title: unbuilt('harbor') ? 'Statue of Liberty: dark' : unbuilt('torch') ? 'Statue of Liberty: torch unlit' : 'Statue of Liberty',
    text: unbuilt('harbor')
      ? `${BLUEPRINTS.harbor.hint}. She hops when an agent commits, and takes off like a rocket on a push.`
      : unbuilt('torch')
        ? `${BLUEPRINTS.torch.hint}. She hops when an agent commits, and takes off like a rocket on a push.`
        : 'Hops when an agent commits, and takes off like a rocket on a push.',
    color: unbuilt('harbor') ? '#7dd3fc' : '#5eada0',
    extra: launch
      ? `Last ${launch.kind === 'push' ? 'push' : 'commit'}: ${launch.who}${launch.repo ? ` in ${launch.repo}` : ''}, ${ago(sc.now - launch.at)}`
      : 'No commits or pushes seen yet.',
  })

  // A borough for each other repository.
  for (const [b, repo] of sc.repoOf) {
    const [cx, cy] = BURBS[b].center
    zones.push({
      box: [cx - 3, cy - 3, cx + 3, cy + 4.6],
      height: 26,
      title: `${BURBS[b].name}: ${repo.name}`,
      text: `Another repository, at ${repo.root}. Agents cross the bridge to work here. "Make Manhattan" in the sidebar makes it home.`,
      color: '#fde68a',
      who: sc.byBurb.get(b) ?? [],
    })
  }
  // The houses a repository left behind when it packed up.
  for (const [b, repo] of sc.vacantOf) {
    const [cx, cy] = BURBS[b].center
    zones.push({
      box: [cx - 3, cy - 3, cx + 3, cy + 4.6],
      height: 26,
      title: `${BURBS[b].name}: empty`,
      text: `${repo.name} moved out after an hour's quiet${repo.left ? `, ${ago(sc.now - repo.left)}` : ''}. It moves straight back in when a session works there again.`,
      color: '#94a3b8',
      who: sc.byBurb.get(b) ?? [],
    })
  }

  // Back to front, so the zone nearest the viewer wins the hover.
  zones.sort((a, b) => a.box[0] + a.box[1] + a.box[3] - (b.box[0] + b.box[1] + b.box[3]))

  // Manhattan itself, under everything else.
  let s = `<g class="places">`
  s += `<polygon class="zone ground" points="${pts(ISLAND.map(([gx, gy]) => p(gx, gy)))}" data-tip-title="${esc(`Manhattan: ${world.home || 'home'}`)}" data-tip-text="${esc('The busiest repository, unless you picked one. Its districts stand for kinds of work: hover over one to see which.')}"/>`
  for (const z of zones) {
    const who = z.who ? whoLines(world, z.who) : ''
    const more = [z.extra, who].filter(Boolean).join('\n')
    s += `<polygon class="zone${z.isUpdate ? ' update' : ''}" points="${pts(outline(z.box, z.height))}" style="--accent:${z.color ?? '#e2e8f0'}" data-tip-title="${esc(z.title)}" data-tip-text="${esc(z.text)}"${more ? ` data-tip-more="${esc(more)}"` : ''}${z.isUpdate ? ' data-update="1"' : ''}/>`
  }
  s += `</g>`
  return s
}

// Invisible but hoverable; a soft outline in the place's colour while hovered.
export const PLACES_CSS =
  `.zone{fill:#fff;fill-opacity:0;stroke:none}` +
  `.zone:not(.ground):hover{fill-opacity:.06;stroke:var(--accent);stroke-opacity:.8;stroke-width:calc(1.2px*var(--zt,1));stroke-dasharray:calc(4px*var(--zt,1)) calc(3px*var(--zt,1))}` +
  `.zone.update{cursor:pointer}.zone.update:hover{fill-opacity:.12}`
