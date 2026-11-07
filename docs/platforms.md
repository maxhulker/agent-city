# Windows and macOS

Crosswalk ships for both, kept working in parallel:

- **Windows** 10 and 11, x64: `Crosswalk-Setup-<version>.exe`, an installer.
- **macOS** 13.5 or later, Apple silicon and Intel: `Crosswalk-<version>-mac.zip`,
  holding `Crosswalk.app`.

Both carry their own Node (the version that built them), so neither needs
anything installed but Claude Code (and git, for borough houses).

## Keeping both working

- **CI is the gate** (`.github/workflows/ci.yml`). Every pull request and
  every push to main runs the tests on Windows and on a Mac, builds both
  downloads, installs and starts the Windows one (then uninstalls it), and
  unzips and starts the Mac one, natively and under Rosetta as an Intel Mac.
  Merge only when every job is green. Both downloads are kept on the run as
  artifacts (**Crosswalk-windows**, **Crosswalk-mac**).
- **What differs between them is small and kept in a few places**, each with
  both sides written:

  | What | Windows | macOS | Where |
  |---|---|---|---|
  | The city's own window | Edge in app mode | Chrome, Edge, Brave or Chromium in app mode, else the default browser | `src/browser.ts` |
  | Desktop notifications | a toast through PowerShell (a click opens the city) | AppleScript's `display notification` (a click opens nothing) | `src/notify.ts` |
  | Restarting the server on its own | WMI (`Win32_Process.Create`) | `sh -c … &`, detached | `src/detached.ts` |
  | Starting `claude` | through the shell (`claude.cmd`) | directly | `src/sessions.ts`, `src/tasks.ts` |
  | The download | Inno Setup installer (`installer/crosswalk.iss`) | `Crosswalk.app` in a zip (`scripts/build-mac.mjs`) | |
  | Launch scripts for working on Crosswalk itself | `scripts/*.ps1` (desktop shortcut, start at login) | none yet: `npm run app` | |

- **Paths**: never assume backslashes. Compare paths with slashes made
  forward (`split('\\').join('/')`) and case folded, as `same()` does, and
  build Mac paths with `/` (not `path.join`, which uses `\` when the code
  runs on Windows, as the tests do).
- **New platform-specific code** goes behind `process.platform` with both
  sides, or in one of the places above, with a test in
  `test/platform.test.ts` where it can be checked from either machine.

## Building the downloads

| | Command | Runs on | Needs |
|---|---|---|---|
| Windows installer | `npm run build:installer` | Windows | Inno Setup 6 (`winget install JRSoftware.InnoSetup --scope user`) |
| Mac app | `npm run build:mac` | any machine | the internet (Node for macOS comes from nodejs.org, checksums checked; cached in `dist/.cache`) |

Both land in `dist/`. The version is `package.json`'s: raise it before a
release so an installed Windows copy upgrades in place. Or take both from
the latest green CI run on main.

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

On the Mac the city opens in Chrome, Edge or Brave's app mode when one is
installed (a window of its own with its own Dock icon), else in a tab of the
default browser. Closing that window quits Crosswalk after ten seconds.
`~/.agent-city/app.log` has what it printed.

## Checking a Mac build by hand

CI starts the Mac app but can't look at it. On a real Mac, once per release:

1. It opens (after the first-time steps above) and the city shows in a
   window of its own.
2. **Watch a demo city** on the welcome card plays: landmarks go up, two
   boroughs arrive, one branches off as a section.
3. With Claude Code installed: **Connect Claude Code** says it changed
   `~/.claude/settings.json`; a new `claude` session in a terminal arrives
   by train, and its work shows up in the city.
4. A borough's houses appear for a git repository the session works in.
5. A desktop notification shows when an update is ready (if one is).
6. Closing the window quits Crosswalk (Activity Monitor: no `node-arm64`
   or `node-x64` after ten seconds).
7. **Disconnect** on the Blueprints card takes the hooks out again.

Anything that fails: `~/.agent-city/app.log` and a screenshot.
