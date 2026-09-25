'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, dialog, shell, net, session } = require('electron');
const { YtDlpManager, runDownload, getFfmpegPath } = require('./downloader');
const { toNetscapeCookies } = require('./args');

// Uygulama içi giriş için kalıcı, ayrı bir tarayıcı oturumu
const LOGIN_PARTITION = 'persist:mnz-login';
const LOGIN_SITES = {
  instagram: 'https://www.instagram.com/accounts/login/',
  youtube: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
  x: 'https://x.com/i/flow/login',
  tiktok: 'https://www.tiktok.com/login',
  facebook: 'https://www.facebook.com/login',
};
let loginWin = null;

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
  cookiesPath: '',
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

// ---------------------------------------------------------------- giriş / çerezler
const loginSession = () => session.fromPartition(LOGIN_PARTITION);

/** Sitelerin "güvensiz tarayıcı" uyarısı vermemesi için düz Chrome kimliği kullan. */
function chromeUserAgent() {
  const os =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

function openLogin(site) {
  const url = LOGIN_SITES[site];
  if (!url) return;
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.loadURL(url);
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 1000,
    height: 760,
    parent: win,
    title: 'Giriş yap — pencereyi kapatınca oturum kaydedilir',
    autoHideMenuBar: true,
    webPreferences: { partition: LOGIN_PARTITION, sandbox: true, contextIsolation: true },
  });
  loginWin.removeMenu();
  loginWin.webContents.setWindowOpenHandler(() => ({
    action: 'allow', // "Google ile giriş" gibi açılır pencereler aynı oturumda açılsın
    overrideBrowserWindowOptions: {
      parent: loginWin,
      autoHideMenuBar: true,
      webPreferences: { partition: LOGIN_PARTITION, sandbox: true, contextIsolation: true },
    },
  }));
  loginWin.on('page-title-updated', (e) => e.preventDefault());
  loginWin.on('closed', async () => {
    loginWin = null;
    send('login:status', await loginStatus());
  });
  loginWin.loadURL(url);
}

/** Hangi sitelere giriş yapılmış olduğunu (oturum çerezi var mı) döndürür. */
async function loginStatus() {
  const markers = {
    instagram: ['instagram.com', 'sessionid'],
    youtube: ['youtube.com', 'SAPISID'],
    x: ['x.com', 'auth_token'],
    tiktok: ['tiktok.com', 'sessionid'],
    facebook: ['facebook.com', 'c_user'],
  };
  const cookies = await loginSession().cookies.get({});
  const sites = Object.keys(markers).filter((k) => {
    const [domain, name] = markers[k];
    return cookies.some((c) => c.name === name && c.domain.replace(/^\./, '').endsWith(domain));
  });
  return { sites, count: cookies.length };
}

/** Uygulama içi oturumun çerezlerini geçici bir cookies.txt'ye yazar. */
async function exportLoginCookies() {
  const cookies = await loginSession().cookies.get({});
  if (!cookies.length) return null;
  const file = path.join(app.getPath('userData'), 'session-cookies.txt');
  fs.writeFileSync(file, toNetscapeCookies(cookies), { mode: 0o600 });
  return file;
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

ipcMain.handle('login:open', (_e, site) => openLogin(site));
ipcMain.handle('login:status', () => loginStatus());
ipcMain.handle('login:clear', async () => {
  await loginSession().clearStorageData();
  return loginStatus();
});
ipcMain.handle('dialog:cookiesFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'cookies.txt dosyasını seçin',
    properties: ['openFile'],
    filters: [{ name: 'Çerez dosyası', extensions: ['txt'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

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

  // Çerez kaynağını hazırla
  let cookiesFile = null;
  let tempCookies = null;
  if (options.browser === 'app') {
    tempCookies = cookiesFile = await exportLoginCookies();
    if (!cookiesFile) {
      return { ok: false, message: 'Uygulama içi oturum boş. Önce "Giriş yap" ile siteye giriş yapın.' };
    }
  } else if (options.browser === 'file') {
    if (!options.cookiesPath || !fs.existsSync(options.cookiesPath)) {
      return { ok: false, message: 'cookies.txt dosyası seçilmedi ya da bulunamadı.' };
    }
    cookiesFile = options.cookiesPath;
  }

  for (const job of jobs) {
    if (stopQueue) {
      send('job:update', { id: job.id, state: 'cancelled' });
      continue;
    }
    send('job:update', { id: job.id, state: 'running' });

    let dl;
    try {
      dl = runDownload(manager.binPath, { ...options, cookiesFile, url: job.url }, (ev) =>
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
  if (tempCookies) fs.rm(tempCookies, { force: true }, () => {});
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
    loginSession().setUserAgent(chromeUserAgent());
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
