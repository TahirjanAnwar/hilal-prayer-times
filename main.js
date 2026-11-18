const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, dialog, nativeImage, safeStorage, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const Anthropic = require('@anthropic-ai/sdk');
const prayer = require('./src/prayer');
const i18n = require('./src/i18n');
const family = require('./family');
const updater = require('./updater');

const START_HIDDEN = process.argv.includes('--hidden');
const ADHAN_IDS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha', 'juma'];
const HADITH_MINUTES = [10, 30, 60, 180, 360, 720, 1440];
const TEMP_UNITS = ['auto', 'c', 'f', 'off'];
const THEMES = ['auto', 'system', 'day', 'night', 'relaxed', 'emerald', 'glassDark', 'glassLight'];

// Let the adhan play without a click, even when the window is hidden.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let widget = null;
let tray = null;
let quitting = false;
let adhanPlaying = false;

// ---------- settings ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  language: null, // filled from the system language on first run
  locationMode: 'auto', // 'auto' | 'manual'
  location: null, // { city, country, countryCode, lat, lon, tz }
  method: 'auto',
  madhab: 'standard',
  jumaTime: '13:30',
  hour12: false,
  adhanEnabled: true,
  adhanFor: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true, juma: true },
  volume: 0.8,
  adhanChoice: 1, // built-in adhan 1-7 for every prayer except Fajr
  adhanFile: null, // own file, used instead of the built-in choice
  startup: true,
  widget: true, // small always-there window on the desktop with the next prayer
  widgetTop: false, // keep the widget above other windows
  widgetPos: null, // { x, y } after the user dragged it
  widgetHadith: true, // show a hadith and a dua on the widget
  hadithHours: 24, // (older versions) how often they change, in hours
  hadithMinutes: null, // how often they change: 10, 30, 60, 180, 360, 720 or 1440 minutes
  tempUnit: 'auto', // the weather: 'auto' (Fahrenheit where that is usual, else Celsius) | 'c' | 'f' | 'off'
  theme: 'auto', // 'auto' (day after sunrise, night after Maghrib) | 'system' | 'day' | 'night' | 'relaxed' | 'emerald' | 'glassDark' | 'glassLight'
  glass: 60, // how see-through the panes of the two glass looks are, 0 (solid) to 100 (clear)
  hijriAdjust: 0, // days to shift the calculated Islamic date, -2..2, to match the local moon sighting
  updateCheck: true, // look for a new version by itself and tell the user
  apiKeyEnc: null,
  firstRunDone: false,
};

let settings = { ...DEFAULTS };

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, ...raw, adhanFor: { ...DEFAULTS.adhanFor, ...(raw.adhanFor || {}) } };
  } catch {
    settings = { ...DEFAULTS };
  }
  if (!HADITH_MINUTES.includes(settings.hadithMinutes)) settings.hadithMinutes = HADITH_MINUTES.includes(settings.hadithHours * 60) ? settings.hadithHours * 60 : 1440;
  if (!i18n.LANG_CODES.includes(settings.language)) {
    const sys = (app.getLocale() || 'en').toLowerCase();
    const code = sys.split('-')[0];
    settings.language = code === 'nb' || code === 'nn' ? 'no' : i18n.LANG_CODES.includes(code) ? code : 'en';
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Could not save settings', e);
  }
}

// What the window is allowed to see (never the API key itself).
function publicState() {
  const { apiKeyEnc, familyEnc, ...rest } = settings;
  return {
    settings: {
      ...rest,
      hasApiKey: !!apiKeyEnc,
      adhanUrl: adhanUrl(),
      fajrAdhanUrl: pathToFileURL(path.join(__dirname, 'assets', 'fajr.mp3')).href,
      adhanCount: ADHAN_COUNT,
      adhanFileName: settings.adhanFile ? path.basename(settings.adhanFile) : null,
    },
    strings: i18n.strings(settings.language),
    methods: prayer.METHODS,
    resolvedMethod: settings.location
      ? prayer.resolveMethod(settings.method, settings.location.countryCode) : null,
    qibla: settings.location ? prayer.qibla(settings.location) : null,
    version: updater.version(),
    seeThrough: winGlass, // the main window is a see-through one
    weather: settings.tempUnit !== 'off' && weather && weather.place === placeKey() ? { c: weather.c, code: weather.code, day: weather.day } : null,
    family: family.view(),
  };
}

const ADHAN_COUNT = 7;

// Fajr always uses its own adhan; this is the one for the other prayers.
function adhanUrl() {
  const custom = settings.adhanFile && fs.existsSync(settings.adhanFile) ? settings.adhanFile : null;
  return pathToFileURL(custom || path.join(__dirname, 'assets', `adhan-${settings.adhanChoice}.mp3`)).href;
}

function applyStartup() {
  if (!app.isPackaged) return; // don't register the development build
  app.setLoginItemSettings({ openAtLogin: !!settings.startup || family.role() === 'child', args: ['--hidden'] });
}

function broadcast() {
  const st = publicState();
  for (const w of [win, widget]) if (w && !w.isDestroyed()) w.webContents.send('state:changed', st);
  refreshTray();
}

// ---------- prayer times ----------
function dayPlan(now = Date.now()) {
  const loc = settings.location;
  if (!loc) return null;
  const tz = prayer.safeTz(loc.tz);
  const today = prayer.cityDate(tz, new Date(now));
  return {
    tz,
    dateKey: `${today.y}-${today.m}-${today.d}`,
    yesterday: prayer.computeDay(loc, settings, prayer.addDays(today, -1)),
    today: prayer.computeDay(loc, settings, today),
    tomorrow: prayer.computeDay(loc, settings, prayer.addDays(today, 1)),
  };
}

function nextPrayer(now = Date.now()) {
  const plan = dayPlan(now);
  if (!plan) return null;
  const all = [...plan.today, ...plan.tomorrow].filter((e) => e.id !== 'sunrise');
  const next = all.find((e) => e.time > now);
  return next ? { ...next, tz: plan.tz } : null;
}

const fired = new Set();

function tick() {
  const now = Date.now();
  const plan = dayPlan(now);
  if (!plan) return;
  family.tick(plan, now);
  for (const e of [...plan.yesterday, ...plan.today]) {
    if (!ADHAN_IDS.includes(e.id)) continue;
    const key = `${e.id}:${e.time}`;
    if (now >= e.time && now - e.time < 60000 && !fired.has(key)) {
      fired.add(key);
      if (fired.size > 50) fired.delete(fired.values().next().value);
      announce(e.id);
    }
  }
}

function announce(id) {
  const s = i18n.strings(settings.language);
  const body = s.timeFor.replace('{p}', s[id]);
  if (Notification.isSupported()) {
    const n = new Notification({ title: s[id], body, silent: true, icon: iconPath() });
    n.on('click', showWindow);
    n.show();
  }
  const play = settings.adhanEnabled && settings.adhanFor[id] !== false;
  for (const target of [win, widget]) if (target && !target.isDestroyed()) target.webContents.send('prayer:now', { id, play });
}

// ---------- location ----------
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'PrayerTimesApp/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// City-level location from the internet connection (no GPS permission needed).
async function detectLocation() {
  const sources = [
    async () => {
      const j = await getJson('https://ipwho.is/');
      if (!j.success) throw new Error('lookup failed');
      return { city: j.city, country: j.country, countryCode: j.country_code, lat: j.latitude, lon: j.longitude, tz: j.timezone && j.timezone.id };
    },
    async () => {
      const j = await getJson('https://ipapi.co/json/');
      if (j.error) throw new Error('lookup failed');
      return { city: j.city, country: j.country_name, countryCode: j.country_code, lat: j.latitude, lon: j.longitude, tz: j.timezone };
    },
  ];
  for (const source of sources) {
    try {
      const loc = await source();
      if (Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
        loc.tz = loc.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
        return loc;
      }
    } catch { /* try the next source */ }
  }
  return null;
}

// ---------- weather ----------
// The temperature and the kind of weather right now at the chosen place, from Open-Meteo
// (free, no account). Only the place's coordinates, rounded to about a kilometre, are sent.
let weather = null; // { c, code, day, at, place }
const placeKey = () => (settings.location ? `${settings.location.lat.toFixed(2)},${settings.location.lon.toFixed(2)}` : '');

async function refreshWeather() {
  const place = placeKey();
  if (!place || settings.tempUnit === 'off') return;
  try {
    const [lat, lon] = place.split(',');
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day`);
    const c = j && j.current;
    if (!c || !Number.isFinite(c.temperature_2m)) throw new Error('no data');
    weather = { c: c.temperature_2m, code: Number(c.weather_code) || 0, day: c.is_day !== 0, at: Date.now(), place };
  } catch {
    // keep the last reading for a while; an old temperature is worse than none
    if (weather && Date.now() - weather.at > 60 * 60000) weather = null;
  }
  broadcast();
}

async function refreshAutoLocation() {
  const loc = await detectLocation();
  if (loc && settings.locationMode === 'auto') {
    settings.location = loc;
    saveSettings();
    broadcast();
    refreshWeather();
  }
  return !!loc;
}

async function searchCities(query) {
  const q = String(query || '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const lang = ['nl', 'tr', 'de', 'fr', 'ja', 'es', 'it', 'pt', 'ru'].includes(settings.language) ? settings.language : 'en'; // languages the city search knows
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=8&format=json&language=${lang}&name=${encodeURIComponent(q)}`);
  return (j.results || []).map((r) => ({
    city: r.name, region: r.admin1 || '', country: r.country || '', countryCode: r.country_code || '',
    lat: r.latitude, lon: r.longitude, tz: r.timezone || 'UTC',
  }));
}

// ---------- AI assistant ----------
const AI_SYSTEM = `You are a knowledgeable, gentle assistant inside a Muslim prayer-times desktop app. People ask you about Islam: beliefs, worship, the Quran, hadith, the lives of the prophets and companions, history, and everyday practice.

Accuracy matters more than anything else here, because people may act on what you say. Quote the Quran only when you are confident of the wording, and give the surah and ayah number. For hadith, name the collection (for example Sahih al-Bukhari or Sahih Muslim) and mention the grading when you know it; if you are not sure a narration is authentic or cannot recall its source, say so plainly instead of presenting it as established. Never invent a reference.

Where the schools of law differ, say that they differ and summarise the main positions fairly instead of presenting one as the only view. For personal rulings that depend on someone's circumstances (divorce, inheritance, medical matters, finance), explain the general principles and recommend asking a qualified local scholar.

Answer in the language the person writes in. The app is used in many languages, among them English, Uyghur (Arabic script), Arabic, Urdu, Hindi, Indonesian, Turkish, Uzbek, Russian, Dutch, German, French, Spanish, Italian, Portuguese, Norwegian, Swedish, Finnish, Japanese and Korean. Write in plain text without Markdown symbols such as asterisks or pound signs, because the chat window shows text exactly as written. Keep answers focused; tell stories warmly and at a comfortable length. If asked about something unrelated to Islam, answer briefly and kindly.`;

function getApiKey() {
  if (!settings.apiKeyEnc) return null;
  try {
    const buf = Buffer.from(settings.apiKeyEnc.data, 'base64');
    return settings.apiKeyEnc.enc ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    return null;
  }
}

function setApiKey(key) {
  const k = String(key || '').trim();
  if (!k) {
    settings.apiKeyEnc = null;
  } else if (safeStorage.isEncryptionAvailable()) {
    settings.apiKeyEnc = { enc: true, data: safeStorage.encryptString(k).toString('base64') };
  } else {
    settings.apiKeyEnc = { enc: false, data: Buffer.from(k, 'utf8').toString('base64') };
  }
  saveSettings();
}

const aiStreams = new Map();

async function aiSend(event, { id, messages }) {
  const s = i18n.strings(settings.language);
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error: s.aiNeedKey };
  const history = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-40)
    .map((m) => ({ role: m.role, content: m.content }));
  if (!history.length) return { ok: false, error: '' };

  const client = new Anthropic({ apiKey });
  try {
    // If the main model declines a request, the API retries it on a fallback model.
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: AI_SYSTEM,
      messages: history,
    });
    aiStreams.set(id, stream);
    stream.on('text', (delta) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:chunk', { id, text: delta });
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') return { ok: false, error: s.aiDeclined };
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) return { ok: true, aborted: true };
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { ok: false, error: s.aiBadKey };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: s.aiBusy };
    if (err instanceof Anthropic.APIError && err.status >= 500) return { ok: false, error: s.aiBusy };
    return { ok: false, error: s.aiError.replace('{e}', err && err.message ? err.message : String(err)) };
  } finally {
    aiStreams.delete(id);
  }
}

// ---------- window & tray ----------
function iconPath() {
  return path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

// The window has rounded corners in every look. Windows 10 only allows that for a window
// that is see-through and has no title bar, so the main window is always made that way:
// the page draws its own minimise and close buttons (there is no maximise), the header
// moves the window and it cannot be resized. In the two glass looks the desktop shows
// through the panes; the other looks paint a solid, rounded background.
const isGlass = () => true;
let winGlass = false;
let swapping = false;

async function syncWindowKind() {
  if (!win || win.isDestroyed() || winGlass === isGlass() || adhanPlaying || swapping) return;
  swapping = true;
  try {
    const old = win;
    let view = 'times';
    try { view = await old.webContents.executeJavaScript('currentView'); } catch { /* page not ready */ }
    if (old.isDestroyed() || winGlass === isGlass()) return;
    const bounds = old.getBounds();
    const show = old.isVisible();
    old.removeAllListeners('hide'); // not a real hide: the parent PIN stays accepted
    old.destroy();
    createWindow({ bounds, show, view: view === 'settings' ? view : null });
  } finally {
    swapping = false;
  }
}

function createWindow(opts = {}) {
  winGlass = isGlass();
  const show = opts.show === undefined ? !START_HIDDEN : opts.show;
  win = new BrowserWindow({
    width: 440,
    height: 830,
    minWidth: 380,
    minHeight: 600,
    ...(opts.bounds || {}),
    show: false,
    ...(winGlass
      ? { frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, maximizable: false, fullscreenable: false, hasShadow: false }
      : { backgroundColor: '#0f2238' }),
    autoHideMenuBar: true,
    icon: iconPath(),
    title: 'Hilal Prayer Times',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep timers and audio running while hidden
    },
  });
  const w = win;
  w.setMenu(null);
  w.loadFile(path.join(__dirname, 'src', 'index.html'), opts.view ? { hash: opts.view } : undefined);
  w.once('ready-to-show', () => { if (show && !w.isDestroyed()) w.show(); });
  win.on('hide', family.lockAdmin); // ask for the parent PIN again next time
  win.on('session-end', family.markCleanExit);
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); w.hide(); } // keep running in the tray
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// ---------- desktop widget ----------
const WIDGET_W = 350;
const WIDGET_H = 96; // before the page reports its real height
let widgetH = WIDGET_H;

function widgetPosition() {
  const p = settings.widgetPos;
  const onScreen = p && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return p.x + WIDGET_W > a.x + 40 && p.x < a.x + a.width - 40 && p.y >= a.y && p.y < a.y + a.height - 40;
  });
  if (onScreen) return { x: p.x, y: p.y };
  const a = screen.getPrimaryDisplay().workArea; // default: bottom right corner
  return { x: a.x + a.width - WIDGET_W - 24, y: a.y + a.height - WIDGET_H - 24 };
}

// Shows or removes the widget to match the settings. It has no close button, and closing
// it another way (Alt+F4) is refused; it only goes away through Settings, which a child's
// computer protects with the parent PIN.
function syncWidget() {
  if (!settings.widget) {
    if (widget && !widget.isDestroyed()) widget.destroy();
    widget = null;
    return;
  }
  if (widget && !widget.isDestroyed()) {
    widget.setAlwaysOnTop(!!settings.widgetTop);
    return;
  }
  widget = new BrowserWindow({
    ...widgetPosition(),
    width: WIDGET_W,
    height: WIDGET_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: !!settings.widgetTop,
    title: 'Hilal Prayer Times',
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}), // keeps it out of Alt+Tab
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const w = widget;
  w.setMenu(null);
  w.loadFile(path.join(__dirname, 'src', 'widget.html'));
  w.once('ready-to-show', () => w.showInactive());
  w.on('close', (e) => { if (!quitting) e.preventDefault(); });
  w.on('minimize', () => w.restore());
  // If the window is destroyed some other way, put it back.
  w.on('closed', () => {
    if (widget === w) widget = null;
    if (!quitting && settings.widget) setTimeout(syncWidget, 300);
  });
  w.on('moved', () => {
    const [x, y] = w.getPosition();
    settings.widgetPos = { x, y };
    saveSettings();
  });
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function removeWidget() {
  if (widget && !widget.isDestroyed()) widget.destroy();
  widget = null;
}

// The widget page reports how tall its card is; the window follows, staying on screen.
function setWidgetHeight(h) {
  if (!widget || widget.isDestroyed() || !Number.isFinite(h)) return;
  widgetH = Math.min(720, Math.max(70, Math.round(h)));
  const [x, y] = widget.getPosition();
  const a = screen.getDisplayMatching({ x, y, width: WIDGET_W, height: widgetH }).workArea;
  const top = Math.max(a.y, Math.min(y, a.y + a.height - widgetH - 8));
  widget.setBounds({ x, y: top, width: WIDGET_W, height: widgetH });
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); win.once('ready-to-show', () => win.show()); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (lastUpdateCheck && Date.now() - lastUpdateCheck > UPDATE_ON_OPEN_AFTER) checkUpdates();
}

function fmtTime(ms, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: !!settings.hour12 }).format(new Date(ms));
}

function refreshTray() {
  if (!tray) return;
  const s = i18n.strings(settings.language);
  const next = nextPrayer();
  const nextLabel = next ? `${s[next.id]}  ${fmtTime(next.time, next.tz)}` : s.noLocation;
  tray.setToolTip(`${s.appName}\n${nextLabel}`);
  const items = [
    { label: nextLabel, enabled: false },
    { type: 'separator' },
    { label: s.open, click: showWindow },
  ];
  if (adhanPlaying) items.push({ label: s.stopAdhan, click: () => win && win.webContents.send('adhan:stop') });
  items.push(
    { label: s.playAdhan, type: 'checkbox', checked: !!settings.adhanEnabled, click: (item) => { settings.adhanEnabled = item.checked; saveSettings(); broadcast(); } },
  );
  // On a child's computer the app can only be closed from Settings, after the parent PIN.
  if (family.role() !== 'child') items.push({ type: 'separator' }, { label: s.quit, click: () => { quitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (process.platform === 'darwin') img = img.resize({ width: 18, height: 18 });
  tray = new Tray(img);
  tray.on('click', showWindow);
  refreshTray();
}

// ---------- update check ----------
// The app looks for a new version shortly after it starts, then every half hour, and also
// when its window is opened (if the last look was more than ten minutes ago). An unchanged
// repository costs one small request, so this stays far below GitHub's hourly limit. When
// there is one, the main window comes up with a message and a short sound. "Later" keeps
// that version quiet for a day.
const UPDATE_EVERY = 30 * 60000;
const UPDATE_ON_OPEN_AFTER = 10 * 60000;
let lastUpdateCheck = 0;
const UPDATE_SNOOZE = 24 * 3600000;
let updateTold = { commit: null, until: 0 };

function tellUpdate(info) {
  if (!win || win.isDestroyed()) createWindow();
  const w = win;
  const send = () => {
    if (w.isDestroyed()) return;
    if (!w.isVisible()) w.showInactive(); // comes up without taking the keyboard away
    w.flashFrame(true);
    w.once('focus', () => w.flashFrame(false));
    w.webContents.send('update:available', info);
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send); else send();
}

async function checkUpdates() {
  if (!settings.updateCheck) return;
  lastUpdateCheck = Date.now();
  const r = await updater.check();
  if (r.status !== 'available' && r.status !== 'installer') return;
  if (updateTold.commit === r.commit && Date.now() < updateTold.until) return;
  updateTold = { commit: r.commit, until: Date.now() + UPDATE_SNOOZE };
  tellUpdate({ status: r.status, version: r.version });
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('state:get', () => publicState());
  ipcMain.handle('times:get', () => {
    const plan = dayPlan();
    return plan ? { tz: plan.tz, dateKey: plan.dateKey, today: plan.today, tomorrow: plan.tomorrow } : null;
  });

  ipcMain.handle('settings:set', (_e, patch) => {
    let p = patch || {};
    if (family.guarded()) p = { adhanFor: p.adhanFor, theme: p.theme }; // without the PIN only the adhan bells and the colours can be changed
    if (i18n.LANG_CODES.includes(p.language)) settings.language = p.language;
    if (p.method === 'auto' || prayer.METHODS.includes(p.method)) settings.method = p.method;
    if (p.madhab === 'standard' || p.madhab === 'hanafi') settings.madhab = p.madhab;
    if (typeof p.jumaTime === 'string' && /^\d{1,2}:\d{2}$/.test(p.jumaTime)) settings.jumaTime = p.jumaTime;
    if (typeof p.hour12 === 'boolean') settings.hour12 = p.hour12;
    if (typeof p.adhanEnabled === 'boolean') settings.adhanEnabled = p.adhanEnabled;
    if (Number.isInteger(p.adhanChoice) && p.adhanChoice >= 1 && p.adhanChoice <= ADHAN_COUNT) {
      settings.adhanChoice = p.adhanChoice;
      settings.adhanFile = null;
    }
    if (typeof p.volume === 'number') settings.volume = Math.min(1, Math.max(0, p.volume));
    if (p.adhanFor && typeof p.adhanFor === 'object') {
      for (const id of ADHAN_IDS) if (typeof p.adhanFor[id] === 'boolean') settings.adhanFor[id] = p.adhanFor[id];
    }
    if (typeof p.startup === 'boolean') { settings.startup = p.startup; applyStartup(); }
    if (typeof p.widget === 'boolean') settings.widget = p.widget;
    if (typeof p.widgetTop === 'boolean') settings.widgetTop = p.widgetTop;
    if (typeof p.widgetHadith === 'boolean') settings.widgetHadith = p.widgetHadith;
    if (HADITH_MINUTES.includes(p.hadithMinutes)) settings.hadithMinutes = p.hadithMinutes;
    if (TEMP_UNITS.includes(p.tempUnit)) { const was = settings.tempUnit; settings.tempUnit = p.tempUnit; if (was === 'off' && p.tempUnit !== 'off') refreshWeather(); }
    if (THEMES.includes(p.theme)) settings.theme = p.theme;
    if (Number.isFinite(p.glass)) settings.glass = Math.round(Math.min(100, Math.max(0, p.glass)));
    if (Number.isInteger(p.hijriAdjust) && Math.abs(p.hijriAdjust) <= 2) settings.hijriAdjust = p.hijriAdjust;
    if (typeof p.updateCheck === 'boolean') settings.updateCheck = p.updateCheck;
    if ('widget' in p || 'widgetTop' in p) syncWidget();
    saveSettings();
    broadcast();
    syncWindowKind();
    return publicState();
  });

  ipcMain.handle('location:auto', async () => {
    if (family.guarded()) return false;
    settings.locationMode = 'auto';
    saveSettings();
    const ok = await refreshAutoLocation();
    broadcast();
    return ok;
  });
  ipcMain.handle('location:search', async (_e, q) => {
    try { return await searchCities(q); } catch { return []; }
  });
  ipcMain.handle('location:set', (_e, loc) => {
    if (family.guarded() || !loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return false;
    settings.locationMode = 'manual';
    settings.location = {
      city: String(loc.city || ''), country: String(loc.country || ''), countryCode: String(loc.countryCode || ''),
      lat: loc.lat, lon: loc.lon, tz: prayer.safeTz(String(loc.tz || 'UTC')),
    };
    saveSettings();
    broadcast();
    refreshWeather();
    return true;
  });

  ipcMain.handle('adhan:pick', async () => {
    if (family.guarded()) return publicState();
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac'] }],
    });
    if (!r.canceled && r.filePaths[0]) { settings.adhanFile = r.filePaths[0]; saveSettings(); broadcast(); }
    return publicState();
  });
  ipcMain.on('adhan:state', (_e, playing) => { adhanPlaying = !!playing; refreshTray(); if (!adhanPlaying) syncWindowKind(); });

  ipcMain.handle('ai:setKey', (_e, key) => { if (!family.guarded()) setApiKey(key); broadcast(); return publicState(); });
  ipcMain.handle('ai:send', aiSend);
  ipcMain.handle('family:setup', (_e, { role, pin, name } = {}) => family.setup(role, pin, name));
  ipcMain.on('family:name', (_e, name) => family.setChildName(name));
  ipcMain.handle('family:auth', (_e, pin) => family.auth(pin));
  ipcMain.handle('family:leave', () => family.leave());
  ipcMain.handle('family:taskmgr', (_e, block) => family.setTaskMgrBlocked(!!block));
  ipcMain.on('family:cfg', (_e, patch) => family.setCfg(patch));
  ipcMain.on('family:unlock', (_e, id) => family.unlockChild(String(id)));
  ipcMain.on('family:forget', (_e, id) => family.forgetChild(String(id)));
  ipcMain.on('family:confirmPrayer', (_e, { id, prayed } = {}) => family.confirmPrayer(String(id), !!prayed));
  ipcMain.on('family:addPrayer', (_e, id) => family.addPrayer(String(id)));
  ipcMain.on('family:clearAlerts', () => family.clearAlerts());
  ipcMain.on('family:testLock', () => family.testLock());
  ipcMain.on('family:quit', () => { if (!family.guarded()) { quitting = true; app.quit(); } });
  ipcMain.on('window:show', showWindow);
  ipcMain.on('window:min', (e) => { if (win && !win.isDestroyed() && e.sender === win.webContents) win.minimize(); });
  ipcMain.on('window:close', (e) => { if (win && !win.isDestroyed() && e.sender === win.webContents) win.close(); });
  ipcMain.on('widget:size', (e, h) => { if (widget && !widget.isDestroyed() && e.sender === widget.webContents) setWidgetHeight(h); });
  ipcMain.handle('update:run', async (e) => {
    if (family.guarded()) return { status: 'error', error: '' };
    const r = await updater.run((p) => { if (!e.sender.isDestroyed()) e.sender.send('update:progress', p); });
    if (r.status === 'ready') {
      // Restart into the downloaded files, with the same options as this run.
      setTimeout(() => {
        quitting = true;
        family.markCleanExit();
        removeWidget();
        app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') });
        app.exit(0); // exit rather than quit: nothing may hold the restart back
      }, 1200);
    }
    return r;
  });
  ipcMain.on('update:page', () => shell.openExternal(updater.PAGE));
  ipcMain.handle('lock:info', () => family.lockInfo());
  ipcMain.handle('lock:pin', (_e, pin) => family.lockPin(pin));
  ipcMain.on('ai:cancel', (_e, id) => { const st = aiStreams.get(id); if (st) st.abort(); });
}

// ---------- app lifecycle ----------
// The watchdog task starts the app every minute with --watch; that must not pop up the window.
app.on('second-instance', (_e, argv) => { if (!argv.includes('--watch')) showWindow(); });
app.on('before-quit', () => { quitting = true; family.markCleanExit(); removeWidget(); });
app.on('window-all-closed', () => { /* stay alive in the tray */ });
app.on('activate', showWindow);

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.hilal.prayertimes');
  loadSettings();
  if (!settings.firstRunDone) {
    settings.firstRunDone = true;
    saveSettings();
  }
  family.init({
    settings: () => settings,
    save: saveSettings,
    strings: () => i18n.strings(settings.language),
    iconPath,
    preload: path.join(__dirname, 'preload.js'),
    showWindow,
    changed: (view) => { if (win && !win.isDestroyed()) win.webContents.send('family:state', view); },
    roleChanged: () => { applyStartup(); broadcast(); },
  });
  applyStartup();
  registerIpc();
  createWindow();
  createTray();
  syncWidget();
  screen.on('display-removed', () => { if (widget && !widget.isDestroyed()) { const p = widgetPosition(); widget.setPosition(p.x, p.y); } });
  setInterval(tick, 1000);
  setInterval(refreshTray, 60000);
  refreshWeather();
  setInterval(refreshWeather, 15 * 60000);
  if (settings.locationMode === 'auto') refreshAutoLocation();
  setTimeout(updater.cleanup, 5000); // the app started fine: keep this version, remove older downloads
  setTimeout(checkUpdates, 30000);
  setInterval(checkUpdates, UPDATE_EVERY);
  // For trying the update message while running from source code.
  if (!app.isPackaged && process.env.HILAL_TEST_UPDATE) setTimeout(() => tellUpdate({ status: process.env.HILAL_TEST_UPDATE, version: '9.9.9' }), 4000);
});
