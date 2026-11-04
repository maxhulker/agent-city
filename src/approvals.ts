import { randomUUID } from 'node:crypto'

import type { Decision, Pending } from './types.ts'
import type { HookEvent, HookReply } from './world.ts'

// Permission prompts, questions and plan approvals, held open for the page.
// Claude Code's PermissionRequest hook waits for its HTTP reply, so each one
// is a promise resolved by the page's decision, by a timeout or by the
// session ending. An empty reply means "no decision": the session then asks
// in its own window as usual.

// Below the hook's 600 s timeout, so we answer before Claude Code gives up on us.
const HOLD_MS = 540_000
const INPUT_BUDGET = 2000
const DECLINED = 'The user declined this in Crosswalk.'

type Held = {
  pending: Pending
  toolInput: Record<string, unknown>
  suggestions: Record<string, unknown>[]
  resolve: (reply: HookReply) => void
  timer: ReturnType<typeof setTimeout>
}

function oneLine(text: string, n = 200): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function summarize(tool: string, input: Record<string, unknown>): string {
  const first =
    str(input.command) ||
    str(input.file_path) ||
    str(input.notebook_path) ||
    str(input.url) ||
    str(input.path) ||
    str(input.pattern) ||
    str(input.query)
  return first ? oneLine(first) : tool
}

// Strings clipped so the whole input stays near the budget: enough to judge
// a command or an edit without shipping a whole file to the page.
function trimInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let left = INPUT_BUDGET
  for (const [key, value] of Object.entries(input)) {
    if (left <= 0) {
      out[key] = '…'
      continue
    }
    if (typeof value === 'string') {
      out[key] = value.length > left ? value.slice(0, left) + '…' : value
      left -= Math.min(value.length, left)
      continue
    }
    const json = JSON.stringify(value) ?? ''
    if (json.length <= left) out[key] = value
    else out[key] = json.slice(0, left) + '…'
    left -= Math.min(json.length, left)
  }
  return out
}

function questionsOf(input: Record<string, unknown>): Pending['questions'] {
  if (!Array.isArray(input.questions)) return undefined
  return input.questions
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object' && typeof q.question === 'string')
    .map(q => ({
      question: q.question as string,
      header: typeof q.header === 'string' ? q.header : undefined,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof o.label === 'string')
        .map(o => ({ label: o.label as string, description: typeof o.description === 'string' ? o.description : undefined })),
      multiSelect: q.multiSelect === true,
    }))
}

// Claude Code's "always allow" choices for a prompt (permission_suggestions:
// add a rule, accept edits for the session, open a directory…), passed back
// as updatedPermissions when the page picks "Always allow". Kept only when
// each one is something we can name on the button.
export function suggestionsOf(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && typeof s.type === 'string')
}

const WHERE: Record<string, string> = {
  session: 'this session',
  localSettings: 'this project',
  projectSettings: 'this project (shared)',
  userSettings: 'all projects',
}

// One line for the button's tooltip: "Bash(git status:*) in this project".
export function alwaysLabel(suggestions: Record<string, unknown>[]): string | undefined {
  const parts = suggestions.map(s => {
    const where = WHERE[str(s.destination)] ?? str(s.destination)
    if (s.type === 'addRules' && s.behavior === 'allow' && Array.isArray(s.rules)) {
      const rules = s.rules
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map(r => (str(r.ruleContent) ? `${str(r.toolName)}(${str(r.ruleContent)})` : str(r.toolName)))
      return rules.length ? `${rules.join(', ')} in ${where}` : ''
    }
    if (s.type === 'setMode' && s.mode === 'acceptEdits') return `Accept edits in ${where}`
    if (s.type === 'setMode') return `${str(s.mode)} mode in ${where}`
    if (s.type === 'addDirectories' && Array.isArray(s.directories)) return `Access to ${s.directories.map(str).join(', ')} in ${where}`
    return ''
  })
  return parts.length && parts.every(Boolean) ? oneLine(parts.join('; ')) : undefined
}

function reply(decision: Record<string, unknown>): HookReply {
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }
}

export class Approvals {
  private held = new Map<string, Held>()
  private onChange: () => void

  constructor(onChange: () => void) {
    this.onChange = onChange
  }

  // For a PermissionRequest event. The promise is the hook's reply; pass the
  // request's signal so a hook Claude Code cancels (answered in its own
  // window, or interrupted) leaves the page too.
  hold(ev: HookEvent, now: number, signal?: AbortSignal): Promise<HookReply> {
    const tool = str(ev.tool_name) || 'tool'
    const toolInput = ev.tool_input && typeof ev.tool_input === 'object' ? (ev.tool_input as Record<string, unknown>) : {}
    const kind: Pending['kind'] = tool === 'AskUserQuestion' ? 'question' : tool === 'ExitPlanMode' ? 'plan' : 'permission'
    const pending: Pending = {
      id: randomUUID(),
      session: ev.session_id,
      agentId: ev.agent_id,
      kind,
      tool,
      summary: summarize(tool, toolInput),
      input: trimInput(toolInput),
      at: now,
      expiresAt: now + HOLD_MS,
    }
    const suggestions = kind === 'permission' ? suggestionsOf(ev.permission_suggestions) : []
    const always = alwaysLabel(suggestions)
    if (always) pending.always = always
    if (kind === 'question') {
      pending.questions = questionsOf(toolInput)
      const first = pending.questions?.[0]?.question
      if (first) pending.summary = oneLine(first)
      // The questions are shown on their own; no need to send them twice.
      delete pending.input.questions
    }
    if (kind === 'plan') {
      pending.plan = str(toolInput.plan)
      const title = pending.plan.split('\n').find(l => l.trim())
      if (title) pending.summary = oneLine(title.replace(/^#+\s*/, ''))
      delete pending.input.plan
    }
    if (signal?.aborted) return Promise.resolve({})

    return new Promise(resolve => {
      const timer = setTimeout(() => this.settle(pending.id, {}), Math.max(0, pending.expiresAt - Date.now()))
      this.held.set(pending.id, { pending, toolInput, suggestions, resolve, timer })
      signal?.addEventListener('abort', () => this.settle(pending.id, {}), { once: true })
      this.onChange()
    })
  }

  // The page's answer. False when it is gone (decided, expired or cancelled).
  decide(id: string, decision: Decision): boolean {
    const h = this.held.get(id)
    if (!h) return false
    if (decision.behavior === 'deny') {
      const message = decision.message?.trim() || DECLINED
      return this.settle(id, reply({ behavior: 'deny', message }))
    }
    if (h.pending.kind === 'question') {
      // The tool reads the answers from its own input: the questions as asked,
      // plus question text → chosen label(s).
      const answers = decision.answers ?? {}
      return this.settle(id, reply({ behavior: 'allow', updatedInput: { ...h.toolInput, answers } }))
    }
    if (decision.always && h.pending.always) {
      return this.settle(id, reply({ behavior: 'allow', updatedInput: h.toolInput, updatedPermissions: h.suggestions }))
    }
    return this.settle(id, reply({ behavior: 'allow', updatedInput: h.toolInput }))
  }

  list(): Pending[] {
    return [...this.held.values()].map(h => h.pending).sort((a, b) => a.at - b.at)
  }

  // A session that ended has no one left to answer.
  dropSession(sessionId: string) {
    for (const [id, h] of this.held) if (h.pending.session === sessionId) this.settle(id, {})
  }

  // Every hook event, so a prompt answered somewhere else (the session's own
  // window, an SDK host) leaves the page: Claude Code doesn't cancel the hook
  // request when that happens, it just stops waiting for it.
  seen(ev: HookEvent) {
    const name = ev.hook_event_name
    if (name === 'SessionEnd') return this.dropSession(ev.session_id)
    for (const [id, h] of this.held) {
      const p = h.pending
      if (p.session !== ev.session_id) continue
      const sameAgent = (p.agentId ?? '') === (ev.agent_id ?? '')
      // The tool ran (or failed), so its prompt was answered. The input is
      // compared for plain permissions: a question's comes back with answers,
      // a plan's comes back empty.
      if ((name === 'PostToolUse' || name === 'PostToolUseFailure') && sameAgent && ev.tool_name === p.tool) {
        if (p.kind !== 'permission' || JSON.stringify(ev.tool_input) === JSON.stringify(h.toolInput)) this.settle(id, {})
        continue
      }
      // The lead's turn is over, or the person typed a new prompt: nothing it
      // asked is still waiting. Subagents' prompts end with the subagent.
      if ((name === 'Stop' || name === 'UserPromptSubmit') && !p.agentId) this.settle(id, {})
      else if (name === 'SubagentStop' && p.agentId && p.agentId === ev.agent_id) this.settle(id, {})
    }
  }

  private settle(id: string, answer: HookReply): boolean {
    const h = this.held.get(id)
    if (!h) return false
    this.held.delete(id)
    clearTimeout(h.timer)
    h.resolve(answer)
    this.onChange()
    return true
  }
}
