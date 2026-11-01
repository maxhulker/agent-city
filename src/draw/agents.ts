import type { Agent, District, Session, World } from '../types.ts'
import { TRACK_Y, TRAIN_MS, burbAt, esc, n, p, placeAt, standAt, walk } from './geo.ts'
import type { Scene } from './geo.ts'

// The agents: who they are, where they stand, what they are doing.

// The page sets --zs (sprites) and --zt (text) from its zoom. The figure scales
// about its feet; text and bubbles scale back so they keep their screen size.
export const AGENT_CSS =
  `.fig{transform:scale(var(--zs,1))}` +
  `.tx{transform:scale(calc(var(--zt,1)/var(--zs,1)))}` +
  `.bubble{display:none}.ring{display:none}` +
  `.name text{font-weight:700;letter-spacing:.04em;fill:#e2e8f0;paint-order:stroke;stroke:#0b1224;stroke-width:3px}` +
  `.city:not(.z2) .name.minor{display:none}`

// What a working agent holds, drawn in a 6x6 box around (0,0).
const INK = '#0b1224'
const PROPS: Record<District, string> = {
  // Open book.
  library:
    `<path d="M-3.4 -2.2L0 -1V3.2L-3.4 2z" fill="#f8fafc"/><path d="M3.4 -2.2L0 -1V3.2L3.4 2z" fill="#fde68a"/><path d="M-3.4 -2.2L0 -1L3.4 -2.2V2L0 3.2L-3.4 2z" fill="none" stroke="${INK}" stroke-width=".6"/>`,
  // Hammer.
  workshop:
    `<g transform="rotate(35)"><rect x="-.6" y="-2" width="1.2" height="6" fill="#b45309" stroke="${INK}" stroke-width=".4"/><rect x="-2.8" y="-3.4" width="5.6" height="2.4" fill="#cbd5e1" stroke="${INK}" stroke-width=".5"/></g>`,
  // Laptop with a glowing screen.
  foundry:
    `<circle cx="0" cy="-1" r="4.2" fill="#22d3ee" opacity=".25"/><rect x="-3" y="-3.6" width="6" height="4.2" rx=".5" fill="#0e7490" stroke="${INK}" stroke-width=".5"/><rect x="-2.2" y="-2.8" width="4.4" height="2.6" fill="#67e8f9"><animate attributeName="opacity" values="1;.55;1" dur="1.4s" repeatCount="indefinite"/></rect><path d="M-3.9 1.2H3.9L4.6 2.8H-4.6z" fill="#94a3b8" stroke="${INK}" stroke-width=".5"/>`,
  // Binoculars.
  observatory:
    `<rect x="-1.5" y="-1" width="3" height="1.6" fill="#475569"/><circle cx="-2" cy="0" r="1.9" fill="#1e293b" stroke="${INK}" stroke-width=".5"/><circle cx="2" cy="0" r="1.9" fill="#1e293b" stroke="${INK}" stroke-width=".5"/><circle cx="-2" cy="0" r=".9" fill="#7dd3fc"/><circle cx="2" cy="0" r=".9" fill="#7dd3fc"/>`,
  // Envelope.
  relay:
    `<rect x="-3.6" y="-2.4" width="7.2" height="5" rx=".5" fill="#f8fafc" stroke="${INK}" stroke-width=".6"/><path d="M-3.6 -2.2L0 .6L3.6 -2.2" fill="none" stroke="#64748b" stroke-width=".7"/>`,
  // Cardboard box.
  harbor:
    `<path d="M0 -3L3.6 -1.2V2.2L0 4L-3.6 2.2V-1.2z" fill="#b8864b" stroke="${INK}" stroke-width=".5"/><path d="M0 -3L3.6 -1.2L0 .6L-3.6 -1.2z" fill="#e2b072"/><path d="M0 .6V4" stroke="${INK}" stroke-width=".5"/>`,
  // Clipboard.
  hall:
    `<rect x="-2.6" y="-3.4" width="5.2" height="7" rx=".5" fill="#92400e" stroke="${INK}" stroke-width=".5"/><rect x="-1.9" y="-2.3" width="3.8" height="5.2" fill="#f8fafc"/><rect x="-1" y="-4" width="2" height="1.4" fill="#cbd5e1" stroke="${INK}" stroke-width=".4"/><path d="M-1.2 -.6H1.2M-1.2 .8H1.2M-1.2 2.2H.4" stroke="#64748b" stroke-width=".5"/>`,
  // Coffee cup.
  plaza:
    `<path d="M-2.2 -1.6H2.2L1.6 3H-1.6z" fill="#f8fafc" stroke="${INK}" stroke-width=".5"/><path d="M-2 0H2" stroke="#b45309" stroke-width="1.2"/><path d="M-.6 -2.2Q-1.2 -3.4 -.2 -4.2M.8 -2.2Q.2 -3.4 1.2 -4.2" fill="none" stroke="#cbd5e1" stroke-width=".5"/>`,
}

// White or dark ink, whichever reads on the bullet's colour.
function inkOn(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return '#fff'
  const v = parseInt(m[1]!, 16)
  const lum = (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255
  return lum > 0.6 ? INK : '#fff'
}

function figure(a: Agent, label: boolean, lift: number, k: number, session?: Session): string {
  const s = (a.isMain ? 1.3 : 1) * k
  const isWorking = a.status === 'working'
  let body = `<ellipse class="ring" cx="0" cy="0" rx="${n(9 * s)}" ry="${n(4.5 * s)}" fill="none" stroke="#fde047" stroke-width="${n(1.6 * k)}"/>`
  body += `<ellipse cx="0" cy="0" rx="${n(5 * s)}" ry="${n(2.5 * s)}" fill="#000" opacity=".4"/><g>`
  if (isWorking) {
    body += `<animateTransform attributeName="transform" type="translate" values="0,0;0,${n(-2.4 * s)};0,0" dur=".55s" repeatCount="indefinite"/>`
  }
  body += `<rect x="${n(-4 * s)}" y="${n(-13 * s)}" width="${n(8 * s)}" height="${n(10.5 * s)}" rx="${n(3.6 * s)}" fill="${a.color}" stroke="#0b1224" stroke-width="${n(0.8 * k)}"/>`
  body += `<circle cx="0" cy="${n(-16 * s)}" r="${n(3.7 * s)}" fill="#fef3c7" stroke="#0b1224" stroke-width="${n(0.8 * k)}"/>`
  if (a.isMain) {
    body += `<path d="M${n(-3.5 * s)} ${n(-19 * s)}v${n(-4.5 * s)}l${n(1.75 * s)} ${n(2.5 * s)}l${n(1.75 * s)} ${n(-3.5 * s)}l${n(1.75 * s)} ${n(3.5 * s)}l${n(1.75 * s)} ${n(-2.5 * s)}v${n(4.5 * s)}z" fill="#fde047" stroke="#0b1224" stroke-width="${n(0.6 * k)}"/>`
  }
  // The tool in hand, by where the agent is.
  if (a.status === 'working' || a.status === 'waiting') {
    body += `<g transform="translate(${n(7.4 * s)},${n(-6.5 * s)}) scale(${n(s)})">${PROPS[a.at] ?? ''}</g>`
  }
  const badge = (fill: string, mark: string, ink: string, pulse: boolean) =>
    `<g>${pulse ? '<animate attributeName="opacity" values="1;.35;1" dur="1s" repeatCount="indefinite"/>' : ''}<circle cx="${n(8 * s)}" cy="${n(-26 * s)}" r="${n(5.5 * s)}" fill="${fill}" stroke="#fff" stroke-width="${n(1.2 * k)}"/><text x="${n(8 * s)}" y="${n(-23.2 * s)}" text-anchor="middle" font-size="${n(8 * s)}" font-weight="800" fill="${ink}">${mark}</text></g>`
  if (a.status === 'waiting') body += badge('#fbbf24', '?', '#111827', true)
  else if (a.status === 'failed') body += badge('#ef4444', '!', '#fff', false)
  // The session's subway bullet, left of the badge.
  if (session?.bullet) {
    body += `<circle cx="${n(-8 * s)}" cy="${n(-26 * s)}" r="${n(5 * s)}" fill="${esc(session.color)}" stroke="#fff" stroke-width="${n(1 * k)}"/><text x="${n(-8 * s)}" y="${n(-23.2 * s)}" text-anchor="middle" font-size="${n(7.6 * s)}" font-weight="800" fill="${inkOn(session.color)}">${esc(session.bullet.slice(0, 1))}</text>`
  }
  body += `</g>`
  const top = -33 * s - lift * k
  if (label) {
    const name = esc(a.name.length > 18 ? a.name.slice(0, 17) + '…' : a.name)
    const minor = a.isMain || a.status === 'waiting' || a.status === 'failed' ? '' : ' minor'
    body += `<g class="name${minor}" transform="translate(0,${n(top)})"><g class="tx"><text x="0" y="0" text-anchor="middle" font-size="${a.isMain ? 11 : 10}">${name}</text></g></g>`
  }
  // Speech bubble, hidden until the page hovers, selects or waits on it.
  const said = a.activity.replace(/\s+/g, ' ').trim()
  if (said) {
    const text = esc(said.length > 32 ? said.slice(0, 31) + '…' : said)
    const w = Math.max(20, Math.min(32, said.length) * 4.6 + 8)
    const h = n(w / 2)
    const e = n(w / 2 - 3)
    body += `<g transform="translate(0,${n(top - 12)})"><g class="bubble"><g class="tx"><path d="M-${e} -16H${e}Q${h} -16 ${h} -13V-7Q${h} -4 ${e} -4H3L0 0L-3 -4H-${e}Q-${h} -4 -${h} -7V-13Q-${h} -16 -${e} -16z" fill="#f8fafc" stroke="${INK}" stroke-width=".7"/><text x="0" y="-7.6" text-anchor="middle" font-size="8" font-weight="600" fill="#0f172a">${text}</text></g></g></g>`
  }
  const tip = `<title>${esc(`${a.name} (${a.kind}) · ${a.status}${a.activity ? ' · ' + a.activity : ''}`)}</title>`
  return `<g class="fig">${tip}${body}</g>`
}

// How faded an agent is drawn, so the active ones stand out: full while it
// works or boards its train; an idle one dims the longer it has been quiet
// (from two minutes on, down to a third at half an hour, when it leaves); a
// finished subagent fades over the two minutes it rests. Undefined means full.
export function opacityFor(a: Agent, now: number): number | undefined {
  const quiet = Math.max(0, now - a.updatedAt)
  const round = (v: number) => Math.round(v * 100) / 100
  if (a.status === 'idle' || a.status === 'failed') {
    const t = Math.min(1, Math.max(0, (quiet - 2 * 60_000) / (28 * 60_000)))
    return t > 0 ? round(1 - 0.65 * t) : undefined
  }
  if (a.status === 'done') return round(0.85 - 0.45 * Math.min(1, quiet / (2 * 60_000)))
  return undefined
}

// Every agent, always on top so no tower hides one.
export function drawAgents(world: World, sc: Scene): string {
  const { byDistrict, byBurb, repoOf, k } = sc
  const sessions = new Map(world.sessions.map(x => [x.id, x]))
  let s = ''
  const placed: { a: Agent; at: [number, number]; i: number }[] = []
  for (const [d, list] of byDistrict) list.forEach((a, i) => placed.push({ a, at: standAt(d, i), i }))
  for (const [b, list] of byBurb) list.forEach((a, i) => placed.push({ a, at: burbAt(b, i), i }))
  placed.sort((x, y) => x.at[0] + x.at[1] - (y.at[0] + y.at[1]))
  for (const { a, at, i } of placed) {
    const dim = opacityFor(a, sc.now)
    const fade = dim === undefined ? '' : ` opacity="${dim}"`
    const alert = a.status === 'waiting' || a.status === 'failed'
    // The lead of a borough shares the repo's name, which is already on the sign.
    const dup = !!a.burb && a.name.toLowerCase() === repoOf.get(a.burb)?.name.toLowerCase()
    const label = !dup || alert
    const who = ` class="agent ${a.status}" data-agent="${esc(a.id)}" data-session="${esc(a.session)}"`
    const lift = (i % 2) * 9
    const moved = a.walkFrom && (a.walkFrom.at !== a.at || a.walkFrom.burb !== a.burb)
    const fig = figure(a, label, lift, k, sessions.get(a.session))
    if (sc.animateWalks && a.walkFrom && moved) {
      const { path, dur } = walk(a.walkFrom, { at: a.at, burb: a.burb }, at)
      s += `<g${who}${fade}><animateMotion path="${path}" dur="${n(dur)}s" fill="freeze"/>${fig}</g>`
    } else if (a.arriving && a.arriving > sc.now) {
      // Still aboard: it steps onto the platform once its train is in.
      const [x, y] = p(at[0], at[1])
      s += `<g${who} transform="translate(${n(x)},${n(y)})" opacity="0"><animate attributeName="opacity" values="0;1" begin="${n((a.arriving - sc.now) / 1000)}s" dur=".4s" fill="freeze"/>${fig}</g>`
    } else {
      const [x, y] = p(at[0], at[1])
      s += `<g${who} transform="translate(${n(x)},${n(y)})"${fade}>${fig}</g>`
    }
  }
  return s
}

// The last train home: it waits on the street in front of Grand Central while
// its passengers walk over, windows lit, then pulls out eastward, towards the
// tunnel under the river, and is gone. Drawn under the agents, so whoever is
// boarding stands in front of it. Three cars along 42nd Street. The arriving
// train is the same one run backwards: in from the tunnel, a stop at the
// platform, then out again with its windows dark.
const CAR_D = 0.32
const CAR_H = 6
const CAR_L = 1

function quad(list: [number, number, number][], fill: string, extra = ''): string {
  return `<polygon points="${list.map(([gx, gy, z]) => p(gx, gy, z).map(n).join(',')).join(' ')}" fill="${fill}"${extra}/>`
}

function car(x: number, color: string, isFront: boolean, boarding: boolean, lit = true): string {
  const y = TRACK_Y
  const y1 = y + CAR_D
  const x1 = x + CAR_L
  const edge = ` stroke="${INK}" stroke-width=".35" stroke-linejoin="round"`
  let g = quad([[x, y1, 0.8], [x1, y1, 0.8], [x1, y1, 0], [x, y1, 0]], '#1e293b')
  g += quad([[x, y, CAR_H], [x1, y, CAR_H], [x1, y1, CAR_H], [x, y1, CAR_H]], '#e2e8f0', edge)
  g += quad([[x, y1, CAR_H], [x1, y1, CAR_H], [x1, y1, 0.8], [x, y1, 0.8]], '#aab4c3', edge)
  g += quad([[x1, y, CAR_H], [x1, y1, CAR_H], [x1, y1, 0.8], [x1, y, 0.8]], '#6b7687', edge)
  // The session's colour as the stripe along the side.
  g += quad([[x, y1, 2.1], [x1, y1, 2.1], [x1, y1, 3.1], [x, y1, 3.1]], color)
  let windows = ''
  for (let i = 0; i < 4; i++) {
    const wx = x + 0.1 + i * 0.22
    windows += quad([[wx, y1, 3.5], [wx + 0.14, y1, 3.5], [wx + 0.14, y1, 5.1], [wx, y1, 5.1]], lit ? '#fde68a' : '#334155')
  }
  g += `<g opacity=".9">${boarding ? '<animate attributeName="opacity" values=".9;.45;.9" dur="1.1s" repeatCount="indefinite"/>' : ''}${windows}</g>`
  if (isFront) {
    const [hx, hy] = p(x1, y + CAR_D / 2, 2.4)
    g += `<circle cx="${n(hx)}" cy="${n(hy)}" r="1" fill="#fff7ae"><animate attributeName="opacity" values="1;.5;1" dur=".8s" repeatCount="indefinite"/></circle>`
  }
  return g
}

export function drawTrains(world: World, sc: Scene): string {
  let s = ''
  const [dx, dy] = p(7, 0)
  const secs = n(TRAIN_MS / 1000)
  for (const t of world.trains ?? []) {
    // Negative while boarding; once it is positive, the train is on its way.
    const age = (sc.now - t.leaveAt) / 1000
    if (age > TRAIN_MS / 1000 + 1) continue
    const arriving = t.kind === 'arrive'
    // An arriving train is coming in for its first few seconds.
    const since = (sc.now - t.at) / 1000
    const incoming = arriving && since < TRAIN_MS / 1000
    const boarding = age < 0
    // Its windows are lit with passengers: coming in, or waiting for them.
    const lit = arriving ? incoming : true
    let cars = ''
    for (let i = 0; i < 3; i++) cars += car(9.1 + i * (CAR_L + 0.1), esc(t.color), i === 2, boarding && !arriving, lit)
    let motion = ''
    let phase: string
    if (incoming) {
      motion = `<animateTransform attributeName="transform" type="translate" from="${n(dx)},${n(dy)}" to="0,0" begin="${(-since).toFixed(2)}s" dur="${secs}s" fill="freeze" calcMode="spline" keySplines="0 0 .4 1"/>`
      phase = 'arriving'
    } else if (boarding) {
      phase = arriving ? 'standing' : 'boarding'
    } else {
      const timing = `begin="${(-age).toFixed(2)}s" dur="${secs}s" fill="freeze"`
      motion =
        `<animateTransform attributeName="transform" type="translate" from="0,0" to="${n(dx)},${n(dy)}" ${timing} calcMode="spline" keySplines=".5 0 1 1"/>` +
        `<animate attributeName="opacity" values="1;1;0" keyTimes="0;.55;1" ${timing}/>`
      phase = 'leaving'
    }
    const who = arriving
      ? incoming
        ? `Arriving: ${t.who}`
        : boarding
          ? `${t.who} stepped off`
          : 'Leaving empty'
      : `${boarding ? 'Boarding' : 'Gone'}: ${t.who}`
    const name = arriving ? 'The train in from the east' : 'The last train home'
    s += `<g class="train ${phase}"${phase === 'leaving' ? ' opacity="1"' : ''}>${motion}<title>${esc(`${name} · ${who}`)}</title>${cars}</g>`
  }
  return s
}

// Taxis across town. A negative begin makes a re-rendered frame carry on the
// trip where the last one was, not start it over.
export function drawRides(world: World, sc: Scene): string {
  let s = ''
  for (const ride of world.rides ?? []) {
    const { path, dur } = walk(ride.from, ride.to, placeAt(ride.to, 0))
    const age = (sc.now - ride.at) / 1000
    if (age > dur + 1) continue
    const timing = `begin="${(-age).toFixed(2)}s" dur="${n(dur)}s" fill="freeze"`
    const c = esc(ride.color)
    const roof =
      ride.kind === 'report'
        ? `<rect x="-3.4" y="-18" width="6.8" height="4.6" rx=".6" fill="${c}" stroke="#fff" stroke-width=".7"/><path d="M-3.4 -17.7L0 -15.3L3.4 -17.7" fill="none" stroke="#fff" stroke-width=".7"/>`
        : `<path d="M-4 -19H4Q5 -19 5 -18V-15Q5 -14 4 -14H1L-1 -12.2V-14H-4Q-5 -14 -5 -15V-18Q-5 -19 -4 -19z" fill="#fff" stroke="${c}" stroke-width="1"/><path d="M-2.4 -17H2.4M-2.4 -15.4H1" stroke="${c}" stroke-width=".8"/>`
    s +=
      `<g class="ride"><animateMotion path="${path}" ${timing}/><animate attributeName="opacity" values="1;1;0" keyTimes="0;.85;1" ${timing}/><g class="fig">` +
      `<ellipse cx="0" cy="0" rx="9" ry="3" fill="#000" opacity=".4"/>` +
      `<rect x="-8" y="-6.5" width="16" height="5.5" rx="1.6" fill="#facc15" stroke="${INK}" stroke-width=".7"/>` +
      `<path d="M-4.6 -6.5L-3.4 -10.2H3.4L4.6 -6.5z" fill="#fde047" stroke="${INK}" stroke-width=".7"/>` +
      `<path d="M-3.4 -7.2L-2.6 -9.4H2.6L3.4 -7.2z" fill="#1e293b"/>` +
      `<rect x="-1.6" y="-11.8" width="3.2" height="1.6" rx=".5" fill="#fff7ae"><animate attributeName="opacity" values="1;.4;1" dur="1s" repeatCount="indefinite"/></rect>` +
      `<circle cx="-4.6" cy="-1" r="1.7" fill="#111827"/><circle cx="4.6" cy="-1" r="1.7" fill="#111827"/>` +
      roof +
      `</g></g>`
  }
  return s
}
