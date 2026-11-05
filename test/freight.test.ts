import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { renderFrame } from '../src/city.ts'
import { checkFreight, cloneProject, nameOf } from '../src/freight.ts'
import { cityBuildings, findSite } from '../src/layout.ts'
import { City, norm } from '../src/world.ts'

// Freight: a project brought in from its address, cloned while its train
// waits at Grand Central.

const T0 = 1_700_000_000_000

test('only https and git@ addresses are taken; a GitHub page works too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crosswalk-freight-'))
  try {
    const ok = (url: string) => checkFreight({ url, parent: dir }, dir)
    assert.deepEqual(ok('https://github.com/maxhulker/agent-city'), { url: 'https://github.com/maxhulker/agent-city', name: 'agent-city', path: norm(join(dir, 'agent-city')) })
    assert.equal(ok('https://github.com/o/r.git').name, 'r')
    assert.equal(ok('github.com/o/shop').url, 'https://github.com/o/shop', 'no scheme')
    assert.equal(ok('https://github.com/o/shop/tree/main/src').url, 'https://github.com/o/shop', 'a page inside it')
    assert.equal(ok('git@github.com:o/tool.git').name, 'tool')
    assert.equal(ok('https://gitlab.com/group/sub/proj').name, 'proj')
    for (const url of ['ext::sh -c touch% /tmp/pwned', 'file:///C:/x', 'C:/some/repo', '--upload-pack=evil', 'http://github.com/o/r', 'https://github.com/o/r;rm -rf', 'ssh://x/y', '']) {
      assert.throws(() => ok(url), /repository address/, url)
    }
    assert.throws(() => checkFreight({ url: 'https://github.com/o/r', folder: '../up' }, dir), /folder name/)
    mkdirSync(join(dir, 'taken'))
    assert.throws(() => checkFreight({ url: 'https://github.com/o/taken' }, dir), /already exists/)
    assert.equal(nameOf('git@host:a/b/c.git'), 'c')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a clone that works lands the repository; one that fails leaves nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crosswalk-freight-'))
  try {
    const src = join(dir, 'source')
    mkdirSync(src)
    writeFileSync(join(src, 'README.md'), '# hi\n')
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd: src, stdio: 'ignore' })
    git('init', '-q')
    git('add', '-A')
    git('commit', '-q', '-m', 'first')
    // cloneProject takes what checkFreight let through; a local path stands in for the address here.
    const ok = await new Promise<string | undefined>(r => cloneProject({ url: src, name: 'source', path: join(dir, 'copy') }, r))
    assert.equal(ok, undefined)
    assert.ok(existsSync(join(dir, 'copy', 'README.md')))
    const bad = await new Promise<string | undefined>(r => cloneProject({ url: join(dir, 'nothing-here'), name: 'x', path: join(dir, 'broken') }, r))
    assert.ok(bad && bad.length > 0, 'says what went wrong')
    assert.ok(!existsSync(join(dir, 'broken')), 'and leaves no folder behind')
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('its borough is laid out and its freight train waits; unloaded, the train leaves; failed, it all goes', () => {
  const city = new City()
  city.newMap(1511622721, T0 - 1000)
  const st = cityBuildings(city.layout, 'station')[0]!
  const site = findSite(city.layout, 10, 8, [st.x + 1, st.y + 2])!
  const root = 'C:/fake/shop'
  const at = { x: site[0], y: site[1], w: 10, h: 8, fill: true }
  const r = city.freightArrives(root, 'shop', at, T0)
  assert.ok('ok' in r && r.drawn)
  assert.ok(city.toasts.includes('🚂 shop is arriving by freight, for shop'))
  const train = () => city.world.trains?.find(t => t.id === `freight:${root.toLowerCase()}`)
  assert.equal(train()!.kind, 'freight')
  // It stands at the platform for as long as the clone takes.
  const drawn = renderFrame(city.world, T0 + 60_000).overlay.find(o => o.k === `train:freight:${root.toLowerCase()}`)!
  assert.match(drawn.svg, /Unloading shop \(cloning it\)/)
  assert.match(drawn.svg, />SHOP</, 'its name on the boxcar')

  city.freightDone(root, 'shop', r as { id: string; drawn: boolean }, undefined, T0 + 90_000)
  assert.equal(train()!.leaveAt, T0 + 92_500, 'unloaded: it leaves')
  assert.ok(city.toasts.includes('📦 shop unloaded: its houses go up as it is counted'))
  assert.ok(city.world.repos.some(x => x.root === root))

  // Another that can't be cloned: its borough and its record go.
  const site2 = findSite(city.layout, 10, 8, [st.x + 1, st.y + 2])!
  const r2 = city.freightArrives('C:/fake/nope', 'nope', { x: site2[0], y: site2[1], w: 10, h: 8 }, T0 + 100_000)
  assert.ok('ok' in r2)
  const boroughs = city.layout.boroughs.length
  city.freightDone('C:/fake/nope', 'nope', r2 as { id: string; drawn: boolean }, 'Repository not found.', T0 + 110_000)
  assert.equal(city.layout.boroughs.length, boroughs - 1, 'its borough is taken back')
  assert.ok(!city.world.repos.some(x => x.root === 'C:/fake/nope'))
  assert.ok(city.toasts.includes("🚂 nope couldn't be brought in: Repository not found."))
})
