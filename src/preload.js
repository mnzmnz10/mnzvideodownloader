'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('mnz', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  chooseFolder: () => ipcRenderer.invoke('dialog:folder'),
  openFolder: (dir) => ipcRenderer.invoke('shell:openFolder', dir),
  showFile: (file) => ipcRenderer.invoke('shell:showFile', file),
  retryEngine: () => ipcRenderer.invoke('engine:retry'),
  start: (jobs, options) => ipcRenderer.invoke('download:start', { jobs, options }),
  cancel: () => ipcRenderer.invoke('download:cancel'),
  onEngineStatus: listen('engine:status'),
  onJobUpdate: listen('job:update'),
  onJobEvent: listen('job:event'),
});
