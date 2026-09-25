'use strict';

const { app, shell } = require('electron');

const RELEASES_URL = 'https://github.com/mnzmnz10/mnzvideodownloader/releases/latest';
const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 saat

/**
 * GitHub Releases üzerinden otomatik güncelleme.
 * - Kurulum (NSIS) sürümü: yeni sürümü arka planda indirir, kapanışta ya da
 *   "Yeniden başlat" ile kurar.
 * - Portable sürüm kendini güncelleyemez: yalnızca yeni sürüm olduğunu bildirir.
 * @param {(status: object) => void} send arayüze durum bildirir
 */
function setupUpdater(send) {
  if (!app.isPackaged) return { install: () => {}, check: () => {} };

  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return { install: () => {}, check: () => {} };
  }

  autoUpdater.autoDownload = !portable;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  let last = null;
  const emit = (s) => {
    last = s;
    send(s);
  };

  autoUpdater.on('update-available', (info) => {
    emit(
      portable
        ? { state: 'available-portable', version: info.version }
        : { state: 'downloading', version: info.version, percent: 0 },
    );
  });
  autoUpdater.on('download-progress', (p) => {
    emit({ state: 'downloading', version: last?.version, percent: p.percent || 0 });
  });
  autoUpdater.on('update-downloaded', (info) => {
    emit({ state: 'ready', version: info.version });
  });
  autoUpdater.on('error', () => {
    // Ağ yoksa ya da GitHub'a ulaşılamazsa sessizce geç; bir sonraki kontrolde tekrar denenir
    if (last?.state === 'downloading') emit({ state: 'idle' });
  });

  const check = () => {
    if (last?.state === 'ready' || last?.state === 'downloading') return;
    autoUpdater.checkForUpdates().catch(() => {});
  };

  setTimeout(check, 5000);
  setInterval(check, CHECK_INTERVAL);

  return {
    check,
    lastStatus: () => last,
    install: () => {
      if (portable) shell.openExternal(RELEASES_URL);
      else if (last?.state === 'ready') autoUpdater.quitAndInstall(false, true);
    },
  };
}

module.exports = { setupUpdater };
