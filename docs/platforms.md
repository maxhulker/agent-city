# Windows and macOS

Crosswalk ships for both, kept working in parallel:

- **Windows** 10 and 11, x64: `Crosswalk-Setup-<version>.exe`, an installer.
- **macOS** 13.5 or later, Apple silicon and Intel: `Crosswalk-<version>-mac.zip`,
  holding `Crosswalk.app`.

Both are the same desktop app (Electron, `desktop/main.mjs`): a window of
its own with its own name and icon, drawn by the same Chromium engine on
both, and the server run by Electron's own Node. Neither needs anything
installed but Claude Code (and git, for borough houses).

## Keeping both working

- **CI is the gate** (`.github/workflows/ci.yml`). Every pull request and
  every push to main runs the tests on Windows and on a Mac, builds both
  downloads, installs and starts the Windows one (then uninstalls it), and
  unzips and starts the Mac one: natively, opened twice through Launch
  Services as a double-click is, and under Rosetta as an Intel Mac. Each job
  also takes a picture of the app's window (artifacts **window-windows**
  and **window-mac**: look at the Mac one, since nobody here has a Mac).
  Merge only when every job is green. Both downloads are kept on the run as
  artifacts (**Crosswalk-windows**, **Crosswalk-mac**).
- **What differs between them is small and kept in a few places**, each with
  both sides written:

  | What | Windows | macOS | Where |
  |---|---|---|---|
  | Desktop notifications | a toast through PowerShell (a click opens the city) | AppleScript's `display notification` (a click opens nothing) | `src/notify.ts` |
  | Restarting the server on its own | WMI (`Win32_Process.Create`) | `sh -c … &`, detached | `src/detached.ts` |
  | Starting `claude` | through the shell (`claude.cmd`) | directly | `src/sessions.ts`, `src/tasks.ts` |
  | The menu bar | hidden (its shortcuts still work) | the Mac's own, with the app menu and Edit | `desktop/main.mjs` |
  | The download | Inno Setup installer (`installer/crosswalk.iss`) | `Crosswalk.app` in a zip, signed ad hoc | `scripts/package-app.mjs` |
  | Launch scripts for working on Crosswalk itself | `scripts/*.ps1` (desktop shortcut, start at login) | none: `npm run app` | |

- **Paths**: never assume backslashes. Compare paths with slashes made
  forward (`split('\\').join('/')`) and case folded, as `same()` does, and
  build Mac paths with `/` (not `path.join`, which uses `\` when the code
  runs on Windows, as the tests do).
- **New platform-specific code** goes behind `process.platform` with both
  sides, or in one of the places above, with a test in
  `test/platform.test.ts` where it can be checked from either machine.

## Building the downloads

`npm install` first (Electron and its packager; the server itself needs
nothing). Each download is built on its own system:

| | Command | Runs on | Needs |
|---|---|---|---|
| Windows installer | `npm run build:installer` | Windows | Inno Setup 6 (`winget install JRSoftware.InnoSetup --scope user`) |
| Mac app | `npm run build:mac` | a Mac | nothing more (`codesign` and `ditto` come with macOS) |

Both land in `dist/`. CI builds both on every run, so the Mac app comes from
the latest green run's **Crosswalk-mac** artifact. The version is
`package.json`'s: raise it before a release so an installed Windows copy
upgrades in place.

## Opening the Mac app the first time

It isn't signed with an Apple Developer ID yet, so macOS stops it once:

1. Unzip `Crosswalk-<version>-mac.zip` and drag **Crosswalk** into
   **Applications**.
2. Open it. macOS says it can't check it; click **Done**.
3. Open **System Settings > Privacy & Security**, scroll down to "Crosswalk
   was blocked…", click **Open Anyway** and confirm.

After that it opens like any app. (In Terminal, `xattr -dr
com.apple.quarantine /Applications/Crosswalk.app` does the same.) Signing
and notarising with an Apple Developer account ($99 a year) removes this;
on Windows a code-signing certificate does the same for SmartScreen.

Opening it again while it runs brings its window forward. Closing the
window quits Crosswalk and stops its server. `~/.agent-city/app.log` has
what it printed.

Builds before 0.2.0 opened the city in a browser's app mode instead; on
0.1.0, opening it a second time said "the application is not responding"
(quit `node-arm64` or `node-x64` in Activity Monitor). 0.2.0 replaces them.

## Checking a Mac build by hand

CI starts the Mac app and takes a picture of its window, but nobody there
uses it. On a real Mac, once per release:

1. It opens (after the first-time steps above), the city shows in a window
   of its own, and Crosswalk is in the Dock and the menu bar.
2. **Watch a demo city** on the welcome card plays: landmarks go up, two
   boroughs arrive, one branches off as a section.
3. With Claude Code installed: **Connect Claude Code** says it changed
   `~/.claude/settings.json`; a new `claude` session in a terminal arrives
   by train, and its work shows up in the city.
4. A borough's houses appear for a git repository the session works in.
5. Copy and paste work in the conversation box (Cmd-C, Cmd-V).
6. Opening Crosswalk again from the Dock or Finder brings its window back.
7. Quitting it (Cmd-Q, or closing the window) leaves nothing running in
   Activity Monitor.
8. **Disconnect** on the Blueprints card takes the hooks out again.

Anything that fails: `~/.agent-city/app.log` and a screenshot.
