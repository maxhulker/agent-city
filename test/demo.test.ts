import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LANDMARKS } from '../src/draw/geo.ts'
import { renderFrame } from '../src/city.ts'
import { DEMO, DemoPlayer, demoConf, demoFolders, demoWorld } from '../src/demo.ts'
import { City } from '../src/world.ts'

// The demo city plays a script into a fresh planned city: by its end every
// landmark stands, the two projects have boroughs, the shop's worktree is a
// section of the shop's, and the city keeps working after.

const T0 = 1_700_000_000_000

function play(seconds: number) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-demo-'))
  const folders = demoFolders(dir)
  const city = new City(demoWorld())
  let now = T0
  const player = new DemoPlayer(city, folders, T0, () => now)
  for (; now <= T0 + seconds * 1000; now += 250) {
    player.step(now)
    city.flush(now)
  }
  return { dir, folders, city }
}

test('the demo city is a city of its own that no real session posts to', () => {
  const conf = demoConf('C:/state')
  assert.equal(conf.id, DEMO)
  assert.equal(conf.ownFolder, true)
  assert.deepEqual(conf.accounts, [])
  const w = demoWorld()
  assert.equal(w.sessions.length, 0)
  assert.ok(w.layout!.buildings.length > 0, 'the city is planned')
  assert.equal(Object.keys(new City(w).world.built ?? {}).length, 0, 'and no landmark is built yet')
})

test('its folders are made once, real projects to count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-demo-'))
  try {
    const f = demoFolders(dir)
    for (const root of [f.home, f.shop, f.api]) assert.ok(existsSync(join(root, 'README.md')), root)
    if (f.git) assert.ok(f.checkout && existsSync(join(f.checkout, 'src', 'cart.ts')), 'a worktree of the shop')
    // Again: nothing breaks, the same folders.
    assert.deepEqual(demoFolders(dir), f)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the script raises every landmark, gives the projects boroughs and branches the worktree off the shop', () => {
  const { dir, folders, city } = play(170)
  try {
    const w = city.world
    for (const id of LANDMARKS) assert.notEqual(w.built?.[id], undefined, `${id} stands`)
    const repo = (root: string) => w.repos.find(r => r.root.toLowerCase() === root.toLowerCase())
    const shop = repo(folders.shop)!
    const api = repo(folders.api)!
    assert.ok(!shop.burb.startsWith('@'), 'the shop has a borough')
    assert.ok(!api.burb.startsWith('@'), 'so does the API')
    if (folders.checkout) {
      const co = repo(folders.checkout)!
      const bo = w.layout!.boroughs.find(b => b.id === co.burb)
      assert.equal(bo?.of, shop.burb, 'the worktree is a section of the shop')
    }
    assert.equal(w.asks.length, 0, 'the question was answered')
    // It draws.
    assert.ok(renderFrame(w, T0 + 170_000, { connected: true }).map.svg.length > 1000)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('after the script, ambient work goes on', () => {
  const { dir, city } = play(240)
  try {
    const tools = city.world.agents.reduce((n, a) => n + a.tools, 0)
    const { city: early, dir: d2 } = play(165)
    rmSync(d2, { recursive: true, force: true })
    assert.ok(tools > early.world.agents.reduce((n, a) => n + a.tools, 0), 'more tool calls than at the end of the script')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
