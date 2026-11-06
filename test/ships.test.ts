import test from 'node:test'
import assert from 'node:assert/strict'

import { renderFrame } from '../src/city.ts'
import { shippedOf } from '../src/deploys.ts'
import { LIVE_MS, PREVIEW_MS, SAIL_MS, seaway } from '../src/draw/ships.ts'
import { cityWith, wholeLayout } from './whole.ts'
import { City } from '../src/world.ts'
import type { HookEvent } from '../src/world.ts'

// Shipping: a deploy sends a ship out of the Seaport; a production one puts
// up a LIVE sign.

const T0 = 1_700_000_000_000

test('deploys are read from the commands that make them, and only those', () => {
  assert.deepEqual(shippedOf('vercel --prod', 'Production: https://shop-abc.vercel.app [3s]', false), { kind: 'shipped', target: 'Vercel', prod: true, url: 'https://shop-abc.vercel.app' })
  assert.deepEqual(shippedOf('cd web && npx vercel', 'Preview: https://shop-git-x.vercel.app', false), { kind: 'shipped', target: 'Vercel', prod: false, url: 'https://shop-git-x.vercel.app' })
  for (const c of ['vercel env pull', 'vercel link', 'cat vercel.json', 'netlify status', 'fly logs', 'npm publish --dry-run', 'git push']) assert.equal(shippedOf(c, '', false), undefined, c)
  assert.deepEqual(shippedOf('netlify deploy --prod --dir dist', 'Website URL:       https://shop.netlify.app', false), { kind: 'shipped', target: 'Netlify', prod: true, url: 'https://shop.netlify.app' })
  assert.deepEqual(shippedOf('flyctl deploy', 'Visit your newly deployed app at https://api.fly.dev/', false), { kind: 'shipped', target: 'Fly.io', prod: true, url: 'https://api.fly.dev/' })
  assert.deepEqual(shippedOf('npx wrangler deploy', 'Published api (1.2 sec)\n  https://api.me.workers.dev', false), { kind: 'shipped', target: 'Cloudflare', prod: true, url: 'https://api.me.workers.dev' })
  assert.deepEqual(shippedOf('firebase deploy', 'Hosting URL: https://shop.web.app', false), { kind: 'shipped', target: 'Firebase', prod: true, url: 'https://shop.web.app' })
  assert.deepEqual(shippedOf('npm publish', 'npm notice\n+ @me/tool@1.4.0', false), { kind: 'shipped', target: 'npm', prod: true, url: 'https://www.npmjs.com/package/@me/tool', version: '1.4.0' })
  assert.deepEqual(shippedOf('npm run deploy', 'Done: https://shop.example.com live', false), { kind: 'shipped', target: 'its deploy script', prod: true, url: 'https://shop.example.com' })
  assert.equal(shippedOf('vercel --prod', 'Error: no token', false), undefined, 'it failed')
  assert.equal(shippedOf('vercel --prod', 'https://x.vercel.app', true), undefined, 'the command failed')
})

test('ships leave from the Seaport toward the nearest water', () => {
  assert.equal(seaway(wholeLayout()), undefined, 'no ship while the Seaport is a blueprint lot')
  const built = cityWith()
  built.buildAll(T0)
  const way = seaway(built.layout)!
  assert.ok(way, 'a Seaport once it stands')
  assert.equal(Math.abs(way.dir[0]) + Math.abs(way.dir[1]), 1, 'straight out to the water')
})

function ev(name: string, extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: name, session_id: 'S1', cwd: 'C:/fake/home', ...extra }
}

test('a deploy sails a ship out and puts up a LIVE sign, which come down in their time', () => {
  const city = cityWith()
  city.buildAll(T0)
  city.apply(ev('SessionStart'), T0)
  const extra = { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'vercel --prod' } }
  city.apply(ev('PreToolUse', extra), T0 + 10)
  city.apply(ev('PostToolUse', { ...extra, tool_response: { stdout: 'Production: https://home-x.vercel.app', stderr: '' } }), T0 + 20)
  assert.ok(city.toasts.includes('🚢 home shipped to Vercel: https://home-x.vercel.app'))
  const at = (t: number) => renderFrame(city.world, T0 + 20 + t).overlay
  const ship = at(1000).find(o => o.k.startsWith('ship:'))
  assert.ok(ship, 'a ship sails')
  assert.match(ship!.svg, /HOME/)
  assert.match(ship!.svg, /begin="-1s"/, 'a second into its voyage')
  const live = at(1000).find(o => o.k.startsWith('live:'))!
  assert.match(live.svg, /data-site-url="https:\/\/home-x\.vercel\.app"/)
  assert.match(live.svg, />LIVE</)
  assert.ok(!at(SAIL_MS + 1).some(o => o.k.startsWith('ship:')), 'gone over the horizon')
  assert.ok(at(SAIL_MS + 1).some(o => o.k.startsWith('live:')), 'the sign stays')
  assert.ok(!at(LIVE_MS + 1).some(o => o.k.startsWith('live:')), 'for a month')
  assert.ok(PREVIEW_MS < LIVE_MS)
})
