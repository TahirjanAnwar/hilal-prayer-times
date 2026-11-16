/* global api */
// The child lock screen. The app closes this window when the time is up or a parent unlocks.
const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');

let info = null;
let S = {};
let pin = '';
let waitUntil = 0;

function renderCount() {
  const s = Math.max(0, Math.ceil((info.until - Date.now()) / 1000));
  $('count').textContent = `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  const wait = Math.ceil((waitUntil - Date.now()) / 1000);
  if (wait > 0) $('msg').textContent = S.pinWait.replace('{s}', wait);
  else if (waitUntil) { waitUntil = 0; $('msg').textContent = ''; }
  $('padOk').disabled = wait > 0 || pin.length < 4;
}

function renderPin() {
  $('dots').textContent = '●'.repeat(pin.length) || ' ';
  renderCount();
}

function showPad(show) {
  pin = '';
  $('msg').textContent = '';
  $('pad').hidden = !show;
  $('parentBtn').hidden = show;
  renderPin();
}

async function submit() {
  if (pin.length < 4 || Date.now() < waitUntil) return;
  const r = await api.lockPin(pin);
  if (r.ok) return; // the window is closed by the app
  pin = '';
  if (r.wait > 0) waitUntil = Date.now() + r.wait * 1000;
  else $('msg').textContent = S.pinWrong;
  renderPin();
}

(async () => {
  info = await api.lockInfo();
  S = info.strings;
  document.documentElement.lang = info.lang;
  document.documentElement.dir = S.dir;
  $('title').textContent = info.test ? S.lockTest : S.timeFor.replace('{p}', S[info.prayer] || '');
  $('sub').textContent = S.lockSub;
  $('reward').textContent = info.test ? '' : S.rewardLock.replace('{n}', info.per);
  $('leftLabel').textContent = S.lockLeft;
  $('parentBtn').textContent = S.lockParent;
  $('padLabel').textContent = S.pinEnter;
  $('padCancel').textContent = S.cancel;
  $('padOk').textContent = S.unlock;
  if (info.wait > 0) waitUntil = Date.now() + info.wait * 1000;

  const keys = $('keys');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k;
    if (!k) b.className = 'blank';
    b.addEventListener('click', () => {
      if (k === '⌫') pin = pin.slice(0, -1);
      else if (k && pin.length < 12) pin += k;
      $('msg').textContent = '';
      renderPin();
    });
    keys.append(b);
  }
  $('parentBtn').addEventListener('click', () => showPad(true));
  $('padCancel').addEventListener('click', () => showPad(false));
  $('padOk').addEventListener('click', submit);
  renderPin();
  setInterval(renderCount, 500);
})();
