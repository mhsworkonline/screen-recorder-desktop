const { app, BrowserWindow, session, desktopCapturer, globalShortcut, ipcMain, Menu, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SHORTCUTS = {
  startStop: 'CommandOrControl+Alt+R',
  pause: 'CommandOrControl+Alt+P',
  cancel: 'CommandOrControl+Alt+X',
};
const DEFAULT_FILENAME_PATTERN = 'Recording-{date}-{time}';
const DEFAULT_COUNTDOWN_SECONDS = 3;
const DEFAULT_BEEP_ENABLED = true;
const SHORTCUT_ACTIONS = { startStop: 'start-stop', pause: 'pause', cancel: 'cancel' };

let win = null;
let settingsWin = null;

function readSettings(){
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
  catch (e) { raw = {}; }
  return {
    ...raw,
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(raw.shortcuts || {}) },
    outputFolder: raw.outputFolder || app.getPath('downloads'),
    filenamePattern: raw.filenamePattern || DEFAULT_FILENAME_PATTERN,
    countdownSeconds: typeof raw.countdownSeconds === 'number' ? raw.countdownSeconds : DEFAULT_COUNTDOWN_SECONDS,
    beepEnabled: typeof raw.beepEnabled === 'boolean' ? raw.beepEnabled : DEFAULT_BEEP_ENABLED,
  };
}
function writeSettings(patch){
  const merged = { ...readSettings(), ...patch };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
  broadcastSettingsChanged(merged);
  return merged;
}
function broadcastSettingsChanged(settings){
  const s = settings || readSettings();
  if (win) win.webContents.send('settings:changed', s);
  if (settingsWin) settingsWin.webContents.send('settings:changed', s);
}

function sanitizeFilename(name){
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'recording';
}
function buildFilename(pattern, ext){
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const tokens = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    count: '',
  };
  const src = pattern || DEFAULT_FILENAME_PATTERN;
  if (src.includes('{count}')){
    const next = (readSettings().recordingCount || 0) + 1;
    writeSettings({ recordingCount: next });
    tokens.count = String(next).padStart(3, '0');
  }
  const name = sanitizeFilename(src.replace(/\{(date|time|count)\}/g, (_, k) => tokens[k]));
  return `${name}.${ext}`;
}

function mapSources(sources){
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    type: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnailDataUrl: s.thumbnail ? s.thumbnail.toDataURL() : null,
    appIconDataUrl: s.appIcon ? s.appIcon.toDataURL() : null,
  }));
}

// Resolves to a callback payload for setDisplayMediaRequestHandler, showing our
// own in-app picker (via IPC round-trip to the renderer) when there's no usable
// remembered source. The renderer-side getDisplayMedia() call stays pending the
// whole time the user is looking at the picker — that's expected.
//
// Direct window capture (not screen-capture-and-crop): a screen+crop approach
// was tried here and torn back out — it fixed the GPU-rendered-window freeze
// (Chromium's GDI-based window capturer holds the first frame of windows
// like scrcpy/SDL2 that render via a swap chain) but kept finding new ways to
// fail (self-window leaking into the capture, other windows occluding the
// target, PowerShell/encoding issues) faster than they could be closed out.
// Direct window capture has exactly one known limitation — GPU-rendered
// windows freeze after the first frame — instead of a rotating set of new
// ones, which is the better trade-off for this app.
async function resolveSource(request){
  const raw = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 400, height: 250 },
    fetchWindowIcons: true,
  });

  const settings = readSettings();
  if (settings.sourceId){
    let match = raw.find(s => s.id === settings.sourceId);
    // Windows recycles window handles once the original window closes — a
    // stale remembered id can end up matching a completely different,
    // currently-open window instead of correctly failing to match at all.
    // If the id matches but the name doesn't, that's a recycled handle, not
    // our window — treat it as no match and fall through to name matching.
    if (match && settings.sourceName && match.name !== settings.sourceName) match = null;
    if (!match && settings.sourceName){
      match = raw.find(s => s.name === settings.sourceName);
      // Self-heal: adopt the window's current (fresh) id so future launches
      // resolve it directly instead of repeating this same id-mismatch
      // recovery every time.
      if (match && match.id !== settings.sourceId) writeSettings({ sourceId: match.id });
    }
    if (match){
      return { video: match, audio: request.audioRequested ? 'loopback' : undefined };
    }
    // Remembered source is gone (e.g. window closed) — fall through to re-picking.
    writeSettings({ sourceId: undefined, sourceName: undefined, sourceType: undefined });
  }

  const picked = await new Promise(resolve => {
    ipcMain.once('picker:selected', (_e, sourceId) => resolve(sourceId));
    win.webContents.send('picker:show', mapSources(raw));
  });

  if (!picked) return {}; // user cancelled the picker

  const match = raw.find(s => s.id === picked);
  if (!match) return {};
  writeSettings({
    sourceId: match.id,
    sourceName: match.name,
    sourceType: match.id.startsWith('screen:') ? 'screen' : 'window',
  });
  return { video: match, audio: request.audioRequested ? 'loopback' : undefined };
}

function createWindow(){
  win = new BrowserWindow({
    width: 480,
    height: 780,
    show: false, // maximize before first paint so there's no small→big flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // The blur-region pipeline redraws via requestAnimationFrame, which
  // Chromium throttles to near-zero once this window loses focus or is
  // minimized — keep it running at full rate regardless, so a blurred
  // recording doesn't stall just because the window isn't focused.
  win.webContents.setBackgroundThrottling(false);
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('closed', () => { win = null; });
}

function openSettingsWindow(){
  if (settingsWin){ settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 700,
    parent: win || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
    registerShortcutsFromMap(readSettings().shortcuts);
  });
}

function registerShortcutsFromMap(shortcuts){
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [key, action] of Object.entries(SHORTCUT_ACTIONS)){
    const accelerator = shortcuts[key];
    const ok = globalShortcut.register(accelerator, () => {
      if (win) win.webContents.send('shortcut', action);
    });
    if (!ok){
      failed.push(key);
      console.warn(`Could not register global shortcut ${accelerator} (${key}) — likely already in use by another app.`);
    }
  }
  return failed;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    resolveSource(request).then(callback).catch(() => callback({}));
  }, { useSystemPicker: false });

  createWindow();
  registerShortcutsFromMap(readSettings().shortcuts);

  session.defaultSession.on('will-download', (_event, item) => {
    const settings = readSettings();
    let folder = settings.outputFolder;
    try { fs.mkdirSync(folder, { recursive: true }); }
    catch (e) {
      console.warn(`Could not use output folder "${folder}", falling back to Downloads:`, e.message);
      folder = app.getPath('downloads');
    }
    const original = item.getFilename();
    const ext = original.includes('.') ? original.split('.').pop() : 'webm';
    item.setSavePath(path.join(folder, buildFilename(settings.filenamePattern, ext)));
  });

  ipcMain.handle('sources:get', async () => {
    const raw = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 400, height: 250 },
      fetchWindowIcons: true,
    });
    return mapSources(raw);
  });
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_e, patch) => writeSettings(patch));
  ipcMain.handle('settings:resetSource', () =>
    writeSettings({ sourceId: undefined, sourceName: undefined, sourceType: undefined })
  );
  ipcMain.handle('settings:getDefaults', () => ({
    shortcuts: DEFAULT_SHORTCUTS,
    outputFolder: app.getPath('downloads'),
    filenamePattern: DEFAULT_FILENAME_PATTERN,
    countdownSeconds: DEFAULT_COUNTDOWN_SECONDS,
    beepEnabled: DEFAULT_BEEP_ENABLED,
  }));
  ipcMain.handle('settings:openWindow', () => openSettingsWindow());
  // The picker UI only exists in the main window's DOM, so "Change source"
  // from the Settings window resets the stored source and hands off to the
  // main window to actually show it — creating that window first if it was
  // closed (settingsWin can outlive win; window-all-closed only quits once
  // every window is gone).
  ipcMain.handle('source:openPicker', () => {
    writeSettings({ sourceId: undefined, sourceName: undefined, sourceType: undefined });
    const send = () => { win.show(); win.focus(); win.webContents.send('source:openPicker'); };
    if (win) send();
    else { createWindow(); win.webContents.once('did-finish-load', send); }
  });
  ipcMain.handle('dialog:chooseFolder', async () => {
    const parent = settingsWin || win;
    const result = await dialog.showOpenDialog(parent, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: readSettings().outputFolder,
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('shortcuts:set', (_e, shortcuts) => {
    const accelerators = Object.values(shortcuts);
    if (new Set(accelerators).size !== accelerators.length){
      return { ok: false, error: 'Each action needs a different shortcut — two actions can\'t share one.' };
    }
    const merged = { ...DEFAULT_SHORTCUTS, ...shortcuts };
    const failed = registerShortcutsFromMap(merged);
    if (failed.length){
      // Roll back to the last-saved bindings so the app isn't left with dead shortcuts.
      registerShortcutsFromMap(readSettings().shortcuts);
      return {
        ok: false,
        error: `Could not register: ${failed.join(', ')} — that combo is likely already in use by another app.`,
        failed,
      };
    }
    writeSettings({ shortcuts: merged });
    return { ok: true };
  });
  // Used only for the few seconds renderer/settings.html is actively capturing a new
  // combo, so the old binding can't also fire while the user is pressing the new one.
  ipcMain.handle('shortcuts:suspend', () => { globalShortcut.unregisterAll(); });
  ipcMain.handle('shortcuts:resume', () => { registerShortcutsFromMap(readSettings().shortcuts); });
  ipcMain.handle('taskbar:setBadge', (_e, dataUrl) => {
    if (!win) return;
    try { win.setOverlayIcon(dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, dataUrl ? 'Recording' : ''); }
    catch (e) { console.warn('Could not set taskbar overlay icon:', e.message); }
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
