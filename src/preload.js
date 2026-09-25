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
  openLogin: (site) => ipcRenderer.invoke('login:open', site),
  loginStatus: () => ipcRenderer.invoke('login:status'),
  clearLogin: () => ipcRenderer.invoke('login:clear'),
  chooseCookiesFile: () => ipcRenderer.invoke('dialog:cookiesFile'),
  onLoginStatus: listen('login:status'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: listen('update:status'),
  start: (jobs, options) => ipcRenderer.invoke('download:start', { jobs, options }),
  cancel: () => ipcRenderer.invoke('download:cancel'),
  onEngineStatus: listen('engine:status'),
  onJobUpdate: listen('job:update'),
  onJobEvent: listen('job:event'),
});
