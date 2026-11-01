import { renderFrame } from '../src/city.ts'
import type { Frame, RenderOptions } from '../src/city.ts'
import type { World } from '../src/types.ts'

// The three layers flattened into one string, for "it draws X" checks.
export const flat = (f: Frame): string =>
  f.map.svg + f.overlay.map(i => i.svg).join('') + f.agents.map(a => `<g class="${a.cls}">${a.fig.svg}</g>`).join('')

export const renderCity = (world: World, now: number, opts: RenderOptions = {}): string => flat(renderFrame(world, now, opts))
