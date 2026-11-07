import type { Census, Site } from './types.ts'
import { shippedOf } from './deploys.ts'
import type { Shipped } from './deploys.ts'

// A project's construction site: the lifecycle of its work, as a builder
// would see it. A branch other than the main one is a permit applied for; a
// pull request filed for it is the permit; a test run (or a pull request's
// checks) is an inspection, passed or failed; a pull request merged is the
// ribbon cut on what was built. All of it is read from the sessions' own
// shell commands and what they printed, like the commits and pushes the
// Harbor Statue marks.

// How long each part of a site shows on its board.
export const PERMIT_MS = 14 * 24 * 3600_000
export const INSPECTION_MS = 6 * 3600_000
export const OPENED_MS = 30 * 60_000
// The ribbon cutting itself: the ribbon across the square, and confetti.
export const RIBBON_MS = 2 * 60_000
// A test run's or a CI wait's verdict, a tick or a cross over its agent's head.
export const VERDICT_MS = 6_000

const MAIN_BRANCHES = /^(main|master|trunk|develop|HEAD)$/

export const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/
const PR_CREATE = /\bgh\s+pr\s+create\b/
const PR_MERGE = /\bgh\s+pr\s+merge\b([^;&|]*)/
const PR_CHECKS = /\bgh\s+pr\s+checks\b/
// A test runner at the start of one of a command's parts (so `cat jest.config.js` is not one).
const TEST_RUNNER =
  /^(?:\w+=\S*\s+)*(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::\S+)?\b|node\s+--test\b|(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+|bunx\s+)?(?:vitest|jest|mocha|playwright\s+test)\b|(?:python3?\s+-m\s+|uv\s+run\s+)?pytest\b|go\s+test\b|cargo\s+test\b|deno\s+test\b|dotnet\s+test\b)/

// The text a tool call printed: a shell's stdout and stderr, or whatever it gave.
export function outputOf(response: unknown): string {
  if (typeof response === 'string') return response
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>
    const parts = [r.stdout, r.stderr, r.output, r.error].filter((x): x is string => typeof x === 'string')
    if (parts.length) return parts.join('\n')
  }
  try {
    return JSON.stringify(response ?? '')
  } catch {
    return ''
  }
}

// A command's parts, split at &&, ||, ; and |, each trimmed, with a leading
// `cd somewhere` left as its own part.
function parts(code: string): string[] {
  return code
    .split(/&&|\|\||;|\||\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function isTestRun(code: string): boolean {
  return parts(code).some(p => TEST_RUNNER.test(p))
}

// Waiting on CI, at the start of a command part (after any VAR=value, a
// loop's `until` or `while`, or a `watch`): a workflow run watched or looked
// at, or a pull request's checks. Reading a run's logs, or opening it in the
// browser, is not waiting on it.
const CI_WAIT =
  /^(?:\w+=(?:\$\([^)]*\)|\S*)\s+)*(?:(?:until|while|if|then|do|!|time|watch(?:\s+-n\s*\S+)?|timeout\s+\S+)\s+)*gh\s+(?:run\s+(?:watch|view)|pr\s+checks)\b/
const CI_LOOK = /\s--(?:log|log-failed|web)\b/

export function isCiWait(code: string): boolean {
  return parts(code).some(p => CI_WAIT.test(p) && !CI_LOOK.test(p))
}

// What a shell command waits on, if it waits on tests: a test run, or CI.
export type TestWait = 'tests' | 'ci'
export function testWaitOf(code: string): TestWait | undefined {
  return isTestRun(code) ? 'tests' : isCiWait(code) ? 'ci' : undefined
}

const num = (re: RegExp, text: string): number | undefined => {
  const m = re.exec(text)
  return m ? Number(m[1]) : undefined
}

// What an inspection found, from a test run's output (or a pull request's
// checks); undefined when the output doesn't say (cut off, or no summary).
export function verdictOf(text: string, failed: boolean, isChecks = false): { passed: boolean; detail?: string } | undefined {
  if (isChecks) {
    if (/Some checks were not successful|\bfail(?:ed|ure)?\t/i.test(text)) return { passed: false, detail: 'checks failed' }
    if (/All checks were successful/i.test(text) || (/\bpass\t/.test(text) && !/\bpending\t/.test(text))) return { passed: true, detail: 'checks passed' }
    // A workflow run watched to its end (`gh run watch`), or its conclusion asked for.
    if (/completed with '?(?:failure|cancelled|timed_out|startup_failure)\b|"conclusion":\s*"(?:failure|cancelled|timed_out|startup_failure)"/.test(text)) return { passed: false, detail: 'CI failed' }
    if (/completed with '?success\b|"conclusion":\s*"success"/.test(text)) return { passed: true, detail: 'CI passed' }
    // Still pending: `gh pr checks` exits non-zero while it waits, which is no failure.
    if (/\bpending\t|\b(?:in_progress|queued)\b|still pending/i.test(text)) return undefined
    return failed ? { passed: false, detail: 'checks failed' } : undefined
  }
  const failCount =
    num(/ℹ fail (\d+)/, text) ??
    num(/test result: \w+\. \d+ passed; (\d+) failed/, text) ??
    num(/\b(\d+) (?:failed|failing)\b/i, text)
  const passCount =
    num(/ℹ pass (\d+)/, text) ??
    num(/test result: \w+\. (\d+) passed/, text) ??
    num(/\b(\d+) (?:passed|passing)\b/i, text)
  const saysFail = /(?:^|\n)(?:FAIL\b|--- FAIL)|test result: FAILED|npm ERR! Test failed|Tests failed|FAILED \(/.test(text)
  if (failed || (failCount ?? 0) > 0 || saysFail) {
    return failCount ? { passed: false, detail: `${failCount} failed` } : { passed: false }
  }
  if ((passCount ?? 0) > 0 || /(?:^|\n)ok\s|test result: ok/.test(text)) {
    return passCount ? { passed: true, detail: `${passCount} passed` } : { passed: true }
  }
  return undefined
}

// What a finished shell command means for its project's site, if anything.
export type SiteEvent =
  | { kind: 'permit'; pr: number; url: string }
  | { kind: 'inspection'; passed: boolean; what: string; detail?: string }
  | { kind: 'opened'; pr?: number; url?: string }
  | Shipped

export function siteEventOf(code: string, output: string, failed: boolean): SiteEvent | undefined {
  if (PR_CREATE.test(code)) {
    if (failed) return undefined
    const m = PR_URL.exec(output)
    return m ? { kind: 'permit', pr: Number(m[1]), url: m[0] } : undefined
  }
  const merge = PR_MERGE.exec(code)
  if (merge) {
    if (failed || /\b(?:failed|not mergeable|could not|GraphQL|error)\b/i.test(output)) return undefined
    const url = PR_URL.exec(merge[1] ?? '')
    const arg = /(?:^|\s)#?(\d+)(?=\s|$)/.exec(merge[1] ?? '')
    const said = /[Mm]erged pull request [\w./-]*#(\d+)/.exec(output)
    const pr = url ? Number(url[1]) : arg ? Number(arg[1]) : said ? Number(said[1]) : undefined
    return { kind: 'opened', ...(pr ? { pr } : {}), ...(url ? { url: url[0] } : {}) }
  }
  const isChecks = PR_CHECKS.test(code) || isCiWait(code)
  if (isChecks || isTestRun(code)) {
    const v = verdictOf(output, failed, isChecks)
    if (!v) return undefined
    return { kind: 'inspection', passed: v.passed, what: isChecks ? 'checks' : 'tests', ...(v.detail ? { detail: v.detail } : {}) }
  }
  // A deploy: the project ships (src/deploys.ts).
  return shippedOf(code, output, failed)
}

// The branch a census says is checked out, when it isn't the main one: work
// under way that has applied for a permit.
export function branchAtWork(census: Census | undefined): string | undefined {
  const b = census?.branch
  return b && !MAIN_BRANCHES.test(b) ? b : undefined
}

// Applies an event to a project's site (made if it has none), returning it.
export function applySiteEvent(site: Site, e: SiteEvent, branch: string | undefined, now: number): Site {
  if (e.kind === 'permit') site.permit = { pr: e.pr, url: e.url, ...(branch ? { branch } : {}), at: now }
  else if (e.kind === 'inspection') site.inspection = { at: now, passed: e.passed, what: e.what, ...(e.detail ? { detail: e.detail } : {}) }
  else if (e.kind === 'shipped') site.shipped = { at: now, target: e.target, prod: e.prod, ...(e.url ? { url: e.url } : {}), ...(e.version ? { version: e.version } : {}) }
  else {
    const pr = e.pr ?? site.permit?.pr
    const url = e.url ?? (site.permit && (!e.pr || e.pr === site.permit.pr) ? site.permit.url : undefined)
    site.opened = { at: now, ...(pr ? { pr } : {}), ...(url ? { url } : {}) }
    // The permit is used up once its work is open.
    if (!site.permit || !pr || site.permit.pr === pr) delete site.permit
  }
  return site
}

// What a site's board shows now, or undefined when there is nothing to show.
export type Board = {
  // 'open' just after a ribbon cutting; 'permit' with a pull request filed;
  // 'pending' for a branch at work with none; 'office' for an inspection alone.
  stage: 'open' | 'permit' | 'pending' | 'office'
  pr?: number
  url?: string
  branch?: string
  inspection?: Site['inspection']
  // The ribbon is being cut now.
  ribbon: boolean
}

export function boardOf(site: Site | undefined, census: Census | undefined, now: number): Board | undefined {
  const branch = branchAtWork(census)
  const opened = site?.opened && now - site.opened.at < OPENED_MS ? site.opened : undefined
  const permit = site?.permit && now - site.permit.at < PERMIT_MS ? site.permit : undefined
  // An inspection of work since opened, and recent.
  const inspection =
    site?.inspection && now - site.inspection.at < INSPECTION_MS && !(site.opened && site.opened.at >= site.inspection.at) ? site.inspection : undefined
  const ribbon = !!opened && now - opened.at < RIBBON_MS
  if (opened && !permit) {
    return { stage: 'open', ...(opened.pr ? { pr: opened.pr } : {}), ...(opened.url ? { url: opened.url } : {}), ribbon }
  }
  if (permit) return { stage: 'permit', pr: permit.pr, url: permit.url, ...((permit.branch ?? branch) ? { branch: permit.branch ?? branch } : {}), ...(inspection ? { inspection } : {}), ribbon }
  if (branch) return { stage: 'pending', branch, ...(inspection ? { inspection } : {}), ribbon }
  if (inspection) return { stage: 'office', inspection, ribbon }
  return undefined
}
