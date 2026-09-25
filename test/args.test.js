'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildArgs, parseLine, toNetscapeCookies, TAG } = require('../src/args');

const base = {
  url: 'https://www.youtube.com/watch?v=abc',
  mode: 'mp4',
  quality: '1080',
  bitrate: '320',
  outDir: 'C:\\Downloads',
  playlist: false,
  h264: true,
  thumbnail: true,
  browser: 'none',
};

const valueOf = (args, flag) => args[args.indexOf(flag) + 1];

test('mp4: kalite, h264 tercihi ve mp4 birleştirme', () => {
  const a = buildArgs(base);
  assert.strictEqual(valueOf(a, '-S'), 'res:1080,vcodec:h264,acodec:aac');
  assert.strictEqual(valueOf(a, '--merge-output-format'), 'mp4');
  assert.ok(a.includes('--no-playlist'));
  assert.ok(!a.includes('-x'));
  assert.deepStrictEqual(a.slice(-2), ['--', base.url]);
});

test('mp4: en iyi kalite, uyumlu mod kapalı', () => {
  const a = buildArgs({ ...base, quality: 'best', h264: false });
  assert.strictEqual(valueOf(a, '-S'), 'res');
});

test('mp3: ses çıkarma ve bit hızı', () => {
  const a = buildArgs({ ...base, mode: 'mp3', bitrate: '192' });
  assert.ok(a.includes('-x'));
  assert.strictEqual(valueOf(a, '--audio-format'), 'mp3');
  assert.strictEqual(valueOf(a, '--audio-quality'), '192K');
  assert.ok(!a.includes('--merge-output-format'));
});

test('oynatma listesi ve tarayıcı çerezleri', () => {
  const a = buildArgs({ ...base, playlist: true, browser: 'firefox' });
  assert.ok(a.includes('--yes-playlist'));
  assert.strictEqual(valueOf(a, '--cookies-from-browser'), 'firefox');
  assert.throws(() => buildArgs({ ...base, browser: 'x; rm -rf' }));
});

test('geçersiz bağlantı reddedilir', () => {
  assert.throws(() => buildArgs({ ...base, url: '--exec calc' }));
  assert.throws(() => buildArgs({ ...base, url: 'file:///C:/x' }));
});

test('ilerleme satırı çözümlenir', () => {
  const p = parseLine(`${TAG.progress}500|1000|NA|250.5|2`);
  assert.deepStrictEqual(p, { type: 'progress', downloaded: 500, total: 1000, percent: 50, speed: 250.5, eta: 2 });
  const est = parseLine(`${TAG.progress}10|NA|40|NA|NA`);
  assert.strictEqual(est.percent, 25);
  assert.strictEqual(est.eta, null);
  const unknown = parseLine(`${TAG.progress}10|NA|NA|NA|NA`);
  assert.strictEqual(unknown.percent, null);
});

test('başlık, dosya ve hata satırları', () => {
  assert.deepStrictEqual(parseLine(`${TAG.title}Şarkı | Klip`), { type: 'title', title: 'Şarkı | Klip' });
  assert.deepStrictEqual(parseLine(`${TAG.file}C:\\a\\b.mp4`), { type: 'file', file: 'C:\\a\\b.mp4' });
  const e = parseLine('ERROR: [instagram] xyz: Requested content is not available, login required');
  assert.strictEqual(e.type, 'error');
  assert.match(e.message, /Uygulama içi giriş/);
  assert.strictEqual(parseLine('   '), null);

  // "webpage" içindeki "age" giriş ipucunu tetiklememeli
  const net = parseLine(
    "ERROR: [generic] nope: Unable to download webpage: ('Unable to connect to proxy'); " +
      'please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the template',
  );
  assert.match(net.message, /Siteye bağlanılamadı/);
  assert.doesNotMatch(net.message, /please report|Uygulama içi giriş/);
  assert.match(parseLine('ERROR: Sign in to confirm your age').message, /giriş gerektiriyor/);
});

test('uygulama içi oturum ve cookies.txt --cookies ile verilir', () => {
  const a = buildArgs({ ...base, browser: 'app', cookiesFile: 'C:\\u\\session-cookies.txt' });
  assert.strictEqual(valueOf(a, '--cookies'), 'C:\\u\\session-cookies.txt');
  assert.ok(!a.includes('--cookies-from-browser'));
  const f = buildArgs({ ...base, browser: 'file', cookiesFile: 'D:\\c.txt' });
  assert.strictEqual(valueOf(f, '--cookies'), 'D:\\c.txt');
});

test('Chrome çerez hatası uygulama içi girişi önerir', () => {
  for (const line of [
    'ERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271  for more info',
    'ERROR: Failed to decrypt with DPAPI. See  https://github.com/yt-dlp/yt-dlp/issues/10927  for more info',
  ]) {
    assert.match(parseLine(line).message, /Uygulama içi giriş/);
  }
});

test('Netscape çerez dosyası biçimi', () => {
  const txt = toNetscapeCookies([
    { domain: '.instagram.com', hostOnly: false, path: '/', secure: true, httpOnly: true,
      expirationDate: 1893456000.5, name: 'sessionid', value: 'abc' },
    { domain: 'www.youtube.com', hostOnly: true, path: '/', secure: false, name: 'PREF', value: 'x\ty' },
  ]);
  const lines = txt.trim().split('\n');
  assert.strictEqual(lines[0], '# Netscape HTTP Cookie File');
  assert.strictEqual(lines[3], '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1893456000\tsessionid\tabc');
  assert.strictEqual(lines[4], 'www.youtube.com\tFALSE\t/\tFALSE\t0\tPREF\txy');
});
