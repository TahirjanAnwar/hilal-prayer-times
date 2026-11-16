/* global api */
// Desktop widget: the next prayer and a countdown to it.
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

let state = null;
let times = null;

function render() {
  if (!state) return;
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
})();
