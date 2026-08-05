# Screen Recorder (Electron desktop app)

Standalone Windows desktop screen recorder. **This is a fully separate project from `../utility-app`** (the Next.js web app that also hosts a browser-based screen recorder at `public/screen-recorder.html`). They share no code, no `package.json`, no `node_modules`, and no build pipeline — do not add cross-references, symlinks, or shared imports between the two. Changes here must never require touching `../utility-app`, and vice versa.

The web version exists because browsers force a picker dialog on every `getDisplayMedia()` call and only allow page-scoped keyboard shortcuts. This app exists specifically to do the two things the browser can't: remember an exact recording source with zero dialog, and register true global (system-wide) hotkeys. If a future request could be satisfied entirely inside a browser tab, it probably belongs in the web version instead of here.

## Run / build

```
npm start          # launch in dev mode (electron .)
npm run pack        # unpacked build → release/win-unpacked/
npm run dist         # portable .exe → release/*.exe (runs the app directly, no installer wizard)
npm run release      # node start.js — builds the portable .exe AND launches it
```

## Architecture

- `main.js` — the only place with Node/OS access. Owns:
  - `session.defaultSession.setDisplayMediaRequestHandler(handler, { useSystemPicker: false })` — intercepts every renderer `getDisplayMedia()` call. Resolves the remembered source (`settings.json`'s `sourceId`, falling back to matching by `sourceName` if the id went stale) and calls back with **zero dialog**. If nothing is remembered or the match fails, sends the fresh `desktopCapturer` source list to the renderer via `picker:show` and waits on a one-shot `ipcMain.once('picker:selected', ...)` for the user's pick before calling back. Do not set `useSystemPicker: true` — that reintroduces the native dialog we're specifically avoiding.
  - `desktopCapturer.getSources()` results must be mapped through `.thumbnail.toDataURL()` / `.appIcon.toDataURL()` before crossing IPC — a `NativeImage` doesn't survive structured-clone.
  - Settings persistence: plain JSON at `app.getPath('userData')/settings.json`, read/written directly via `fs` (`readSettings`/`writeSettings`). No `electron-store` — not worth the dependency for a flat key/value file this small.
  - `globalShortcut.register(...)` for `Ctrl+Alt+R` (start/stop), `Ctrl+Alt+P` (pause/resume), `Ctrl+Alt+X` (cancel). These are deliberately **not** `Ctrl+Shift+R`/`Ctrl+1-3` — those get intercepted by browsers (hard-refresh, tab-switch) and would break them system-wide for as long as this app is running. If you ever add/change a global shortcut, check it isn't already OS-reserved (e.g. `Win+Alt+R` is Xbox Game Bar's own recorder toggle) before picking it.
  - `setPermissionRequestHandler` allow-listing only `'media'` — defense-in-depth; Electron's real default is to *allow* most permission requests, this isn't what blocks anything by default.
- `preload.js` — `contextBridge.exposeInMainWorld('recorderAPI', {...})` only. `BrowserWindow` is created with `contextIsolation: true, nodeIntegration: false, sandbox: true`; with `sandbox: true` the preload script itself cannot `require('fs')` or similar, so it must stay a thin IPC wrapper — any new capability the renderer needs goes through a new `ipcMain.handle`/`ipcRenderer.invoke` pair here and in `main.js`, never by loosening sandbox/contextIsolation.
- `renderer/index.html` — single-file UI + script (no framework, no bundler, matches the style of the web version's tools). MediaRecorder/audio-mixing/timer/floating-badge/toast/beep logic is source-agnostic and works the same regardless of how the `MediaStream` was obtained — that part was ported from the web version close to verbatim. What's different from the web version: no `displaySurface` hint modal (replaced by the real thumbnail-grid picker fed by `desktopCapturer`), no "Browser Tab" option (Electron has no tabs), settings read/written via `window.recorderAPI.getSettings()/setSettings()` instead of `localStorage`, plus the additive `window.recorderAPI.onShortcut()` handler for the global hotkeys on top of the existing focused-window `R`/`P`/`Esc` keydown listener.
- `start.js` — convenience script (`npm run release`) that runs `electron-builder --win portable` then spawns the resulting self-contained `.exe` from `release/`. The build target is `portable` (set in `package.json`'s `build.win.target`), not `nsis` — double-clicking the output `.exe` launches the app immediately, with no installer wizard and nothing written outside itself.

## Known environment quirk (not a bug)

If a sandboxed/CI shell has `ELECTRON_RUN_AS_NODE=1` set, `electron .` will run `main.js` under plain Node instead of the real Electron runtime — `require('electron')` returns a path string instead of the API, and `app`/`BrowserWindow` will be `undefined`. That's the shell's env, not the app; unset it (`env -u ELECTRON_RUN_AS_NODE electron .`) to actually launch the GUI.

## Scope notes

No tray icon, no minimize-to-tray, no auto-updater, no code signing, no custom app icon, no `dialog.showSaveDialog` Save-As flow (recordings save silently to the OS Downloads folder, same as the web version), no `requestSingleInstanceLock`. These were deliberate omissions to keep this a small single-purpose tool — don't add them speculatively; add them if/when actually requested.
