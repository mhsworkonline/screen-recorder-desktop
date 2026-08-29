const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorderAPI', {
  getSources: () => ipcRenderer.invoke('sources:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getDefaults: () => ipcRenderer.invoke('settings:getDefaults'),
  resetSource: () => ipcRenderer.invoke('settings:resetSource'),
  openSettings: () => ipcRenderer.invoke('settings:openWindow'),
  openSourcePicker: () => ipcRenderer.invoke('source:openPicker'),
  onOpenSourcePicker: (cb) => ipcRenderer.on('source:openPicker', () => cb()),
  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  setShortcuts: (shortcuts) => ipcRenderer.invoke('shortcuts:set', shortcuts),
  suspendShortcuts: () => ipcRenderer.invoke('shortcuts:suspend'),
  resumeShortcuts: () => ipcRenderer.invoke('shortcuts:resume'),
  setTaskbarBadge: (dataUrl) => ipcRenderer.invoke('taskbar:setBadge', dataUrl),
  pickerSelect: (sourceId) => ipcRenderer.send('picker:selected', sourceId),
  onPickerShow: (cb) => ipcRenderer.on('picker:show', (_e, sources) => cb(sources)),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, action) => cb(action)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, settings) => cb(settings)),
});
