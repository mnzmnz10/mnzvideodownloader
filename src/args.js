'use strict';

const path = require('path');

const QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'];
const BITRATES = ['320', '256', '192', '128'];
const BROWSERS = ['none', 'firefox', 'chrome', 'edge', 'brave', 'opera', 'vivaldi'];
// Tarayıcı dışı çerez kaynakları: uygulama içi oturum ve cookies.txt dosyası
const COOKIE_SOURCES = ['app', 'file'];

// yt-dlp çıktısında bizim satırlarımızı ayırt etmek için önekler
const TAG = {
  progress: 'MNZP|',
  title: 'MNZT|',
  file: 'MNZF|',
};

/**
 * Arayüz ayarlarından yt-dlp komut satırı argümanlarını üretir.
 * @param {object} o
 * @param {string} o.url
 * @param {'mp4'|'mp3'} o.mode
 * @param {string} o.quality    QUALITIES içinden
 * @param {string} o.bitrate    BITRATES içinden
 * @param {string} o.outDir
 * @param {boolean} o.playlist
 * @param {boolean} o.h264
 * @param {boolean} o.thumbnail
 * @param {string} o.browser    BROWSERS veya COOKIE_SOURCES içinden
 * @param {string} [o.cookiesFile] browser 'app' / 'file' iken kullanılacak Netscape çerez dosyası
 * @param {string} [o.ffmpegPath]
 */
function buildArgs(o) {
  if (!o.url || !/^https?:\/\//i.test(o.url)) throw new Error('Geçersiz bağlantı');

  const args = [
    '--newline',
    '--no-colors',
    '--quiet',
    '--progress',
    '--encoding', 'utf-8',
    '--windows-filenames',
    '--retries', '10',
    '--fragment-retries', '10',
    '--concurrent-fragments', '4',
    '--embed-metadata',
    '--progress-template',
    `download:${TAG.progress}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|` +
      '%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '--print', `before_dl:${TAG.title}%(title)s`,
    '--print', `after_move:${TAG.file}%(filepath)s`,
    '-o', path.join(o.outDir, '%(title).150B [%(id)s].%(ext)s'),
  ];

  if (o.ffmpegPath) args.push('--ffmpeg-location', o.ffmpegPath);
  args.push(...(o.playlist ? ['--yes-playlist', '--ignore-errors'] : ['--no-playlist']));
  if (COOKIE_SOURCES.includes(o.browser)) {
    if (o.cookiesFile) args.push('--cookies', o.cookiesFile);
  } else if (o.browser && o.browser !== 'none') {
    if (!BROWSERS.includes(o.browser)) throw new Error('Geçersiz tarayıcı');
    args.push('--cookies-from-browser', o.browser);
  }
  if (o.thumbnail) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');

  if (o.mode === 'mp3') {
    const br = BITRATES.includes(o.bitrate) ? o.bitrate : '320';
    args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', `${br}K`);
  } else {
    const q = QUALITIES.includes(o.quality) ? o.quality : 'best';
    const sort = [q === 'best' ? 'res' : `res:${q}`];
    // Windows'un kendi oynatıcısında sorunsuz açılan H.264 + AAC'yi tercih et
    if (o.h264) sort.push('vcodec:h264', 'acodec:aac');
    args.push(
      '-f', 'bv*+ba/b',
      '-S', sort.join(','),
      '--merge-output-format', 'mp4',
      '--remux-video', 'mp4',
    );
  }

  // "--" sonrası: bağlantı "-" ile başlasa bile seçenek sanılmasın
  args.push('--', o.url);
  return args;
}

/** yt-dlp çıktısındaki tek bir satırı yorumlar. */
function parseLine(line) {
  line = line.trim();
  if (line.startsWith(TAG.progress)) {
    const [done, total, estimate, speed, eta] = line
      .slice(TAG.progress.length)
      .split('|')
      .map((v) => (v === 'NA' || v === 'None' || v === '' ? null : Number(v)));
    const size = total || estimate || null;
    return {
      type: 'progress',
      downloaded: done || 0,
      total: size,
      percent: size ? Math.min(100, ((done || 0) / size) * 100) : null,
      speed: speed || null,
      eta: Number.isFinite(eta) ? eta : null,
    };
  }
  if (line.startsWith(TAG.title)) return { type: 'title', title: line.slice(TAG.title.length) };
  if (line.startsWith(TAG.file)) return { type: 'file', file: line.slice(TAG.file.length) };
  if (/^ERROR:/i.test(line)) return { type: 'error', message: explainError(line) };
  if (/^WARNING:/i.test(line)) return { type: 'warning', message: line.replace(/^WARNING:\s*/i, '') };
  return line ? { type: 'log', message: line } : null;
}

/** yt-dlp hatalarını kullanıcı dostu Türkçe açıklamalara çevirir. */
function explainError(line) {
  const msg = line
    .replace(/^ERROR:\s*/i, '')
    .replace(/;?\s*please report this issue on\s.*$/i, '')
    .trim();
  const low = msg.toLowerCase();
  let hint = '';
  if (/could not copy .*cookie|failed to decrypt|app.?bound|cookie database|dpapi/.test(low)) {
    hint =
      'Chrome / Edge / Brave çerezleri Windows\'ta artık okunamıyor (tarayıcı şifrelemesi). ' +
      '"Çerezler" kısmından "Uygulama içi giriş"i seçip "Giriş yap" ile siteye bir kez giriş yapın.';
  } else if (/unable to connect|timed out|getaddrinfo|name resolution|connection (refused|reset)|network is unreachable/.test(low)) {
    hint = 'Siteye bağlanılamadı. İnternet bağlantınızı ve bağlantı adresini kontrol edin.';
  } else if (/\blog ?in\b|sign in|\bcookies\b|\bprivate\b|\bage\b|age[- ]restricted/.test(low)) {
    hint = 'Bu içerik giriş gerektiriyor. "Çerezler" kısmından "Uygulama içi giriş"i seçip "Giriş yap" ile siteye giriş yapın.';
  } else if (low.includes('unsupported url')) {
    hint = 'Bu site veya bağlantı desteklenmiyor.';
  } else if (low.includes('video unavailable') || low.includes('not available')) {
    hint = 'Video kaldırılmış, gizli ya da bölgenizde erişilemiyor olabilir.';
  } else if (low.includes('http error 403') || low.includes('unable to extract')) {
    hint = 'Site değişmiş olabilir. Programı yeniden başlatın (yt-dlp otomatik güncellenir).';
  }
  return hint ? `${msg}\n→ ${hint}` : msg;
}

/**
 * Electron çerezlerini yt-dlp'nin okuduğu Netscape cookies.txt biçimine çevirir.
 * @param {Array<{domain:string, hostOnly?:boolean, path?:string, secure?:boolean,
 *   httpOnly?:boolean, expirationDate?:number, name:string, value:string}>} cookies
 */
function toNetscapeCookies(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# MNZ Video Downloader tarafından oluşturuldu', ''];
  for (const c of cookies) {
    if (!c.domain || !c.name) continue;
    let domain = c.domain;
    const sub = !c.hostOnly;
    if (sub && !domain.startsWith('.')) domain = `.${domain}`;
    if (!sub) domain = domain.replace(/^\./, '');
    const clean = (v) => String(v).replace(/[\t\r\n]/g, '');
    lines.push(
      [
        (c.httpOnly ? '#HttpOnly_' : '') + domain,
        sub ? 'TRUE' : 'FALSE',
        c.path || '/',
        c.secure ? 'TRUE' : 'FALSE',
        c.expirationDate ? Math.floor(c.expirationDate) : 0,
        clean(c.name),
        clean(c.value),
      ].join('\t'),
    );
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  buildArgs,
  parseLine,
  explainError,
  toNetscapeCookies,
  QUALITIES,
  BITRATES,
  BROWSERS,
  COOKIE_SOURCES,
  TAG,
};
