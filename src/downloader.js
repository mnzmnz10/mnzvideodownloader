'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { buildArgs, parseLine } = require('./args');

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const BINARY_NAME = {
  win32: 'yt-dlp.exe',
  darwin: 'yt-dlp_macos',
  linux: 'yt-dlp_linux',
}[process.platform] || 'yt-dlp';

/** Paketlenmiş uygulamada ffmpeg-static, app.asar.unpacked içinden çalıştırılmalı. */
function getFfmpegPath() {
  try {
    const p = require('ffmpeg-static');
    return p ? p.replace('app.asar', 'app.asar.unpacked') : null;
  } catch {
    return null;
  }
}

class YtDlpManager {
  /**
   * @param {string} binDir yt-dlp'nin saklanacağı yazılabilir klasör
   * @param {(url: string) => Promise<Response>} fetchFn indirme fonksiyonu (Electron net.fetch)
   */
  constructor(binDir, fetchFn) {
    this.binDir = binDir;
    this.fetch = fetchFn;
    this.binPath = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    this.ready = null;
  }

  /** yt-dlp yoksa indirir, varsa günceller. Birden fazla çağrıda aynı işi paylaşır. */
  ensure(onStatus = () => {}) {
    if (!this.ready) {
      this.ready = this._ensure(onStatus).catch((err) => {
        this.ready = null; // sonraki denemede tekrar dene
        throw err;
      });
    }
    return this.ready;
  }

  async _ensure(onStatus) {
    if (!fs.existsSync(this.binPath)) {
      onStatus('İndirme motoru (yt-dlp) indiriliyor, bu yalnızca ilk açılışta olur...');
      await this._download();
    } else {
      onStatus('İndirme motoru güncelleniyor...');
      try {
        await this._run(['-U'], 60_000);
      } catch {
        // Güncelleme başarısız olsa da eldeki sürümle devam edilebilir
      }
    }
    const version = (await this._run(['--version'], 30_000)).trim();
    onStatus(`Hazır (yt-dlp ${version})`);
    return version;
  }

  async _download() {
    fs.mkdirSync(this.binDir, { recursive: true });
    const res = await this.fetch(RELEASE_BASE + BINARY_NAME);
    if (!res.ok) throw new Error(`yt-dlp indirilemedi (HTTP ${res.status})`);
    const tmp = this.binPath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, this.binPath);
  }

  _run(args, timeout) {
    return new Promise((resolve, reject) => {
      execFile(this.binPath, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }
}

/**
 * Tek bir bağlantıyı indirir.
 * @returns {{ promise: Promise<{code:number, files:string[], errors:string[]}>, cancel: () => void }}
 */
function runDownload(binPath, options, onEvent) {
  const args = buildArgs({ ...options, ffmpegPath: getFfmpegPath() });
  const child = spawn(binPath, args, {
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  const files = [];
  const errors = [];
  let cancelled = false;

  const handle = (line) => {
    const ev = parseLine(line);
    if (!ev) return;
    if (ev.type === 'file') files.push(ev.file);
    if (ev.type === 'error') errors.push(ev.message);
    onEvent(ev);
  };

  const splitter = () => {
    let buf = '';
    return (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      lines.forEach(handle);
    };
  };
  child.stdout.on('data', splitter());
  child.stderr.on('data', splitter());

  const promise = new Promise((resolve) => {
    child.on('error', (err) => {
      errors.push(err.message);
      resolve({ code: -1, files, errors, cancelled });
    });
    child.on('close', (code) => resolve({ code: code ?? -1, files, errors, cancelled }));
  });

  const cancel = () => {
    cancelled = true;
    if (child.exitCode !== null) return;
    if (process.platform === 'win32') {
      // ffmpeg alt süreçleriyle birlikte tüm ağacı sonlandır
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else {
      child.kill('SIGTERM');
    }
  };

  return { promise, cancel };
}

module.exports = { YtDlpManager, runDownload, getFfmpegPath };
