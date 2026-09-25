'use strict';

const path = require('path');

const QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'];
const BITRATES = ['320', '256', '192', '128'];
const BROWSERS = ['none', 'firefox', 'chrome', 'edge', 'brave', 'opera', 'vivaldi'];

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
 * @param {string} o.browser    BROWSERS içinden
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
  if (o.browser && o.browser !== 'none') {
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
  if (low.includes('could not copy') && low.includes('cookie')) {
    hint = 'Tarayıcı çerezleri okunamadı. Tarayıcıyı tamamen kapatıp tekrar deneyin ya da Firefox kullanın.';
  } else if (/unable to connect|timed out|getaddrinfo|name resolution|connection (refused|reset)|network is unreachable/.test(low)) {
    hint = 'Siteye bağlanılamadı. İnternet bağlantınızı ve bağlantı adresini kontrol edin.';
  } else if (/\blog ?in\b|sign in|\bcookies\b|\bprivate\b|\bage\b|age[- ]restricted/.test(low)) {
    hint = 'Bu içerik giriş gerektiriyor. "Tarayıcı çerezleri" kısmından siteye giriş yaptığınız tarayıcıyı seçin.';
  } else if (low.includes('unsupported url')) {
    hint = 'Bu site veya bağlantı desteklenmiyor.';
  } else if (low.includes('video unavailable') || low.includes('not available')) {
    hint = 'Video kaldırılmış, gizli ya da bölgenizde erişilemiyor olabilir.';
  } else if (low.includes('http error 403') || low.includes('unable to extract')) {
    hint = 'Site değişmiş olabilir. Programı yeniden başlatın (yt-dlp otomatik güncellenir).';
  }
  return hint ? `${msg}\n→ ${hint}` : msg;
}

module.exports = { buildArgs, parseLine, explainError, QUALITIES, BITRATES, BROWSERS, TAG };
