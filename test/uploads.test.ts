import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { imageBlocks, isUpload, pruneUploads, safeName, saveUpload } from '../src/uploads.ts'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1f3c1e70000000049454e44ae426082', 'hex')

test('a name is made safe for any system and any shell', () => {
  assert.equal(safeName('report Q3.pdf'), 'report Q3.pdf')
  assert.equal(safeName('C:\\Users\\me\\..\\secret.txt'), 'secret.txt')
  assert.equal(safeName('../../etc/passwd'), 'passwd')
  assert.equal(safeName('a"b&c|d.png'), 'a_b_c_d.png')
  assert.equal(safeName('.hidden'), 'hidden')
  assert.equal(safeName(''), 'file')
  assert.equal(safeName('.png'), 'png')
  assert.ok(safeName('x'.repeat(300) + '.txt').length <= 112)
})

test('an upload is saved under its day, and only uploads count as uploads', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-city-up-'))
  try {
    const now = Date.UTC(2026, 10, 4, 12)
    const u = saveUpload(root, 'shot.png', PNG, now)
    assert.equal(basename(dirname(u.path)), '2026-11-04')
    assert.match(basename(u.path), /^[0-9a-f]{8}-shot\.png$/)
    assert.deepEqual(readFileSync(u.path), PNG)
    assert.equal(u.image, true)
    assert.equal(u.size, PNG.length)
    assert.equal(saveUpload(root, 'notes.md', Buffer.from('# hi'), now).image, false)
    assert.throws(() => saveUpload(root, 'empty.txt', Buffer.alloc(0), now), /empty/)

    assert.equal(isUpload(root, u.path), true)
    const outside = join(tmpdir(), 'agent-city-not-an-upload.png')
    writeFileSync(outside, PNG)
    assert.equal(isUpload(root, outside), false, 'outside the folder')
    assert.equal(isUpload(root, join(root, '..', basename(outside))), false, 'climbing out')
    assert.equal(isUpload(root, root), false, 'the folder itself')
    assert.equal(isUpload(root, join(root, '2026-11-04')), false, 'a folder')
    assert.equal(isUpload(root, 42), false)
    rmSync(outside, { force: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('attached images become content blocks; other files and strangers do not', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-city-up-'))
  try {
    const img = saveUpload(root, 'a.png', PNG).path
    const doc = saveUpload(root, 'b.pdf', Buffer.from('%PDF-1.4')).path
    const blocks = imageBlocks(root, [img, doc, 'C:\\Windows\\win.ini', 7])
    assert.deepEqual(blocks, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.toString('base64') } }])
    assert.deepEqual(imageBlocks(root, 'not a list'), [])
    const big = saveUpload(root, 'big.jpg', Buffer.alloc(4 * 1024 * 1024, 1)).path
    assert.deepEqual(imageBlocks(root, [big]), [], 'too big to send inline: it is still listed by path')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('uploads older than a month are cleared', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-city-up-'))
  try {
    for (const d of ['2026-09-01', '2026-10-04', '2026-10-05', '2026-11-04', 'keep-me']) {
      mkdirSync(join(root, d))
      writeFileSync(join(root, d, 'f.txt'), 'x')
    }
    assert.equal(pruneUploads(root, Date.UTC(2026, 10, 4, 12), 30), 2)
    assert.deepEqual(['2026-09-01', '2026-10-04', '2026-10-05', '2026-11-04', 'keep-me'].map(d => existsSync(join(root, d))), [false, false, true, true, true])
    assert.equal(pruneUploads(join(root, 'missing')), 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
