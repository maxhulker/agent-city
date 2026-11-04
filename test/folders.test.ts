import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { REST } from '../src/census.ts'
import { fileIn, filesOf, lookAt, parseChanges } from '../src/folders.ts'

// What is inside a house: its folder's files as the census groups them, with
// what changed since the last commit, and a look inside one that never
// leaves the repository.

test('git status entries become changes, renames and new files included', () => {
  const out = [' M src/a.ts', '?? src/new.ts', 'A  docs/added.md', ' D old.txt', 'R  src/b2.ts', 'src/b.ts', 'MM both.ts', ''].join('\0')
  assert.deepEqual([...parseChanges(out)], [
    ['src/a.ts', 'modified'],
    ['src/new.ts', 'new'],
    ['docs/added.md', 'new'],
    ['old.txt', 'deleted'],
    ['src/b2.ts', 'renamed'],
    ['both.ts', 'modified'],
  ])
  assert.equal(parseChanges('').size, 0)
})

test('a folder lists the files its census block holds, the changed ones marked', () => {
  const keys = ['src', 'src/draw', 'test', '', REST]
  const entries = [
    { path: 'src/a.ts', bytes: 10 },
    { path: 'src/draw/map.ts', bytes: 20 },
    { path: 'test/a.test.ts', bytes: 5 },
    { path: 'README.md', bytes: 7 },
    { path: 'scripts/x.ps1', bytes: 3 },
    { path: 'old.txt', bytes: 4 },
  ]
  const changes = parseChanges([' M src/a.ts', '?? src/new.ts', ' D old.txt', ''].join('\0'))
  const size = (p: string) => (p === 'src/a.ts' ? 12 : p === 'src/new.ts' ? 99 : 0)
  const src = filesOf(entries, changes, 'src', keys, size)
  assert.deepEqual(src.files, [
    { path: 'src/a.ts', bytes: 12, change: 'modified' },
    { path: 'src/new.ts', bytes: 99, change: 'new' },
  ], 'its own files, not the deeper block\'s; sizes as they are now')
  assert.equal(src.total, 2)
  assert.equal(src.bytes, 111)
  assert.deepEqual(filesOf(entries, changes, 'src/draw', keys, size).files.map(f => f.path), ['src/draw/map.ts'])
  const top = filesOf(entries, changes, '', keys, size)
  assert.deepEqual(top.files.map(f => [f.path, f.change]), [['old.txt', 'deleted'], ['README.md', undefined]])
  assert.equal(top.bytes, 7, 'a deleted file weighs nothing')
  assert.deepEqual(filesOf(entries, changes, REST, keys, size).files.map(f => f.path), ['scripts/x.ps1'], 'the smaller folders together')
})

test('a look inside a file: text, an image, or binary, and never outside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-city-fl-'))
  try {
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    writeFileSync(join(root, 'blob.bin'), Buffer.from([1, 0, 2, 0]))
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(300 * 1024))
    writeFileSync(join(root, '.git', 'config'), '[core]')
    writeFileSync(join(tmpdir(), 'agent-city-outside.txt'), 'secret')

    const a = lookAt(root, 'src/a.ts')!
    assert.equal(a.text, 'export const a = 1\n')
    assert.equal(a.bytes, 19)
    assert.equal(a.truncated, undefined)
    assert.equal(lookAt(root, 'logo.png')!.image, 'image/png')
    assert.equal(lookAt(root, 'blob.bin')!.binary, true)
    const big = lookAt(root, 'big.txt')!
    assert.equal(big.truncated, true)
    assert.equal(big.text!.length, 256 * 1024)

    assert.equal(fileIn(root, '../agent-city-outside.txt'), undefined, 'not out of it')
    assert.equal(fileIn(root, join(tmpdir(), 'agent-city-outside.txt')), undefined, 'not by an absolute path')
    assert.equal(fileIn(root, '.git/config'), undefined, 'not git\'s own files')
    assert.equal(fileIn(root, 'src'), undefined, 'not a folder')
    assert.equal(fileIn(root, ''), undefined)
    assert.equal(lookAt(root, 'missing.ts'), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(join(tmpdir(), 'agent-city-outside.txt'), { force: true })
  }
})
