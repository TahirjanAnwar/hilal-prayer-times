// The Quran tab: the list of surahs and a reader that plays the recitation and lights up
// each word as it is recited. The text, the translations and the word timings come from
// Quran.com (fetched by the main process and kept on this computer after the first read);
// the audio is streamed. Nothing here writes or changes a single word of the text.
/* global QURAN_LIST, t, state, api, showView */

const q$ = (id) => document.getElementById(id);

const Q_SPEEDS = [0.5, 0.75, 1, 1.25];
const qAudio = q$('qAudio');
const q = {
  ch: 0,          // the open surah (0: the list)
  data: null,     // { verses: [{ n, w: [words], t }], times: { n: { from, to, seg } }, audio }
  lang: '',       // the language the open surah was loaded in
  vi: -1, wi: -1, // the lit verse (index) and word
  words: [],      // per verse: its word elements
  rows: [],       // per verse: its block
  repeat: false,
  startAt: null,  // seconds to jump to once the audio is ready
  load: 0,        // counts loads, so a slow answer for an earlier surah is dropped
};

const qStore = {
  get(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* not kept */ } },
};
const qLast = () => {
  const l = qStore.get('quranLast', null);
  return l && QURAN_LIST[l.c - 1] && l.v >= 1 && l.v <= QURAN_LIST[l.c - 1][2] ? l : null;
};
const qEl = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ---------- the list ----------
function qRenderHome() {
  const last = qLast();
  const label = last ? t('quranContinue', { s: QURAN_LIST[last.c - 1][0], v: `${last.c}:${last.v}` }) : t('quranRead');
  q$('qCardText').textContent = label;
  q$('qContinue').hidden = !last;
  q$('qContinueText').textContent = label;
  const list = q$('qList');
  if (list.dataset.lang === state.settings.language) return;
  list.dataset.lang = state.settings.language;
  list.textContent = '';
  QURAN_LIST.forEach(([name, arabic, count], i) => {
    const b = qEl('button', 'q-row');
    b.type = 'button';
    b.append(qEl('span', 'q-num', i + 1));
    const mid = qEl('span', 'q-names');
    mid.append(qEl('span', 'q-name', name), qEl('span', 'q-count', t('quranVerses', { n: count })));
    b.append(mid, qEl('span', 'q-arabic', arabic));
    b.addEventListener('click', () => qOpen(i + 1, 1));
    list.append(b);
  });
}

// ---------- the reader ----------
function qShowReader(on) {
  q$('qHome').hidden = on;
  q$('qReader').hidden = !on;
  q$('view-quran').classList.toggle('reading', on);
}

function qClose() {
  qStop();
  q.ch = 0;
  q.data = null;
  qShowReader(false);
  qRenderHome();
}

function qStop() {
  qAudio.pause();
  qAudio.removeAttribute('src');
  qAudio.load();
  q.startAt = null;
  qPlayUi();
}

async function qOpen(ch, verse) {
  qStop();
  const mine = ++q.load;
  q.ch = ch;
  q.data = null;
  q.vi = q.wi = -1;
  q.lang = state.settings.language;
  const [name, arabic] = QURAN_LIST[ch - 1];
  q$('qName').textContent = `${ch}. ${name}`;
  q$('qNameAr').textContent = arabic;
  const body = q$('qBody');
  body.textContent = '';
  body.append(qEl('p', 'q-msg', t('quranLoading')));
  q$('qBar').hidden = true;
  qShowReader(true);
  let data;
  try {
    data = await api.quranChapter(ch, q.lang);
  } catch {
    data = null;
  }
  if (mine !== q.load) return;
  body.textContent = '';
  if (!data || !data.verses || !data.verses.length) {
    const retry = qEl('button', 'primary', t('quranRetry'));
    retry.type = 'button';
    retry.addEventListener('click', () => qOpen(ch, verse));
    body.append(qEl('p', 'q-msg', t('quranNeedsNet')), retry);
    return;
  }
  q.data = data;
  q.words = [];
  q.rows = [];
  if (QURAN_LIST[ch - 1][3]) body.append(qEl('div', 'q-bismillah', 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ'));
  data.verses.forEach((v, vi) => {
    const row = qEl('div', 'q-verse');
    const ar = qEl('div', 'q-ar');
    ar.dir = 'rtl';
    ar.lang = 'ar';
    const spans = v.w.map((w, wi) => {
      const s = qEl('span', 'q-w', w);
      s.addEventListener('click', (e) => { e.stopPropagation(); qSeek(vi, wi, true); });
      return s;
    });
    spans.forEach((s) => ar.append(s, ' '));
    ar.append(qEl('span', 'q-end', v.n.toLocaleString('ar-EG')));
    row.append(ar);
    if (v.t) {
      const tr = qEl('div', 'q-tr');
      tr.append(qEl('span', 'q-tr-n', `${v.n}. `), v.t);
      row.append(tr);
    }
    row.addEventListener('click', () => qSeek(vi, -1, true));
    q.words.push(spans);
    q.rows.push(row);
    body.append(row);
  });
  q$('qBar').hidden = false;
  const vi = Math.max(0, data.verses.findIndex((v) => v.n === verse));
  qLight(vi, -1);
  q.rows[vi].scrollIntoView({ block: vi ? 'center' : 'end' });
  if (!vi) body.scrollTop = 0;
  q.startAt = qFrom(vi) / 1000;
  qPlayUi();
}

const qTime = (vi) => (q.data && q.data.times[q.data.verses[vi] && q.data.verses[vi].n]) || null;
const qFrom = (vi) => { const tm = qTime(vi); return tm ? tm.from : 0; };

// Lights one verse and one word of it (wi -1: the verse only).
function qLight(vi, wi) {
  if (vi === q.vi && wi === q.wi) return;
  if (vi !== q.vi) {
    if (q.rows[q.vi]) q.rows[q.vi].classList.remove('on');
    if (q.rows[vi]) {
      q.rows[vi].classList.add('on');
      if (q.vi !== -1) q.rows[vi].scrollIntoView({ block: 'center', behavior: 'smooth' });
      qStore.set('quranLast', { c: q.ch, v: q.data.verses[vi].n });
    }
  }
  const old = q.words[q.vi] && q.words[q.vi][q.wi];
  if (old) old.classList.remove('on');
  const now = q.words[vi] && q.words[vi][wi];
  if (now) now.classList.add('on');
  q.vi = vi;
  q.wi = wi;
}

// The verse and the word being recited at a moment (milliseconds into the recording).
function qAt(ms) {
  const n = q.data.verses.length;
  let vi = q.vi;
  let tm = qTime(vi);
  if (!tm || ms < tm.from || ms >= tm.to) {
    vi = -1;
    for (let i = 0; i < n; i++) {
      const x = qTime(i);
      if (x && ms >= x.from && ms < x.to) { vi = i; break; }
    }
    if (vi === -1) return ms < qFrom(0) ? [0, -1] : [q.vi === -1 ? n - 1 : q.vi, q.wi];
    tm = qTime(vi);
  }
  let wi = -1;
  for (const [w, from] of tm.seg) {
    if (ms < from) break;
    wi = w - 1;
  }
  return [vi, wi];
}

function qTick() {
  if (!q.data || qAudio.paused) return;
  const ms = qAudio.currentTime * 1000;
  const [vi, wi] = qAt(ms);
  // Repeat: when the recitation runs on into the next verse, go back to the start of this one.
  if (q.repeat && q.vi !== -1 && vi === q.vi + 1) {
    qAudio.currentTime = qFrom(q.vi) / 1000;
  } else {
    qLight(vi, wi);
  }
  requestAnimationFrame(qTick);
}

function qSeek(vi, wi, play) {
  if (!q.data || !q.rows[vi]) return;
  const tm = qTime(vi);
  let ms = tm ? tm.from : 0;
  if (tm && wi >= 0) {
    const seg = tm.seg.find((s) => s[0] === wi + 1);
    if (seg) ms = seg[1];
  }
  qLight(vi, wi);
  if (qAudio.getAttribute('src') && qAudio.readyState > 0) qAudio.currentTime = ms / 1000;
  else q.startAt = ms / 1000;
  if (play) qPlay();
}

function qPlay() {
  if (!q.data) return;
  if (!qAudio.getAttribute('src')) {
    qAudio.src = q.data.audio;
    qAudio.load();
  }
  qApplySpeed();
  qAudio.play().catch(() => qPlayUi());
}

function qPlayUi() {
  const playing = !qAudio.paused && !qAudio.ended;
  q$('qPlay').classList.toggle('playing', playing);
  q$('qPlay').title = t(playing ? 'quranPause' : 'quranPlay');
}

function qApplySpeed() {
  const s = Q_SPEEDS.includes(qStore.get('quranSpeed', 1)) ? qStore.get('quranSpeed', 1) : 1;
  qAudio.defaultPlaybackRate = s;
  qAudio.playbackRate = s;
  q$('qSpeed').textContent = `${s}×`;
  q$('qSpeed').classList.toggle('changed', s !== 1);
}

qAudio.addEventListener('loadedmetadata', () => {
  if (q.startAt != null) { qAudio.currentTime = q.startAt; q.startAt = null; }
  qApplySpeed();
});
qAudio.addEventListener('play', () => { qPlayUi(); requestAnimationFrame(qTick); });
qAudio.addEventListener('pause', qPlayUi);
qAudio.addEventListener('ended', qPlayUi);
qAudio.addEventListener('error', () => {
  if (!qAudio.getAttribute('src')) return;
  qPlayUi();
  q$('qNote').textContent = t('quranNeedsNet');
  q$('qNote').hidden = false;
  setTimeout(() => { q$('qNote').hidden = true; }, 5000);
});

q$('qPlay').addEventListener('click', () => { if (qAudio.paused) qPlay(); else qAudio.pause(); });
q$('qPrev').addEventListener('click', () => qSeek(Math.max(0, q.vi - 1), -1, !qAudio.paused));
q$('qNext').addEventListener('click', () => qSeek(Math.min(q.rows.length - 1, q.vi + 1), -1, !qAudio.paused));
q$('qSpeed').addEventListener('click', () => {
  const s = qStore.get('quranSpeed', 1);
  qStore.set('quranSpeed', Q_SPEEDS[(Q_SPEEDS.indexOf(s) + 1) % Q_SPEEDS.length]);
  qApplySpeed();
});
q$('qRepeat').addEventListener('click', () => {
  q.repeat = !q.repeat;
  q$('qRepeat').classList.toggle('changed', q.repeat);
  q$('qRepeat').setAttribute('aria-pressed', q.repeat);
});
q$('qBack').addEventListener('click', qClose);
const qResume = async () => {
  const last = qLast();
  await showView('quran');
  if (last) qOpen(last.c, last.v);
};
q$('qContinue').addEventListener('click', qResume);
q$('quranCard').addEventListener('click', qResume);

// Called by the page whenever the settings change (language) and when another tab is opened.
function quranOnState() {
  q$('qPrev').title = t('quranPrev');
  q$('qNext').title = t('quranNext');
  q$('qRepeat').title = t('quranRepeat');
  q$('qBack').title = t('quranBack');
  qPlayUi();
  qApplySpeed();
  qRenderHome();
  // The translation follows the app's language: load the open surah again in the new one.
  if (q.ch && q.lang !== state.settings.language) qOpen(q.ch, q.data && q.vi >= 0 ? q.data.verses[q.vi].n : 1);
}
function quranOnView(name) {
  if (name !== 'quran') qAudio.pause();
  qRenderHome();
}
