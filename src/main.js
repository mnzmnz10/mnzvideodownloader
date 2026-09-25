'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const { YtDlpManager, runDownload, getFfmpegPath } = require('./downloader');

let win = null;
let manager = null;
let current = null; // çalışan indirme { id, cancel }
let stopQueue = false;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = () => ({
  mode: 'mp4',
  quality: '1080',
  bitrate: '320',
  outDir: app.getPath('downloads'),
  playlist: false,
  h264: true,
  thumbnail: true,
  browser: 'none',
});

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS(), ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return DEFAULT_SETTINGS();
  }
}

function saveSettings(s) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  } catch {
    // ayar kaydedilemezse indirmeyi engellemeye gerek yok
  }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 640,
    minHeight: 560,
    title: 'MNZ Video Downloader',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Uygulama içinden dış bağlantı açılmasın; varsayılan tarayıcıda açılsın
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function prepareEngine() {
  return manager
    .ensure((msg) => send('engine:status', { state: 'busy', message: msg }))
    .then((version) => {
      send('engine:status', { state: 'ready', message: `Hazır • yt-dlp ${version}` });
      return true;
    })
    .catch((err) => {
      send('engine:status', {
        state: 'error',
        message: `İndirme motoru hazırlanamadı: ${err.message}. İnternet bağlantınızı kontrol edin.`,
      });
      return false;
    });
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, s) => saveSettings({ ...loadSettings(), ...s }));

ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: loadSettings().outDir,
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:openFolder', (_e, dir) => (dir && fs.existsSync(dir) ? shell.openPath(dir) : null));
ipcMain.handle('shell:showFile', (_e, file) => file && fs.existsSync(file) && shell.showItemInFolder(file));
ipcMain.handle('engine:retry', () => prepareEngine());

/**
 * Kuyruğu sırayla indirir.
 * jobs: [{ id, url }], options: arayüz ayarları
 */
ipcMain.handle('download:start', async (_e, { jobs, options }) => {
  if (current) return { ok: false, message: 'Zaten bir indirme sürüyor.' };
  if (!(await prepareEngine())) return { ok: false, message: 'İndirme motoru hazır değil.' };

  try {
    fs.mkdirSync(options.outDir, { recursive: true });
  } catch (err) {
    return { ok: false, message: `Klasör oluşturulamadı: ${err.message}` };
  }
  saveSettings(options);
  stopQueue = false;

  for (const job of jobs) {
    if (stopQueue) {
      send('job:update', { id: job.id, state: 'cancelled' });
      continue;
    }
    send('job:update', { id: job.id, state: 'running' });

    let dl;
    try {
      dl = runDownload(manager.binPath, { ...options, url: job.url }, (ev) =>
        send('job:event', { id: job.id, ...ev }),
      );
    } catch (err) {
      send('job:update', { id: job.id, state: 'error', errors: [err.message] });
      continue;
    }
    current = { id: job.id, cancel: dl.cancel };
    const r = await dl.promise;
    current = null;

    let state = 'done';
    if (r.cancelled) state = 'cancelled';
    else if (r.code !== 0 && r.files.length === 0) state = 'error';
    else if (r.code !== 0) state = 'partial'; // listede bazı öğeler başarısız
    send('job:update', { id: job.id, state, files: r.files, errors: r.errors });
  }
  return { ok: true };
});

ipcMain.handle('download:cancel', () => {
  stopQueue = true;
  if (current) current.cancel();
});

// ---------------------------------------------------------------- app
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    manager = new YtDlpManager(path.join(app.getPath('userData'), 'bin'), (url) => net.fetch(url));
    if (!getFfmpegPath()) console.warn('ffmpeg bulunamadı');
    createWindow();
    win.webContents.once('did-finish-load', () => prepareEngine());
  });

  app.on('window-all-closed', () => {
    stopQueue = true;
    if (current) current.cancel();
    app.quit();
  });
}
