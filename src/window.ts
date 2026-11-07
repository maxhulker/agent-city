// What the desktop app (src/app.ts) does about its window, checked once a
// second. It lives as long as someone watches the city, and it never stays
// running unseen: a window that doesn't show up is tried again in the
// default browser, and if nobody watches at all it stops, so opening the app
// again starts afresh.

// The window it opened: a browser's app mode, the default browser, or none
// (AGENT_CITY_NO_WINDOW: whoever runs it watches).
export type WindowKind = 'app' | 'browser' | 'none'

export type WindowStep = 'wait' | 'default-browser' | 'give-up' | 'quit'

// No one watching this long after the app window was asked for: the default browser too.
export const FALLBACK_MS = 20_000
// No one watching at all this long after starting: stop.
export const GIVE_UP_MS = 180_000
// Everyone gone this long after someone watched: the window closed, stop.
// (A reload reconnects well within that.)
export const QUIT_MS = 10_000

export function windowStep(s: {
  now: number
  startedAt: number
  window: WindowKind
  // Someone has watched since it started.
  seen: boolean
  // When the last watcher left (0: someone watches now, or nobody ever did).
  quietSince: number
  triedDefault: boolean
}): WindowStep {
  if (s.seen) return s.quietSince && s.now - s.quietSince >= QUIT_MS ? 'quit' : 'wait'
  if (s.window === 'none') return 'wait'
  const waited = s.now - s.startedAt
  if (s.window === 'app' && !s.triedDefault && waited >= FALLBACK_MS) return 'default-browser'
  if (waited >= GIVE_UP_MS) return 'give-up'
  return 'wait'
}
