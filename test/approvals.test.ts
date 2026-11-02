import test from 'node:test'
import assert from 'node:assert/strict'

import { Approvals, alwaysLabel } from '../src/approvals.ts'
import type { HookEvent } from '../src/world.ts'

// "Always allow" on a permission card: Claude Code's own suggestions for the
// prompt go back as updatedPermissions, as if picked in its own dialog.

const RULE = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }

function ask(extra: Record<string, unknown> = {}): HookEvent {
  return { hook_event_name: 'PermissionRequest', session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' }, ...extra }
}

test('a suggestion is named on the card and sent back on Always allow', async () => {
  const a = new Approvals(() => {})
  const out = a.hold(ask({ permission_suggestions: [RULE] }), Date.now())
  const [p] = a.list()
  assert.equal(p.always, 'Bash(npm test:*) in this project')
  assert.ok(a.decide(p.id, { behavior: 'allow', always: true }))
  assert.deepEqual(await out, {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { command: 'npm test' }, updatedPermissions: [RULE] } },
  })
})

test('a plain Allow remembers nothing', async () => {
  const a = new Approvals(() => {})
  const out = a.hold(ask({ permission_suggestions: [RULE] }), Date.now())
  a.decide(a.list()[0].id, { behavior: 'allow' })
  const reply = (await out) as { hookSpecificOutput: { decision: Record<string, unknown> } }
  assert.equal(reply.hookSpecificOutput.decision.updatedPermissions, undefined)
})

test('no suggestions, no Always allow', async () => {
  const a = new Approvals(() => {})
  const out = a.hold(ask(), Date.now())
  const [p] = a.list()
  assert.equal(p.always, undefined)
  a.decide(p.id, { behavior: 'allow', always: true })
  const reply = (await out) as { hookSpecificOutput: { decision: Record<string, unknown> } }
  assert.equal(reply.hookSpecificOutput.decision.updatedPermissions, undefined)
})

test('labels for modes and directories; anything unknown hides the button', () => {
  assert.equal(alwaysLabel([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]), 'Accept edits in this session')
  assert.equal(alwaysLabel([{ type: 'addDirectories', directories: ['C:/src'], destination: 'session' }]), 'Access to C:/src in this session')
  assert.equal(alwaysLabel([RULE, { type: 'mystery' }]), undefined)
  assert.equal(alwaysLabel([]), undefined)
})
