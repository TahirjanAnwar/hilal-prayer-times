/* global api, HIJRI */
const $ = (id) => document.getElementById(id);

const METHOD_NAMES = {
  MuslimWorldLeague: 'Muslim World League',
  Turkey: 'Diyanet (Türkiye)',
  Egyptian: 'Egyptian General Authority',
  Karachi: 'University of Karachi',
  UmmAlQura: 'Umm al-Qura (Makkah)',
  Dubai: 'Dubai',
  MoonsightingCommittee: 'Moonsighting Committee',
  NorthAmerica: 'ISNA (North America)',
  Kuwait: 'Kuwait',
  Qatar: 'Qatar',
  Singapore: 'Singapore / Malaysia / Indonesia',
  Tehran: 'Tehran',
};
const LOCALES = { en: 'en-GB', nl: 'nl-NL', ug: 'ug', tr: 'tr-TR', de: 'de-DE', no: 'nb-NO', fr: 'fr-FR', ja: 'ja-JP' };
const BELL_SVG = '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/><path class="slash" d="M4 4l16 16"/></svg>';

// Where the sun is at each prayer: a small sky with the sun on its way from sunrise (right)
// over noon to sunset (left), and the moon under the horizon for Isha.
const SKY = '<path class="sky" d="M10 24A22 15 0 0 1 54 24"/><path class="sky" d="M5 24H59"/>';
function sunIcon(cx, cy, half) {
  let rays = '';
  for (let a = 0; a < 360; a += 45) {
    if (half && (a === 0 || a === 180 || a < 180)) continue; // only the rays above the horizon
    const rad = (a * Math.PI) / 180;
    const p = (d) => `${(cx + Math.cos(rad) * d).toFixed(1)} ${(cy + Math.sin(rad) * d).toFixed(1)}`;
    rays += `M${p(6.2)}L${p(8.6)}`;
  }
  const disc = half ? `<path class="sun" d="M${cx - 4} ${cy}A4 4 0 0 1 ${cx + 4} ${cy}z"/>` : `<circle class="sun" cx="${cx}" cy="${cy}" r="4"/>`;
  return `${disc}<path class="ray" d="${rays}"/>`;
}
const PRAYER_ICONS = {
  fajr: SKY + sunIcon(54, 24, true),
  dhuhr: SKY + sunIcon(32, 9, false),
  juma: SKY + sunIcon(32, 9, false),
  asr: SKY + sunIcon(16.5, 13.5, false),
  maghrib: SKY + sunIcon(10, 24, true),
  isha: SKY + '<path class="moon" d="M15 27.5A5 5 0 1 0 19.6 34.3 4.3 4.3 0 0 1 15 27.5z"/>',
};
const THEME_ICONS = {
  auto: '<circle cx="12" cy="12" r="8"/><path class="fill" d="M12 4a8 8 0 0 1 0 16z"/>',
  system: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  day: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  night: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  relaxed: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-14 14zM5 19l8-8"/>',
};
const THEME_KEYS = { auto: 'themeAuto', system: 'themeSystem', day: 'themeDay', night: 'themeNight', relaxed: 'themeRelaxed' };
const THEME_CYCLE = ['auto', 'day', 'night', 'relaxed'];

let state = null;
let S = {};
let times = null;
let locating = false;

// ---------- helpers ----------
const t = (key, vars) => {
  let s = S[key] ?? key;
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
  return s;
};
const pad = (n) => String(n).padStart(2, '0');

function fmtClock(ms) {
  const h12 = state.settings.hour12;
  return new Intl.DateTimeFormat(h12 ? 'en-US' : 'en-GB', {
    timeZone: times.tz, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: h12,
  }).format(new Date(ms));
}
function fmtHM(ms) {
  const m = Math.floor(Math.abs(ms) / 60000);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
function fmtHMS(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
const UG_DAYS = ['يەكشەنبە', 'دۈشەنبە', 'سەيشەنبە', 'چارشەنبە', 'پەيشەنبە', 'جۈمە', 'شەنبە'];
const UG_HIJRI = ['مۇھەررەم', 'سەپەر', 'رەبىئۇلئەۋۋەل', 'رەبىئۇلئاخىر', 'جۇمادىيەلئەۋۋەل', 'جۇمادىيەلئاخىر',
  'رەجەب', 'شەئبان', 'رامىزان', 'شەۋۋال', 'زۇلقەئدە', 'زۇلھەججە'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtDate(hijri) {
  const lang = state.settings.language;
  const opts = { timeZone: times.tz, numberingSystem: 'latn' };
  let when = new Date();
  if (hijri) {
    // The Islamic date is counted in whole days, with the correction from Settings.
    opts.calendar = 'islamic-umalqura';
    opts.timeZone = 'UTC';
    when = new Date(HIJRI.noon(times.tz, state.settings.hijriAdjust));
  }
  try {
    if (lang === 'ug') {
      // The browser engine has no Uyghur date names, so build the text here.
      const f = new Intl.DateTimeFormat('en-US', { ...opts, day: 'numeric', month: 'numeric', year: 'numeric', weekday: 'long' });
      const p = {};
      for (const part of f.formatToParts(when)) p[part.type] = part.value;
      if (hijri) return `ھىجرىيە ${p.year}-يىلى ${UG_HIJRI[p.month - 1]} ${p.day}`;
      return `${p.year}-يىلى ${p.month}-ئاينىڭ ${p.day}-كۈنى، ${UG_DAYS[EN_DAYS.indexOf(p.weekday)]}`;
    }
    const full = { ...opts, day: 'numeric', month: 'long', year: 'numeric' };
    if (!hijri) full.weekday = 'long';
    return new Intl.DateTimeFormat(LOCALES[lang] || 'en-GB', full).format(when);
  } catch { return ''; }
}

// ---------- language ----------
function applyStrings() {
  S = state.strings;
  document.documentElement.lang = state.settings.language;
  document.documentElement.dir = S.dir;
  document.title = S.appName;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}

// ---------- colours ----------
// Day, Night or Relaxed. "Automatic" is Day from sunrise until Maghrib and Night after it;
// "Same as the computer" follows the light/dark setting of Windows or macOS.
function applyTheme() {
  const mode = state.settings.theme;
  let theme = mode;
  if (mode === 'auto' || mode === 'system') {
    const now = Date.now();
    const at = (id) => { const e = times && times.today.find((x) => x.id === id); return e ? e.time : null; };
    if (mode === 'auto' && at('sunrise') && at('maghrib')) theme = now >= at('sunrise') && now < at('maghrib') ? 'day' : 'night';
    else theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : 'night';
  }
  if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  const btn = $('themeBtn');
  if (btn.dataset.mode !== mode + S.dir + state.settings.language) {
    btn.dataset.mode = mode + S.dir + state.settings.language;
    btn.innerHTML = `<svg viewBox="0 0 24 24">${THEME_ICONS[mode] || THEME_ICONS.auto}</svg>`;
    btn.title = `${t('theme')}: ${t(THEME_KEYS[mode] || 'themeAuto')}`;
  }
}
$('themeBtn').addEventListener('click', () => {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(state.settings.theme) + 1) % THEME_CYCLE.length];
  save({ theme: next });
});
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (state) applyTheme(); });

function renderRamadan() {
  if (!times) { $('ramadan').hidden = true; return; }
  const r = HIJRI.ramadan(times.tz, state.settings.hijriAdjust);
  $('ramadan').hidden = false;
  $('ramadan').classList.toggle('on', r.inRamadan);
  $('ramadanText').textContent = r.inRamadan ? t('ramadanDay', { d: r.day, n: r.left }) : t('ramadanIn', { n: r.until });
}

// ---------- prayer times view ----------
function locationText() {
  const loc = state.settings.location;
  if (!loc) return locating ? t('locating') : t('noLocation');
  return [loc.city, loc.country].filter(Boolean).join(', ');
}

async function loadTimes() {
  times = await api.getTimes();
  renderTimes();
}

function renderTimes() {
  $('locLabel').textContent = locationText();
  applyTheme();
  renderRamadan();
  if (!times) {
    $('heroName').textContent = '—';
    $('heroCount').textContent = '--:--:--';
    $('heroTime').textContent = '';
    $('rows').replaceChildren();
    $('dateGreg').textContent = locating ? t('locating') : t('locationFailed');
    $('dateHijri').textContent = '';
    $('qibla').textContent = '';
    return;
  }
  const now = Date.now();
  const upcoming = [...times.today, ...times.tomorrow].filter((e) => e.id !== 'sunrise' && e.time > now);
  const next = upcoming[0];
  if (next) {
    $('heroName').textContent = t(next.id);
    $('heroCount').textContent = fmtHMS(next.time - now);
    $('heroTime').textContent = fmtClock(next.time);
  }

  const rows = $('rows');
  if (rows.dataset.key !== rowsKey()) buildRows();
  for (const el of rows.children) {
    const time = Number(el.dataset.time);
    const diff = time - now;
    const isNext = next && next.time === time && next.id === el.dataset.id;
    el.classList.toggle('next', !!isNext);
    el.classList.toggle('past', diff <= 0);
    const rel = el.querySelector('.row-rel');
    rel.textContent = Math.abs(diff) < 60000 && diff <= 0 ? t('now')
      : diff > 0 ? t('inTime', { t: fmtHM(diff) }) : t('agoTime', { t: fmtHM(diff) });
  }

  $('dateGreg').textContent = fmtDate();
  $('dateHijri').textContent = fmtDate('islamic-umalqura');
  $('qibla').textContent = state.qibla == null ? '' : t('qibla', { d: state.qibla });
}

function rowsKey() {
  const s = state.settings;
  return [times.dateKey, times.tz, s.language, s.hour12, JSON.stringify(s.adhanFor), times.today.map((e) => e.time).join()].join('|');
}

function buildRows() {
  const rows = $('rows');
  rows.dataset.key = rowsKey();
  rows.replaceChildren(...times.today.map((e) => {
    const el = document.createElement('div');
    el.className = 'row' + (e.id === 'sunrise' ? ' minor' : '');
    el.dataset.time = e.time;
    el.dataset.id = e.id;

    const name = document.createElement('div');
    name.className = 'row-name';
    name.textContent = t(e.id);
    const rel = document.createElement('span');
    rel.className = 'row-rel';
    rel.dir = S.dir;
    name.append(rel);

    const icon = document.createElement('div');
    icon.className = 'row-icon';
    if (PRAYER_ICONS[e.id]) icon.innerHTML = `<svg viewBox="0 0 64 40" aria-hidden="true">${PRAYER_ICONS[e.id]}</svg>`;

    const clock = document.createElement('div');
    clock.className = 'row-time';
    clock.dir = 'ltr';
    clock.textContent = fmtClock(e.time);

    let last;
    if (e.id === 'sunrise') {
      last = document.createElement('span');
      last.className = 'bell-space';
    } else {
      const on = state.settings.adhanFor[e.id] !== false;
      last = document.createElement('button');
      last.type = 'button';
      last.className = 'bell' + (on ? '' : ' off');
      last.title = on ? t('adhanOn') : t('adhanOff');
      last.innerHTML = BELL_SVG;
      last.addEventListener('click', async () => {
        setState(await api.setSettings({ adhanFor: { [e.id]: !on } }));
      });
    }
    el.append(name, icon, clock, last);
    return el;
  }));
}

// ---------- adhan ----------
const audio = $('adhan');
let bannerTimer = null;

function playAdhan(id) {
  audio.src = id === 'fajr' ? state.settings.fajrAdhanUrl : state.settings.adhanUrl;
  audio.volume = state.settings.volume;
  audio.currentTime = 0;
  audio.play().catch(() => stopAdhan());
}
function stopAdhan() {
  audio.pause();
  audio.removeAttribute('src');
  syncAdhanUi();
}
function syncAdhanUi() {
  const playing = !audio.paused && !audio.ended;
  api.adhanState(playing);
  $('testAdhan').textContent = playing ? t('stop') : t('test');
  $('testFajr').textContent = playing ? t('stop') : t('test');
  $('bannerStop').hidden = !playing;
}
audio.addEventListener('playing', syncAdhanUi);
audio.addEventListener('pause', syncAdhanUi);
audio.addEventListener('ended', syncAdhanUi);
audio.addEventListener('error', syncAdhanUi);

function showBanner(id) {
  $('bannerText').textContent = t('timeFor', { p: t(id) });
  $('banner').hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { $('banner').hidden = true; }, 15 * 60000);
}

api.onPrayer(({ id, play }) => {
  showBanner(id);
  if (play) playAdhan(id);
  syncAdhanUi();
});
api.onAdhanStop(stopAdhan);
$('bannerStop').addEventListener('click', () => { stopAdhan(); $('banner').hidden = true; });
$('testAdhan').addEventListener('click', () => (audio.paused ? playAdhan() : stopAdhan()));
$('testFajr').addEventListener('click', () => (audio.paused ? playAdhan('fajr') : stopAdhan()));

// ---------- settings view ----------
function fillSettings() {
  const s = state.settings;
  $('setLoc').textContent = locationText() + (s.locationMode === 'auto' ? ` · ${t('auto')}` : '');
  $('language').value = s.language;
  $('adhanEnabled').checked = s.adhanEnabled;
  $('volume').value = s.volume;
  const choice = $('adhanChoice');
  choice.replaceChildren(...Array.from({ length: s.adhanCount }, (_, i) => new Option(t('adhanN', { n: i + 1 }), String(i + 1))));
  if (s.adhanFileName) choice.add(new Option(s.adhanFileName, 'file'));
  choice.value = s.adhanFileName ? 'file' : String(s.adhanChoice);

  const method = $('method');
  const autoName = state.resolvedMethod && s.method === 'auto' ? ` – ${METHOD_NAMES[state.resolvedMethod]}` : '';
  method.replaceChildren(new Option(t('methodAuto') + autoName, 'auto'),
    ...state.methods.map((m) => new Option(METHOD_NAMES[m] || m, m)));
  method.value = s.method;
  $('madhab').value = s.madhab;
  $('jumaTime').value = s.jumaTime.padStart(5, '0');
  $('hour12').value = s.hour12 ? '12' : '24';
  $('hijriAdjust').value = String(s.hijriAdjust);
  $('theme').value = s.theme;
  $('updateCheck').checked = s.updateCheck;
  $('startup').checked = s.startup;
  $('widget').checked = s.widget;
  $('widgetTop').checked = s.widgetTop;
  $('widgetTop').disabled = !s.widget;
  $('widgetHadith').checked = s.widgetHadith;
  $('widgetHadith').disabled = !s.widget;
  $('hadithHours').replaceChildren(...[1, 3, 6, 12, 24].map((n) => new Option(n === 1 ? t('everyHour') : n === 24 ? t('everyDay') : t('everyNHours', { n }), String(n))));
  $('hadithHours').value = String(s.hadithHours);
  $('hadithHours').disabled = !s.widget || !s.widgetHadith;
  $('keyStatus').textContent = s.hasApiKey ? t('apiKeySaved') : t('apiKeyMissing');
  $('keyRemove').hidden = !s.hasApiKey;
  $('version').textContent = `v${state.version}`;
  $('updVersion').textContent = t('updVersion', { v: state.version });
  audio.volume = s.volume;
}

const save = async (patch) => setState(await api.setSettings(patch));
$('language').addEventListener('change', (e) => save({ language: e.target.value }));
$('adhanEnabled').addEventListener('change', (e) => save({ adhanEnabled: e.target.checked }));
$('volume').addEventListener('change', (e) => save({ volume: Number(e.target.value) }));
$('volume').addEventListener('input', (e) => { audio.volume = Number(e.target.value); });
$('method').addEventListener('change', (e) => save({ method: e.target.value }));
$('madhab').addEventListener('change', (e) => save({ madhab: e.target.value }));
$('jumaTime').addEventListener('change', (e) => e.target.value && save({ jumaTime: e.target.value }));
$('hour12').addEventListener('change', (e) => save({ hour12: e.target.value === '12' }));
$('hijriAdjust').addEventListener('change', (e) => save({ hijriAdjust: Number(e.target.value) }));
$('theme').addEventListener('change', (e) => save({ theme: e.target.value }));
$('updateCheck').addEventListener('change', (e) => save({ updateCheck: e.target.checked }));
$('startup').addEventListener('change', (e) => save({ startup: e.target.checked }));
$('widget').addEventListener('change', (e) => save({ widget: e.target.checked }));
$('widgetTop').addEventListener('change', (e) => save({ widgetTop: e.target.checked }));
$('widgetHadith').addEventListener('change', (e) => save({ widgetHadith: e.target.checked }));
$('hadithHours').addEventListener('change', (e) => save({ hadithHours: Number(e.target.value) }));
$('pickAdhan').addEventListener('click', async () => { stopAdhan(); setState(await api.pickAdhan()); });
$('adhanChoice').addEventListener('change', (e) => {
  stopAdhan();
  if (e.target.value !== 'file') save({ adhanChoice: Number(e.target.value) });
});

$('autoLoc').addEventListener('click', async () => {
  locating = true;
  $('autoLoc').disabled = true;
  renderTimes();
  const ok = await api.locateAuto();
  locating = false;
  $('autoLoc').disabled = false;
  setState(await api.getState());
  if (!ok) $('cityResults').textContent = t('locationFailed');
});

$('citySearch').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('cityResults');
  box.textContent = '…';
  const list = await api.searchCities($('cityInput').value);
  if (!list.length) { box.textContent = t('noResults'); return; }
  box.replaceChildren(...list.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.city;
    const sub = document.createElement('small');
    sub.textContent = [c.region, c.country].filter(Boolean).join(', ');
    b.append(sub);
    b.addEventListener('click', async () => {
      await api.setLocation(c);
      box.replaceChildren();
      $('cityInput').value = '';
      setState(await api.getState());
      showView('times');
    });
    return b;
  }));
});

$('keyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('keyInput').value.trim();
  if (!v) return;
  $('keyInput').value = '';
  setState(await api.setApiKey(v));
});
$('keyRemove').addEventListener('click', async () => setState(await api.setApiKey('')));

// ---------- updates ----------
$('updBtn').addEventListener('click', async () => {
  const say = (text) => { $('updMsg').textContent = text; };
  $('updBtn').disabled = true;
  $('updPage').hidden = true;
  say(t('updChecking'));
  const res = await api.updateRun();
  if (res.status === 'ready') { say(t('updRestart')); return; } // the app restarts by itself
  $('updBtn').disabled = false;
  if (res.status === 'latest') say(t('updLatest'));
  else if (res.status === 'dev') say(t('updDev'));
  else if (res.status === 'installer') { say(t('updInstaller')); $('updPage').hidden = false; }
  else say(t('updFailed', { e: res.error || '' }));
});
$('updPage').addEventListener('click', () => api.updatePage());
api.onUpdateProgress(({ done, total }) => {
  const text = t('updDownloading', { n: done, m: total });
  $('updMsg').textContent = text;
  if (!$('updModal').hidden) $('updNewMsg').textContent = text;
});

// The app found a new version by itself: a message with a short sound.
let updInfo = null;
function chime() {
  try {
    const ctx = new AudioContext();
    const loud = Math.max(0.15, state.settings.volume) * 0.35;
    [[659.25, 0], [880, 0.17], [1318.5, 0.34]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(loud, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 1);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch { /* no sound device */ }
}
function renderUpdModal() {
  if (!updInfo) return;
  const installer = updInfo.status === 'installer';
  $('updNewText').textContent = installer ? t('updInstaller') : updInfo.version ? t('updNewBody', { v: updInfo.version }) : t('updNewBodyNoV');
  $('updNow').textContent = installer ? t('updOpenPage') : t('updNow');
}
api.onUpdateAvailable((info) => {
  if (!state) return;
  updInfo = info;
  $('updNewMsg').textContent = '';
  $('updNow').disabled = false;
  $('updLater').disabled = false;
  renderUpdModal();
  $('updModal').hidden = false;
  chime();
});
$('updLater').addEventListener('click', () => { $('updModal').hidden = true; updInfo = null; });
$('updNow').addEventListener('click', async () => {
  if (updInfo.status === 'installer') { api.updatePage(); $('updModal').hidden = true; updInfo = null; return; }
  // On a child's computer an update needs the parent PIN, like the rest of Settings.
  if (state.family.role === 'child' && !state.family.adminOk) {
    $('updModal').hidden = true;
    const ok = await askPin(t('gateChild'));
    $('updModal').hidden = false;
    if (!ok) return;
  }
  $('updNow').disabled = true;
  $('updLater').disabled = true;
  $('updNewMsg').textContent = t('updChecking');
  const res = await api.updateRun();
  if (res.status === 'ready') { $('updNewMsg').textContent = t('updRestart'); return; } // the app restarts by itself
  if (res.status === 'latest') { $('updModal').hidden = true; updInfo = null; return; }
  $('updNow').disabled = false;
  $('updLater').disabled = false;
  $('updNewMsg').textContent = res.status === 'installer' ? t('updInstaller') : res.status === 'dev' ? t('updDev') : t('updFailed', { e: res.error || '' });
});

// ---------- AI chat ----------
let chat = []; // { role, content, error? }
let streaming = null; // { id, index }
let chatSeq = 0;

function renderChat() {
  const box = $('chat');
  if (!chat.length) {
    const w = document.createElement('div');
    w.className = 'welcome';
    const p = document.createElement('div');
    p.textContent = state.settings.hasApiKey ? t('aiWelcome') : t('aiNeedKey');
    w.append(p);
    if (state.settings.hasApiKey) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      for (const k of ['sug1', 'sug2', 'sug3']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = t(k);
        b.addEventListener('click', () => sendChat(t(k)));
        chips.append(b);
      }
      w.append(chips);
    }
    box.replaceChildren(w);
  } else {
    box.replaceChildren(...chat.map((m, i) => {
      const el = document.createElement('div');
      el.className = `msg ${m.role}` + (m.error ? ' error' : '') + (streaming && streaming.index === i ? ' pending' : '');
      el.textContent = m.content;
      return el;
    }));
    box.scrollTop = box.scrollHeight;
  }
  $('chatSend').textContent = streaming ? t('stop') : t('send');
  $('chatSend').disabled = !streaming && !state.settings.hasApiKey;
}

async function sendChat(text) {
  if (streaming || !text.trim() || !state.settings.hasApiKey) return;
  chat.push({ role: 'user', content: text.trim() });
  const history = chat.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
  chat.push({ role: 'assistant', content: '' });
  const mine = { id: ++chatSeq, index: chat.length - 1 };
  streaming = mine;
  renderChat();
  const res = await api.aiSend({ id: mine.id, messages: history });
  const msg = chat[mine.index];
  if (streaming === mine) streaming = null;
  if (msg) {
    if (!res.ok) { msg.error = true; msg.content = res.error || t('aiError', { e: '' }); }
    else if (!msg.content) chat.splice(mine.index, 1);
  }
  renderChat();
}

api.onAiChunk(({ id, text }) => {
  if (!streaming || streaming.id !== id) return;
  chat[streaming.index].content += text;
  const box = $('chat');
  const el = box.children[streaming.index];
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  if (el) el.textContent = chat[streaming.index].content;
  if (atBottom) box.scrollTop = box.scrollHeight;
});

const input = $('chatInput');
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (streaming) { api.aiCancel(streaming.id); return; }
  const v = input.value;
  input.value = '';
  input.style.height = '';
  sendChat(v);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chatForm').requestSubmit(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight + 2, 120)}px`;
});
$('newChat').addEventListener('click', () => {
  if (streaming) api.aiCancel(streaming.id);
  streaming = null;
  chat = [];
  renderChat();
});

// ---------- family mode ----------
const LOCK_IDS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'juma'];
const ALERT_KEYS = { killed: 'alKilled', taskmgr: 'alTaskmgr', pinfail: 'alPinfail', pinunlock: 'alPinunlock' };
let currentView = 'times';
let pinDone = null;

// Shows the PIN box; the promise gives true once the right PIN was entered.
function askPin(why) {
  if (state.family.adminOk) return Promise.resolve(true);
  $('pinWhy').textContent = why;
  $('pinMsg').textContent = '';
  $('pinInput').value = '';
  $('pinModal').hidden = false;
  $('pinInput').focus();
  return new Promise((resolve) => { pinDone = resolve; });
}
function closePin(ok) {
  $('pinModal').hidden = true;
  if (pinDone) pinDone(ok);
  pinDone = null;
}
$('pinCancel').addEventListener('click', () => closePin(false));
$('pinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api.familyAuth($('pinInput').value);
  $('pinInput').value = '';
  if (r.ok) { state.family.adminOk = true; closePin(true); return; }
  $('pinMsg').textContent = r.wait ? t('pinWait', { s: r.wait }) : t('pinWrong');
});

function fmtLeft(ms) {
  const s = Math.ceil(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
function fmtWhen(ts) {
  const h12 = state.settings.hour12;
  return new Intl.DateTimeFormat(h12 ? 'en-US' : 'en-GB', {
    day: '2-digit', month: '2-digit', hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: h12,
  }).format(new Date(ts));
}
function note(text) {
  const p = document.createElement('p');
  p.className = 'muted small';
  p.textContent = text;
  return p;
}

function renderFamily() {
  const f = state.family;
  document.querySelector('.tab[data-view="family"]').hidden = f.role === 'none';
  document.querySelectorAll('.parent-only').forEach((el) => { el.hidden = f.role !== 'parent'; });
  // The PIN is asked again after the window was closed, so leave protected screens.
  const needsPin = (currentView === 'family' && (f.role === 'none' || (f.role === 'parent' && !f.adminOk)))
    || (currentView === 'settings' && f.role === 'child' && !f.adminOk);
  if (needsPin && $('pinModal').hidden) showView('times', true);

  // Card in Settings
  $('famNone').hidden = f.role !== 'none';
  $('famParentBox').hidden = f.role !== 'parent';
  $('famChildBox').hidden = f.role !== 'child';
  $('famChild').hidden = !f.isWin;
  $('famWinOnly').hidden = f.isWin;
  $('famLinkErr').textContent = f.linkError ? t('linkProblem', { e: f.linkError }) : '';
  $('famChildIs').textContent = t('roleIsChild', { n: f.name });
  if (document.activeElement !== $('famNameEdit')) $('famNameEdit').value = f.name;
  $('famParentSeen').textContent = t(f.parentSeen ? 'parentSeen' : 'parentNotSeen');
  $('famTm').textContent = t(f.taskMgrOff ? 'tmUnblock' : 'tmBlock');
  $('famTmHelp').textContent = t('tmHelp', { s: t(f.taskMgrOff ? 'tmOff' : 'tmOn') });
  renderScores(f);
  if (f.role !== 'parent') return;

  // Prayers waiting for the parent's answer
  $('pendingList').replaceChildren(...(!f.pending.length ? [note(t('noPending'))] : f.pending.map((p) => {
    const row = document.createElement('div');
    row.className = 'kid';
    const text = document.createElement('div');
    text.className = 'kid-text';
    const name = document.createElement('strong');
    name.textContent = `${p.name} · ${t(p.prayer)}`;
    const when = document.createElement('small');
    when.textContent = fmtWhen(p.ts);
    text.append(name, when);
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'primary';
    yes.textContent = t('prayedYes');
    yes.addEventListener('click', () => api.familyConfirmPrayer(p.id, true));
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'ghost';
    no.textContent = t('prayedNo');
    no.addEventListener('click', () => api.familyConfirmPrayer(p.id, false));
    const btns = document.createElement('div');
    btns.className = 'kid-btns';
    btns.append(no, yes);
    row.append(text, btns);
    return row;
  })));

  // Family panel: children's computers
  $('kidList').replaceChildren(...(!f.children.length ? [note(t('noChildren'))] : f.children.map((c) => {
    const row = document.createElement('div');
    row.className = 'kid' + (c.locked ? ' locked' : '');
    const text = document.createElement('div');
    text.className = 'kid-text';
    const name = document.createElement('strong');
    name.textContent = c.name;
    const st = document.createElement('small');
    st.textContent = c.locked ? `${t('stLocked', { t: fmtLeft(c.left) })}${c.prayer ? ` · ${t(c.prayer)}` : ''}`
      : c.online ? t('stOnline') : `${t('stOffline')} · ${fmtWhen(c.lastSeen)}`;
    text.append(name, st);
    row.append(text);
    if (c.locked || !c.online) {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (c.locked) {
        btn.className = 'primary';
        btn.textContent = c.unlocking ? t('unlocking') : t('unlock');
        btn.disabled = c.unlocking;
        btn.addEventListener('click', () => api.familyUnlock(c.id));
      } else {
        btn.className = 'ghost';
        btn.textContent = t('remove');
        btn.addEventListener('click', () => api.familyForget(c.id));
      }
      row.append(btn);
    }
    return row;
  })));

  // Lock settings
  if (document.activeElement !== $('lockMinutes')) $('lockMinutes').value = f.cfg.lockMinutes;
  const box = $('lockFor');
  if (box.dataset.lang !== state.settings.language) {
    box.dataset.lang = state.settings.language;
    box.replaceChildren(...LOCK_IDS.map((id) => {
      const label = document.createElement('label');
      label.className = 'line';
      const span = document.createElement('span');
      span.textContent = t(id);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.id = id;
      cb.addEventListener('change', () => api.familyCfg({ lockFor: { [id]: cb.checked } }));
      label.append(span, cb);
      return label;
    }));
  }
  for (const cb of box.querySelectorAll('input')) cb.checked = f.cfg.lockFor[cb.dataset.id] !== false;

  // Alerts
  $('alertsClear').hidden = !f.alerts.length;
  $('alertList').replaceChildren(...(!f.alerts.length ? [note(t('noAlerts'))] : f.alerts.map((a) => {
    const row = document.createElement('div');
    row.className = 'alert';
    const head = document.createElement('small');
    head.textContent = `${fmtWhen(a.ts)} · ${a.name}`;
    const body = document.createElement('div');
    body.textContent = t(ALERT_KEYS[a.type] || a.type);
    row.append(head, body);
    return row;
  })));
}

// The hasanat scoreboard, shown on the parent's and on every child's computer.
function renderScores(f) {
  const b = f.board;
  const rows = b ? b.rows : [];
  const top = rows.length && rows[0].week > 0 ? rows[0].week : -1;
  const head = document.createElement('div');
  head.className = 'score head';
  for (const text of ['', t('scoreWeek'), t('scoreTotal')]) {
    const c = document.createElement('span');
    c.textContent = text;
    head.append(c);
  }
  $('scoreList').replaceChildren(...(!rows.length ? [note(t('noScores'))] : [head, ...rows.map((r) => {
    const row = document.createElement('div');
    row.className = 'score' + (r.week === top ? ' lead' : '') + (r.id === f.myId ? ' me' : '');
    const name = document.createElement('strong');
    name.textContent = (r.week === top ? '★ ' : '') + r.name;
    const week = document.createElement('span');
    week.textContent = r.week;
    const total = document.createElement('span');
    total.textContent = r.total;
    row.append(name, week, total);
    if (f.role === 'parent') {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'ghost';
      add.textContent = t('addPrayer');
      add.title = t('addPrayerHelp');
      add.addEventListener('click', () => api.familyAddPrayer(r.id));
      row.append(add);
    }
    return row;
  })]));
  $('scoreWinner').textContent = b && b.lastWinner ? t('lastWinner', { n: b.lastWinner.names.join(', '), p: b.lastWinner.points }) : '';
}

let setupRole = null;
function openSetup(role) {
  setupRole = role;
  $('famSetup').hidden = !role;
  $('famSetupRole').textContent = role ? t(role === 'parent' ? 'roleParentBtn' : 'roleChildBtn') : '';
  $('famSetupMsg').textContent = '';
  $('famName').hidden = role !== 'child';
  $('famName').value = '';
  $('famPin1').value = '';
  $('famPin2').value = '';
  if (role) $(role === 'child' ? 'famName' : 'famPin1').focus();
}
$('famParent').addEventListener('click', () => openSetup('parent'));
$('famChild').addEventListener('click', () => openSetup('child'));
$('famSetupCancel').addEventListener('click', () => openSetup(null));
$('famSetup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = $('famPin1').value;
  if (!/^\d{4,12}$/.test(a)) { $('famSetupMsg').textContent = t('pinBad'); return; }
  if (a !== $('famPin2').value) { $('famSetupMsg').textContent = t('pinMismatch'); return; }
  const r = await api.familySetup(setupRole, a, $('famName').value);
  if (!r.ok) { $('famSetupMsg').textContent = t(r.error); return; }
  openSetup(null);
});
document.querySelectorAll('.fam-off').forEach((b) => b.addEventListener('click', async () => {
  if (await askPin(t('pinEnter'))) await api.familyLeave();
}));
$('famRename').addEventListener('submit', (e) => { e.preventDefault(); api.familyName($('famNameEdit').value); $('famNameEdit').blur(); });
$('famTest').addEventListener('click', () => api.familyTestLock());
$('famTm').addEventListener('click', async () => {
  $('famTm').disabled = true;
  state.family = await api.familyTaskMgr(!state.family.taskMgrOff);
  $('famTm').disabled = false;
  renderFamily();
});
$('famQuit').addEventListener('click', () => api.familyQuit());
$('lockMinutes').addEventListener('change', (e) => {
  const n = Math.round(Number(e.target.value));
  if (n >= 1 && n <= 120) api.familyCfg({ lockMinutes: n });
});
$('alertsClear').addEventListener('click', () => api.familyClearAlerts());
api.onFamily((f) => { if (state) { state.family = f; renderFamily(); } });

// ---------- navigation & state ----------
async function showView(name, force) {
  const f = state.family;
  if (!force && name === 'settings' && f.role === 'child' && !(await askPin(t('gateChild')))) return;
  if (!force && name === 'family' && f.role === 'parent' && !(await askPin(t('gateParent')))) return;
  currentView = name;
  for (const v of ['times', 'ai', 'family', 'settings']) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'ai') input.focus();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('locBtn').addEventListener('click', async () => { await showView('settings'); if (currentView === 'settings') $('cityInput').focus(); });

function setState(next) {
  state = next;
  applyStrings();
  fillSettings();
  renderChat();
  renderFamily();
  renderUpdModal();
  syncAdhanUi();
  applyTheme();
  loadTimes();
}
api.onState(setState);

(async () => {
  const first = await api.getState();
  locating = !first.settings.location && first.settings.locationMode === 'auto';
  setState(first);
  setTimeout(() => { locating = false; if (!times) renderTimes(); }, 15000);
  setInterval(() => { if (times) renderTimes(); }, 1000);
  setInterval(loadTimes, 60000); // picks up the new day after midnight
})();
