import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { renderCity } from './render.ts'
import { BLOCK_EVERY, LANDMARKS, fullPopulation } from '../src/draw/geo.ts'
import { City, FIREWORKS_MS, SCAFFOLD_MS, TRAIN_MS, emptyWorld } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'
import type { Landmark, World } from '../src/types.ts'

// The onboarding game: the island starts bare, and each landmark goes up the
// first time a session does that kind of work. Pure, like the other rules:
// feed hook events, look at `built`.

const T0 = 1_700_000_000_000
const HOME = 'C:/fake/home'

function ev(name: string, sid: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: sid, cwd: HOME, ...extra }
}

function tool(city: City, sid: string, name: string, input: Record<string, unknown>, now: number, agent?: string) {
  const extra = { tool_name: name, tool_use_id: `${sid}-${name}-${now}`, tool_input: input, ...(agent ? { agent_id: agent } : {}) }
  city.apply(ev('PreToolUse', sid, extra), now)
  city.apply(ev('PostToolUse', sid, { ...extra, tool_response: 'ok' }), now + 10)
}

// A session that has sent its first prompt: City Hall is up, nothing else.
function started(city: City, sid = 'S1', now = T0) {
  city.apply(ev('SessionStart', sid), now)
  city.apply(ev('UserPromptSubmit', sid, { prompt: 'hello' }), now + 100)
}

const built = (city: City) => Object.keys(city.world.built ?? {}).sort()

test('a brand-new city is bare land, and the welcome shows until a session is seen', () => {
  const city = new City()
  assert.deepEqual(city.world.built, {})
  assert.equal(city.world.population, 0)
  assert.equal(city.isNew, true)
  const svg = renderCity(city.world, T0, { connected: false })
  assert.ok(svg.includes('class="bp'), 'blueprint lots are drawn')
  assert.ok(svg.includes('Read a file to build it'), 'with their hints')
  assert.ok(!svg.includes('class="rails"'), 'no rails until the hooks are in')
  assert.ok(renderCity(city.world, T0, { connected: true }).includes('class="rails"'))

  city.apply(ev('SessionStart', 'S1'), T0)
  assert.equal(city.isNew, false, 'a session has been seen')
  assert.deepEqual(city.world.built, {}, 'but nothing is built yet')
})

test('City Hall rises on the first prompt', () => {
  const city = new City()
  city.apply(ev('SessionStart', 'S1'), T0)
  assert.deepEqual(built(city), [])
  city.apply(ev('UserPromptSubmit', 'S1', { prompt: 'hi' }), T0 + 100)
  assert.deepEqual(built(city), ['hall'])
  assert.equal(city.world.built!.hall, T0 + 100)
  assert.ok(city.toasts.includes('City Hall opened'))
  assert.ok(city.ticker.some(i => i.text === 'CITY HALL OPENED'))
  // A second prompt changes nothing.
  city.apply(ev('UserPromptSubmit', 'S1', { prompt: 'again' }), T0 + 200)
  assert.equal(city.world.built!.hall, T0 + 100)
})

test('each kind of work builds its landmark, once', () => {
  const cases: [string, Record<string, unknown>, Landmark][] = [
    ['Read', { file_path: `${HOME}/a.ts` }, 'library'],
    ['Grep', { pattern: 'x' }, 'library'],
    ['Glob', { pattern: '*.ts' }, 'library'],
    ['Edit', { file_path: `${HOME}/a.ts` }, 'workshop'],
    ['Write', { file_path: `${HOME}/b.ts` }, 'workshop'],
    ['Bash', { command: 'ls' }, 'foundry'],
    ['PowerShell', { command: 'dir' }, 'foundry'],
    ['WebFetch', { url: 'https://example.com' }, 'observatory'],
    ['WebSearch', { query: 'q' }, 'observatory'],
    ['mcp__Claude_Browser__navigate', { url: 'https://example.com' }, 'observatory'],
    ['Agent', { description: 'look around', prompt: 'x' }, 'relay'],
  ]
  for (const [name, input, landmark] of cases) {
    const city = new City()
    started(city)
    tool(city, 'S1', name, input, T0 + 1000)
    assert.deepEqual(built(city), ['hall', landmark].sort(), `${name} builds ${landmark}`)
    const at = city.world.built![landmark]
    tool(city, 'S1', name, input, T0 + 5000)
    assert.equal(city.world.built![landmark], at, 'the first time only')
  }
})

test('a git command is a shell command too, but only a commit builds the Seaport', () => {
  const city = new City()
  started(city)
  tool(city, 'S1', 'Bash', { command: 'git status' }, T0 + 1000)
  assert.deepEqual(built(city), ['foundry', 'hall'])
  tool(city, 'S1', 'Bash', { command: 'git commit -m "first"' }, T0 + 2000)
  assert.deepEqual(built(city), ['foundry', 'hall', 'harbor'])
  assert.ok(city.toasts.includes('Seaport and the Statue of Liberty opened'))
})

test('a commit that fails builds nothing; a push builds the Seaport and lights the torch', () => {
  const city = new City()
  started(city)
  const extra = { tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: 'git commit -m "x"' } }
  city.apply(ev('PreToolUse', 'S1', extra), T0 + 1000)
  city.apply(ev('PostToolUseFailure', 'S1', { ...extra, error: 'nothing to commit' }), T0 + 1010)
  assert.deepEqual(built(city), ['foundry', 'hall'])

  tool(city, 'S1', 'Bash', { command: 'git push origin main' }, T0 + 2000)
  assert.deepEqual(built(city), ['foundry', 'hall', 'harbor', 'torch'])
  assert.ok(city.toasts.includes("Liberty's torch is lit"))
})

test("Central Park greens when the first subagent finishes; a lead's own stop does not count", () => {
  const city = new City()
  started(city)
  city.apply(ev('Stop', 'S1'), T0 + 500)
  assert.deepEqual(built(city), ['hall'])
  city.apply(ev('SubagentStart', 'S1', { agent_id: 'a1', agent_type: 'Explore' }), T0 + 1000)
  assert.deepEqual(built(city), ['hall'], 'starting one is not finishing one')
  city.apply(ev('SubagentStop', 'S1', { agent_id: 'a1' }), T0 + 2000)
  assert.deepEqual(built(city), ['hall', 'plaza'])
  assert.ok(city.toasts.includes('Central Park is green'))
})

test('the Empire State goes up once every district is built, with the news once', () => {
  const city = new City()
  started(city)
  tool(city, 'S1', 'Read', { file_path: `${HOME}/a.ts` }, T0 + 1000)
  tool(city, 'S1', 'Edit', { file_path: `${HOME}/a.ts` }, T0 + 2000)
  tool(city, 'S1', 'Bash', { command: 'npm test' }, T0 + 3000)
  tool(city, 'S1', 'WebSearch', { query: 'q' }, T0 + 4000)
  tool(city, 'S1', 'Agent', { description: 'd', prompt: 'p' }, T0 + 5000)
  city.apply(ev('SubagentStart', 'S1', { agent_id: 'a1' }), T0 + 5100)
  city.apply(ev('SubagentStop', 'S1', { agent_id: 'a1' }), T0 + 6000)
  assert.equal(city.world.built!.empire, undefined, 'the Seaport is still a blueprint')
  const before = city.ticker.filter(i => i.text === 'THE CITY IS COMPLETE').length
  assert.equal(before, 0)
  tool(city, 'S1', 'Bash', { command: 'git commit -am "done"' }, T0 + 7000)
  assert.deepEqual(built(city), ['empire', 'foundry', 'hall', 'harbor', 'library', 'observatory', 'plaza', 'relay', 'workshop'])
  assert.equal(city.world.built!.empire, T0 + 7010)
  assert.equal(city.ticker.filter(i => i.text === 'THE CITY IS COMPLETE').length, 1)
  assert.ok(city.toasts.includes('The city is complete'))
  // The torch is the one thing left, and it does not reopen anything.
  tool(city, 'S1', 'Bash', { command: 'git push' }, T0 + 8000)
  assert.equal(city.ticker.filter(i => i.text === 'THE CITY IS COMPLETE').length, 1)
  assert.equal(city.world.built!.empire, T0 + 7010)
})

test('the population counts tool calls, and the fabric grows with it', () => {
  const city = new City()
  started(city)
  for (let i = 0; i < 5; i++) tool(city, 'S1', 'Read', { file_path: `${HOME}/${i}.ts` }, T0 + 1000 + i * 100)
  assert.equal(city.world.population, 5)
  const bare = renderCity(city.world, T0 + 2000, {})
  city.world.population = BLOCK_EVERY * 3
  const some = renderCity(city.world, T0 + 2000, {})
  city.world.population = fullPopulation()
  const full = renderCity(city.world, T0 + 2000, {})
  const blocks = (svg: string) => (svg.match(/class="[gsbrk]L"/g) ?? []).length
  assert.ok(blocks(bare) < blocks(some), 'blocks appear with the population')
  assert.ok(blocks(some) < blocks(full))
  assert.ok(fullPopulation() > 5000, 'weeks of work fill the island')
})

test('a landmark stands in scaffolding for a few seconds, then finished; the server redraws when it comes down', () => {
  const city = new City()
  started(city)
  // Well after City Hall's own scaffolding has come down.
  tool(city, 'S1', 'Read', { file_path: `${HOME}/a.ts` }, T0 + 3 * SCAFFOLD_MS)
  const at = city.world.built!.library!
  city.flush(at)
  const rising = renderCity(city.world, at + 1000, {})
  assert.ok(rising.includes('class="scaf"'), 'scaffolding on the Library')
  assert.ok(!rising.includes('Read a file to build it'), 'its blueprint is gone')
  assert.equal(city.due(at + SCAFFOLD_MS - 100), false)
  assert.equal(city.due(at + SCAFFOLD_MS + 100), true)
  const done = renderCity(city.world, at + SCAFFOLD_MS + 1000, {})
  assert.ok(!done.includes('class="scaf"'))
})

test('the finished city gets fireworks for a while', () => {
  const city = new City()
  city.buildAll(T0)
  city.world.built!.empire = T0 + 10_000
  assert.ok(renderCity(city.world, T0 + 11_000, {}).includes('class="fireworks"'))
  assert.ok(!renderCity(city.world, T0 + 10_000 + FIREWORKS_MS + 1000, {}).includes('class="fireworks"'))
  assert.equal(city.due(T0 + 10_000 + FIREWORKS_MS + 100), true)
})

test('the Statue is dark until the first commit, and her torch unlit until the first push', () => {
  const city = new City()
  started(city)
  assert.ok(renderCity(city.world, T0 + 500, {}).includes('class="statue dark"'))
  tool(city, 'S1', 'Bash', { command: 'git commit -m x' }, T0 + 1000)
  const lit = renderCity(city.world, T0 + 20_000, {})
  assert.ok(lit.includes('class="statue unlit"'))
  tool(city, 'S1', 'Bash', { command: 'git push' }, T0 + 30_000)
  assert.ok(renderCity(city.world, T0 + 50_000, {}).includes('class="statue lit"'))
})

test('a city saved before the game existed counts as fully built; a never-used one starts bare', () => {
  const used: World = { ...emptyWorld(), homeRoot: HOME, home: 'home', flushedAt: T0 }
  delete used.built
  delete used.population
  const city = new City(used)
  assert.deepEqual(Object.keys(city.world.built!).sort(), [...LANDMARKS].sort())
  assert.ok(city.world.built!.hall! <= T0, 'built in the past, so no scaffolding on load')
  assert.equal(city.world.population, fullPopulation())
  assert.equal(city.isNew, false)
  assert.deepEqual(city.toasts, [], 'no ceremony')

  const withSessions: World = { ...emptyWorld(), sessions: [{ id: 'S1', name: 's', cwd: HOME, root: HOME, color: '#fff', startedAt: T0, updatedAt: T0 }], flushedAt: T0 }
  delete withSessions.built
  assert.equal(Object.keys(new City(withSessions).world.built!).length, LANDMARKS.length)

  const never: World = { ...emptyWorld(), flushedAt: T0 }
  delete never.built
  const fresh = new City(never)
  assert.deepEqual(fresh.world.built, {})
  assert.equal(fresh.isNew, true)
})

test('Rebuild clears the progress; Build it all now finishes it without ceremony', () => {
  const city = new City()
  started(city)
  tool(city, 'S1', 'Read', { file_path: `${HOME}/a.ts` }, T0 + 1000)
  city.toasts.length = 0
  city.buildAll(T0 + 2000)
  assert.equal(Object.keys(city.world.built!).length, LANDMARKS.length)
  assert.equal(city.world.built!.library, T0 + 1000, 'what was built keeps its date')
  assert.ok(city.world.built!.empire! < T0 + 2000 - SCAFFOLD_MS + 1, 'the rest stands finished at once')
  assert.equal(city.world.population, fullPopulation())
  assert.ok(!city.ticker.some(i => i.text === 'THE CITY IS COMPLETE'))
  assert.deepEqual(city.toasts, [])

  city.rebuild(T0 + 3000)
  assert.deepEqual(city.world.built, {})
  assert.equal(city.world.population, 0)
  assert.equal(city.isNew, false, 'the session is still here, so no welcome')
  assert.equal(city.world.sessions.length, 1, 'rebuilding touches scenery only')
  assert.equal(city.world.agents.length, 1)
  // It can be played again.
  tool(city, 'S1', 'Edit', { file_path: `${HOME}/a.ts` }, T0 + 4000)
  assert.deepEqual(built(city), ['workshop'])
})

test("the first session of a brand-new city arrives by train, and the train leaves empty", () => {
  const city = new City()
  city.apply(ev('SessionStart', 'S1'), T0)
  const lead = city.world.agents.find(a => a.id === 'lead:S1')!
  assert.equal(lead.at, 'relay', 'it steps off at Grand Central')
  assert.equal(lead.arriving, T0 + TRAIN_MS)
  const train = city.world.trains![0]!
  assert.equal(train.kind, 'arrive')
  assert.equal(train.at, T0)
  assert.ok(train.leaveAt > T0 + TRAIN_MS, 'it stands at the platform a while')

  city.flush(T0 + 500)
  const coming = renderCity(city.world, T0 + 500, {})
  assert.ok(coming.includes('class="train arriving"'))
  assert.ok(coming.includes('Arriving: home'))
  const aboard = renderFrame(city.world, T0 + 500).agents.find(a => a.id === 'lead:S1')!
  assert.ok(aboard.cls === 'agent idle' && aboard.fig.svg.startsWith('<g opacity="0">'), 'the passenger is not on the platform yet')
  assert.equal(city.due(T0 + TRAIN_MS), true, 'redrawn when it steps off')
  city.flush(T0 + TRAIN_MS + 100)
  assert.equal(lead.arriving, undefined)
  const standing = renderCity(city.world, T0 + TRAIN_MS + 100, {})
  assert.ok(standing.includes('class="train standing"'))
  assert.ok(!renderFrame(city.world, T0 + TRAIN_MS + 100).agents[0]!.fig.svg.startsWith('<g opacity="0">'))
  city.flush(train.leaveAt + 500)
  const gone = renderCity(city.world, train.leaveAt + 500, {})
  assert.ok(gone.includes('class="train leaving"'), 'it pulls out again, empty')
  assert.equal(city.world.agents.length, 1, 'the lead stays')
  city.flush(train.leaveAt + TRAIN_MS + 100)
  assert.equal(city.world.trains, undefined)

  // Its first prompt walks it from the station to City Hall.
  city.apply(ev('UserPromptSubmit', 'S1', { prompt: 'hi' }), train.leaveAt + TRAIN_MS + 200)
  city.flush(train.leaveAt + TRAIN_MS + 200)
  assert.equal(lead.at, 'hall')
  assert.equal(lead.walkFrom?.at, 'relay')
})

test('a second session, or one in a built city, arrives without a train', () => {
  const city = new City()
  city.apply(ev('SessionStart', 'S1'), T0)
  city.apply(ev('SessionStart', 'S2'), T0 + 100)
  assert.equal(city.world.trains!.length, 1, 'only the first')
  assert.equal(city.world.agents.find(a => a.id === 'lead:S2')!.at, 'hall')

  const old = new City()
  old.buildAll(T0)
  old.apply(ev('SessionStart', 'S1'), T0 + 100)
  assert.equal(old.world.trains, undefined)
  assert.equal(old.world.agents[0]!.at, 'hall')
})
