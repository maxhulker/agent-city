import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { BLUEPRINT_MS, addBlueprints, newFolders, pathsInPlan, relativeTo, unbuilt } from '../src/blueprints.ts'
import { blueprintPlots, houses, placeBlocks } from '../src/draw/blocks.ts'
import type { Census } from '../src/types.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// Blueprints: the folders a project is about to get, on its empty plots
// before they are built.

const T0 = 1_700_000_000_000
const ROOT = 'C:/fake/api'
const census = (paths: string[]): Census => ({
  at: T0, files: 10, bytes: 1e4, commits: 0, dirty: 0,
  blocks: paths.map(path => ({ path, files: 5, bytes: 5e3, commits: 0, dirty: 0 })),
})

test('the paths a plan names: files and folders, not urls or words with slashes', () => {
  const plan = [
    '## Plan',
    '1. Add `src/routes/users.ts` and a test in test/users.test.ts.',
    '2. Put the docs in docs/ and the page in (public/index.html).',
    '3. Read and/or update C:/fake/api/scripts/seed.mjs, not C:/elsewhere/x.ts.',
    '4. See https://example.com/a/b.html and README.md.',
  ].join('\n')
  assert.deepEqual(pathsInPlan(plan, ROOT).sort(), ['docs/', 'public/index.html', 'scripts/seed.mjs', 'src/routes/users.ts', 'test/users.test.ts'])
  assert.equal(relativeTo(ROOT, 'C:\\fake\\api\\web\\a.ts'), 'web/a.ts')
  assert.equal(relativeTo(ROOT, 'C:/other/a.ts'), undefined)
})

test('only folders the census lacks become blueprints; built or stale ones go', () => {
  const c = census(['src', 'docs/guides'])
  assert.deepEqual(newFolders(['src/a.ts', 'docs/x.md', 'public/i.html', 'node_modules/x/y.js', '.github/w.yml', 'top.md', 'web/'], c), ['public', 'web'])
  const { list, added } = addBlueprints(undefined, ['public', 'web'], 'plan', T0)
  assert.deepEqual(added, ['public', 'web'])
  assert.deepEqual(addBlueprints(list, ['web'], 'work', T0 + 5).added, [], 'named again: refreshed, not added')
  assert.deepEqual(unbuilt(list, census(['src', 'public']), T0 + 10).map(b => b.path), ['web'], 'public stands now')
  assert.deepEqual(unbuilt(list, c, T0 + BLUEPRINT_MS + 1), [], 'stale')
})

test('blueprints take the free plots nearest the front, two each while there is room', () => {
  const placed = placeBlocks(houses('brooklyn'), census(['src']))
  const free = placed.filter(s => s.block < 0).length
  const plots = blueprintPlots(placed, ['public', 'web'])
  assert.equal(plots.length, 2)
  assert.deepEqual(plots.map(p => p.plots.length), [2, 2])
  for (const p of plots) for (const i of p.plots) assert.equal(placed[i]!.block, -1, 'on an empty plot')
  assert.ok(Math.max(...plots[0]!.plots) > Math.max(...plots[1]!.plots), 'the first nearest the front')
  assert.ok(free > 4)
})

function ev(name: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: 'S2', cwd: ROOT, ...extra }
}

test('a plan draws blueprints in its borough; a commit builds them', () => {
  const city = new City()
  city.apply({ hook_event_name: 'SessionStart', session_id: 'S1', cwd: 'C:/fake/home' }, T0)
  city.build({ op: 'movein', id: 'brooklyn', root: ROOT }, T0)
  city.setCensus(ROOT, census(['src']))
  city.apply(ev('SessionStart'), T0 + 10)
  const plan = 'Create `web/index.html` and `web/app.js`, plus tests in `e2e/app.spec.ts`; touch src/main.ts.'
  city.apply(ev('PreToolUse', { tool_name: 'ExitPlanMode', tool_use_id: 'p1', tool_input: { plan } }), T0 + 20)
  const repo = () => city.world.repos.find(r => r.root === ROOT)!
  assert.deepEqual(repo().blueprints!.map(b => [b.path, b.from]), [['web', 'plan'], ['e2e', 'plan']])
  assert.ok(city.toasts.includes('📐 Blueprints drawn in Brooklyn for web/, e2e/'))

  // Writing a file into a new folder draws one too.
  city.apply(ev('PreToolUse', { tool_name: 'Write', tool_use_id: 'w1', tool_input: { file_path: `${ROOT}/scripts/seed.mjs`, content: 'x' } }), T0 + 30)
  assert.deepEqual(repo().blueprints!.map(b => b.path), ['web', 'e2e', 'scripts'])

  const lit = renderFrame(city.world, T0 + 40).overlay.find(o => o.k === 'burb:brooklyn')!.svg
  assert.match(lit, /class="blueprints"/)
  assert.match(lit, /PLANNED · web\//)
  assert.match(renderFrame(city.world, T0 + 40).overlay.find(o => o.k === 'zones')!.svg, /web\/ \(planned\)/)

  // Committed: web/ stands, its blueprint comes down.
  city.setCensus(ROOT, { ...census(['src', 'web']), at: T0 + 50 })
  assert.deepEqual(repo().blueprints!.map(b => b.path), ['e2e', 'scripts'])
  assert.ok(city.toasts.includes('🏗 web/ went up in Brooklyn'))
})
