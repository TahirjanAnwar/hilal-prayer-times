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
  showDua(WISDOM.duas[d]);
  $('dua').textContent = L.duas[d];
  $('duaSrc').textContent = WISDOM.duas[d].ref ? `${L.quran} ${WISDOM.duas[d].ref}` : WISDOM.duas[d].src;
}

// ---------- the dua read aloud ----------
// The play button plays the verse from Quran.com (only the part that is the dua) and
// lights up each word, in Arabic and in English letters, while it is being recited.
const AUDIO_BASE = 'https://verses.quran.com/';
const audio = $('duaAudio');
let dua = null; // the dua on show
let wordEls = []; // per word: [Arabic span, English-letter span]
let partIndex = -1; // which part is loaded, -1 when stopped
let frame = 0;
let noteTimer = null;

function showDua(d) {
  stopDua();
  dua = d;
  const ar = d.ar.split(' ').map((text) => {
    const s = document.createElement('span');
    s.className = 'w-word';
    s.textContent = text;
    return s;
  });
  $('duaAr').replaceChildren(...ar.flatMap((s, i) => (i ? [' ', s] : [s])));
  const tr = [];
  const row = [];
  d.tr.forEach((piece) => {
    const joinHyphen = piece.endsWith('-');
    const joinPlain = piece.endsWith('+');
    const s = document.createElement('span');
    s.className = 'w-word';
    s.textContent = joinPlain ? piece.slice(0, -1) : piece;
    tr.push(s);
    row.push(s);
    if (!joinHyphen && !joinPlain) row.push(' ');
  });
  $('duaTr').replaceChildren(...row);
  wordEls = ar.map((s, i) => [s, tr[i]]);
  $('duaPlay').hidden = !d.parts;
}

function mark(index) {
  wordEls.forEach((pair, i) => pair.forEach((el) => el && el.classList.toggle('on', i === index)));
}

function setPlaying(on) {
  $('duaPlay').classList.toggle('playing', on);
  $('duaPlay').setAttribute('aria-label', on ? 'Pause' : 'Play');
  cancelAnimationFrame(frame);
  if (on) frame = requestAnimationFrame(follow);
}

function stopDua() {
  partIndex = -1;
  audio.pause();
  audio.removeAttribute('src');
  setPlaying(false);
  mark(-1);
}

function startPart(i) {
  const part = dua.parts[i];
  partIndex = i;
  audio.src = AUDIO_BASE + part.url;
  audio.volume = state.settings.volume;
  const begin = () => {
    if (partIndex !== i) return;
    audio.currentTime = part.from / 1000;
    audio.play().then(() => setPlaying(true)).catch(() => failDua());
  };
  if (audio.readyState >= 1) begin(); else audio.addEventListener('loadedmetadata', begin, { once: true });
  audio.load();
}

function nextPart() {
  if (partIndex >= 0 && partIndex + 1 < dua.parts.length) startPart(partIndex + 1); else stopDua();
}

// Runs while the recitation plays: finds the word being recited and stops at the end of the dua.
function follow() {
  if (partIndex < 0 || audio.paused) return;
  const part = dua.parts[partIndex];
  const t = audio.currentTime * 1000;
  if (part.to !== null && t >= part.to + 120) { nextPart(); return; }
  // let the last word of a cut clip fade instead of stopping dead
  audio.volume = part.to !== null && t > part.to ? state.settings.volume * Math.max(0, 1 - (t - part.to) / 120) : state.settings.volume;
  const before = dua.parts.slice(0, partIndex).reduce((n, p) => n + p.words.length, 0);
  let at = -1;
  part.words.forEach(([from], n) => { if (t >= from - 40) at = n; });
  mark(at < 0 ? -1 : before + at);
  frame = requestAnimationFrame(follow);
}

function failDua() {
  stopDua();
  $('duaNote').textContent = state.strings.duaOffline;
  $('duaNote').hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { $('duaNote').hidden = true; }, 6000);
}

$('duaPlay').addEventListener('click', () => {
  if (!dua || !dua.parts) return;
  $('duaNote').hidden = true;
  if (partIndex >= 0 && !audio.paused) { audio.pause(); setPlaying(false); return; } // pause: the word stays lit
  if (partIndex >= 0) { audio.play().then(() => setPlaying(true)).catch(() => failDua()); return; } // go on
  startPart(0);
});
audio.addEventListener('ended', nextPart);
audio.addEventListener('error', () => { if (partIndex >= 0) failDua(); });
api.onPrayer(() => stopDua()); // the adhan comes first

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
