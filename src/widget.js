/* global api, WISDOM, HIJRI */
// Desktop widget: the next prayer with a countdown, and below it a hadith and a short dua
// that change once a day (or as often as chosen in Settings).
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

let state = null;
let times = null;
let shownSlot = null;
let lastHeight = 0;

function renderPrayer() {
  const S = state.strings;
  $('label').textContent = S.nextPrayer;
  const now = Date.now();
  const next = times && [...times.today, ...times.tomorrow].find((e) => e.id !== 'sunrise' && e.time > now);
  if (!next) {
    $('name').textContent = '—';
    $('clock').textContent = '';
    $('count').textContent = '--:--:--';
    return;
  }
  const h12 = state.settings.hour12;
  $('name').textContent = S[next.id];
  $('clock').textContent = new Intl.DateTimeFormat(h12 ? 'en-US' : 'en-GB', {
    timeZone: times.tz, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hour12: h12,
  }).format(new Date(next.time));
  const s = Math.max(0, Math.ceil((next.time - now) / 1000));
  $('count').textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// One line with the days until Ramadan, or the day of Ramadan and the days left.
function renderRamadan() {
  if (!times) { $('ram').hidden = true; return; }
  const r = HIJRI.ramadan(times.tz, state.settings.hijriAdjust);
  const S = state.strings;
  $('ram').hidden = false;
  $('ram').textContent = r.inRamadan
    ? S.ramadanDay.replace('{d}', r.day).replace('{n}', r.left)
    : S.ramadanIn.replace('{n}', r.until);
}

// Which hadith and dua to show now. The slot number grows by one every refresh period,
// counted in local time, so "once a day" changes at midnight.
function renderWisdom() {
  const on = state.settings.widgetHadith;
  $('wisdom').hidden = !on;
  if (!on) { shownSlot = null; return; }
  const period = (state.settings.hadithHours || 24) * 3600000;
  const slot = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / period);
  const key = `${slot}|${state.settings.language}|${state.family.role}`;
  if (key === shownSlot) return;
  shownSlot = key;

  const L = WISDOM.lang[state.settings.language] || WISDOM.lang.en;
  // On a child's computer only the hadiths chosen for children are shown.
  let pool = WISDOM.hadiths.map((h, i) => ({ ...h, i }));
  if (state.family.role === 'child') pool = pool.filter((h) => h.kids);
  const h = pool[slot % pool.length];
  $('hadith').textContent = L.hadiths[h.i];
  $('hadithSrc').textContent = [h.src.includes('b') ? L.b : null, h.src.includes('m') ? L.m : null].filter(Boolean).join(' · ');

  const d = slot % WISDOM.duas.length;
  $('duaAr').textContent = WISDOM.duas[d].ar;
  $('dua').textContent = L.duas[d];
  $('duaSrc').textContent = `${L.quran} ${WISDOM.duas[d].ref}`;
}

function render() {
  if (!state) return;
  renderPrayer();
  renderRamadan();
  renderWisdom();
  // The window follows the height of the card, so longer texts are never cut off.
  const h = Math.ceil($('card').getBoundingClientRect().height) + 12;
  if (h !== lastHeight) { lastHeight = h; api.widgetSize(h); }
}

async function load() {
  times = await api.getTimes();
  render();
}

function setState(next) {
  state = next;
  document.documentElement.lang = state.settings.language;
  document.documentElement.dir = state.strings.dir;
  load();
}

$('open').addEventListener('click', () => api.showMain());
api.onState(setState);
(async () => {
  setState(await api.getState());
  setInterval(render, 1000);
  setInterval(load, 60000); // new day, new times
  // Settings changes are pushed to the widget; asking again every few seconds makes sure the
  // language and the other settings can never stay out of step with the app.
  setInterval(async () => {
    const fresh = await api.getState();
    if (JSON.stringify(fresh.settings) !== JSON.stringify(state.settings) || fresh.family.role !== state.family.role) setState(fresh);
  }, 5000);
})();
