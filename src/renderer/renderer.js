'use strict';

const $ = (sel) => document.querySelector(sel);
const api = window.mnz;

const els = {
  urls: $('#urls'),
  quality: $('#quality'),
  bitrate: $('#bitrate'),
  browser: $('#browser'),
  playlist: $('#playlist'),
  thumbnail: $('#thumbnail'),
  h264: $('#h264'),
  outDir: $('#outDir'),
  start: $('#start'),
  cancel: $('#cancel'),
  queue: $('#queue'),
  engine: $('#engine'),
};

let settings = {};
let running = false;
let nextId = 1;
const jobs = new Map(); // id -> { el, url, title }

const STATE_TEXT = {
  queued: 'Sırada',
  running: 'Başlıyor...',
  done: '✔ Tamamlandı',
  partial: '⚠ Kısmen tamamlandı',
  error: '✖ Hata',
  cancelled: 'İptal edildi',
};

// ------------------------------------------------------------ ayarlar
function applySettings() {
  document.querySelectorAll('.seg').forEach((b) => {
    const on = b.dataset.mode === settings.mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
  const video = settings.mode === 'mp4';
  $('#qualityField').classList.toggle('hidden', !video);
  $('#bitrateField').classList.toggle('hidden', video);
  $('#h264Field').classList.toggle('hidden', !video);
  els.quality.value = settings.quality;
  els.bitrate.value = settings.bitrate;
  els.browser.value = settings.browser;
  els.playlist.checked = settings.playlist;
  els.thumbnail.checked = settings.thumbnail;
  els.h264.checked = settings.h264;
  const b = settings.browser;
  $('#loginPanel').classList.toggle('hidden', b !== 'app');
  $('#filePanel').classList.toggle('hidden', b !== 'file');
  $('#browserWarn').classList.toggle('hidden', !['chrome', 'edge', 'brave', 'opera', 'vivaldi'].includes(b));
  $('#cookiesPath').textContent = settings.cookiesPath || 'Dosya seçilmedi';
  $('#cookiesPath').title = settings.cookiesPath || '';
  els.outDir.textContent = settings.outDir;
  els.outDir.title = settings.outDir;
}

function update(patch) {
  settings = { ...settings, ...patch };
  applySettings();
  api.setSettings(settings);
}

document.querySelectorAll('.seg').forEach((b) =>
  b.addEventListener('click', () => update({ mode: b.dataset.mode })),
);
els.quality.addEventListener('change', () => update({ quality: els.quality.value }));
els.bitrate.addEventListener('change', () => update({ bitrate: els.bitrate.value }));
els.browser.addEventListener('change', () => update({ browser: els.browser.value }));
['playlist', 'thumbnail', 'h264'].forEach((k) =>
  els[k].addEventListener('change', () => update({ [k]: els[k].checked })),
);

$('#chooseDir').addEventListener('click', async () => {
  const dir = await api.chooseFolder();
  if (dir) update({ outDir: dir });
});
$('#openDir').addEventListener('click', () => api.openFolder(settings.outDir));

// ------------------------------------------------------------ çerezler / giriş
const SITE_NAMES = { instagram: 'Instagram', youtube: 'YouTube', x: 'X', tiktok: 'TikTok', facebook: 'Facebook' };

function renderLogin({ sites }) {
  document.querySelectorAll('.site').forEach((btn) =>
    btn.classList.toggle('logged', sites.includes(btn.dataset.site)),
  );
  $('#loginInfo').textContent = sites.length
    ? `Giriş yapılı: ${sites.map((s) => SITE_NAMES[s]).join(', ')}. İndirirken bu oturum kullanılır.`
    : 'Bir siteye tıklayın, açılan pencerede giriş yapıp pencereyi kapatın. Oturum hatırlanır.';
}

document.querySelectorAll('.site').forEach((btn) =>
  btn.addEventListener('click', () => api.openLogin(btn.dataset.site)),
);
$('#clearLogin').addEventListener('click', async () => {
  if (confirm('Uygulama içindeki tüm site oturumları kapatılsın mı?')) renderLogin(await api.clearLogin());
});
api.onLoginStatus(renderLogin);
$('#chooseCookies').addEventListener('click', async () => {
  const file = await api.chooseCookiesFile();
  if (file) update({ cookiesPath: file });
});

$('#paste').addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return;
    const cur = els.urls.value.trim();
    els.urls.value = cur ? `${cur}\n${text}` : text;
  } catch {
    els.urls.focus();
  }
});
$('#clearUrls').addEventListener('click', () => {
  els.urls.value = '';
  els.urls.focus();
});

// ------------------------------------------------------------ motor durumu
api.onEngineStatus(({ state, message }) => {
  els.engine.className = `pill ${state}`;
  els.engine.textContent = message;
  els.engine.title = message;
});
els.engine.addEventListener('click', () => {
  if (els.engine.classList.contains('error')) api.retryEngine();
});

// ------------------------------------------------------------ kuyruk
function fmtSize(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fmtTime(s) {
  s = Math.round(s);
  const m = Math.floor(s / 60);
  return m ? `${m} dk ${s % 60} sn` : `${s} sn`;
}

function addJob(url) {
  const id = nextId++;
  const el = $('#jobTpl').content.firstElementChild.cloneNode(true);
  el.querySelector('.job-title').textContent = url;
  el.querySelector('.job-title').title = url;
  el.querySelector('.job-state').textContent = STATE_TEXT.queued;
  els.queue.querySelector('.empty')?.remove();
  els.queue.prepend(el);
  jobs.set(id, { el, url, files: [], state: 'queued' });
  return { id, url };
}

function setState(job, state) {
  job.state = state;
  job.el.classList.remove('running', 'done', 'error', 'partial', 'cancelled', 'indeterminate');
  job.el.classList.add(state);
  job.el.querySelector('.job-state').textContent = STATE_TEXT[state] || state;
}

function showErrors(job, errors) {
  if (!errors?.length) return;
  const pre = job.el.querySelector('.job-error');
  pre.textContent = [...new Set(errors)].join('\n\n');
  pre.hidden = false;
}

api.onJobUpdate(({ id, state, files, errors }) => {
  const job = jobs.get(id);
  if (!job) return;
  setState(job, state);
  if (state === 'running') job.el.classList.add('indeterminate');
  if (files?.length) {
    job.files = files;
    const btn = job.el.querySelector('.show');
    btn.hidden = false;
    btn.onclick = () => api.showFile(files[files.length - 1]);
    const name = files[files.length - 1].split(/[\\/]/).pop();
    job.el.querySelector('.job-info').textContent =
      files.length > 1 ? `${files.length} dosya kaydedildi` : name;
  } else if (state !== 'running') {
    job.el.querySelector('.job-info').textContent = '';
  }
  if (state === 'error' || state === 'partial') showErrors(job, errors);
});

api.onJobEvent((ev) => {
  const job = jobs.get(ev.id);
  if (!job) return;
  const info = job.el.querySelector('.job-info');
  const stateEl = job.el.querySelector('.job-state');

  switch (ev.type) {
    case 'title': {
      const t = job.el.querySelector('.job-title');
      t.textContent = ev.title;
      t.title = `${ev.title}\n${job.url}`;
      job.done = (job.done || 0) + 1;
      break;
    }
    case 'progress': {
      if (ev.percent == null) {
        job.el.classList.add('indeterminate');
        info.textContent = `${fmtSize(ev.downloaded)} indirildi`;
        stateEl.textContent = 'İndiriliyor...';
        break;
      }
      job.el.classList.remove('indeterminate');
      job.el.querySelector('.fill').style.width = `${ev.percent.toFixed(1)}%`;
      stateEl.textContent = ev.percent >= 100 ? 'İşleniyor...' : `%${ev.percent.toFixed(1)}`;
      const parts = [`${fmtSize(ev.downloaded)} / ${fmtSize(ev.total)}`];
      if (ev.speed) parts.push(`${fmtSize(ev.speed)}/sn`);
      if (ev.eta != null) parts.push(`kalan ${fmtTime(ev.eta)}`);
      if (job.done > 1) parts.unshift(`#${job.done}`);
      info.textContent = parts.join('  •  ');
      break;
    }
    case 'file':
      stateEl.textContent = 'Kaydedildi';
      break;
    case 'error':
      showErrors(job, [ev.message]);
      break;
    default:
      break;
  }
});

$('#clearDone').addEventListener('click', () => {
  for (const [id, job] of jobs) {
    if (job.state !== 'queued' && job.state !== 'running') {
      job.el.remove();
      jobs.delete(id);
    }
  }
  if (!jobs.size) {
    els.queue.innerHTML = '<li class="empty">Henüz indirme yok. Bir bağlantı yapıştırıp “İndir”e basın.</li>';
  }
});

// ------------------------------------------------------------ indir / iptal
function setRunning(on) {
  running = on;
  els.start.disabled = on;
  els.cancel.disabled = !on;
}

async function start() {
  if (running) return;
  const urls = [...new Set(els.urls.value.split(/\s+/).map((u) => u.trim()).filter(Boolean))];
  if (!urls.length) {
    els.urls.focus();
    return;
  }
  const bad = urls.filter((u) => !/^https?:\/\/\S+$/i.test(u));
  if (bad.length) {
    alert(`Geçersiz bağlantı:\n${bad.join('\n')}\n\nBağlantılar http:// veya https:// ile başlamalı.`);
    return;
  }
  els.urls.value = '';
  const queued = urls.map(addJob);
  setRunning(true);
  try {
    const r = await api.start(queued, settings);
    if (!r.ok) {
      queued.forEach(({ id }) => {
        const job = jobs.get(id);
        setState(job, 'error');
        showErrors(job, [r.message]);
      });
    }
  } finally {
    setRunning(false);
  }
}

els.start.addEventListener('click', start);
els.urls.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) start();
});
els.cancel.addEventListener('click', () => {
  els.cancel.disabled = true;
  api.cancel();
});

// ------------------------------------------------------------ başlangıç
(async () => {
  settings = await api.getSettings();
  applySettings();
  renderLogin(await api.loginStatus());
})();
