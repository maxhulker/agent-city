# Crosswalk

The user's own app (repo maxhulker/agent-city): an isometric city of every
Claude Code session on the machine, fed by HTTP hooks to a local Node server
on :4777. The README says what it does; `docs/` how.

## Two platforms, always

Crosswalk is maintained for **Windows and macOS in parallel**
(`docs/platforms.md`). Every change has to keep both working:

- Platform-specific code goes behind `process.platform` with both sides
  written, or in the few places that hold the differences (`src/notify.ts`,
  `src/detached.ts`, `desktop/main.mjs`); add a test to `test/platform.test.ts`
  where it can be checked from either machine.
- Never assume Windows paths: compare with slashes made forward and case
  folded; build Mac paths with `/`, not `path.join`.
- The development machine is Windows: the Mac is checked by CI
  (`.github/workflows/ci.yml`: tests on both, both downloads built and
  started, a picture of each window kept as an artifact: look at the Mac's).
  Don't merge a pull request until every CI job is green.
- A change to how it's packaged touches both builds: `installer/crosswalk.iss`
  with `scripts/build-installer.mjs` (Windows), and `scripts/package-app.mjs`
  (both; the Mac app can only be built on a Mac, so CI builds it).

## Working on it

- The server has no dependencies and no build step: Node 22.18+ runs the
  TypeScript as it is. `npm test` runs every test; `npm start` the server;
  `npm run demo` adds the demo city. The desktop app is Electron
  (`desktop/main.mjs`, a devDependency): `npm install` once, then
  `npm run app`. Keep the server free of dependencies.
- Internal ids still say "agent-city" (headers, env vars, `~/.agent-city`,
  the package and repo names): only the visible name is Crosswalk.
- Test against a server of your own (`AGENT_CITY_PORT` and a temporary
  `HOME`/`USERPROFILE`), never the user's running one on :4777. Electron on
  Windows also needs `APPDATA` and `LOCALAPPDATA` under that temporary home,
  or it exits silently with code 3.
